#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

// Claude 최적화 설정
const CLAUDE_MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const CLAUDE_MAX_CHUNK_SIZE = 2 * 1024 * 1024;    // 2MB
const CLAUDE_MAX_LINES = 2000;                     // 최대 2000줄
const CLAUDE_MAX_DIR_ITEMS = 1000;                 // 디렉토리 항목 최대 1000개

// 기본 허용 디렉토리들
const DEFAULT_ALLOWED_DIRECTORIES = [
  process.env.HOME || '/home',
  '/tmp',
  '/Users', 
  '/home'
];

// 기본 제외 패턴 (보안 및 성능)
const DEFAULT_EXCLUDE_PATTERNS = [
  '.venv', 'venv', 'node_modules', '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.coverage',
  'dist', 'build', 'target', 'bin', 'obj', '.vs', '.vscode',
  '*.pyc', '*.pyo', '*.pyd', '.DS_Store', 'Thumbs.db'
];

// 유틸리티 함수들
function isPathAllowed(targetPath: string): boolean {
  const absolutePath = path.resolve(targetPath);
  return DEFAULT_ALLOWED_DIRECTORIES.some(allowedDir => 
    absolutePath.startsWith(path.resolve(allowedDir))
  );
}

function safePath(inputPath: string): string {
  if (!isPathAllowed(inputPath)) {
    throw new Error(`Access denied to path: ${inputPath}`);
  }
  return path.resolve(inputPath);
}

function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function shouldExcludePath(targetPath: string, excludePatterns: string[] = []): boolean {
  const patterns = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];
  const pathName = path.basename(targetPath).toLowerCase();
  const pathParts = targetPath.split(path.sep);
  
  return patterns.some(pattern => {
    const patternLower = pattern.toLowerCase();
    
    if (pattern.includes('*') || pattern.includes('?')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      return regex.test(pathName);
    }
    
    return pathParts.some(part => part.toLowerCase() === patternLower) || 
           pathName === patternLower;
  });
}

function truncateContent(content: string, maxSize: number = CLAUDE_MAX_RESPONSE_SIZE) {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxSize) {
    return { content, truncated: false };
  }
  
  let truncated = content;
  while (Buffer.byteLength(truncated, 'utf8') > maxSize) {
    truncated = truncated.slice(0, -1);
  }
  
  return {
    content: truncated,
    truncated: true,
    original_size: contentBytes,
    truncated_size: Buffer.byteLength(truncated, 'utf8')
  };
}

// 파일 해시 계산
function calculateFileHash(filePath: string, algorithm: string = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = require('fs').createReadStream(filePath);
    
    stream.on('data', (data: Buffer) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// diff 생성
function generateDiff(original: string, modified: string, filename: string = "file"): string {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  
  const diff = [`--- a/${filename}`, `+++ b/${filename}`];
  let originalIndex = 0;
  let modifiedIndex = 0;
  
  while (originalIndex < originalLines.length || modifiedIndex < modifiedLines.length) {
    if (originalIndex < originalLines.length && modifiedIndex < modifiedLines.length) {
      if (originalLines[originalIndex] === modifiedLines[modifiedIndex]) {
        originalIndex++;
        modifiedIndex++;
        continue;
      }
    }
    
    // 간단한 diff 구현
    if (originalIndex < originalLines.length) {
      diff.push(`-${originalLines[originalIndex]}`);
      originalIndex++;
    }
    if (modifiedIndex < modifiedLines.length) {
      diff.push(`+${modifiedLines[modifiedIndex]}`);
      modifiedIndex++;
    }
  }
  
  return diff.join('\n');
}

// MCP 서버 생성
const server = new Server(
  {
    name: 'fast-filesystem',
    version: '2.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 툴 목록 정의
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fast_list_allowed_directories',
        description: '허용된 디렉토리 목록을 조회합니다',
        inputSchema: { 
          type: 'object', 
          properties: {}, 
          required: [] 
        }
      },
      {
        name: 'fast_read_file',
        description: '파일을 읽습니다 (청킹 지원)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '읽을 파일 경로' },
            start_offset: { type: 'number', description: '시작 바이트 위치' },
            max_size: { type: 'number', description: '읽을 최대 크기' },
            line_start: { type: 'number', description: '시작 라인 번호' },
            line_count: { type: 'number', description: '읽을 라인 수' },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_write_file',
        description: '파일을 쓰거나 수정합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '파일 경로' },
            content: { type: 'string', description: '파일 내용' },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' },
            create_dirs: { type: 'boolean', description: '디렉토리 자동 생성', default: true },
            append: { type: 'boolean', description: '추가 모드', default: false }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'fast_list_directory',
        description: '디렉토리 목록을 조회합니다 (페이징 지원)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '디렉토리 경로' },
            page: { type: 'number', description: '페이지 번호', default: 1 },
            page_size: { type: 'number', description: '페이지당 항목 수' },
            pattern: { type: 'string', description: '파일명 필터 패턴' },
            show_hidden: { type: 'boolean', description: '숨김 파일 표시', default: false },
            sort_by: { type: 'string', description: '정렬 기준', enum: ['name', 'size', 'modified', 'type'], default: 'name' },
            reverse: { type: 'boolean', description: '역순 정렬', default: false }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_get_file_info',
        description: '파일/디렉토리 상세 정보를 조회합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '조회할 경로' }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_create_directory',
        description: '디렉토리를 생성합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '생성할 디렉토리 경로' },
            recursive: { type: 'boolean', description: '재귀적 생성', default: true }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_search_files',
        description: '파일을 검색합니다 (이름/내용)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '검색할 디렉토리' },
            pattern: { type: 'string', description: '검색 패턴' },
            content_search: { type: 'boolean', description: '파일 내용 검색', default: false },
            case_sensitive: { type: 'boolean', description: '대소문자 구분', default: false },
            max_results: { type: 'number', description: '최대 결과 수', default: 100 },
            file_extensions: { type: 'string', description: '파일 확장자 필터 (쉼표로 구분)' }
          },
          required: ['path', 'pattern']
        }
      },
      {
        name: 'fast_get_directory_tree',
        description: '디렉토리 트리 구조를 가져옵니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '루트 디렉토리 경로' },
            max_depth: { type: 'number', description: '최대 깊이', default: 3 },
            show_hidden: { type: 'boolean', description: '숨김 파일 표시', default: false },
            include_files: { type: 'boolean', description: '파일 포함', default: true }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_get_disk_usage',
        description: '디스크 사용량을 조회합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '조회할 경로', default: '/' }
          }
        }
      },
      {
        name: 'fast_find_large_files',
        description: '큰 파일들을 찾습니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '검색할 디렉토리' },
            min_size: { type: 'string', description: '최소 크기 (예: 100MB, 1GB)', default: '100MB' },
            max_results: { type: 'number', description: '최대 결과 수', default: 50 }
          },
          required: ['path']
        }
      },
      // 🆕 새로 추가된 도구들
      {
        name: 'fast_move_file',
        description: '파일이나 디렉토리를 이동하거나 이름을 변경합니다',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '원본 경로' },
            destination: { type: 'string', description: '대상 경로' }
          },
          required: ['source', 'destination']
        }
      },
      {
        name: 'fast_copy_file',
        description: '파일이나 디렉토리를 복사합니다',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '원본 경로' },
            destination: { type: 'string', description: '대상 경로' },
            overwrite: { type: 'boolean', description: '덮어쓰기 허용', default: false }
          },
          required: ['source', 'destination']
        }
      },
      {
        name: 'fast_delete_file',
        description: '파일이나 디렉토리를 삭제합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '삭제할 경로' },
            recursive: { type: 'boolean', description: '재귀적 삭제 (디렉토리용)', default: false }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_edit_file',
        description: '파일의 특정 부분을 수정합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '편집할 파일 경로' },
            edits: { 
              type: 'array', 
              description: '수정 사항 배열',
              items: {
                type: 'object',
                properties: {
                  old_text: { type: 'string', description: '찾을 텍스트' },
                  new_text: { type: 'string', description: '바꿀 텍스트' }
                },
                required: ['old_text', 'new_text']
              }
            },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' },
            create_backup: { type: 'boolean', description: '백업 파일 생성', default: true },
            dry_run: { type: 'boolean', description: '실제 수정 없이 미리보기', default: false }
          },
          required: ['path', 'edits']
        }
      },
      {
        name: 'fast_compare_files',
        description: '두 파일을 비교합니다',
        inputSchema: {
          type: 'object',
          properties: {
            file1: { type: 'string', description: '첫 번째 파일 경로' },
            file2: { type: 'string', description: '두 번째 파일 경로' },
            method: { type: 'string', description: '비교 방법', enum: ['hash', 'size', 'content'], default: 'hash' }
          },
          required: ['file1', 'file2']
        }
      },
      {
        name: 'fast_read_file_streaming',
        description: '향상된 스트리밍 파일 읽기 (head/tail/range 지원)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '읽을 파일 경로' },
            mode: { type: 'string', description: '읽기 모드', enum: ['full', 'head', 'tail', 'range'], default: 'full' },
            head_lines: { type: 'number', description: '처음 N줄 읽기' },
            tail_lines: { type: 'number', description: '마지막 N줄 읽기' },
            line_range: { type: 'string', description: '줄 범위 (예: "10-20", "50-")' },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_calculate_directory_size',
        description: '디렉토리의 전체 크기를 계산합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '계산할 디렉토리 경로' },
            include_subdirs: { type: 'boolean', description: '하위 디렉토리 포함', default: true }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_watch_directory',
        description: '디렉토리 변경사항을 모니터링합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '모니터링할 디렉토리 경로' },
            duration: { type: 'number', description: '모니터링 시간 (초)', default: 10 }
          },
          required: ['path']
        }
      }
    ],
  };
});

// 서버 시작
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fast Filesystem MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});