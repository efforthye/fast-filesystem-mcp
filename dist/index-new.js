#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { SafeLargeFileWriter } from './checkpoint-writer.js';
const execAsync = promisify(exec);
// Claude 최적화 설정
const CLAUDE_MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const CLAUDE_MAX_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
const CLAUDE_MAX_LINES = 2000; // 최대 2000줄
const CLAUDE_MAX_DIR_ITEMS = 1000; // 디렉토리 항목 최대 1000개
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
// 이모지 제거 함수
function removeEmojis(text, enableEmojis = false) {
    if (enableEmojis)
        return text;
    // 이모지 패턴 정규식
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    return text.replace(emojiRegex, '');
}
// 유틸리티 함수들
function isPathAllowed(targetPath) {
    const absolutePath = path.resolve(targetPath);
    return DEFAULT_ALLOWED_DIRECTORIES.some(allowedDir => absolutePath.startsWith(path.resolve(allowedDir)));
}
function safePath(inputPath) {
    if (!isPathAllowed(inputPath)) {
        throw new Error(`Access denied to path: ${inputPath}`);
    }
    return path.resolve(inputPath);
}
function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}
function shouldExcludePath(targetPath, excludePatterns = []) {
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
function truncateContent(content, maxSize = CLAUDE_MAX_RESPONSE_SIZE) {
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
// MCP 서버 생성
const server = new Server({
    name: 'fast-filesystem',
    version: '2.5.0',
}, {
    capabilities: {
        tools: {},
    },
});
// 툴 목록 정의
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // ... 기존 툴들 ...
            {
                name: 'fast_checkpoint_write_file',
                description: '체크포인트 기반 대용량 파일 안전 작성 (중단 복구 가능, 이모지 제거 옵션)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '파일 경로' },
                        sections: {
                            type: 'array',
                            description: '섹션 배열',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string', description: '섹션 ID' },
                                    name: { type: 'string', description: '섹션 이름' },
                                    content: { type: 'string', description: '섹션 내용' }
                                },
                                required: ['id', 'name', 'content']
                            }
                        },
                        options: {
                            type: 'object',
                            description: '작성 옵션',
                            properties: {
                                enable_emojis: { type: 'boolean', description: '이모지 허용', default: false },
                                checkpoint_interval: { type: 'number', description: '체크포인트 간격', default: 1 },
                                auto_backup: { type: 'boolean', description: '자동 백업', default: true },
                                verify_write: { type: 'boolean', description: '작성 검증', default: true },
                                max_retries: { type: 'number', description: '최대 재시도', default: 3 },
                                mode: { type: 'string', enum: ['write', 'append'], description: '작성 모드', default: 'write' }
                            }
                        }
                    },
                    required: ['path', 'sections']
                }
            },
            {
                name: 'fast_checkpoint_status',
                description: '체크포인트 상태 확인',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '파일 경로' }
                    },
                    required: ['path']
                }
            },
            {
                name: 'fast_checkpoint_continue',
                description: '체크포인트에서 이어서 작성',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '파일 경로' }
                    },
                    required: ['path']
                }
            },
            {
                name: 'fast_checkpoint_reset',
                description: '체크포인트 초기화',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '파일 경로' }
                    },
                    required: ['path']
                }
            }
        ],
    };
});
// 체크포인트 핸들러들
async function handleCheckpointWriteFile(args) {
    const { path: filePath, sections, options = {} } = args;
    const safeFilePath = safePath(filePath);
    const writer = new SafeLargeFileWriter(safeFilePath, {
        enableEmojis: options.enable_emojis || false,
        checkpointInterval: options.checkpoint_interval || 1,
        autoBackup: options.auto_backup !== false,
        verifyWrite: options.verify_write !== false,
        maxRetries: options.max_retries || 3
    });
    // 섹션들 추가
    for (const section of sections) {
        writer.addSection(section.id, section.name, section.content);
    }
    const success = await writer.writeSafely(options.mode || 'write');
    return {
        success,
        path: safeFilePath,
        total_sections: writer.getSections().length,
        total_size: writer.getTotalSize(),
        total_size_readable: formatSize(writer.getTotalSize()),
        total_lines: writer.getTotalLines(),
        checkpoint_path: safeFilePath + '.checkpoint.json',
        backup_path: safeFilePath + '.backup',
        timestamp: new Date().toISOString()
    };
}
async function handleCheckpointStatus(args) {
    const { path: filePath } = args;
    const safeFilePath = safePath(filePath);
    const writer = new SafeLargeFileWriter(safeFilePath);
    // 상태 정보를 문자열로 캡처
    let statusOutput = '';
    const originalLog = console.log;
    console.log = (message) => {
        statusOutput += message + '\n';
    };
    await writer.getStatus();
    console.log = originalLog;
    return {
        path: safeFilePath,
        status_output: statusOutput,
        checkpoint_exists: await fs.access(safeFilePath + '.checkpoint.json').then(() => true).catch(() => false),
        file_exists: await fs.access(safeFilePath).then(() => true).catch(() => false),
        backup_exists: await fs.access(safeFilePath + '.backup').then(() => true).catch(() => false),
        timestamp: new Date().toISOString()
    };
}
async function handleCheckpointContinue(args) {
    const { path: filePath } = args;
    const safeFilePath = safePath(filePath);
    const writer = new SafeLargeFileWriter(safeFilePath);
    const success = await writer.continueFromCheckpoint();
    return {
        success,
        path: safeFilePath,
        message: success ? '체크포인트에서 성공적으로 이어서 작성 완료' : '체크포인트에서 이어서 작성 실패',
        timestamp: new Date().toISOString()
    };
}
async function handleCheckpointReset(args) {
    const { path: filePath } = args;
    const safeFilePath = safePath(filePath);
    const writer = new SafeLargeFileWriter(safeFilePath);
    await writer.resetCheckpoint();
    return {
        path: safeFilePath,
        message: '체크포인트 초기화 완료',
        timestamp: new Date().toISOString()
    };
}
// 기존 write_file 함수에 이모지 제거 기능 추가
async function handleWriteFile(args) {
    const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false, enable_emojis = false } = args;
    let targetPath;
    if (path.isAbsolute(filePath)) {
        targetPath = filePath;
    }
    else {
        targetPath = path.join(process.cwd(), filePath);
    }
    if (!isPathAllowed(targetPath)) {
        throw new Error(`Access denied to path: ${targetPath}`);
    }
    const resolvedPath = path.resolve(targetPath);
    if (create_dirs) {
        const dir = path.dirname(resolvedPath);
        await fs.mkdir(dir, { recursive: true });
    }
    // 이모지 제거 적용
    const cleanContent = removeEmojis(content, enable_emojis);
    if (append) {
        await fs.appendFile(resolvedPath, cleanContent, encoding);
    }
    else {
        await fs.writeFile(resolvedPath, cleanContent, encoding);
    }
    const stats = await fs.stat(resolvedPath);
    return {
        message: `File ${append ? 'appended' : 'written'} successfully` +
            (!enable_emojis ? ' (emojis removed)' : ''),
        path: resolvedPath,
        size: stats.size,
        size_readable: formatSize(stats.size),
        encoding: encoding,
        mode: append ? 'append' : 'write',
        emojis_removed: !enable_emojis,
        timestamp: new Date().toISOString()
    };
}
// 툴 호출 핸들러에 체크포인트 케이스 추가
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            case 'fast_checkpoint_write_file':
                result = await handleCheckpointWriteFile(args);
                break;
            case 'fast_checkpoint_status':
                result = await handleCheckpointStatus(args);
                break;
            case 'fast_checkpoint_continue':
                result = await handleCheckpointContinue(args);
                break;
            case 'fast_checkpoint_reset':
                result = await handleCheckpointReset(args);
                break;
            case 'fast_write_file':
                result = await handleWriteFile(args);
                break;
            // ... 기존 케이스들 ...
            default:
                throw new Error(`Tool not implemented: ${name}`);
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                }]
        };
    }
    catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Unknown error');
    }
});
// 서버 시작
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Fast Filesystem MCP Server v2.5.0 running on stdio (with checkpoint system)');
}
main().catch((error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
});
//# sourceMappingURL=index-new.js.map