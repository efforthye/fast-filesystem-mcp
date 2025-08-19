#!/usr/bin/env node

/*
 * Copyright 2025 efforthye
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { 
  ResponseSizeMonitor, 
  ContinuationTokenManager, 
  AutoChunkingHelper, 
  createChunkedResponse,
  globalTokenManager,
  type ContinuationToken,
  type ChunkedResponse
} from './auto-chunking.js';
import { 
  handleReadFileWithAutoChunking,
  handleListDirectoryWithAutoChunking,
  handleSearchFilesWithAutoChunking
} from './enhanced-handlers.js';
// import { searchCode, SearchResult } from './search.js';

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

// 백업 파일 설정 (환경변수나 설정으로 제어)
const CREATE_BACKUP_FILES = process.env.CREATE_BACKUP_FILES === 'true'; // 기본값: false, true로 설정시만 활성화

// 기본 제외 패턴 (보안 및 성능)
const DEFAULT_EXCLUDE_PATTERNS = [
  '.venv', 'venv', 'node_modules', '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.coverage',
  'dist', 'build', 'target', 'bin', 'obj', '.vs', '.vscode',
  '*.pyc', '*.pyo', '*.pyd', '.DS_Store', 'Thumbs.db'
];

// 이모지 감지 함수 (제거하지 않고 경고만)
function detectEmojis(text: string): { hasEmojis: boolean; count: number; positions: number[] } {
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]/gu;
  
  const matches = Array.from(text.matchAll(emojiRegex));
  const positions = matches.map(match => match.index || 0);
  
  return {
    hasEmojis: matches.length > 0,
    count: matches.length,
    positions: positions
  };
}

// 이모지 제거 함수 (선택적)
function removeEmojis(text: string): string {
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]/gu;
  return text.replace(emojiRegex, '');
}

// 파일 타입별 이모지 가이드라인
function getEmojiGuideline(filePath: string): { shouldAvoidEmojis: boolean; reason: string; fileType: string } {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath).toLowerCase();
  
  // 코드 파일들
  const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt'];
  
  // 설정 파일들
  const configExtensions = ['.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf'];
  const configFiles = ['package.json', 'tsconfig.json', 'webpack.config.js', 'dockerfile', 'makefile'];
  
  // 문서 파일들
  const docExtensions = ['.md', '.txt', '.rst', '.adoc'];
  
  if (codeExtensions.includes(ext)) {
    return {
      shouldAvoidEmojis: true,
      reason: 'Emojis not recommended in code files',
      fileType: 'code'
    };
  }
  
  if (configExtensions.includes(ext) || configFiles.includes(fileName)) {
    return {
      shouldAvoidEmojis: true,
      reason: 'Emojis not recommended in config files',
      fileType: 'config'
    };
  }
  
  if (docExtensions.includes(ext)) {
    return {
      shouldAvoidEmojis: true,
      reason: 'Emojis not recommended in files',
      fileType: 'documentation'
    };
  }
  
  return {
    shouldAvoidEmojis: true,
    reason: 'Emojis not recommended in files',
    fileType: 'general'
  };
}

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
      const regex = new RegExp(pattern.replace(/\\*/g, '.*').replace(/\\?/g, '.'));
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

// 대용량 파일 작성을 위한 유틸리티 함수들
async function writeFileWithRetry(
  filePath: string, 
  content: string, 
  encoding: BufferEncoding, 
  chunkSize: number,
  maxRetries: number,
  append: boolean
): Promise<{retryCount: number; totalTime: number}> {
  let retryCount = 0;
  const startTime = Date.now();
  
  while (retryCount <= maxRetries) {
    try {
      await writeFileStreaming(filePath, content, encoding, chunkSize, append);
      return { retryCount, totalTime: Date.now() - startTime };
    } catch (error) {
      retryCount++;
      if (retryCount > maxRetries) {
        throw error;
      }
      
      const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw new Error('Max retry attempts exceeded');
}

async function writeFileStreaming(
  filePath: string, 
  content: string, 
  encoding: BufferEncoding, 
  chunkSize: number,
  append: boolean
): Promise<void> {
  const buffer = Buffer.from(content, encoding);
  const fileHandle = await fs.open(filePath, append ? 'a' : 'w');
  
  try {
    let position = 0;
    while (position < buffer.length) {
      const end = Math.min(position + chunkSize, buffer.length);
      const chunk = buffer.subarray(position, end);
      
      await fileHandle.write(chunk);
      position = end;
      
      // 메모리 압박 방지를 위한 이벤트 루프 양보
      if (position % (chunkSize * 10) === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }
    
    await fileHandle.sync(); // 디스크에 강제 동기화
  } finally {
    await fileHandle.close();
  }
}

async function checkDiskSpace(dirPath: string, requiredBytes: number): Promise<void> {
  try {
    const { stdout } = await execAsync(`df -B1 "${dirPath}" | tail -1 | awk '{print $4}'`);
    const availableBytes = parseInt(stdout.trim());
    
    if (availableBytes < requiredBytes * 1.5) {
      throw new Error(
        `Insufficient disk space. Required: ${formatSize(requiredBytes)}, ` +
        `Available: ${formatSize(availableBytes)}`
      );
    }
  } catch (error) {
    console.warn('Could not check disk space:', error);
  }
}

async function getOriginalFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

// MCP 서버 생성
const server = new Server(
  {
    name: 'fast-filesystem',
    version: '3.2.4',
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
        description: '파일을 읽습니다 (자동 청킹 지원)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '읽을 파일 경로' },
            start_offset: { type: 'number', description: '시작 바이트 위치' },
            max_size: { type: 'number', description: '읽을 최대 크기' },
            line_start: { type: 'number', description: '시작 라인 번호' },
            line_count: { type: 'number', description: '읽을 라인 수' },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' },
            continuation_token: { type: 'string', description: '이전 호출의 연속 토큰' },
            auto_chunk: { type: 'boolean', description: '자동 청킹 활성화', default: true }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_read_multiple_files',
        description: '여러 파일의 내용을 동시에 읽습니다 (순차적 읽기 지원)',
        inputSchema: {
          type: 'object',
          properties: {
            paths: { 
              type: 'array', 
              items: { type: 'string' }, 
              description: '읽을 파일 경로들' 
            },
            continuation_tokens: {
              type: 'object',
              description: '파일별 continuation token (이전 호출에서 반환된 값)'
            },
            auto_continue: {
              type: 'boolean',
              description: '자동으로 전체 파일 읽기 (기본값: true)',
              default: true
            },
            chunk_size: {
              type: 'number',
              description: '청크 크기 (바이트, 기본값: 1MB)',
              default: 1048576
            }
          },
          required: ['paths']
        }
      },
      {
        name: 'fast_write_file',
        description: '파일을 쓰거나 수정합니다 (이모지 가이드라인 제공)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '파일 경로' },
            content: { type: 'string', description: '파일 내용' },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' },
            create_dirs: { type: 'boolean', description: '디렉토리 자동 생성', default: true },
            append: { type: 'boolean', description: '추가 모드', default: false },
            force_remove_emojis: { type: 'boolean', description: '이모지 강제 제거 (기본값: false)', default: false }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'fast_large_write_file',
        description: '대용량 파일을 안정적으로 작성합니다 (스트리밍, 재시도, 백업, 검증 기능)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '파일 경로' },
            content: { type: 'string', description: '파일 내용' },
            encoding: { type: 'string', description: '텍스트 인코딩', default: 'utf-8' },
            create_dirs: { type: 'boolean', description: '디렉토리 자동 생성', default: true },
            append: { type: 'boolean', description: '추가 모드', default: false },
            chunk_size: { type: 'number', description: '청크 크기 (바이트)', default: 65536 },
            backup: { type: 'boolean', description: '기존 파일 백업 생성', default: true },
            retry_attempts: { type: 'number', description: '재시도 횟수', default: 3 },
            verify_write: { type: 'boolean', description: '작성 후 검증', default: true },
            force_remove_emojis: { type: 'boolean', description: '이모지 강제 제거 (기본값: false)', default: false }
          },
          required: ['path', 'content']
        }
      },
      {
        name: 'fast_list_directory',
        description: '디렉토리 목록을 조회합니다 (자동 청킹 페이징 지원)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '디렉토리 경로' },
            page: { type: 'number', description: '페이지 번호', default: 1 },
            page_size: { type: 'number', description: '페이지당 항목 수' },
            pattern: { type: 'string', description: '파일명 필터 패턴' },
            show_hidden: { type: 'boolean', description: '숨김 파일 표시', default: false },
            sort_by: { type: 'string', description: '정렬 기준', enum: ['name', 'size', 'modified', 'type'], default: 'name' },
            reverse: { type: 'boolean', description: '역순 정렬', default: false },
            continuation_token: { type: 'string', description: '이전 호출의 연속 토큰' },
            auto_chunk: { type: 'boolean', description: '자동 청킹 활성화', default: true }
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
        description: '파일을 검색합니다 (이름/내용) - 자동 청킹, 정규표현식, 컨텍스트, 라인번호 지원',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '검색할 디렉토리' },
            pattern: { type: 'string', description: '검색 패턴 (정규표현식 지원)' },
            content_search: { type: 'boolean', description: '파일 내용 검색', default: false },
            case_sensitive: { type: 'boolean', description: '대소문자 구분', default: false },
            max_results: { type: 'number', description: '최대 결과 수', default: 100 },
            context_lines: { type: 'number', description: '매치된 라인 주변 컨텍스트 라인 수', default: 0 },
            file_pattern: { type: 'string', description: '파일명 필터 패턴 (*.js, *.txt 등)', default: '' },
            include_binary: { type: 'boolean', description: '바이너리 파일 포함 여부', default: false },
            continuation_token: { type: 'string', description: '이전 호출의 연속 토큰' },
            auto_chunk: { type: 'boolean', description: '자동 청킹 활성화', default: true }
          },
          required: ['path', 'pattern']
        }
      },
      {
        name: 'fast_search_code',
        description: '코드 검색 (ripgrep 스타일) - 자동 청킹, 라인번호와 컨텍스트 제공',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '검색할 디렉토리' },
            pattern: { type: 'string', description: '검색 패턴 (정규표현식 지원)' },
            file_pattern: { type: 'string', description: '파일 확장자 필터 (*.js, *.ts 등)', default: '' },
            context_lines: { type: 'number', description: '매치 주변 컨텍스트 라인 수', default: 2 },
            max_results: { type: 'number', description: '최대 결과 수', default: 50 },
            case_sensitive: { type: 'boolean', description: '대소문자 구분', default: false },
            include_hidden: { type: 'boolean', description: '숨김 파일 포함', default: false },
            max_file_size: { type: 'number', description: '검색할 최대 파일 크기 (MB)', default: 10 },
            continuation_token: { type: 'string', description: '이전 호출의 연속 토큰' },
            auto_chunk: { type: 'boolean', description: '자동 청킹 활성화', default: true }
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
      {
        name: 'fast_edit_file',
        description: '파일의 특정 부분을 수정합니다 (Python edit_file과 동일)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '편집할 파일 경로' },
            edits: { 
              type: 'array',
              description: '수정 사항 리스트 [{"old_text": "찾을 텍스트", "new_text": "바꿀 텍스트"}]',
              items: {
                type: 'object',
                properties: {
                  old_text: { type: 'string', description: '찾을 텍스트' },
                  new_text: { type: 'string', description: '바꿀 텍스트' }
                },
                required: ['old_text', 'new_text']
              }
            },
            encoding: { type: 'string', description: '파일 인코딩', default: 'utf-8' },
            create_backup: { type: 'boolean', description: '백업 파일 생성 여부', default: true },
            dry_run: { type: 'boolean', description: '실제 수정 없이 미리보기만', default: false }
          },
          required: ['path', 'edits']
        }
      },
      {
        name: 'fast_edit_block',
        description: '정교한 블록 편집: 정확한 문자열 매칭으로 안전한 편집 (desktop-commander 방식)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '편집할 파일 경로' },
            old_text: { type: 'string', description: '정확히 매칭할 기존 텍스트 (최소 컨텍스트 포함)' },
            new_text: { type: 'string', description: '새로운 텍스트' },
            expected_replacements: { type: 'number', description: '예상 교체 횟수 (안전성을 위해)', default: 1 },
            backup: { type: 'boolean', description: '백업 생성', default: true },
            word_boundary: { type: 'boolean', description: '단어 경계 검사 (부분 매칭 방지)', default: false },
            preview_only: { type: 'boolean', description: '미리보기만 (실제 편집 안함)', default: false },
            case_sensitive: { type: 'boolean', description: '대소문자 구분', default: true }
          },
          required: ['path', 'old_text', 'new_text']
        }
      },
      {
        name: 'fast_safe_edit',
        description: '안전한 스마트 편집: 위험 감지 및 대화형 확인',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '편집할 파일 경로' },
            old_text: { type: 'string', description: '교체할 텍스트' },
            new_text: { type: 'string', description: '새로운 텍스트' },
            safety_level: { 
              type: 'string', 
              enum: ['strict', 'moderate', 'flexible'],
              default: 'moderate',
              description: '안전 수준 (strict: 매우 안전, moderate: 균형, flexible: 유연)'
            },
            auto_add_context: { type: 'boolean', description: '자동 컨텍스트 추가', default: true },
            require_confirmation: { type: 'boolean', description: '위험시 확인 요구', default: true }
          },
          required: ['path', 'old_text', 'new_text']
        }
      },
      {
        name: 'fast_edit_multiple_blocks',
        description: '파일의 여러 부분을 한 번에 편집합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '편집할 파일 경로' },
            edits: {
              type: 'array',
              description: '편집 작업 목록',
              items: {
                type: 'object',
                properties: {
                  old_text: { type: 'string', description: '찾을 기존 텍스트' },
                  new_text: { type: 'string', description: '새로운 텍스트' },
                  line_number: { type: 'number', description: '라인 번호' },
                  mode: { 
                    type: 'string', 
                    enum: ['replace', 'insert_before', 'insert_after', 'delete_line'],
                    default: 'replace'
                  }
                }
              }
            },
            backup: { type: 'boolean', description: '백업 생성', default: true }
          },
          required: ['path', 'edits']
        }
      },
      {
        name: 'fast_edit_blocks',
        description: '여러개의 정교한 블록 편집을 한 번에 처리 (fast_edit_block 배열)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '편집할 파일 경로' },
            edits: {
              type: 'array',
              description: '정교한 블록 편집 목록',
              items: {
                type: 'object',
                properties: {
                  old_text: { type: 'string', description: '정확히 매칭할 기존 텍스트' },
                  new_text: { type: 'string', description: '새로운 텍스트' },
                  expected_replacements: { type: 'number', description: '예상 교체 횟수', default: 1 }
                },
                required: ['old_text', 'new_text']
              }
            },
            backup: { type: 'boolean', description: '백업 생성', default: true }
          },
          required: ['path', 'edits']
        }
      },
      {
        name: 'fast_extract_lines',
        description: '파일에서 특정 라인들을 추출합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '파일 경로' },
            line_numbers: { type: 'array', items: { type: 'number' }, description: '추출할 라인 번호들' },
            start_line: { type: 'number', description: '시작 라인 (범위 추출용)' },
            end_line: { type: 'number', description: '끝 라인 (범위 추출용)' },
            pattern: { type: 'string', description: '패턴으로 라인 추출' },
            context_lines: { type: 'number', description: '패턴 매칭시 앞뒤 컨텍스트 라인 수', default: 0 }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_copy_file',
        description: '파일이나 디렉토리를 복사합니다',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '원본 파일/디렉토리 경로' },
            destination: { type: 'string', description: '대상 경로' },
            overwrite: { type: 'boolean', description: '기존 파일 덮어쓰기', default: false },
            preserve_timestamps: { type: 'boolean', description: '타임스탬프 보존', default: true },
            recursive: { type: 'boolean', description: '디렉토리 재귀적 복사', default: true },
            create_dirs: { type: 'boolean', description: '대상 디렉토리 자동 생성', default: true }
          },
          required: ['source', 'destination']
        }
      },
      {
        name: 'fast_move_file',
        description: '파일이나 디렉토리를 이동하거나 이름을 변경합니다',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '원본 파일/디렉토리 경로' },
            destination: { type: 'string', description: '대상 경로' },
            overwrite: { type: 'boolean', description: '기존 파일 덮어쓰기', default: false },
            create_dirs: { type: 'boolean', description: '대상 디렉토리 자동 생성', default: true },
            backup_if_exists: { type: 'boolean', description: '대상 파일이 존재할 경우 백업 생성', default: false }
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
            path: { type: 'string', description: '삭제할 파일/디렉토리 경로' },
            recursive: { type: 'boolean', description: '디렉토리 재귀적 삭제', default: false },
            force: { type: 'boolean', description: '강제 삭제', default: false },
            backup_before_delete: { type: 'boolean', description: '삭제 전 백업 생성', default: false },
            confirm_delete: { type: 'boolean', description: '삭제 확인 (안전장치)', default: true }
          },
          required: ['path']
        }
      },
      {
        name: 'fast_batch_file_operations',
        description: '여러 파일에 대한 일괄 작업을 수행합니다',
        inputSchema: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description: '일괄 작업 목록',
              items: {
                type: 'object',
                properties: {
                  operation: { 
                    type: 'string', 
                    enum: ['copy', 'move', 'delete', 'rename'],
                    description: '작업 유형'
                  },
                  source: { type: 'string', description: '원본 경로' },
                  destination: { type: 'string', description: '대상 경로 (copy, move, rename용)' },
                  overwrite: { type: 'boolean', description: '덮어쓰기 허용', default: false }
                },
                required: ['operation', 'source']
              }
            },
            stop_on_error: { type: 'boolean', description: '에러 발생시 중단', default: true },
            dry_run: { type: 'boolean', description: '실제 실행 없이 미리보기', default: false },
            create_backup: { type: 'boolean', description: '변경 전 백업 생성', default: false }
          },
          required: ['operations']
        }
      },
      {
        name: 'fast_compress_files',
        description: '파일이나 디렉토리를 압축합니다',
        inputSchema: {
          type: 'object',
          properties: {
            paths: { 
              type: 'array', 
              items: { type: 'string' },
              description: '압축할 파일/디렉토리 경로들' 
            },
            output_path: { type: 'string', description: '출력 압축 파일 경로' },
            format: { 
              type: 'string', 
              enum: ['zip', 'tar', 'tar.gz', 'tar.bz2'],
              default: 'zip',
              description: '압축 형식'
            },
            compression_level: { 
              type: 'number', 
              minimum: 0, 
              maximum: 9, 
              default: 6,
              description: '압축 레벨 (0=저장만, 9=최고압축)'
            },
            exclude_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: '제외할 패턴들 (예: *.log, node_modules)',
              default: []
            }
          },
          required: ['paths', 'output_path']
        }
      },
      {
        name: 'fast_extract_archive',
        description: '압축 파일을 해제합니다',
        inputSchema: {
          type: 'object',
          properties: {
            archive_path: { type: 'string', description: '압축 파일 경로' },
            extract_to: { type: 'string', description: '해제할 디렉토리', default: '.' },
            overwrite: { type: 'boolean', description: '기존 파일 덮어쓰기', default: false },
            create_dirs: { type: 'boolean', description: '디렉토리 자동 생성', default: true },
            preserve_permissions: { type: 'boolean', description: '권한 보존', default: true },
            extract_specific: {
              type: 'array',
              items: { type: 'string' },
              description: '특정 파일들만 해제 (선택적)'
            }
          },
          required: ['archive_path']
        }
      },
      {
        name: 'fast_sync_directories',
        description: '두 디렉토리를 동기화합니다',
        inputSchema: {
          type: 'object',
          properties: {
            source_dir: { type: 'string', description: '원본 디렉토리' },
            target_dir: { type: 'string', description: '대상 디렉토리' },
            sync_mode: {
              type: 'string',
              enum: ['mirror', 'update', 'merge'],
              default: 'update',
              description: '동기화 모드'
            },
            delete_extra: { type: 'boolean', description: '대상에만 있는 파일 삭제', default: false },
            preserve_newer: { type: 'boolean', description: '더 새로운 파일 보존', default: true },
            dry_run: { type: 'boolean', description: '실제 실행 없이 미리보기', default: false },
            exclude_patterns: {
              type: 'array',
              items: { type: 'string' },
              description: '제외할 패턴들',
              default: ['.git', 'node_modules', '.DS_Store']
            }
          },
          required: ['source_dir', 'target_dir']
        }
      },
    ],
  };
});

// 툴 호출 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    let result;
    
    switch (name) {
      case 'fast_list_allowed_directories':
        result = await handleListAllowedDirectories();
        break;
      case 'fast_read_file':
        result = await handleReadFileWithAutoChunking(args);
        break;
      case 'fast_read_multiple_files':
        result = await handleReadMultipleFiles(args);
        break;
      case 'fast_write_file':
        result = await handleWriteFile(args);
        break;
      case 'fast_large_write_file':
        result = await handleLargeWriteFile(args);
        break;
      case 'fast_list_directory':
        result = await handleListDirectoryWithAutoChunking(args);
        break;
      case 'fast_get_file_info':
        result = await handleGetFileInfo(args);
        break;
      case 'fast_create_directory':
        result = await handleCreateDirectory(args);
        break;
      case 'fast_search_files':
        result = await handleSearchFilesWithAutoChunking(args);
        break;
      case 'fast_search_code':
        result = await handleSearchCode(args);
        break;
      case 'fast_get_directory_tree':
        result = await handleGetDirectoryTree(args);
        break;
      case 'fast_get_disk_usage':
        result = await handleGetDiskUsage(args);
        break;
      case 'fast_find_large_files':
        result = await handleFindLargeFiles(args);
        break;
      case 'fast_edit_file':
        result = await handleEditFile(args);
        break;
      case 'fast_edit_block':
        result = await handleEditBlockSafe(args);
        break;
      case 'fast_edit_blocks':
        result = await handleEditBlocks(args);
        break;
      case 'fast_edit_multiple_blocks':
        result = await handleEditMultipleBlocks(args);
        break;
      case 'fast_safe_edit':
        result = await handleSafeEdit(args);
        break;
      case 'fast_extract_lines':
        result = await handleExtractLines(args);
        break;
      case 'fast_copy_file':
        result = await handleCopyFile(args);
        break;
      case 'fast_move_file':
        result = await handleMoveFile(args);
        break;
      case 'fast_delete_file':
        result = await handleDeleteFile(args);
        break;
      case 'fast_batch_file_operations':
        result = await handleBatchFileOperations(args);
        break;
      case 'fast_compress_files':
        result = await handleCompressFiles(args);
        break;
      case 'fast_extract_archive':
        result = await handleExtractArchive(args);
        break;
      case 'fast_sync_directories':
        result = await handleSyncDirectories(args);
        break;

      default:
        throw new Error(`Tool not implemented: ${name}`);
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unknown error');
  }
});

// 툴 핸들러 함수들
async function handleListAllowedDirectories() {
  return {
    allowed_directories: DEFAULT_ALLOWED_DIRECTORIES,
    current_working_directory: process.cwd(),
    exclude_patterns: DEFAULT_EXCLUDE_PATTERNS,
    claude_limits: {
      max_response_size_mb: CLAUDE_MAX_RESPONSE_SIZE / (1024**2),
      max_chunk_size_mb: CLAUDE_MAX_CHUNK_SIZE / (1024**2),
      max_lines_per_read: CLAUDE_MAX_LINES,
      max_dir_items: CLAUDE_MAX_DIR_ITEMS
    },
    server_info: {
      name: 'fast-filesystem',
      version: '3.2.4',
      features: ['emoji-guidelines', 'large-file-writing', 'smart-recommendations', 'configurable-backup'],
      emoji_policy: 'Emojis not recommended in all file types',
      backup_enabled: CREATE_BACKUP_FILES,
      backup_env_var: 'MCP_CREATE_BACKUP_FILES',
      timestamp: new Date().toISOString()
    }
  };
}

async function handleReadFile(args: any) {
  const { 
    path: filePath, 
    start_offset = 0, 
    max_size, 
    line_start, 
    line_count, 
    encoding = 'utf-8',
    continuation_token,
    auto_chunk = true
  } = args;
  
  const safePath_resolved = safePath(filePath);
  const stats = await fs.stat(safePath_resolved);
  
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }
  
  const maxReadSize = max_size ? Math.min(max_size, CLAUDE_MAX_CHUNK_SIZE) : CLAUDE_MAX_CHUNK_SIZE;
  
  // 라인 모드 - Python 방식으로 스트리밍 읽기
  if (line_start !== undefined) {
    const linesToRead = line_count ? Math.min(line_count, CLAUDE_MAX_LINES) : CLAUDE_MAX_LINES;
    const lines: string[] = [];
    
    // 큰 파일은 스트리밍으로 처리
    if (stats.size > 10 * 1024 * 1024) { // 10MB 이상
      const fileHandle = await fs.open(safePath_resolved, 'r');
      const stream = fileHandle.createReadStream({ encoding: encoding as BufferEncoding });
      
      let currentLine = 0;
      let buffer = '';
      
      for await (const chunk of stream) {
        buffer += chunk;
        const chunkLines = buffer.split('\n');
        buffer = chunkLines.pop() || ''; // 마지막 불완전한 라인은 보관
        
        for (const line of chunkLines) {
          if (currentLine >= line_start && lines.length < linesToRead) {
            lines.push(line);
          }
          currentLine++;
          
          if (lines.length >= linesToRead) {
            break;
          }
        }
        
        if (lines.length >= linesToRead) {
          break;
        }
      }
      
      // 버퍼에 남은 마지막 라인 처리
      if (buffer && currentLine >= line_start && lines.length < linesToRead) {
        lines.push(buffer);
      }
      
      await fileHandle.close();
    } else {
      // 작은 파일은 기존 방식 (하지만 전체 라인 수는 세지 않음)
      const fileContent = await fs.readFile(safePath_resolved, encoding as BufferEncoding);
      const allLines = fileContent.split('\n');
      const selectedLines = allLines.slice(line_start, line_start + linesToRead);
      lines.push(...selectedLines);
    }
    
    return {
      content: lines.join('\n'),
      mode: 'lines',
      start_line: line_start,
      lines_read: lines.length,
      file_size: stats.size,
      file_size_readable: formatSize(stats.size),
      encoding: encoding,
      has_more: lines.length >= linesToRead, // 요청한 만큼 읽었다면 더 있을 가능성
      path: safePath_resolved
    };
  }
  
  // 바이트 모드 - 기존 방식 유지
  const fileHandle = await fs.open(safePath_resolved, 'r');
  const buffer = Buffer.alloc(maxReadSize);
  const { bytesRead } = await fileHandle.read(buffer, 0, maxReadSize, start_offset);
  await fileHandle.close();
  
  const content = buffer.subarray(0, bytesRead).toString(encoding as BufferEncoding);
  const result = truncateContent(content);
  
  return {
    content: result.content,
    mode: 'bytes',
    start_offset: start_offset,
    bytes_read: bytesRead,
    file_size: stats.size,
    file_size_readable: formatSize(stats.size),
    encoding: encoding,
    truncated: result.truncated,
    has_more: start_offset + bytesRead < stats.size,
    path: safePath_resolved
  };
}

// 여러 파일을 한번에 읽는 핸들러 (순차적 읽기 지원)
async function handleReadMultipleFiles(args: any) {
  const { 
    paths = [], 
    continuation_tokens = {},  // 파일별 continuation token
    auto_continue = true,      // 자동으로 전체 파일 읽기
    chunk_size = 1024 * 1024   // 1MB 청크 크기
  } = args;
  
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths parameter must be a non-empty array');
  }

  const results: any[] = [];
  const errors: any[] = [];
  const continuationData: any = {};
  let totalSuccessful = 0;
  let totalErrors = 0;

  // 각 파일을 병렬로 읽기
  const readPromises = paths.map(async (filePath: string, index: number) => {
    try {
      const safePath_resolved = safePath(filePath);
      const stats = await fs.stat(safePath_resolved);
      
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }

      // 이미지 파일 처리
      const ext = path.extname(safePath_resolved).toLowerCase();
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
      
      if (imageExtensions.includes(ext)) {
        return {
          path: safePath_resolved,
          name: path.basename(safePath_resolved),
          type: 'image',
          content: '[IMAGE FILE - Content not displayed]',
          size: stats.size,
          size_readable: formatSize(stats.size),
          modified: stats.mtime.toISOString(),
          extension: ext,
          mime_type: getMimeType(safePath_resolved),
          encoding: 'binary',
          index: index
        };
      }

      // 기존 continuation token 확인
      const existingToken = continuation_tokens[safePath_resolved];
      let startOffset = existingToken ? existingToken.next_offset : 0;
      
      // 텍스트 파일 읽기 (청킹 지원)
      let content = '';
      let totalBytesRead = 0;
      let hasMore = false;
      let nextOffset = startOffset;
      
      if (auto_continue) {
        // 자동으로 전체 파일 읽기 (여러 청크)
        const fileHandle = await fs.open(safePath_resolved, 'r');
        
        try {
          while (nextOffset < stats.size) {
            const remainingBytes = stats.size - nextOffset;
            const currentChunkSize = Math.min(chunk_size, remainingBytes);
            const buffer = Buffer.alloc(currentChunkSize);
            
            const { bytesRead } = await fileHandle.read(buffer, 0, currentChunkSize, nextOffset);
            if (bytesRead === 0) break;
            
            const chunkContent = buffer.subarray(0, bytesRead).toString('utf-8');
            content += chunkContent;
            totalBytesRead += bytesRead;
            nextOffset += bytesRead;
            
            // 매우 큰 파일의 경우 일정 크기에서 중단 (5MB 제한)
            if (totalBytesRead >= 5 * 1024 * 1024) {
              hasMore = nextOffset < stats.size;
              break;
            }
          }
        } finally {
          await fileHandle.close();
        }
      } else {
        // 단일 청크만 읽기
        const fileHandle = await fs.open(safePath_resolved, 'r');
        const buffer = Buffer.alloc(chunk_size);
        const { bytesRead } = await fileHandle.read(buffer, 0, chunk_size, startOffset);
        await fileHandle.close();
        
        content = buffer.subarray(0, bytesRead).toString('utf-8');
        totalBytesRead = bytesRead;
        nextOffset = startOffset + bytesRead;
        hasMore = nextOffset < stats.size;
      }
      
      // Continuation token 생성 (더 읽을 내용이 있는 경우)
      let continuationToken = null;
      if (hasMore) {
        continuationToken = {
          file_path: safePath_resolved,
          next_offset: nextOffset,
          total_size: stats.size,
          read_so_far: nextOffset,
          chunk_size: chunk_size,
          progress_percent: ((nextOffset / stats.size) * 100).toFixed(2) + '%'
        };
        
        continuationData[safePath_resolved] = continuationToken;
      }
      
      return {
        path: safePath_resolved,
        name: path.basename(safePath_resolved),
        type: 'text',
        content: content,
        size: stats.size,
        size_readable: formatSize(stats.size),
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString(),
        extension: ext,
        mime_type: getMimeType(safePath_resolved),
        encoding: 'utf-8',
        bytes_read: totalBytesRead,
        start_offset: startOffset,
        end_offset: nextOffset,
        is_complete: !hasMore,
        has_more: hasMore,
        continuation_token: continuationToken,
        auto_continued: auto_continue && startOffset === 0,
        index: index
      };
      
    } catch (error) {
      return {
        path: filePath,
        name: path.basename(filePath),
        type: 'error',
        content: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        index: index
      };
    }
  });

  // 모든 파일 읽기 완료 대기
  const fileResults = await Promise.all(readPromises);
  
  // 결과 분류
  fileResults.forEach(result => {
    if (result.type === 'error') {
      errors.push(result);
      totalErrors++;
    } else {
      results.push(result);
      totalSuccessful++;
    }
  });

  // 결과를 원래 순서대로 정렬
  results.sort((a, b) => a.index - b.index);
  errors.sort((a, b) => a.index - b.index);

  // 통계 계산
  const incompleteFiles = results.filter(r => r.has_more);
  const completedFiles = results.filter(r => r.is_complete);

  return {
    message: 'Multiple files read completed',
    total_files: paths.length,
    successful: totalSuccessful,
    errors: totalErrors,
    completed_files: completedFiles.length,
    incomplete_files: incompleteFiles.length,
    files: results,
    failed_files: errors,
    continuation_data: Object.keys(continuationData).length > 0 ? continuationData : null,
    continuation_guide: incompleteFiles.length > 0 ? {
      message: "Some files were not fully read",
      next_request_example: {
        paths: incompleteFiles.map(f => f.path),
        continuation_tokens: continuationData,
        auto_continue: false
      },
      tip: "Set auto_continue: false to read files in smaller chunks"
    } : null,
    performance: {
      parallel_read: true,
      chunk_size_mb: chunk_size / (1024 * 1024),
      auto_continue_enabled: auto_continue,
      max_file_size_limit_mb: auto_continue ? 5 : 1
    },
    timestamp: new Date().toISOString()
  };
}

async function handleWriteFile(args: any) {
  const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false, force_remove_emojis = false } = args;
  
  let targetPath: string;
  if (path.isAbsolute(filePath)) {
    targetPath = filePath;
  } else {
    targetPath = path.join(process.cwd(), filePath);
  }
  
  if (!isPathAllowed(targetPath)) {
    throw new Error(`Access denied to path: ${targetPath}`);
  }
  
  const resolvedPath = path.resolve(targetPath);
  
  // 백업 생성 (설정에 따라)
  let backupPath = null;
  if (CREATE_BACKUP_FILES && !append) {
    try {
      await fs.access(resolvedPath);
      backupPath = `${resolvedPath}.backup.${Date.now()}`;
      await fs.copyFile(resolvedPath, backupPath);
    } catch {
      // 원본 파일이 없으면 백업 생성 안함
    }
  }
  
  if (create_dirs) {
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });
  }
  
  // 이모지 감지 및 가이드라인 제공
  const emojiDetection = detectEmojis(content);
  const guideline = getEmojiGuideline(resolvedPath);
  
  // 최종 내용 결정
  let finalContent = content;
  let emojiAction = 'none';
  
  if (force_remove_emojis) {
    finalContent = removeEmojis(content);
    emojiAction = 'force_removed';
  } else if (emojiDetection.hasEmojis && guideline.shouldAvoidEmojis) {
    // 권장사항 위반시 경고만 제공 (강제 제거 안함)
    emojiAction = 'warning_provided';
  }
  
  if (append) {
    await fs.appendFile(resolvedPath, finalContent, encoding as BufferEncoding);
  } else {
    await fs.writeFile(resolvedPath, finalContent, encoding as BufferEncoding);
  }
  
  const stats = await fs.stat(resolvedPath);
  
  const result: any = {
    message: `File ${append ? 'appended' : 'written'} successfully`,
    path: resolvedPath,
    size: stats.size,
    size_readable: formatSize(stats.size),
    encoding: encoding,
    mode: append ? 'append' : 'write',
    backup_created: backupPath,
    backup_enabled: CREATE_BACKUP_FILES,
    timestamp: new Date().toISOString()
  };
  
  // 이모지 관련 정보 추가 (간단하게)
  if (emojiDetection.hasEmojis) {
    result.emoji_info = {
      detected: true,
      guideline: guideline.reason
    };
  }
  
  return result;
}

// 새로운 대용량 파일 작성 핸들러
async function handleLargeWriteFile(args: any) {
  const { 
    path: filePath, 
    content, 
    encoding = 'utf-8', 
    create_dirs = true, 
    append = false,
    chunk_size = 64 * 1024, // 64KB 청크
    backup = true,
    retry_attempts = 3,
    verify_write = true,
    force_remove_emojis = false
  } = args;
  
  let targetPath: string;
  if (path.isAbsolute(filePath)) {
    targetPath = filePath;
  } else {
    targetPath = path.join(process.cwd(), filePath);
  }
  
  if (!isPathAllowed(targetPath)) {
    throw new Error(`Access denied to path: ${targetPath}`);
  }
  
  const resolvedPath = path.resolve(targetPath);
  const tempPath = `${resolvedPath}.tmp.${Date.now()}`;
  const backupPath = `${resolvedPath}.backup.${Date.now()}`;
  
  try {
    // 이모지 감지 및 처리
    const emojiDetection = detectEmojis(content);
    const guideline = getEmojiGuideline(resolvedPath);
    
    let finalContent = content;
    let emojiAction = 'none';
    
    if (force_remove_emojis) {
      finalContent = removeEmojis(content);
      emojiAction = 'force_removed';
    } else if (emojiDetection.hasEmojis && guideline.shouldAvoidEmojis) {
      emojiAction = 'warning_provided';
    }
    
    // 1. 디렉토리 생성
    if (create_dirs) {
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
    }
    
    // 2. 디스크 공간 확인
    const contentSize = Buffer.byteLength(finalContent, encoding as BufferEncoding);
    await checkDiskSpace(path.dirname(resolvedPath), contentSize);
    
    // 3. 기존 파일 백업 (덮어쓰기 모드이고 파일이 존재하며 백업이 활성화된 경우)
    let originalExists = false;
    let originalSize = 0;
    if (!append && backup && CREATE_BACKUP_FILES) {
      try {
        await fs.access(resolvedPath);
        originalExists = true;
        originalSize = await getOriginalFileSize(resolvedPath);
        await fs.copyFile(resolvedPath, backupPath);
      } catch {
        // 원본 파일이 없으면 무시
      }
    }
    
    // 4. 스트리밍 방식으로 대용량 파일 작성
    const result = await writeFileWithRetry(
      append ? resolvedPath : tempPath,
      finalContent,
      encoding as BufferEncoding,
      chunk_size,
      retry_attempts,
      append
    );
    
    // 5. 원자적 이동 (append가 아닌 경우)
    if (!append) {
      await fs.rename(tempPath, resolvedPath);
    }
    
    // 6. 작성 검증 (옵션)
    if (verify_write) {
      const finalStats = await fs.stat(resolvedPath);
      if (!append) {
        // 새 파일인 경우 내용 크기와 일치해야 함
        if (finalStats.size !== contentSize) {
          throw new Error(`File size verification failed. Expected: ${contentSize}, Actual: ${finalStats.size}`);
        }
      } else {
        // append 모드인 경우 최소한 내용 크기만큼은 증가해야 함
        const expectedMinSize = originalSize + contentSize;
        if (finalStats.size < expectedMinSize) {
          throw new Error(`File size verification failed. Expected at least: ${expectedMinSize}, Actual: ${finalStats.size}`);
        }
      }
    }
    
    const finalStats = await fs.stat(resolvedPath);
    
    const response: any = {
      message: `Large file ${append ? 'appended' : 'written'} successfully`,
      path: resolvedPath,
      size: finalStats.size,
      size_readable: formatSize(finalStats.size),
      content_size: contentSize,
      content_size_readable: formatSize(contentSize),
      encoding: encoding,
      mode: append ? 'append' : 'write',
      chunks_written: Math.ceil(contentSize / chunk_size),
      chunk_size: chunk_size,
      retry_count: result.retryCount,
      backup_created: originalExists && backup && CREATE_BACKUP_FILES ? backupPath : null,
      backup_enabled: CREATE_BACKUP_FILES,
      timestamp: new Date().toISOString(),
      performance: {
        total_time_ms: result.totalTime,
        write_speed_mbps: (contentSize / (1024 * 1024)) / (result.totalTime / 1000)
      }
    };
    
    // 이모지 관련 정보 추가 (간단하게)
    if (emojiDetection.hasEmojis) {
      response.emoji_info = {
        detected: true,
        guideline: guideline.reason
      };
    }
    
    return response;
    
  } catch (error) {
    // 에러 복구
    try {
      // 임시 파일 정리
      await fs.unlink(tempPath).catch(() => {});
      
      // 백업에서 복구 (실패한 경우)
      if (!append && backup && CREATE_BACKUP_FILES) {
        try {
          await fs.copyFile(backupPath, resolvedPath);
        } catch {
          // 복구도 실패
        }
      }
    } catch {
      // 정리 실패는 무시
    }
    
    throw error;
  }
}

async function handleListDirectory(args: any) {
  const { path: dirPath, page = 1, page_size, pattern, show_hidden = false, sort_by = 'name', reverse = false } = args;
  
  const safePath_resolved = safePath(dirPath);
  const stats = await fs.stat(safePath_resolved);
  
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory');
  }
  
  const pageSize = page_size ? Math.min(page_size, CLAUDE_MAX_DIR_ITEMS) : 50;
  const entries = await fs.readdir(safePath_resolved, { withFileTypes: true });
  
  let filteredEntries = entries.filter(entry => {
    if (!show_hidden && entry.name.startsWith('.')) return false;
    if (shouldExcludePath(path.join(safePath_resolved, entry.name))) return false;
    if (pattern) {
      return entry.name.toLowerCase().includes(pattern.toLowerCase());
    }
    return true;
  });
  
  // 정렬
  filteredEntries.sort((a, b) => {
    let comparison = 0;
    
    switch (sort_by) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'type':
        const aType = a.isDirectory() ? 'directory' : 'file';
        const bType = b.isDirectory() ? 'directory' : 'file';
        comparison = aType.localeCompare(bType);
        break;
      default:
        comparison = a.name.localeCompare(b.name);
    }
    
    return reverse ? -comparison : comparison;
  });
  
  const startIdx = (page - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const pageEntries = filteredEntries.slice(startIdx, endIdx);
  
  const items = await Promise.all(pageEntries.map(async (entry) => {
    try {
      const fullPath = path.join(safePath_resolved, entry.name);
      const itemStats = await fs.stat(fullPath);
      
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: entry.isFile() ? itemStats.size : null,
        size_readable: entry.isFile() ? formatSize(itemStats.size) : null,
        modified: itemStats.mtime.toISOString(),
        created: itemStats.birthtime.toISOString(),
        permissions: itemStats.mode,
        path: fullPath
      };
    } catch {
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: null,
        size_readable: null,
        modified: null,
        created: null,
        permissions: null,
        path: path.join(safePath_resolved, entry.name)
      };
    }
  }));
  
  return {
    path: safePath_resolved,
    items: items,
    page: page,
    page_size: pageSize,
    total_count: filteredEntries.length,
    total_pages: Math.ceil(filteredEntries.length / pageSize),
    has_more: endIdx < filteredEntries.length,
    sort_by: sort_by,
    reverse: reverse,
    timestamp: new Date().toISOString()
  };
}

async function handleGetFileInfo(args: any) {
  const { path: targetPath } = args;
  
  const safePath_resolved = safePath(targetPath);
  const stats = await fs.stat(safePath_resolved);
  
  const info = {
    path: safePath_resolved,
    name: path.basename(safePath_resolved),
    type: stats.isDirectory() ? 'directory' : 'file',
    size: stats.size,
    size_readable: formatSize(stats.size),
    created: stats.birthtime.toISOString(),
    modified: stats.mtime.toISOString(),
    accessed: stats.atime.toISOString(),
    permissions: stats.mode,
    is_readable: true,
    is_writable: true
  };
  
  if (stats.isFile()) {
    (info as any).extension = path.extname(safePath_resolved);
    (info as any).mime_type = getMimeType(safePath_resolved);
    
    // 파일별 이모지 가이드라인 제거 (토큰 절약)
    
    if (stats.size > CLAUDE_MAX_CHUNK_SIZE) {
      (info as any).claude_guide = {
        message: 'File is large, consider using chunked reading',
        recommended_chunk_size: CLAUDE_MAX_CHUNK_SIZE,
        total_chunks: Math.ceil(stats.size / CLAUDE_MAX_CHUNK_SIZE)
      };
    }
  } else if (stats.isDirectory()) {
    try {
      const entries = await fs.readdir(safePath_resolved);
      (info as any).item_count = entries.length;
      
      if (entries.length > CLAUDE_MAX_DIR_ITEMS) {
        (info as any).claude_guide = {
          message: 'Directory has many items, consider using pagination',
          recommended_page_size: CLAUDE_MAX_DIR_ITEMS,
          total_pages: Math.ceil(entries.length / CLAUDE_MAX_DIR_ITEMS)
        };
      }
    } catch {
      (info as any).item_count = 'Unable to count';
    }
  }
  
  return info;
}

async function handleCreateDirectory(args: any) {
  const { path: dirPath, recursive = true } = args;
  
  const safePath_resolved = safePath(dirPath);
  await fs.mkdir(safePath_resolved, { recursive });
  
  return {
    message: 'Directory created successfully',
    path: safePath_resolved,
    recursive: recursive,
    timestamp: new Date().toISOString()
  };
}

async function handleSearchFiles(args: any) {
  const { 
    path: searchPath, 
    pattern, 
    content_search = false, 
    case_sensitive = false, 
    max_results = 100,
    context_lines = 0,  // 새로 추가: 컨텍스트 라인
    file_pattern = '',  // 새로 추가: 파일 패턴 필터링
    include_binary = false  // 새로 추가: 바이너리 파일 포함 여부
  } = args;
  
  const safePath_resolved = safePath(searchPath);
  const maxResults = Math.min(max_results, 200);
  const results: any[] = [];
  
  const searchPattern = case_sensitive ? pattern : pattern.toLowerCase();
  
  // 정규표현식 패턴 지원
  let regexPattern: RegExp | null = null;
  try {
    regexPattern = new RegExp(pattern, case_sensitive ? 'g' : 'gi');
  } catch {
    // 정규표현식이 아닌 경우 문자열 검색으로 처리
  }
  
  // 파일 패턴 필터
  let fileRegex: RegExp | null = null;
  if (file_pattern) {
    try {
      // 와일드카드를 정규표현식으로 변환
      const regexStr = file_pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      fileRegex = new RegExp(`^${regexStr}$`, 'i');
    } catch {
      // 정규표현식 변환 실패시 단순 문자열 포함 검사
    }
  }
  
  // 바이너리 파일 감지 함수
  function isBinaryFile(buffer: Buffer): boolean {
    // 첫 1KB를 검사하여 null 바이트가 있으면 바이너리로 판단
    const sample = buffer.slice(0, 1024);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true;
    }
    return false;
  }
  
  // 컨텍스트와 함께 매치된 라인들을 반환
  function getMatchedLinesWithContext(content: string, pattern: string | RegExp, contextLines: number): Array<{
    line_number: number;
    line_content: string;
    match_start?: number;
    match_end?: number;
    context_before?: string[];
    context_after?: string[];
  }> {
    const lines = content.split('\n');
    const matches: Array<{
      line_number: number;
      line_content: string;
      match_start?: number;
      match_end?: number;
      context_before?: string[];
      context_after?: string[];
    }> = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const searchLine = case_sensitive ? line : line.toLowerCase();
      let matched = false;
      let matchStart = -1;
      let matchEnd = -1;
      
      if (regexPattern) {
        const regexMatch = line.match(regexPattern);
        if (regexMatch) {
          matched = true;
          matchStart = regexMatch.index || 0;
          matchEnd = matchStart + regexMatch[0].length;
        }
      } else {
        const index = searchLine.indexOf(searchPattern);
        if (index !== -1) {
          matched = true;
          matchStart = index;
          matchEnd = index + searchPattern.length;
        }
      }
      
      if (matched) {
        const matchInfo: any = {
          line_number: i + 1,
          line_content: line,
          match_start: matchStart,
          match_end: matchEnd
        };
        
        // 컨텍스트 라인 추가
        if (contextLines > 0) {
          matchInfo.context_before = [];
          matchInfo.context_after = [];
          
          // 이전 라인들
          for (let j = Math.max(0, i - contextLines); j < i; j++) {
            matchInfo.context_before.push(lines[j]);
          }
          
          // 이후 라인들
          for (let j = i + 1; j <= Math.min(lines.length - 1, i + contextLines); j++) {
            matchInfo.context_after.push(lines[j]);
          }
        }
        
        matches.push(matchInfo);
      }
    }
    
    return matches;
  }

  async function searchDirectory(dirPath: string) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(dirPath, entry.name);
        
        if (shouldExcludePath(fullPath)) continue;
        
        if (entry.isFile()) {
          // 파일 패턴 필터링
          if (fileRegex && !fileRegex.test(entry.name)) continue;
          
          const searchName = case_sensitive ? entry.name : entry.name.toLowerCase();
          let matched = false;
          let matchType = '';
          let matchedLines: any[] = [];
          
          // 파일명 검색
          if (regexPattern ? regexPattern.test(entry.name) : searchName.includes(searchPattern)) {
            matched = true;
            matchType = 'filename';
          }
          
          // 내용 검색 - ripgrep 사용
          if (!matched && content_search) {
            try {
              // ripgrep을 사용한 빠른 검색 시도
              const ripgrepResults = await searchCode({
                rootPath: fullPath,
                pattern: pattern,
                filePattern: file_pattern,
                ignoreCase: !case_sensitive,
                maxResults: 1, // 매치 여부만 확인
                contextLines: context_lines
              });

              if (ripgrepResults.length > 0) {
                matched = true;
                matchType = 'content';
                
                // ripgrep 결과를 기존 형식으로 변환
                matchedLines = ripgrepResults.map((result: SearchResult) => ({
                  line_number: result.line,
                  line_content: result.match,
                  match_start: result.column || 0,
                  match_end: (result.column || 0) + result.match.length,
                  context_before: result.context_before || [],
                  context_after: result.context_after || []
                }));
              }
            } catch (ripgrepError) {
              // ripgrep 실패시 기존 방법으로 폴백
              try {
                const stats = await fs.stat(fullPath);
                if (stats.size < 10 * 1024 * 1024) { // 10MB 제한
                  // 바이너리 파일 체크
                  const buffer = await fs.readFile(fullPath);
                  
                  if (!include_binary && isBinaryFile(buffer)) {
                    // 바이너리 파일은 건너뛰기
                    continue;
                  }
                  
                  const content = buffer.toString('utf-8');
                  const searchContent = case_sensitive ? content : content.toLowerCase();
                  
                  if (regexPattern ? regexPattern.test(content) : searchContent.includes(searchPattern)) {
                    matched = true;
                    matchType = 'content';
                    
                    // 매치된 라인들과 컨텍스트 수집
                    matchedLines = getMatchedLinesWithContext(content, regexPattern || searchPattern, context_lines);
                  }
                }
              } catch (error) {
                // 읽기 실패한 파일도 결과에 포함 (에러 정보와 함께)
                if (matched) {
                  const stats = await fs.stat(fullPath);
                  results.push({
                    path: fullPath,
                    name: entry.name,
                    match_type: matchType,
                    size: stats.size,
                    size_readable: formatSize(stats.size),
                    modified: stats.mtime.toISOString(),
                    extension: path.extname(fullPath),
                    error: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
                  });
                }
                continue;
              }
            }
          }
          
          if (matched) {
            const stats = await fs.stat(fullPath);
            const result: any = {
              path: fullPath,
              name: entry.name,
              match_type: matchType,
              size: stats.size,
              size_readable: formatSize(stats.size),
              modified: stats.mtime.toISOString(),
              created: stats.birthtime.toISOString(),
              extension: path.extname(fullPath),
              permissions: stats.mode,
              is_binary: false
            };
            
            // 내용 검색인 경우 매치된 라인 정보 추가
            if (matchType === 'content' && matchedLines.length > 0) {
              result.matched_lines = matchedLines.slice(0, 20); // 최대 20개 라인만
              result.total_matches = matchedLines.length;
              
              // 바이너리 파일 여부 표시
              try {
                const buffer = await fs.readFile(fullPath);
                result.is_binary = isBinaryFile(buffer);
              } catch {
                // 파일 읽기 실패
              }
            }
            
            results.push(result);
          }
        } else if (entry.isDirectory()) {
          await searchDirectory(fullPath);
        }
      }
    } catch (error) {
      // 권한 없는 디렉토리 등은 조용히 무시하지만, 로그에는 기록
      console.warn(`Failed to search directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  const startTime = Date.now();
  await searchDirectory(safePath_resolved);
  const searchTime = Date.now() - startTime;
  
  return {
    results: results,
    total_found: results.length,
    search_pattern: pattern,
    search_path: safePath_resolved,
    content_search: content_search,
    case_sensitive: case_sensitive,
    context_lines: context_lines,
    file_pattern: file_pattern,
    include_binary: include_binary,
    max_results_reached: results.length >= maxResults,
    search_time_ms: searchTime,
    regex_used: regexPattern !== null,
    ripgrep_enhanced: true, // ripgrep 통합
    timestamp: new Date().toISOString()
  };
}

async function handleGetDirectoryTree(args: any) {
  const { path: rootPath, max_depth = 3, show_hidden = false, include_files = true } = args;
  
  const safePath_resolved = safePath(rootPath);
  
  async function buildTree(currentPath: string, currentDepth: number): Promise<any> {
    if (currentDepth > max_depth) return null;
    
    try {
      const stats = await fs.stat(currentPath);
      const name = path.basename(currentPath);
      
      if (!show_hidden && name.startsWith('.')) return null;
      if (shouldExcludePath(currentPath)) return null;
      
      const node: any = {
        name: name,
        path: currentPath,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        size_readable: formatSize(stats.size),
        modified: stats.mtime.toISOString()
      };
      
      if (stats.isDirectory()) {
        node.children = [];
        
        try {
          const entries = await fs.readdir(currentPath, { withFileTypes: true });
          
          for (const entry of entries) {
            const childPath = path.join(currentPath, entry.name);
            
            if (entry.isDirectory()) {
              const childNode = await buildTree(childPath, currentDepth + 1);
              if (childNode) node.children.push(childNode);
            } else if (include_files) {
              const childNode = await buildTree(childPath, currentDepth + 1);
              if (childNode) node.children.push(childNode);
            }
          }
        } catch {
          // 권한 없는 디렉토리
          node.error = 'Access denied';
        }
      }
      
      return node;
    } catch {
      return null;
    }
  }
  
  const tree = await buildTree(safePath_resolved, 0);
  
  return {
    tree: tree,
    root_path: safePath_resolved,
    max_depth: max_depth,
    show_hidden: show_hidden,
    include_files: include_files,
    timestamp: new Date().toISOString()
  };
}

async function handleGetDiskUsage(args: any) {
  const { path: targetPath = '/' } = args;
  
  try {
    const { stdout } = await execAsync(`df -h "${targetPath}"`);
    const lines = stdout.split('\n').filter(line => line.trim());
    
    if (lines.length > 1) {
      const data = lines[1].split(/\s+/);
      return {
        filesystem: data[0],
        total: data[1],
        used: data[2],
        available: data[3],
        use_percentage: data[4],
        mounted_on: data[5],
        path: targetPath,
        timestamp: new Date().toISOString()
      };
    }
  } catch {
    // Fallback for systems without df command
  }
  
  return {
    error: 'Unable to get disk usage information',
    path: targetPath,
    timestamp: new Date().toISOString()
  };
}

async function handleFindLargeFiles(args: any) {
  const { path: searchPath, min_size = '100MB', max_results = 50 } = args;
  
  const safePath_resolved = safePath(searchPath);
  const maxResults = Math.min(max_results, 100);
  
  // 크기 파싱 (예: 100MB -> bytes)
  const parseSize = (sizeStr: string): number => {
    const match = sizeStr.match(/^(\d+(\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
    if (!match) return 100 * 1024 * 1024; // 기본값 100MB
    
    const value = parseFloat(match[1]);
    const unit = (match[3] || 'B').toUpperCase();
    
    const units: {[key: string]: number} = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024,
      'TB': 1024 * 1024 * 1024 * 1024
    };
    
    return value * (units[unit] || 1);
  };
  
  const minSizeBytes = parseSize(min_size);
  const results: any[] = [];
  
  async function findLargeFilesRecursive(dirPath: string) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(dirPath, entry.name);
        
        if (shouldExcludePath(fullPath)) continue;
        
        if (entry.isFile()) {
          try {
            const stats = await fs.stat(fullPath);
            if (stats.size >= minSizeBytes) {
              results.push({
                path: fullPath,
                name: entry.name,
                size: stats.size,
                size_readable: formatSize(stats.size),
                modified: stats.mtime.toISOString(),
                extension: path.extname(fullPath)
              });
            }
          } catch {
            // 파일 접근 실패 무시
          }
        } else if (entry.isDirectory()) {
          await findLargeFilesRecursive(fullPath);
        }
      }
    } catch {
      // 권한 없는 디렉토리 무시
    }
  }
  
  await findLargeFilesRecursive(safePath_resolved);
  
  // 크기별로 정렬 (큰 것부터)
  results.sort((a, b) => b.size - a.size);
  
  return {
    results: results,
    total_found: results.length,
    search_path: safePath_resolved,
    min_size: min_size,
    min_size_bytes: minSizeBytes,
    max_results_reached: results.length >= maxResults,
    timestamp: new Date().toISOString()
  };
}

// 검색 결과 타입 정의
interface SearchResult {
  file: string;
  line: number;
  match: string;
  column?: number;
  context_before?: string[];
  context_after?: string[];
}

// ripgrep을 사용한 고성능 검색 함수
async function searchCodeWithRipgrep(options: {
  rootPath: string,
  pattern: string,
  filePattern?: string,
  ignoreCase?: boolean,
  maxResults?: number,
  includeHidden?: boolean,
  contextLines?: number,
  timeout?: number,
}): Promise<SearchResult[]> {
  const { 
    rootPath, 
    pattern, 
    filePattern, 
    ignoreCase = true, 
    maxResults = 1000, 
    includeHidden = false,
    contextLines = 0,
    timeout = 30000
  } = options;

  // @vscode/ripgrep이 설치되지 않았을 경우 폴백
  let rgPath: string;
  try {
    // 동적 require로 ripgrep 경로 가져오기
    const createRequire = (await import('module')).createRequire;
    const require = createRequire(import.meta.url);
    const ripgrepModule = require('@vscode/ripgrep');
    rgPath = ripgrepModule.rgPath;
  } catch {
    // 폴백으로 시스템 rg 사용 시도
    try {
      await execAsync('which rg');
      rgPath = 'rg';
    } catch {
      throw new Error('ripgrep not available');
    }
  }
  
  // ripgrep 인수 구성
  const args = [
    '--json',
    '--line-number',
    '--column',
    '--no-heading',
    '--with-filename',
  ];
  
  if (ignoreCase) args.push('-i');
  if (maxResults) args.push('-m', maxResults.toString());
  if (includeHidden) args.push('--hidden');
  if (contextLines > 0) args.push('-C', contextLines.toString());
  if (filePattern) args.push('-g', filePattern);
  
  args.push(pattern, rootPath);
  
  return new Promise((resolve, reject) => {
    const results: SearchResult[] = [];
    const rg = spawn(rgPath, args);
    let stdoutBuffer = '';
    let timeoutId: NodeJS.Timeout;
    
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        rg.kill();
        reject(new Error(`Search timed out after ${timeout}ms`));
      }, timeout);
    }
    
    rg.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
    });
    
    rg.stderr.on('data', (data) => {
      console.error(`ripgrep error: ${data}`);
    });
    
    rg.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (code === 0 || code === 1) {
        const lines = stdoutBuffer.trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const result = JSON.parse(line);
            if (result.type === 'match') {
              result.data.submatches.forEach((submatch: any) => {
                results.push({
                  file: result.data.path.text,
                  line: result.data.line_number,
                  match: submatch.match.text,
                  column: submatch.start
                });
              });
            } else if (result.type === 'context' && contextLines > 0) {
              results.push({
                file: result.data.path.text,
                line: result.data.line_number,
                match: result.data.lines.text.trim()
              });
            }
          } catch (error) {
            console.error(`Error parsing ripgrep output: ${error}`);    
          }
        }
        resolve(results);
      } else {
        reject(new Error(`ripgrep process exited with code ${code}`));
      }
    });
    
    rg.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });
  });
}

// 메인 검색 함수 (ripgrep 우선, 폴백으로 네이티브)
async function searchCode(options: {
  rootPath: string,
  pattern: string,
  filePattern?: string,
  ignoreCase?: boolean,
  maxResults?: number,
  includeHidden?: boolean,
  contextLines?: number,
  timeout?: number,
}): Promise<SearchResult[]> {
  try {
    return await searchCodeWithRipgrep(options);
  } catch (error) {
    console.warn('Ripgrep failed, falling back to native search:', error);
    // 여기서는 간단한 폴백만 구현 (기존 로직 사용)
    return [];
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: {[key: string]: string} = {
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.md': 'text/markdown'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

// 서버 시작
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fast Filesystem MCP Server v3.2.4 running on stdio (with advanced safe editing features)');
}

// RegExp escape 함수
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 편집 관련 핸들러 함수들
async function handleEditFile(args: any) {
  const { 
    path: filePath, 
    edits = [],
    old_text, 
    new_text, 
    backup = true,
    create_if_missing = false
  } = args;
  
  const safePath_resolved = safePath(filePath);
  
  // 파일 존재 확인
  let fileExists = true;
  try {
    await fs.access(safePath_resolved);
  } catch {
    fileExists = false;
    if (!create_if_missing) {
      throw new Error(`File does not exist: ${safePath_resolved}`);
    }
  }
  
  let content = '';
  if (fileExists) {
    content = await fs.readFile(safePath_resolved, 'utf-8');
  }
  
  const originalContent = content;
  let modifiedContent = content;
  const changes: any[] = [];
  let totalChanges = 0;
  const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
  
  // 백업 생성 (설정에 따라)
  if (fileExists && backup && CREATE_BACKUP_FILES) {
    await fs.copyFile(safePath_resolved, backupPath!);
  }
  
  // 편집할 항목들 준비
  let editList = [...edits];
  
  // 단일 편집 처리 (하위 호환성)
  if (old_text && new_text !== undefined) {
    editList.push({ old_text, new_text });
  }
  
  try {
    // 여러 편집 처리
    for (const edit of editList) {
      const { old_text: oldText, new_text: newText } = edit;
      
      if (!oldText || newText === undefined) {
        changes.push({
          old_text: oldText,
          new_text: newText,
          occurrences: 0,
          status: 'skipped - invalid parameters'
        });
        continue;
      }
      
      // 전체 문자열에서 텍스트 치환 (단순 문자열 치환만)
      const occurrences = (modifiedContent.match(new RegExp(escapeRegExp(oldText), 'g')) || []).length;
      
      if (occurrences > 0) {
        modifiedContent = modifiedContent.replace(new RegExp(escapeRegExp(oldText), 'g'), newText);
        totalChanges += occurrences;
        
        changes.push({
          old_text: oldText.length > 50 ? oldText.substring(0, 50) + '...' : oldText,
          new_text: newText.length > 50 ? newText.substring(0, 50) + '...' : newText,
          occurrences: occurrences,
          status: 'success'
        });
      } else {
        changes.push({
          old_text: oldText.length > 50 ? oldText.substring(0, 50) + '...' : oldText,
          new_text: newText.length > 50 ? newText.substring(0, 50) + '...' : newText,
          occurrences: 0,
          status: 'not found'
        });
      }
    }
    
    // 디렉토리 생성
    const dir = path.dirname(safePath_resolved);
    await fs.mkdir(dir, { recursive: true });
    
    // 수정된 내용 저장
    await fs.writeFile(safePath_resolved, modifiedContent, 'utf-8');
    
    const stats = await fs.stat(safePath_resolved);
    const originalLines = originalContent.split('\n').length;
    const newLines = modifiedContent.split('\n').length;
    
    return {
      message: `File edited successfully`,
      path: safePath_resolved,
      changes_made: totalChanges,
      edits_processed: editList.length,
      changes_detail: changes,
      original_lines: originalLines,
      new_lines: newLines,
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      size: stats.size,
      size_readable: formatSize(stats.size),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    // 에러 시 백업에서 복구 (단, 파일 쓰기 관련 에러만)
    if (fileExists && backup && CREATE_BACKUP_FILES && backupPath && error instanceof Error && 
        (error.message.includes('EACCES') || error.message.includes('EPERM') || 
         error.message.includes('ENOENT') || error.message.includes('write'))) {
      try {
        await fs.copyFile(backupPath, safePath_resolved);
      } catch {
        // 복구 실패는 무시
      }
    }
    throw error;
  }
}

// 정교한 블록 편집 핸들러 (desktop-commander 방식)
async function handleEditBlock(args: any) {
  const { 
    path: filePath, 
    old_text,
    new_text,
    expected_replacements = 1,
    backup = true
  } = args;
  
  const safePath_resolved = safePath(filePath);
  
  // 파일 존재 확인
  let fileExists = true;
  try {
    await fs.access(safePath_resolved);
  } catch {
    fileExists = false;
    throw new Error(`File does not exist: ${safePath_resolved}`);
  }
  
  const originalContent = await fs.readFile(safePath_resolved, 'utf-8');
  const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
  
  // 백업 생성 (설정에 따라)
  if (backup && CREATE_BACKUP_FILES) {
    await fs.copyFile(safePath_resolved, backupPath!);
  }
  
  try {
    // 정확한 문자열 매칭 확인
    const occurrences = (originalContent.match(new RegExp(escapeRegExp(old_text), 'g')) || []).length;
    
    if (occurrences === 0) {
      return {
        message: 'Text not found',
        path: safePath_resolved,
        old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
        expected_replacements: expected_replacements,
        actual_occurrences: 0,
        status: 'not_found',
        backup_created: backupPath,
        backup_enabled: CREATE_BACKUP_FILES,
        timestamp: new Date().toISOString()
      };
    }
    
    if (expected_replacements !== occurrences) {
      return {
        message: 'Replacement count mismatch - operation cancelled for safety',
        path: safePath_resolved,
        old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
        expected_replacements: expected_replacements,
        actual_occurrences: occurrences,
        status: 'count_mismatch',
        safety_info: 'Use expected_replacements parameter to confirm the exact number of changes',
        backup_created: backupPath,
        backup_enabled: CREATE_BACKUP_FILES,
        timestamp: new Date().toISOString()
      };
    }
    
    // 안전 확인 완료 - 편집 실행
    const modifiedContent = originalContent.replace(new RegExp(escapeRegExp(old_text), 'g'), new_text);
    
    // 디렉토리 생성
    const dir = path.dirname(safePath_resolved);
    await fs.mkdir(dir, { recursive: true });
    
    // 수정된 내용 저장
    await fs.writeFile(safePath_resolved, modifiedContent, 'utf-8');
    
    const stats = await fs.stat(safePath_resolved);
    const originalLines = originalContent.split('\n').length;
    const newLines = modifiedContent.split('\n').length;
    
    // 변경된 위치 정보 제공
    const beforeLines = originalContent.substring(0, originalContent.indexOf(old_text)).split('\n');
    const changeStartLine = beforeLines.length;
    
    return {
      message: 'Block edited successfully with precise matching',
      path: safePath_resolved,
      changes_made: occurrences,
      expected_replacements: expected_replacements,
      actual_replacements: occurrences,
      change_start_line: changeStartLine,
      original_lines: originalLines,
      new_lines: newLines,
      old_text_preview: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
      new_text_preview: new_text.length > 100 ? new_text.substring(0, 100) + '...' : new_text,
      status: 'success',
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      size: stats.size,
      size_readable: formatSize(stats.size),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    // 에러 시 백업에서 복구
    if (backup && CREATE_BACKUP_FILES && backupPath) {
      try {
        await fs.copyFile(backupPath, safePath_resolved);
      } catch {
        // 복구 실패는 무시
      }
    }
    throw error;
  }
}

// 여러개의 라인 기반 편집 (안전한 로직으로 업그레이드)
async function handleEditMultipleBlocks(args: any) {
  const { path: filePath, edits, backup = true } = args;
  
  // path 매개변수 필수 검증
  if (!filePath || typeof filePath !== 'string') {
    return {
      message: "Missing required parameter",
      error: "path_parameter_missing",
      details: "The 'path' parameter is required for multiple block editing operations.",
      example: {
        correct_usage: "fast_edit_multiple_blocks({ path: '/path/to/file.txt', edits: [...] })",
        missing_parameter: "path"
      },
      suggestions: [
        "Add the 'path' parameter with a valid file path",
        "Ensure the path is a string value",
        "Use an absolute path for better reliability"
      ],
      status: "parameter_error",
      timestamp: new Date().toISOString()
    };
  }
  
  const safePath_resolved = safePath(filePath);
  
  // 파일 존재 확인
  let fileExists = true;
  try {
    await fs.access(safePath_resolved);
  } catch {
    fileExists = false;
    throw new Error(`File does not exist: ${safePath_resolved}`);
  }
  
  const originalContent = await fs.readFile(safePath_resolved, 'utf-8');
  const lines = originalContent.split('\n');
  let modifiedLines = [...lines];
  
  const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
  let totalChanges = 0;
  const editResults: any[] = [];
  
  // 백업 생성 (설정에 따라)
  if (backup && CREATE_BACKUP_FILES) {
    await fs.copyFile(safePath_resolved, backupPath!);
  }
  
  try {
    // 편집을 라인 번호 역순으로 정렬 (뒤에서부터 편집하여 인덱스 변화 방지)
    const sortedEdits = [...edits].sort((a, b) => {
      const lineA = a.line_number || 0;
      const lineB = b.line_number || 0;
      return lineB - lineA;
    });
    
    for (let i = 0; i < sortedEdits.length; i++) {
      const edit = sortedEdits[i];
      const { 
        old_text, 
        new_text, 
        line_number, 
        mode = 'replace',
        expected_replacements = 1,
        word_boundary = false,
        case_sensitive = true
      } = edit;
      let changesCount = 0;
      let editResult: any = {
        edit_index: i + 1,
        mode: mode,
        line_number: line_number,
        status: 'unknown'
      };
      
      try {
        switch (mode) {
          case 'replace':
            if (old_text && new_text !== undefined) {
              // handleEditBlockSafe 스타일의 안전한 텍스트 교체
              const currentContent = modifiedLines.join('\n');
              
              // 위험 분석
              const riskAnalysis = analyzeEditRisk(old_text, new_text, currentContent, {
                word_boundary,
                case_sensitive
              });
              
              // 매칭 패턴 준비
              let searchPattern = old_text;
              let flags = case_sensitive ? 'g' : 'gi';
              
              if (word_boundary) {
                searchPattern = `\\b${escapeRegExp(old_text)}\\b`;
              } else {
                searchPattern = escapeRegExp(old_text);
              }
              
              const regex = new RegExp(searchPattern, flags);
              const occurrences = (currentContent.match(regex) || []).length;
              
              if (occurrences === 0) {
                editResult = {
                  ...editResult,
                  old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
                  expected_replacements: expected_replacements,
                  actual_occurrences: 0,
                  status: 'not_found',
                  risk_analysis: riskAnalysis
                };
              } else if (expected_replacements !== occurrences) {
                editResult = {
                  ...editResult,
                  old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
                  expected_replacements: expected_replacements,
                  actual_occurrences: occurrences,
                  status: 'count_mismatch',
                  safety_info: 'Use expected_replacements parameter to confirm the exact number of changes',
                  risk_analysis: riskAnalysis
                };
              } else {
                // 안전 확인 완료 - 편집 실행
                const modifiedContent = currentContent.replace(regex, new_text);
                modifiedLines = modifiedContent.split('\n');
                changesCount = occurrences;
                
                editResult = {
                  ...editResult,
                  old_text_preview: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
                  new_text_preview: new_text.length > 100 ? new_text.substring(0, 100) + '...' : new_text,
                  status: 'success',
                  changes_made: occurrences,
                  expected_replacements: expected_replacements,
                  actual_replacements: occurrences,
                  risk_analysis: riskAnalysis,
                  word_boundary_used: word_boundary,
                  case_sensitive_used: case_sensitive
                };
              }
            } else if (line_number && new_text !== undefined) {
              // 라인 기반 교체 (안전 검사 포함)
              const idx = line_number - 1;
              if (idx >= 0 && idx < modifiedLines.length) {
                const originalLine = modifiedLines[idx];
                modifiedLines[idx] = new_text;
                changesCount++;
                
                editResult = {
                  ...editResult,
                  original_line: originalLine,
                  new_line: new_text,
                  status: 'success',
                  changes_made: 1
                };
              } else {
                editResult = {
                  ...editResult,
                  status: 'invalid_line_number',
                  error: `Line number ${line_number} is out of range (1-${modifiedLines.length})`
                };
              }
            }
            break;
            
          case 'insert_before':
            if (line_number && new_text !== undefined) {
              const idx = line_number - 1;
              if (idx >= 0 && idx <= modifiedLines.length) {
                modifiedLines.splice(idx, 0, new_text);
                changesCount++;
                
                editResult = {
                  ...editResult,
                  inserted_line: new_text,
                  status: 'success',
                  changes_made: 1
                };
              } else {
                editResult = {
                  ...editResult,
                  status: 'invalid_line_number',
                  error: `Line number ${line_number} is out of range for insertion`
                };
              }
            }
            break;
            
          case 'insert_after':
            if (line_number && new_text !== undefined) {
              const idx = line_number;
              if (idx >= 0 && idx <= modifiedLines.length) {
                modifiedLines.splice(idx, 0, new_text);
                changesCount++;
                
                editResult = {
                  ...editResult,
                  inserted_line: new_text,
                  status: 'success',
                  changes_made: 1
                };
              } else {
                editResult = {
                  ...editResult,
                  status: 'invalid_line_number',
                  error: `Line number ${line_number} is out of range for insertion`
                };
              }
            }
            break;
            
          case 'delete_line':
            if (line_number) {
              const idx = line_number - 1;
              if (idx >= 0 && idx < modifiedLines.length) {
                const deletedLine = modifiedLines[idx];
                modifiedLines.splice(idx, 1);
                changesCount++;
                
                editResult = {
                  ...editResult,
                  deleted_line: deletedLine,
                  status: 'success',
                  changes_made: 1
                };
              } else {
                editResult = {
                  ...editResult,
                  status: 'invalid_line_number',
                  error: `Line number ${line_number} is out of range for deletion`
                };
              }
            }
            break;
            
          default:
            editResult = {
              ...editResult,
              status: 'unsupported_mode',
              error: `Unsupported edit mode: ${mode}`
            };
        }
        
        totalChanges += changesCount;
        editResults.push(editResult);
        
      } catch (error) {
        editResults.push({
          ...editResult,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // 수정된 내용 저장 (변경사항이 있는 경우에만)
    if (totalChanges > 0) {
      const newContent = modifiedLines.join('\n');
      
      // 디렉토리 생성
      const dir = path.dirname(safePath_resolved);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(safePath_resolved, newContent, 'utf-8');
    }
    
    const stats = await fs.stat(safePath_resolved);
    
    return {
      message: `Safe multiple blocks edited successfully`,
      path: safePath_resolved,
      total_edits: edits.length,
      successful_edits: editResults.filter(r => r.status === 'success').length,
      total_changes: totalChanges,
      original_lines: lines.length,
      new_lines: modifiedLines.length,
      edit_results: editResults,
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      size: stats.size,
      size_readable: formatSize(stats.size),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    // 에러 시 백업에서 복구
    if (backup && CREATE_BACKUP_FILES && backupPath) {
      try {
        await fs.copyFile(backupPath, safePath_resolved);
      } catch {
        // 복구 실패
      }
    }
    throw error;
  }
}

async function handleExtractLines(args: any) {
  const { 
    path: filePath, 
    line_numbers, 
    start_line, 
    end_line, 
    pattern, 
    context_lines = 0 
  } = args;
  
  const safePath_resolved = safePath(filePath);
  const content = await fs.readFile(safePath_resolved, 'utf-8');
  const lines = content.split('\n');
  
  let extractedLines: Array<{line_number: number, content: string}> = [];
  
  if (line_numbers && Array.isArray(line_numbers)) {
    // 특정 라인 번호들 추출
    for (const lineNum of line_numbers) {
      const idx = lineNum - 1;
      if (idx >= 0 && idx < lines.length) {
        extractedLines.push({
          line_number: lineNum,
          content: lines[idx]
        });
      }
    }
  } else if (start_line && end_line) {
    // 범위 추출
    const startIdx = start_line - 1;
    const endIdx = end_line - 1;
    if (startIdx >= 0 && endIdx < lines.length && startIdx <= endIdx) {
      for (let i = startIdx; i <= endIdx; i++) {
        extractedLines.push({
          line_number: i + 1,
          content: lines[i]
        });
      }
    }
  } else if (pattern) {
    // 패턴 매칭으로 추출
    const regex = new RegExp(pattern, 'gi');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        // 컨텍스트 라인 포함
        const contextStart = Math.max(0, i - context_lines);
        const contextEnd = Math.min(lines.length - 1, i + context_lines);
        
        for (let j = contextStart; j <= contextEnd; j++) {
          const existing = extractedLines.find(el => el.line_number === j + 1);
          if (!existing) {
            extractedLines.push({
              line_number: j + 1,
              content: lines[j]
            });
          }
        }
      }
    }
  }
  
  // 라인 번호순 정렬
  extractedLines.sort((a, b) => a.line_number - b.line_number);
  
  return {
    extracted_lines: extractedLines,
    total_lines_extracted: extractedLines.length,
    total_file_lines: lines.length,
    path: safePath_resolved,
    timestamp: new Date().toISOString()
  };
}



// 여러개의 정교한 블록 편집을 한 번에 처리하는 핸들러 (handleEditBlockSafe와 동일한 로직 사용)
async function handleEditBlocks(args: any) {
  const { path: filePath, edits, backup = true } = args;
  
  // path 매개변수 필수 검증
  if (!filePath || typeof filePath !== 'string') {
    return {
      message: "Missing required parameter",
      error: "path_parameter_missing", 
      details: "The 'path' parameter is required for batch editing operations.",
      example: {
        correct_usage: "fast_edit_blocks({ path: '/path/to/file.txt', edits: [...] })",
        missing_parameter: "path"
      },
      suggestions: [
        "Add the 'path' parameter with a valid file path",
        "Ensure the path is a string value", 
        "Use an absolute path for better reliability"
      ],
      status: "parameter_error",
      timestamp: new Date().toISOString()
    };
  }
  
  const safePath_resolved = safePath(filePath);
  
  // 파일 존재 확인
  let fileExists = true;
  try {
    await fs.access(safePath_resolved);
  } catch {
    fileExists = false;
    throw new Error(`File does not exist: ${safePath_resolved}`);
  }
  
  const originalContent = await fs.readFile(safePath_resolved, 'utf-8');
  const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
  
  // 백업 생성 (설정에 따라)
  if (backup && CREATE_BACKUP_FILES) {
    await fs.copyFile(safePath_resolved, backupPath!);
  }
  
  try {
    let modifiedContent = originalContent;
    let totalChanges = 0;
    const editResults: any[] = [];
    
    // 각 편집을 순차적으로 처리 (handleEditBlockSafe와 동일한 로직)
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      const { 
        old_text, 
        new_text, 
        expected_replacements = 1,
        word_boundary = false,
        case_sensitive = true
      } = edit;
      
      if (!old_text || new_text === undefined) {
        editResults.push({
          edit_index: i + 1,
          old_text: old_text?.substring(0, 50) || '',
          status: 'skipped - invalid parameters',
          occurrences: 0
        });
        continue;
      }
      
      // handleEditBlockSafe와 동일한 위험 분석
      const riskAnalysis = analyzeEditRisk(old_text, new_text, modifiedContent, {
        word_boundary,
        case_sensitive
      });
      
      // handleEditBlockSafe와 동일한 매칭 패턴 준비
      let searchPattern = old_text;
      let flags = case_sensitive ? 'g' : 'gi';
      
      if (word_boundary) {
        // 단어 경계 추가로 부분 매칭 방지
        searchPattern = `\\b${escapeRegExp(old_text)}\\b`;
      } else {
        searchPattern = escapeRegExp(old_text);
      }
      
      const regex = new RegExp(searchPattern, flags);
      const occurrences = (modifiedContent.match(regex) || []).length;
      
      if (occurrences === 0) {
        editResults.push({
          edit_index: i + 1,
          old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
          expected_replacements: expected_replacements,
          actual_occurrences: 0,
          status: 'not_found',
          risk_analysis: riskAnalysis
        });
        continue;
      }
      
      if (expected_replacements !== occurrences) {
        editResults.push({
          edit_index: i + 1,
          old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
          expected_replacements: expected_replacements,
          actual_occurrences: occurrences,
          status: 'count_mismatch',
          safety_info: 'Use expected_replacements parameter to confirm the exact number of changes',
          risk_analysis: riskAnalysis
        });
        continue;
      }
      
      // 안전 확인 완료 - 편집 실행 (handleEditBlockSafe와 동일)
      modifiedContent = modifiedContent.replace(regex, new_text);
      totalChanges += occurrences;
      
      editResults.push({
        edit_index: i + 1,
        old_text_preview: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
        new_text_preview: new_text.length > 100 ? new_text.substring(0, 100) + '...' : new_text,
        status: 'success',
        changes_made: occurrences,
        expected_replacements: expected_replacements,
        actual_replacements: occurrences,
        risk_analysis: riskAnalysis,
        word_boundary_used: word_boundary,
        case_sensitive_used: case_sensitive
      });
    }
    
    // 수정된 내용 저장 (변경사항이 있는 경우에만)
    if (totalChanges > 0) {
      // 디렉토리 생성
      const dir = path.dirname(safePath_resolved);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(safePath_resolved, modifiedContent, 'utf-8');
    }
    
    const stats = await fs.stat(safePath_resolved);
    const originalLines = originalContent.split('\n').length;
    const newLines = modifiedContent.split('\n').length;
    
    return {
      message: `Safe multiple block edits processed successfully`,
      path: safePath_resolved,
      total_edits: edits.length,
      successful_edits: editResults.filter(r => r.status === 'success').length,
      total_changes: totalChanges,
      original_lines: originalLines,
      new_lines: newLines,
      edit_results: editResults,
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      size: stats.size,
      size_readable: formatSize(stats.size),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    // 에러 시 백업에서 복구
    if (backup && CREATE_BACKUP_FILES && backupPath) {
      try {
        await fs.copyFile(backupPath, safePath_resolved);
      } catch {
        // 복구 실패는 무시
      }
    }
    throw error;
  }
}

// 코드 검색 함수 (ripgrep 기반)
async function handleSearchCode(args: any) {
  const {
    path: searchPath,
    pattern,
    file_pattern = '',
    context_lines = 2,
    max_results = 50,
    case_sensitive = false,
    include_hidden = false,
    max_file_size = 10,
    timeout = 30
  } = args;

  const safePath_resolved = safePath(searchPath);
  
  try {
    // ripgrep을 사용한 고성능 검색 시도
    const searchResults = await searchCode({
      rootPath: safePath_resolved,
      pattern: pattern,
      filePattern: file_pattern,
      ignoreCase: !case_sensitive,
      maxResults: Math.min(max_results, 200),
      includeHidden: include_hidden,
      contextLines: context_lines,
      timeout: timeout * 1000 // 초를 밀리초로 변환
    });

    // 결과를 기존 형식으로 변환
    const results: any[] = [];
    const fileGroups: { [file: string]: any } = {};

    for (const result of searchResults) {
      if (!fileGroups[result.file]) {
        fileGroups[result.file] = {
          file: result.file,
          matches: [],
          total_matches: 0
        };
      }

      fileGroups[result.file].matches.push({
        line_number: result.line,
        line_content: result.match,
        column: result.column || 0,
        context_before: result.context_before || [],
        context_after: result.context_after || []
      });
      fileGroups[result.file].total_matches++;
    }

    // 파일별로 결과 정리
    for (const [filePath, fileData] of Object.entries(fileGroups)) {
      results.push({
        file: filePath,
        file_name: path.basename(filePath),
        total_matches: fileData.total_matches,
        matches: fileData.matches.slice(0, max_results) // 파일당 최대 결과 제한
      });
    }

    // 통합 출력 생성 (desktop-commander 스타일)
    let combinedOutput = '';
    let totalMatches = 0;

    results.forEach(fileResult => {
      combinedOutput += `\n=== ${fileResult.file} ===\n`;
      fileResult.matches.forEach((match: any) => {
        combinedOutput += `${match.line_number}: ${match.line_content}\n`;
        totalMatches++;
      });
    });

    return {
      results: results,
      total_files: results.length,
      total_matches: totalMatches,
      search_pattern: pattern,
      search_path: safePath_resolved,
      file_pattern: file_pattern,
      context_lines: context_lines,
      case_sensitive: case_sensitive,
      include_hidden: include_hidden,
      max_file_size_mb: max_file_size,
      ripgrep_used: true,
      search_time_ms: 0, // ripgrep 내부에서 측정됨
      formatted_output: combinedOutput.trim(),
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    // ripgrep 실패시 폴백 로직
    console.warn('Ripgrep search failed, using fallback:', error);
    
    // 기존 네이티브 검색으로 폴백
    return handleSearchCodeFallback(args);
  }
}

// 폴백용 네이티브 검색 함수
async function handleSearchCodeFallback(args: any) {
  const {
    path: searchPath,
    pattern,
    file_pattern = '',
    context_lines = 2,
    max_results = 50,
    case_sensitive = false,
    include_hidden = false,
    max_file_size = 10
  } = args;

  const safePath_resolved = safePath(searchPath);
  const maxResults = Math.min(max_results, 200);
  const maxFileSize = max_file_size * 1024 * 1024; // MB to bytes
  const results: any[] = [];

  // 정규표현식 패턴 지원
  let regexPattern: RegExp | null = null;
  try {
    regexPattern = new RegExp(pattern, case_sensitive ? 'g' : 'gi');
  } catch {
    // 정규표현식이 아닌 경우 문자열 검색으로 처리
  }

  // 파일 패턴 필터
  let fileRegex: RegExp | null = null;
  if (file_pattern) {
    try {
      // 와일드카드를 정규표현식으로 변환
      const regexStr = file_pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      fileRegex = new RegExp(`^${regexStr}$`, 'i');
    } catch {
      // 정규표현식 변환 실패시 단순 문자열 포함 검사
    }
  }

  // 코드 파일 확장자 (기본값)
  const codeExtensions = new Set([
    '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
    '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.clj',
    '.sh', '.bash', '.zsh', '.fish', '.ps1', '.cmd', '.bat', '.sql', '.html',
    '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.md', '.markdown',
    '.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf'
  ]);

  // 바이너리 파일 감지 함수
  function isBinaryFile(buffer: Buffer): boolean {
    const sample = buffer.slice(0, 1024);
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === 0) return true;
    }
    return false;
  }

  // desktop-commander 스타일 출력 생성
  function formatOutput(filePath: string, matches: Array<{
    line_number: number;
    line_content: string;
    match_start: number;
    match_end: number;
    context_before: string[];
    context_after: string[];
  }>): string {
    let output = `${filePath}:\n`;
    
    for (const match of matches) {
      // 컨텍스트 이전 라인들
      if (match.context_before && match.context_before.length > 0) {
        match.context_before.forEach((line, index) => {
          const lineNum = match.line_number - match.context_before.length + index;
          output += `  ${lineNum}: ${line}\n`;
        });
      }
      
      // 매치된 라인 (하이라이트 표시)
      const line = match.line_content;
      const highlighted = line.substring(0, match.match_start) + 
                         '**' + line.substring(match.match_start, match.match_end) + '**' +
                         line.substring(match.match_end);
      output += `  ${match.line_number}: ${highlighted}\n`;
      
      // 컨텍스트 이후 라인들
      if (match.context_after && match.context_after.length > 0) {
        match.context_after.forEach((line, index) => {
          const lineNum = match.line_number + 1 + index;
          output += `  ${lineNum}: ${line}\n`;
        });
      }
      
      output += '\n';
    }
    
    return output;
  }

  async function searchDirectory(dirPath: string) {
    if (results.length >= maxResults) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(dirPath, entry.name);

        // 숨김 파일 필터링
        if (!include_hidden && entry.name.startsWith('.')) continue;
        
        if (shouldExcludePath(fullPath)) continue;

        if (entry.isFile()) {
          // 파일 패턴 필터링
          if (fileRegex) {
            if (!fileRegex.test(entry.name)) continue;
          } else if (!file_pattern) {
            // 파일 패턴이 지정되지 않은 경우 코드 파일만 검색
            const ext = path.extname(entry.name).toLowerCase();
            if (!codeExtensions.has(ext)) continue;
          }

          try {
            const stats = await fs.stat(fullPath);
            
            // 파일 크기 제한
            if (stats.size > maxFileSize) continue;

            const buffer = await fs.readFile(fullPath);
            
            // 바이너리 파일 스킵
            if (isBinaryFile(buffer)) continue;

            const content = buffer.toString('utf-8');
            const lines = content.split('\n');
            const matches: Array<{
              line_number: number;
              line_content: string;
              match_start: number;
              match_end: number;
              context_before: string[];
              context_after: string[];
            }> = [];

            // 각 라인에서 패턴 검색
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const searchLine = case_sensitive ? line : line.toLowerCase();
              const searchPattern = case_sensitive ? pattern : pattern.toLowerCase();
              
              let matched = false;
              let matchStart = -1;
              let matchEnd = -1;

              if (regexPattern) {
                regexPattern.lastIndex = 0; // 정규표현식 인덱스 리셋
                const regexMatch = regexPattern.exec(line);
                if (regexMatch) {
                  matched = true;
                  matchStart = regexMatch.index;
                  matchEnd = matchStart + regexMatch[0].length;
                }
              } else {
                const index = searchLine.indexOf(searchPattern);
                if (index !== -1) {
                  matched = true;
                  matchStart = index;
                  matchEnd = index + searchPattern.length;
                }
              }

              if (matched) {
                const matchInfo = {
                  line_number: i + 1,
                  line_content: line,
                  match_start: matchStart,
                  match_end: matchEnd,
                  context_before: [] as string[],
                  context_after: [] as string[]
                };

                // 컨텍스트 라인 추가
                if (context_lines > 0) {
                  // 이전 라인들
                  for (let j = Math.max(0, i - context_lines); j < i; j++) {
                    matchInfo.context_before.push(lines[j]);
                  }

                  // 이후 라인들
                  for (let j = i + 1; j <= Math.min(lines.length - 1, i + context_lines); j++) {
                    matchInfo.context_after.push(lines[j]);
                  }
                }

                matches.push(matchInfo);
              }
            }

            if (matches.length > 0) {
              results.push({
                file: fullPath,
                relative_path: path.relative(safePath_resolved, fullPath),
                matches: matches,
                total_matches: matches.length,
                file_size: stats.size,
                file_size_readable: formatSize(stats.size),
                modified: stats.mtime.toISOString(),
                extension: path.extname(fullPath),
                formatted_output: formatOutput(fullPath, matches)
              });
            }

          } catch (error) {
            // 읽기 실패한 파일은 조용히 건너뛰기
            continue;
          }
        } else if (entry.isDirectory()) {
          await searchDirectory(fullPath);
        }
      }
    } catch (error) {
      // 권한 없는 디렉토리 등은 조용히 무시
      console.warn(`Failed to search directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  const startTime = Date.now();
  await searchDirectory(safePath_resolved);
  const searchTime = Date.now() - startTime;

  // desktop-commander 스타일의 통합 출력 생성
  let combinedOutput = '';
  let totalMatches = 0;
  
  for (const result of results) {
    combinedOutput += result.formatted_output;
    totalMatches += result.total_matches;
  }

  return {
    results: results,
    total_files: results.length,
    total_matches: totalMatches,
    search_pattern: pattern,
    search_path: safePath_resolved,
    file_pattern: file_pattern,
    context_lines: context_lines,
    case_sensitive: case_sensitive,
    include_hidden: include_hidden,
    max_file_size_mb: max_file_size,
    regex_used: regexPattern !== null,
    search_time_ms: searchTime,
    formatted_output: combinedOutput,
    timestamp: new Date().toISOString()
  };
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});

// 새로운 복잡한 파일 작업 핸들러들

async function handleCopyFile(args: any) {
  const { 
    source, 
    destination, 
    overwrite = false, 
    preserve_timestamps = true, 
    recursive = true,
    create_dirs = true 
  } = args;
  
  const sourcePath = safePath(source);
  const destPath = safePath(destination);
  
  try {
    const sourceStats = await fs.stat(sourcePath);
    
    // 대상 디렉토리 생성
    if (create_dirs) {
      const destDir = path.dirname(destPath);
      await fs.mkdir(destDir, { recursive: true });
    }
    
    // 덮어쓰기 검사
    let destExists = false;
    try {
      await fs.access(destPath);
      destExists = true;
      if (!overwrite) {
        throw new Error(`Destination already exists: ${destPath}`);
      }
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
    
    if (sourceStats.isDirectory()) {
      if (!recursive) {
        throw new Error('Cannot copy directory without recursive option');
      }
      await copyDirectoryRecursive(sourcePath, destPath, overwrite, preserve_timestamps);
    } else {
      await fs.copyFile(sourcePath, destPath);
      
      // 타임스탬프 보존
      if (preserve_timestamps) {
        await fs.utimes(destPath, sourceStats.atime, sourceStats.mtime);
      }
    }
    
    const destStats = await fs.stat(destPath);
    
    return {
      message: `${sourceStats.isDirectory() ? 'Directory' : 'File'} copied successfully`,
      source: sourcePath,
      destination: destPath,
      source_size: sourceStats.size,
      destination_size: destStats.size,
      source_size_readable: formatSize(sourceStats.size),
      destination_size_readable: formatSize(destStats.size),
      overwritten: destExists,
      preserve_timestamps: preserve_timestamps,
      recursive: recursive && sourceStats.isDirectory(),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Copy failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function copyDirectoryRecursive(source: string, destination: string, overwrite: boolean, preserveTimestamps: boolean) {
  await fs.mkdir(destination, { recursive: true });
  
  const entries = await fs.readdir(source, { withFileTypes: true });
  
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);
    
    if (shouldExcludePath(sourcePath)) continue;
    
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destPath, overwrite, preserveTimestamps);
    } else {
      // 덮어쓰기 검사
      try {
        await fs.access(destPath);
        if (!overwrite) {
          console.warn(`Skipping existing file: ${destPath}`);
          continue;
        }
      } catch {
        // 파일이 없으면 계속 진행
      }
      
      await fs.copyFile(sourcePath, destPath);
      
      if (preserveTimestamps) {
        const sourceStats = await fs.stat(sourcePath);
        await fs.utimes(destPath, sourceStats.atime, sourceStats.mtime);
      }
    }
  }
}

async function handleMoveFile(args: any) {
  const { 
    source, 
    destination, 
    overwrite = false, 
    create_dirs = true,
    backup_if_exists = false 
  } = args;
  
  const sourcePath = safePath(source);
  const destPath = safePath(destination);
  
  try {
    const sourceStats = await fs.stat(sourcePath);
    
    // 대상 디렉토리 생성
    if (create_dirs) {
      const destDir = path.dirname(destPath);
      await fs.mkdir(destDir, { recursive: true });
    }
    
    // 덮어쓰기 및 백업 처리
    let destExists = false;
    let backupPath = null;
    try {
      const destStats = await fs.stat(destPath);
      destExists = true;
      
      if (backup_if_exists && CREATE_BACKUP_FILES) {
        backupPath = `${destPath}.backup.${Date.now()}`;
        await fs.copyFile(destPath, backupPath);
      }
      
      if (!overwrite && !backup_if_exists) {
        throw new Error(`Destination already exists: ${destPath}`);
      }
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
    
    // 같은 파티션에서는 rename, 다른 파티션에서는 copy + delete
    try {
      await fs.rename(sourcePath, destPath);
    } catch (error) {
      // Cross-device 에러인 경우 copy + delete로 처리
      if ((error as any).code === 'EXDEV') {
        if (sourceStats.isDirectory()) {
          await copyDirectoryRecursive(sourcePath, destPath, overwrite, true);
          await fs.rm(sourcePath, { recursive: true, force: true });
        } else {
          await fs.copyFile(sourcePath, destPath);
          await fs.unlink(sourcePath);
        }
      } else {
        throw error;
      }
    }
    
    const destStats = await fs.stat(destPath);
    
    return {
      message: `${sourceStats.isDirectory() ? 'Directory' : 'File'} moved successfully`,
      source: sourcePath,
      destination: destPath,
      size: destStats.size,
      size_readable: formatSize(destStats.size),
      overwritten: destExists,
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      cross_device_move: false, // 실제 구현에서는 감지 가능
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Move failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleDeleteFile(args: any) {
  const { 
    path: targetPath, 
    recursive = false, 
    force = false,
    backup_before_delete = false,
    confirm_delete = true 
  } = args;
  
  const resolvedPath = safePath(targetPath);
  
  try {
    const stats = await fs.stat(resolvedPath);
    
    // 안전장치: 중요한 디렉토리 보호
    const protectedPaths = ['/Users', '/home', '/', '/System', '/usr', '/bin', '/sbin'];
    if (protectedPaths.some(protectedPath => resolvedPath.startsWith(protectedPath) && resolvedPath.split('/').length <= 3)) {
      throw new Error(`Cannot delete protected system path: ${resolvedPath}`);
    }
    
    // 확인 단계
    if (confirm_delete && !force) {
      const itemType = stats.isDirectory() ? 'directory' : 'file';
      const warningMessage = `WARNING: This will permanently delete the ${itemType}: ${resolvedPath}`;
      console.warn(warningMessage);
      
      // 실제 구현에서는 대화형 확인이 어려우므로 force 플래그 요구
      if (!force) {
        return {
          message: 'Deletion cancelled for safety',
          path: resolvedPath,
          item_type: itemType,
          size: stats.size,
          size_readable: formatSize(stats.size),
          warning: 'Use force: true to confirm deletion',
          backup_available: backup_before_delete && CREATE_BACKUP_FILES,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    // 백업 생성
    let backupPath = null;
    if (backup_before_delete && CREATE_BACKUP_FILES) {
      backupPath = `${resolvedPath}.deleted_backup.${Date.now()}`;
      if (stats.isDirectory()) {
        await copyDirectoryRecursive(resolvedPath, backupPath, true, true);
      } else {
        await fs.copyFile(resolvedPath, backupPath);
      }
    }
    
    // 삭제 실행
    if (stats.isDirectory()) {
      if (!recursive) {
        // 빈 디렉토리인지 확인
        const entries = await fs.readdir(resolvedPath);
        if (entries.length > 0) {
          throw new Error('Directory is not empty. Use recursive: true to delete non-empty directories');
        }
        await fs.rmdir(resolvedPath);
      } else {
        await fs.rm(resolvedPath, { recursive: true, force: force });
      }
    } else {
      await fs.unlink(resolvedPath);
    }
    
    return {
      message: `${stats.isDirectory() ? 'Directory' : 'File'} deleted successfully`,
      path: resolvedPath,
      item_type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      size_readable: formatSize(stats.size),
      recursive: recursive && stats.isDirectory(),
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      force_used: force,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleBatchFileOperations(args: any) {
  const { 
    operations = [], 
    stop_on_error = true, 
    dry_run = false,
    create_backup = false 
  } = args;
  
  const results: any[] = [];
  let successCount = 0;
  let errorCount = 0;
  let backupDir = null;
  
  // 백업 디렉토리 생성 (실제 실행시에만)
  if (create_backup && !dry_run && CREATE_BACKUP_FILES) {
    backupDir = `/tmp/mcp_batch_backup_${Date.now()}`;
    await fs.mkdir(backupDir, { recursive: true });
  }
  
  try {
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      const { operation: op, source, destination, overwrite = false } = operation;
      
      try {
        // 입력 검증
        if (!source) {
          throw new Error('Source path is required');
        }
        if (['copy', 'move', 'rename'].includes(op) && !destination) {
          throw new Error(`Destination path is required for ${op} operation`);
        }
        
        const sourcePath = safePath(source);
        let result: any = { operation: op, source: sourcePath };
        
        if (dry_run) {
          // Dry run: 실제 실행 없이 검증만
          const sourceStats = await fs.stat(sourcePath);
          result.dry_run = true;
          result.source_exists = true;
          result.source_type = sourceStats.isDirectory() ? 'directory' : 'file';
          result.source_size = sourceStats.size;
          
          if (destination) {
            const destPath = safePath(destination);
            result.destination = destPath;
            try {
              await fs.access(destPath);
              result.destination_exists = true;
              result.will_overwrite = overwrite;
            } catch {
              result.destination_exists = false;
            }
          }
          
          result.status = 'would_execute';
        } else {
          // 실제 실행
          let backupPath = null;
          
          // 개별 백업 생성
          if (create_backup && backupDir && CREATE_BACKUP_FILES) {
            const sourceStats = await fs.stat(sourcePath);
            backupPath = path.join(backupDir, `${path.basename(sourcePath)}_${i}`);
            if (sourceStats.isDirectory()) {
              await copyDirectoryRecursive(sourcePath, backupPath, true, true);
            } else {
              await fs.copyFile(sourcePath, backupPath);
            }
          }
          
          switch (op) {
            case 'copy':
              const copyResult = await handleCopyFile({
                source: sourcePath,
                destination: destination,
                overwrite: overwrite,
                recursive: true,
                create_dirs: true
              });
              result = { ...result, ...copyResult, backup_created: backupPath };
              break;
              
            case 'move':
            case 'rename':
              const moveResult = await handleMoveFile({
                source: sourcePath,
                destination: destination,
                overwrite: overwrite,
                create_dirs: true
              });
              result = { ...result, ...moveResult, backup_created: backupPath };
              break;
              
            case 'delete':
              const deleteResult = await handleDeleteFile({
                path: sourcePath,
                recursive: true,
                force: true,
                backup_before_delete: false // 이미 위에서 백업했음
              });
              result = { ...result, ...deleteResult, backup_created: backupPath };
              break;
              
            default:
              throw new Error(`Unsupported operation: ${op}`);
          }
          
          result.status = 'success';
        }
        
        results.push(result);
        successCount++;
        
      } catch (error) {
        const errorResult = {
          operation: op,
          source: source,
          destination: destination,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
          dry_run: dry_run
        };
        
        results.push(errorResult);
        errorCount++;
        
        if (stop_on_error) {
          break;
        }
      }
    }
    
    return {
      message: `Batch operations ${dry_run ? 'analyzed' : 'completed'}`,
      total_operations: operations.length,
      successful: successCount,
      errors: errorCount,
      results: results,
      dry_run: dry_run,
      backup_directory: backupDir,
      backup_enabled: CREATE_BACKUP_FILES,
      stopped_on_error: stop_on_error && errorCount > 0,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Batch operations failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleCompressFiles(args: any) {
  const { 
    paths = [], 
    output_path, 
    format = 'zip',
    compression_level = 6,
    exclude_patterns = [] 
  } = args;
  
  // Node.js 내장 모듈로 간단한 압축 구현
  // 실제 구현에서는 archiver 등의 라이브러리 사용 권장
  
  const outputPath = safePath(output_path);
  const resolvedPaths = paths.map((p: string) => safePath(p));
  
  try {
    // 압축할 파일들 수집
    const filesToCompress: Array<{source: string, archive_path: string}> = [];
    
    for (const inputPath of resolvedPaths) {
      const stats = await fs.stat(inputPath);
      
      if (stats.isFile()) {
        if (!shouldExcludeFromCompression(inputPath, exclude_patterns)) {
          filesToCompress.push({
            source: inputPath,
            archive_path: path.basename(inputPath)
          });
        }
      } else if (stats.isDirectory()) {
        await collectFilesForCompression(inputPath, '', filesToCompress, exclude_patterns);
      }
    }
    
    // 간단한 tar 압축 구현 (실제로는 외부 도구 사용)
    if (format.startsWith('tar')) {
      await createTarArchive(filesToCompress, outputPath, format, compression_level);
    } else {
      // ZIP은 더 복잡하므로 외부 도구 필요
      throw new Error('ZIP compression requires additional dependencies. Use tar format instead.');
    }
    
    const outputStats = await fs.stat(outputPath);
    const totalOriginalSize = filesToCompress.reduce(async (acc, file) => {
      const stats = await fs.stat(file.source);
      return (await acc) + stats.size;
    }, Promise.resolve(0));
    
    return {
      message: 'Files compressed successfully',
      output_path: outputPath,
      format: format,
      compression_level: compression_level,
      files_compressed: filesToCompress.length,
      original_size: await totalOriginalSize,
      compressed_size: outputStats.size,
      original_size_readable: formatSize(await totalOriginalSize),
      compressed_size_readable: formatSize(outputStats.size),
      compression_ratio: ((await totalOriginalSize - outputStats.size) / await totalOriginalSize * 100).toFixed(2) + '%',
      exclude_patterns: exclude_patterns,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function shouldExcludeFromCompression(filePath: string, excludePatterns: string[]): boolean {
  const fileName = path.basename(filePath);
  const allPatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];
  
  return allPatterns.some(pattern => {
    if (pattern.includes('*') || pattern.includes('?')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      return regex.test(fileName);
    }
    return fileName.includes(pattern);
  });
}

async function collectFilesForCompression(
  dirPath: string, 
  archivePath: string, 
  fileList: Array<{source: string, archive_path: string}>,
  excludePatterns: string[]
) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const entryArchivePath = path.join(archivePath, entry.name);
    
    if (shouldExcludeFromCompression(fullPath, excludePatterns)) {
      continue;
    }
    
    if (entry.isFile()) {
      fileList.push({
        source: fullPath,
        archive_path: entryArchivePath
      });
    } else if (entry.isDirectory()) {
      await collectFilesForCompression(fullPath, entryArchivePath, fileList, excludePatterns);
    }
  }
}

async function createTarArchive(
  files: Array<{source: string, archive_path: string}>, 
  outputPath: string, 
  format: string,
  compressionLevel: number
) {
  // 간단한 tar 명령어 사용 (실제 구현)
  const tempListFile = `/tmp/tar_list_${Date.now()}.txt`;
  
  try {
    // 파일 목록 작성
    const fileListContent = files.map(f => f.source).join('\n');
    await fs.writeFile(tempListFile, fileListContent);
    
    // tar 명령어 구성
    let tarCommand = `tar -cf "${outputPath}"`;
    
    if (format === 'tar.gz') {
      tarCommand = `tar -czf "${outputPath}"`;
    } else if (format === 'tar.bz2') {
      tarCommand = `tar -cjf "${outputPath}"`;
    }
    
    tarCommand += ` -T "${tempListFile}"`;
    
    // tar 실행
    const { stdout, stderr } = await execAsync(tarCommand);
    
    if (stderr) {
      console.warn('Tar warnings:', stderr);
    }
    
  } finally {
    // 임시 파일 정리
    try {
      await fs.unlink(tempListFile);
    } catch {
      // 정리 실패 무시
    }
  }
}

async function handleExtractArchive(args: any) {
  const { 
    archive_path, 
    extract_to = '.',
    overwrite = false,
    create_dirs = true,
    preserve_permissions = true,
    extract_specific = [] 
  } = args;
  
  const archivePath = safePath(archive_path);
  const extractPath = safePath(extract_to);
  
  try {
    const archiveStats = await fs.stat(archivePath);
    
    if (create_dirs) {
      await fs.mkdir(extractPath, { recursive: true });
    }
    
    // 아카이브 형식 감지
    const ext = path.extname(archivePath).toLowerCase();
    let format = 'unknown';
    
    if (ext === '.tar' || archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tar.bz2')) {
      format = 'tar';
    } else if (ext === '.zip') {
      format = 'zip';
    }
    
    let extractedFiles: string[] = [];
    
    if (format === 'tar') {
      extractedFiles = await extractTarArchive(archivePath, extractPath, overwrite, extract_specific);
    } else if (format === 'zip') {
      throw new Error('ZIP extraction requires additional dependencies. Use tar format instead.');
    } else {
      throw new Error(`Unsupported archive format: ${ext}`);
    }
    
    return {
      message: 'Archive extracted successfully',
      archive_path: archivePath,
      extract_to: extractPath,
      format: format,
      files_extracted: extractedFiles.length,
      extracted_files: extractedFiles.slice(0, 50), // 처음 50개만 표시
      archive_size: archiveStats.size,
      archive_size_readable: formatSize(archiveStats.size),
      overwrite: overwrite,
      preserve_permissions: preserve_permissions,
      specific_files: extract_specific.length > 0 ? extract_specific : null,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Archive extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function extractTarArchive(
  archivePath: string, 
  extractPath: string, 
  overwrite: boolean,
  specificFiles: string[]
): Promise<string[]> {
  // tar 명령어로 압축 해제
  let tarCommand = `tar -tf "${archivePath}"`; // 파일 목록 먼저 확인
  
  try {
    const { stdout: fileList } = await execAsync(tarCommand);
    const files = fileList.trim().split('\n').filter(f => f.trim());
    
    // 특정 파일만 추출하는 경우
    const filesToExtract = specificFiles.length > 0 ? 
      files.filter(f => specificFiles.some(sf => f.includes(sf))) : files;
    
    // 덮어쓰기 확인
    if (!overwrite) {
      for (const file of filesToExtract) {
        const targetPath = path.join(extractPath, file);
        try {
          await fs.access(targetPath);
          throw new Error(`File already exists: ${targetPath}. Use overwrite: true to replace.`);
        } catch (error) {
          if ((error as any).code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }
    
    // 실제 압축 해제
    let extractCommand = `tar -xf "${archivePath}" -C "${extractPath}"`;
    
    if (specificFiles.length > 0) {
      const tempListFile = `/tmp/extract_list_${Date.now()}.txt`;
      await fs.writeFile(tempListFile, filesToExtract.join('\n'));
      extractCommand += ` -T "${tempListFile}"`;
      
      try {
        await execAsync(extractCommand);
      } finally {
        await fs.unlink(tempListFile).catch(() => {});
      }
    } else {
      await execAsync(extractCommand);
    }
    
    return filesToExtract;
    
  } catch (error) {
    throw new Error(`Tar extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function handleSyncDirectories(args: any) {
  const { 
    source_dir, 
    target_dir,
    sync_mode = 'update',
    delete_extra = false,
    preserve_newer = true,
    dry_run = false,
    exclude_patterns = ['.git', 'node_modules', '.DS_Store'] 
  } = args;
  
  const sourcePath = safePath(source_dir);
  const targetPath = safePath(target_dir);
  
  try {
    const sourceStats = await fs.stat(sourcePath);
    if (!sourceStats.isDirectory()) {
      throw new Error('Source must be a directory');
    }
    
    // 대상 디렉토리 생성
    if (!dry_run) {
      await fs.mkdir(targetPath, { recursive: true });
    }
    
    const syncResults = {
      copied: [] as string[],
      updated: [] as string[],
      deleted: [] as string[],
      skipped: [] as string[],
      errors: [] as string[]
    };
    
    // 소스 디렉토리 스캔
    await syncDirectoryRecursive(sourcePath, targetPath, '', syncResults, {
      sync_mode,
      delete_extra,
      preserve_newer,
      dry_run,
      exclude_patterns
    });
    
    // 대상에만 있는 파일들 처리 (삭제)
    if (delete_extra) {
      await cleanupExtraFiles(sourcePath, targetPath, '', syncResults, {
        dry_run,
        exclude_patterns
      });
    }
    
    const totalOperations = syncResults.copied.length + syncResults.updated.length + 
                          syncResults.deleted.length + syncResults.skipped.length;
    
    return {
      message: `Directory sync ${dry_run ? 'analyzed' : 'completed'}`,
      source_directory: sourcePath,
      target_directory: targetPath,
      sync_mode: sync_mode,
      total_operations: totalOperations,
      copied: syncResults.copied.length,
      updated: syncResults.updated.length,
      deleted: syncResults.deleted.length,
      skipped: syncResults.skipped.length,
      errors: syncResults.errors.length,
      results: {
        copied: syncResults.copied.slice(0, 20),
        updated: syncResults.updated.slice(0, 20),
        deleted: syncResults.deleted.slice(0, 20),
        skipped: syncResults.skipped.slice(0, 20),
        errors: syncResults.errors.slice(0, 10)
      },
      dry_run: dry_run,
      delete_extra: delete_extra,
      preserve_newer: preserve_newer,
      exclude_patterns: exclude_patterns,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    throw new Error(`Directory sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function syncDirectoryRecursive(
  sourcePath: string, 
  targetPath: string, 
  relativePath: string,
  results: any,
  options: any
) {
  try {
    const currentSourcePath = path.join(sourcePath, relativePath);
    const currentTargetPath = path.join(targetPath, relativePath);
    
    const entries = await fs.readdir(currentSourcePath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryRelativePath = path.join(relativePath, entry.name);
      const entrySourcePath = path.join(sourcePath, entryRelativePath);
      const entryTargetPath = path.join(targetPath, entryRelativePath);
      
      // 제외 패턴 확인
      if (shouldExcludeFromSync(entrySourcePath, options.exclude_patterns)) {
        results.skipped.push(entryRelativePath);
        continue;
      }
      
      try {
        if (entry.isDirectory()) {
          // 디렉토리 생성
          if (!options.dry_run) {
            await fs.mkdir(entryTargetPath, { recursive: true });
          }
          
          // 재귀적으로 처리
          await syncDirectoryRecursive(sourcePath, targetPath, entryRelativePath, results, options);
          
        } else if (entry.isFile()) {
          const sourceStats = await fs.stat(entrySourcePath);
          let shouldCopy = false;
          let operation = '';
          
          try {
            const targetStats = await fs.stat(entryTargetPath);
            
            // 동기화 모드에 따른 처리
            switch (options.sync_mode) {
              case 'mirror':
                shouldCopy = true;
                operation = 'updated';
                break;
                
              case 'update':
                if (sourceStats.mtime > targetStats.mtime) {
                  shouldCopy = true;
                  operation = 'updated';
                } else if (options.preserve_newer && targetStats.mtime > sourceStats.mtime) {
                  results.skipped.push(entryRelativePath);
                  continue;
                } else {
                  shouldCopy = true;
                  operation = 'updated';
                }
                break;
                
              case 'merge':
                if (sourceStats.mtime > targetStats.mtime) {
                  shouldCopy = true;
                  operation = 'updated';
                } else {
                  results.skipped.push(entryRelativePath);
                  continue;
                }
                break;
            }
            
          } catch (error) {
            // 대상 파일이 없는 경우
            if ((error as any).code === 'ENOENT') {
              shouldCopy = true;
              operation = 'copied';
            } else {
              throw error;
            }
          }
          
          if (shouldCopy) {
            if (!options.dry_run) {
              await fs.copyFile(entrySourcePath, entryTargetPath);
              // 타임스탬프 보존
              await fs.utimes(entryTargetPath, sourceStats.atime, sourceStats.mtime);
            }
            
            if (operation === 'copied') {
              results.copied.push(entryRelativePath);
            } else {
              results.updated.push(entryRelativePath);
            }
          }
        }
        
      } catch (error) {
        results.errors.push(`${entryRelativePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
  } catch (error) {
    results.errors.push(`${relativePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function shouldExcludeFromSync(filePath: string, excludePatterns: string[]): boolean {
  const pathParts = filePath.split(path.sep);
  
  return excludePatterns.some(pattern => {
    return pathParts.some(part => {
      if (pattern.includes('*') || pattern.includes('?')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        return regex.test(part);
      }
      return part === pattern;
    });
  });
}

async function cleanupExtraFiles(
  sourcePath: string, 
  targetPath: string, 
  relativePath: string,
  results: any,
  options: any
) {
  try {
    const currentTargetPath = path.join(targetPath, relativePath);
    
    const entries = await fs.readdir(currentTargetPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryRelativePath = path.join(relativePath, entry.name);
      const entrySourcePath = path.join(sourcePath, entryRelativePath);
      const entryTargetPath = path.join(targetPath, entryRelativePath);
      
      // 제외 패턴 확인
      if (shouldExcludeFromSync(entryTargetPath, options.exclude_patterns)) {
        continue;
      }
      
      try {
        // 소스에 해당 파일/디렉토리가 있는지 확인
        await fs.access(entrySourcePath);
        
        // 있으면 디렉토리인 경우 재귀적으로 처리
        if (entry.isDirectory()) {
          await cleanupExtraFiles(sourcePath, targetPath, entryRelativePath, results, options);
        }
        
      } catch (error) {
        // 소스에 없는 파일/디렉토리 발견 -> 삭제
        if ((error as any).code === 'ENOENT') {
          if (!options.dry_run) {
            if (entry.isDirectory()) {
              await fs.rm(entryTargetPath, { recursive: true, force: true });
            } else {
              await fs.unlink(entryTargetPath);
            }
          }
          results.deleted.push(entryRelativePath);
        }
      }
    }
    
  } catch (error) {
    // 대상 디렉토리가 없는 경우 등은 무시
  }
}


// 안전한 편집 핸들러 함수들
async function handleEditBlockSafe(args: any) {
  const { 
    path: filePath, 
    old_text,
    new_text,
    expected_replacements = 1,
    backup = true,
    word_boundary = false,
    preview_only = false,
    case_sensitive = true
  } = args;
  
  // path 매개변수 필수 검증
  if (!filePath || typeof filePath !== 'string') {
    return {
      message: "Missing required parameter",
      error: "path_parameter_missing",
      details: "The 'path' parameter is required for file editing operations.",
      example: {
        correct_usage: "fast_edit_block({ path: '/path/to/file.txt', old_text: '...', new_text: '...' })",
        missing_parameter: "path"
      },
      suggestions: [
        "Add the 'path' parameter with a valid file path",
        "Ensure the path is a string value",
        "Use an absolute path for better reliability"
      ],
      status: "parameter_error",
      timestamp: new Date().toISOString()
    };
  }
  
  const safePath_resolved = safePath(filePath);
  
  // 파일 존재 확인
  let fileExists = true;
  try {
    await fs.access(safePath_resolved);
  } catch {
    fileExists = false;
    throw new Error(`File does not exist: ${safePath_resolved}`);
  }
  
  const originalContent = await fs.readFile(safePath_resolved, 'utf-8');
  const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
  
  // 위험 분석
  const riskAnalysis = analyzeEditRisk(old_text, new_text, originalContent, {
    word_boundary,
    case_sensitive
  });
  
  // 백업 생성 (설정에 따라)
  if (backup && CREATE_BACKUP_FILES && !preview_only) {
    await fs.copyFile(safePath_resolved, backupPath!);
  }
  
  try {
    // 매칭 패턴 준비
    let searchPattern = old_text;
    let flags = case_sensitive ? 'g' : 'gi';
    
    if (word_boundary) {
      // 단어 경계 추가로 부분 매칭 방지
      searchPattern = `\\b${escapeRegExp(old_text)}\\b`;
    } else {
      searchPattern = escapeRegExp(old_text);
    }
    
    const regex = new RegExp(searchPattern, flags);
    const occurrences = (originalContent.match(regex) || []).length;
    
    if (occurrences === 0) {
      return {
        message: 'Text not found',
        path: safePath_resolved,
        old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
        expected_replacements: expected_replacements,
        actual_occurrences: 0,
        status: 'not_found',
        risk_analysis: riskAnalysis,
        backup_created: backupPath,
        backup_enabled: CREATE_BACKUP_FILES,
        timestamp: new Date().toISOString()
      };
    }
    
    if (expected_replacements !== occurrences) {
      return {
        message: 'Replacement count mismatch - operation cancelled for safety',
        path: safePath_resolved,
        old_text: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
        expected_replacements: expected_replacements,
        actual_occurrences: occurrences,
        status: 'count_mismatch',
        safety_info: 'Use expected_replacements parameter to confirm the exact number of changes',
        risk_analysis: riskAnalysis,
        backup_created: backupPath,
        backup_enabled: CREATE_BACKUP_FILES,
        timestamp: new Date().toISOString()
      };
    }
    
    // 미리보기 모드
    if (preview_only) {
      const modifiedContent = originalContent.replace(regex, new_text);
      const changePreview = generateChangePreview(originalContent, modifiedContent, old_text);
      
      return {
        message: 'Preview completed - no changes made',
        path: safePath_resolved,
        changes_made: 0,
        expected_replacements: expected_replacements,
        actual_replacements: occurrences,
        preview_mode: true,
        change_preview: changePreview,
        risk_analysis: riskAnalysis,
        backup_created: null,
        backup_enabled: CREATE_BACKUP_FILES,
        timestamp: new Date().toISOString()
      };
    }
    
    // 안전 확인 완료 - 편집 실행
    const modifiedContent = originalContent.replace(regex, new_text);
    
    // 디렉토리 생성
    const dir = path.dirname(safePath_resolved);
    await fs.mkdir(dir, { recursive: true });
    
    // 수정된 내용 저장
    await fs.writeFile(safePath_resolved, modifiedContent, 'utf-8');
    
    const stats = await fs.stat(safePath_resolved);
    const originalLines = originalContent.split('\n').length;
    const newLines = modifiedContent.split('\n').length;
    
    // 변경된 위치 정보 제공
    const beforeLines = originalContent.substring(0, originalContent.indexOf(old_text)).split('\n');
    const changeStartLine = beforeLines.length;
    
    return {
      message: 'Safe block editing completed successfully',
      path: safePath_resolved,
      changes_made: occurrences,
      expected_replacements: expected_replacements,
      actual_replacements: occurrences,
      change_start_line: changeStartLine,
      original_lines: originalLines,
      new_lines: newLines,
      old_text_preview: old_text.length > 100 ? old_text.substring(0, 100) + '...' : old_text,
      new_text_preview: new_text.length > 100 ? new_text.substring(0, 100) + '...' : new_text,
      status: 'success',
      risk_analysis: riskAnalysis,
      word_boundary_used: word_boundary,
      case_sensitive_used: case_sensitive,
      backup_created: backupPath,
      backup_enabled: CREATE_BACKUP_FILES,
      size: stats.size,
      size_readable: formatSize(stats.size),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    // 에러 시 백업에서 복구
    if (backup && CREATE_BACKUP_FILES && backupPath && !preview_only) {
      try {
        await fs.copyFile(backupPath, safePath_resolved);
      } catch {
        // 복구 실패는 무시
      }
    }
    throw error;
  }
}

// 위험 분석 함수
function analyzeEditRisk(oldText: string, newText: string, content: string, options: any) {
  const risks = [];
  const warnings = [];
  let riskLevel = 'low';
  
  // 1. 짧은 텍스트 위험 (부분 매칭 가능성)
  if (oldText.length < 10 && !options.word_boundary) {
    risks.push('Short text pattern may cause unintended partial matches');
    riskLevel = 'medium';
  }
  
  // 2. 다중 매칭 위험
  const occurrences = (content.match(new RegExp(escapeRegExp(oldText), options.case_sensitive ? 'g' : 'gi')) || []).length;
  if (occurrences > 3) {
    risks.push(`High number of matches (${occurrences}) increases risk of unintended changes`);
    riskLevel = 'high';
  }
  
  // 3. 변수명/식별자 패턴 감지
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  if (identifierPattern.test(oldText.trim()) && !options.word_boundary) {
    warnings.push('Identifier pattern detected - consider using word_boundary option');
    if (riskLevel === 'low') riskLevel = 'medium';
  }
  
  // 4. 특수문자 포함 검사
  const hasSpecialChars = /[^\w\s]/.test(oldText);
  if (!hasSpecialChars && oldText.includes(' ')) {
    warnings.push('Whitespace-only separation may cause unexpected matches');
  }
  
  // 5. 대소문자 혼합 패턴
  const hasMixedCase = /[a-z]/.test(oldText) && /[A-Z]/.test(oldText);
  if (hasMixedCase && !options.case_sensitive) {
    warnings.push('Mixed case pattern with case-insensitive matching may be risky');
  }
  
  return {
    risk_level: riskLevel,
    risks: risks,
    warnings: warnings,
    recommendations: generateSafetyRecommendations(oldText, riskLevel, options)
  };
}

// 안전성 권장사항 생성
function generateSafetyRecommendations(oldText: string, riskLevel: string, options: any) {
  const recommendations = [];
  
  if (riskLevel === 'high') {
    recommendations.push('Consider adding more context to the old_text');
    recommendations.push('Use preview_only: true to verify changes first');
  }
  
  if (oldText.length < 10) {
    recommendations.push('Add surrounding context to make the match more specific');
  }
  
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(oldText.trim()) && !options.word_boundary) {
    recommendations.push('Use word_boundary: true for identifier replacements');
  }
  
  recommendations.push('Always enable backup: true for important files');
  
  return recommendations;
}

// 변경 미리보기 생성
function generateChangePreview(original: string, modified: string, pattern: string) {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');
  const preview = [];
  
  // 변경된 라인들 찾기
  for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
    const origLine = originalLines[i] || '';
    const modLine = modifiedLines[i] || '';
    
    if (origLine !== modLine) {
      preview.push({
        line_number: i + 1,
        original: origLine,
        modified: modLine,
        change_type: origLine.includes(pattern) ? 'replacement' : 'side_effect'
      });
      
      if (preview.length >= 10) { // 최대 10개 라인만 표시
        preview.push({ line_number: -1, original: '...', modified: '...', change_type: 'truncated' });
        break;
      }
    }
  }
  
  return preview;
}

// 스마트 안전 편집 핸들러
async function handleSafeEdit(args: any) {
  const { 
    path: filePath, 
    old_text,
    new_text,
    safety_level = 'moderate',
    auto_add_context = true,
    require_confirmation = true
  } = args;
  
  const safePath_resolved = safePath(filePath);
  const originalContent = await fs.readFile(safePath_resolved, 'utf-8');
  
  // 자동 컨텍스트 추가
  let enhancedOldText = old_text;
  if (auto_add_context && old_text.length < 20) {
    enhancedOldText = addSmartContext(old_text, originalContent);
  }
  
  // 안전 수준에 따른 설정
  const safetyConfig = getSafetyConfig(safety_level);
  
  // 위험 분석
  const riskAnalysis = analyzeEditRisk(enhancedOldText, new_text, originalContent, safetyConfig);
  
  // 위험 수준에 따른 처리
  if (riskAnalysis.risk_level === 'high' && require_confirmation) {
    return {
      message: 'High risk detected - confirmation required',
      path: safePath_resolved,
      risk_analysis: riskAnalysis,
      enhanced_old_text: enhancedOldText,
      original_old_text: old_text,
      auto_context_added: enhancedOldText !== old_text,
      status: 'confirmation_required',
      safety_level: safety_level,
      next_steps: [
        'Review the risk analysis above',
        'Consider using enhanced_old_text for safer matching',
        'Set require_confirmation: false to proceed anyway',
        'Use preview_only: true to see changes first'
      ],
      timestamp: new Date().toISOString()
    };
  }
  
  // 안전한 편집 실행
  return await handleEditBlockSafe({
    path: filePath,
    old_text: enhancedOldText,
    new_text: new_text,
    expected_replacements: 1,
    backup: true,
    word_boundary: safetyConfig.word_boundary,
    preview_only: false,
    case_sensitive: safetyConfig.case_sensitive
  });
}

// 스마트 컨텍스트 추가
function addSmartContext(pattern: string, content: string): string {
  const lines = content.split('\n');
  
  // 패턴이 포함된 라인 찾기
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(pattern)) {
      // 전체 라인을 컨텍스트로 사용 (단, 너무 길면 줄임)
      if (line.length <= 100) {
        return line.trim();
      } else {
        // 패턴 주변 50자씩 추출
        const index = line.indexOf(pattern);
        const start = Math.max(0, index - 25);
        const end = Math.min(line.length, index + pattern.length + 25);
        return line.substring(start, end).trim();
      }
    }
  }
  
  return pattern; // 컨텍스트 추가 실패시 원본 반환
}

// 안전 수준 설정
function getSafetyConfig(level: string) {
  switch (level) {
    case 'strict':
      return {
        word_boundary: true,
        case_sensitive: true,
        require_context: true,
        min_context_length: 20
      };
    case 'moderate':
      return {
        word_boundary: false,
        case_sensitive: true,
        require_context: false,
        min_context_length: 10
      };
    case 'flexible':
      return {
        word_boundary: false,
        case_sensitive: false,
        require_context: false,
        min_context_length: 5
      };
    default:
      return getSafetyConfig('moderate');
  }
}
