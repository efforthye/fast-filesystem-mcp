#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
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
function detectEmojis(text) {
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
function removeEmojis(text) {
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]/gu;
    return text.replace(emojiRegex, '');
}
// 파일 타입별 이모지 가이드라인
function getEmojiGuideline(filePath) {
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
// 대용량 파일 작성을 위한 유틸리티 함수들
async function writeFileWithRetry(filePath, content, encoding, chunkSize, maxRetries, append) {
    let retryCount = 0;
    const startTime = Date.now();
    while (retryCount <= maxRetries) {
        try {
            await writeFileStreaming(filePath, content, encoding, chunkSize, append);
            return { retryCount, totalTime: Date.now() - startTime };
        }
        catch (error) {
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
async function writeFileStreaming(filePath, content, encoding, chunkSize, append) {
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
    }
    finally {
        await fileHandle.close();
    }
}
async function checkDiskSpace(dirPath, requiredBytes) {
    try {
        const { stdout } = await execAsync(`df -B1 "${dirPath}" | tail -1 | awk '{print $4}'`);
        const availableBytes = parseInt(stdout.trim());
        if (availableBytes < requiredBytes * 1.5) {
            throw new Error(`Insufficient disk space. Required: ${formatSize(requiredBytes)}, ` +
                `Available: ${formatSize(availableBytes)}`);
        }
    }
    catch (error) {
        console.warn('Could not check disk space:', error);
    }
}
async function getOriginalFileSize(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    }
    catch {
        return 0;
    }
}
// MCP 서버 생성
const server = new Server({
    name: 'fast-filesystem',
    version: '2.7.0',
}, {
    capabilities: {
        tools: {},
    },
});
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
                        max_results: { type: 'number', description: '최대 결과 수', default: 100 }
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
                        backup: { type: 'boolean', description: '백업 생성', default: true }
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
                name: 'fast_search_and_replace',
                description: '파일에서 텍스트를 검색하고 일괄 치환합니다',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: '파일 경로' },
                        search_pattern: { type: 'string', description: '검색할 패턴' },
                        replace_text: { type: 'string', description: '치환할 텍스트' },
                        use_regex: { type: 'boolean', description: '정규식 사용', default: false },
                        case_sensitive: { type: 'boolean', description: '대소문자 구분', default: true },
                        max_replacements: { type: 'number', description: '최대 치환 횟수', default: -1 },
                        backup: { type: 'boolean', description: '백업 생성', default: true }
                    },
                    required: ['path', 'search_pattern', 'replace_text']
                }
            }
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
                result = await handleReadFile(args);
                break;
            case 'fast_write_file':
                result = await handleWriteFile(args);
                break;
            case 'fast_large_write_file':
                result = await handleLargeWriteFile(args);
                break;
            case 'fast_list_directory':
                result = await handleListDirectory(args);
                break;
            case 'fast_get_file_info':
                result = await handleGetFileInfo(args);
                break;
            case 'fast_create_directory':
                result = await handleCreateDirectory(args);
                break;
            case 'fast_search_files':
                result = await handleSearchFiles(args);
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
                result = await handleEditBlock(args);
                break;
            case 'fast_edit_multiple_blocks':
                result = await handleEditMultipleBlocks(args);
                break;
            case 'fast_extract_lines':
                result = await handleExtractLines(args);
                break;
            case 'fast_search_and_replace':
                result = await handleSearchAndReplace(args);
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
    }
    catch (error) {
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
            max_response_size_mb: CLAUDE_MAX_RESPONSE_SIZE / (1024 ** 2),
            max_chunk_size_mb: CLAUDE_MAX_CHUNK_SIZE / (1024 ** 2),
            max_lines_per_read: CLAUDE_MAX_LINES,
            max_dir_items: CLAUDE_MAX_DIR_ITEMS
        },
        server_info: {
            name: 'fast-filesystem',
            version: '2.7.0',
            features: ['emoji-guidelines', 'large-file-writing', 'smart-recommendations', 'configurable-backup'],
            emoji_policy: 'Emojis not recommended in all file types',
            backup_enabled: CREATE_BACKUP_FILES,
            backup_env_var: 'MCP_CREATE_BACKUP_FILES',
            timestamp: new Date().toISOString()
        }
    };
}
async function handleReadFile(args) {
    const { path: filePath, start_offset = 0, max_size, line_start, line_count, encoding = 'utf-8' } = args;
    const safePath_resolved = safePath(filePath);
    const stats = await fs.stat(safePath_resolved);
    if (!stats.isFile()) {
        throw new Error('Path is not a file');
    }
    const maxReadSize = max_size ? Math.min(max_size, CLAUDE_MAX_CHUNK_SIZE) : CLAUDE_MAX_CHUNK_SIZE;
    // 라인 모드 - Python 방식으로 스트리밍 읽기
    if (line_start !== undefined) {
        const linesToRead = line_count ? Math.min(line_count, CLAUDE_MAX_LINES) : CLAUDE_MAX_LINES;
        const lines = [];
        // 큰 파일은 스트리밍으로 처리
        if (stats.size > 10 * 1024 * 1024) { // 10MB 이상
            const fileHandle = await fs.open(safePath_resolved, 'r');
            const stream = fileHandle.createReadStream({ encoding: encoding });
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
        }
        else {
            // 작은 파일은 기존 방식 (하지만 전체 라인 수는 세지 않음)
            const fileContent = await fs.readFile(safePath_resolved, encoding);
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
    const content = buffer.subarray(0, bytesRead).toString(encoding);
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
async function handleWriteFile(args) {
    const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false, force_remove_emojis = false } = args;
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
    // 백업 생성 (설정에 따라)
    let backupPath = null;
    if (CREATE_BACKUP_FILES && !append) {
        try {
            await fs.access(resolvedPath);
            backupPath = `${resolvedPath}.backup.${Date.now()}`;
            await fs.copyFile(resolvedPath, backupPath);
        }
        catch {
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
    }
    else if (emojiDetection.hasEmojis && guideline.shouldAvoidEmojis) {
        // 권장사항 위반시 경고만 제공 (강제 제거 안함)
        emojiAction = 'warning_provided';
    }
    if (append) {
        await fs.appendFile(resolvedPath, finalContent, encoding);
    }
    else {
        await fs.writeFile(resolvedPath, finalContent, encoding);
    }
    const stats = await fs.stat(resolvedPath);
    const result = {
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
async function handleLargeWriteFile(args) {
    const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false, chunk_size = 64 * 1024, // 64KB 청크
    backup = true, retry_attempts = 3, verify_write = true, force_remove_emojis = false } = args;
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
        }
        else if (emojiDetection.hasEmojis && guideline.shouldAvoidEmojis) {
            emojiAction = 'warning_provided';
        }
        // 1. 디렉토리 생성
        if (create_dirs) {
            const dir = path.dirname(resolvedPath);
            await fs.mkdir(dir, { recursive: true });
        }
        // 2. 디스크 공간 확인
        const contentSize = Buffer.byteLength(finalContent, encoding);
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
            }
            catch {
                // 원본 파일이 없으면 무시
            }
        }
        // 4. 스트리밍 방식으로 대용량 파일 작성
        const result = await writeFileWithRetry(append ? resolvedPath : tempPath, finalContent, encoding, chunk_size, retry_attempts, append);
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
            }
            else {
                // append 모드인 경우 최소한 내용 크기만큼은 증가해야 함
                const expectedMinSize = originalSize + contentSize;
                if (finalStats.size < expectedMinSize) {
                    throw new Error(`File size verification failed. Expected at least: ${expectedMinSize}, Actual: ${finalStats.size}`);
                }
            }
        }
        const finalStats = await fs.stat(resolvedPath);
        const response = {
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
    }
    catch (error) {
        // 에러 복구
        try {
            // 임시 파일 정리
            await fs.unlink(tempPath).catch(() => { });
            // 백업에서 복구 (실패한 경우)
            if (!append && backup && CREATE_BACKUP_FILES) {
                try {
                    await fs.copyFile(backupPath, resolvedPath);
                }
                catch {
                    // 복구도 실패
                }
            }
        }
        catch {
            // 정리 실패는 무시
        }
        throw error;
    }
}
async function handleListDirectory(args) {
    const { path: dirPath, page = 1, page_size, pattern, show_hidden = false, sort_by = 'name', reverse = false } = args;
    const safePath_resolved = safePath(dirPath);
    const stats = await fs.stat(safePath_resolved);
    if (!stats.isDirectory()) {
        throw new Error('Path is not a directory');
    }
    const pageSize = page_size ? Math.min(page_size, CLAUDE_MAX_DIR_ITEMS) : 50;
    const entries = await fs.readdir(safePath_resolved, { withFileTypes: true });
    let filteredEntries = entries.filter(entry => {
        if (!show_hidden && entry.name.startsWith('.'))
            return false;
        if (shouldExcludePath(path.join(safePath_resolved, entry.name)))
            return false;
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
        }
        catch {
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
async function handleGetFileInfo(args) {
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
        info.extension = path.extname(safePath_resolved);
        info.mime_type = getMimeType(safePath_resolved);
        // 파일별 이모지 가이드라인 제거 (토큰 절약)
        if (stats.size > CLAUDE_MAX_CHUNK_SIZE) {
            info.claude_guide = {
                message: 'File is large, consider using chunked reading',
                recommended_chunk_size: CLAUDE_MAX_CHUNK_SIZE,
                total_chunks: Math.ceil(stats.size / CLAUDE_MAX_CHUNK_SIZE)
            };
        }
    }
    else if (stats.isDirectory()) {
        try {
            const entries = await fs.readdir(safePath_resolved);
            info.item_count = entries.length;
            if (entries.length > CLAUDE_MAX_DIR_ITEMS) {
                info.claude_guide = {
                    message: 'Directory has many items, consider using pagination',
                    recommended_page_size: CLAUDE_MAX_DIR_ITEMS,
                    total_pages: Math.ceil(entries.length / CLAUDE_MAX_DIR_ITEMS)
                };
            }
        }
        catch {
            info.item_count = 'Unable to count';
        }
    }
    return info;
}
async function handleCreateDirectory(args) {
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
async function handleSearchFiles(args) {
    const { path: searchPath, pattern, content_search = false, case_sensitive = false, max_results = 100 } = args;
    const safePath_resolved = safePath(searchPath);
    const maxResults = Math.min(max_results, 200);
    const results = [];
    const searchPattern = case_sensitive ? pattern : pattern.toLowerCase();
    async function searchDirectory(dirPath) {
        if (results.length >= maxResults)
            return;
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (results.length >= maxResults)
                    break;
                const fullPath = path.join(dirPath, entry.name);
                if (shouldExcludePath(fullPath))
                    continue;
                if (entry.isFile()) {
                    const searchName = case_sensitive ? entry.name : entry.name.toLowerCase();
                    let matched = false;
                    let matchType = '';
                    if (searchName.includes(searchPattern)) {
                        matched = true;
                        matchType = 'filename';
                    }
                    if (!matched && content_search) {
                        try {
                            const stats = await fs.stat(fullPath);
                            if (stats.size < 10 * 1024 * 1024) { // 10MB 제한
                                const content = await fs.readFile(fullPath, 'utf-8');
                                const searchContent = case_sensitive ? content : content.toLowerCase();
                                if (searchContent.includes(searchPattern)) {
                                    matched = true;
                                    matchType = 'content';
                                }
                            }
                        }
                        catch {
                            // 바이너리 파일 등 읽기 실패 무시
                        }
                    }
                    if (matched) {
                        const stats = await fs.stat(fullPath);
                        results.push({
                            path: fullPath,
                            name: entry.name,
                            match_type: matchType,
                            size: stats.size,
                            size_readable: formatSize(stats.size),
                            modified: stats.mtime.toISOString(),
                            extension: path.extname(fullPath)
                        });
                    }
                }
                else if (entry.isDirectory()) {
                    await searchDirectory(fullPath);
                }
            }
        }
        catch {
            // 권한 없는 디렉토리 등 무시
        }
    }
    await searchDirectory(safePath_resolved);
    return {
        results: results,
        total_found: results.length,
        search_pattern: pattern,
        search_path: safePath_resolved,
        content_search: content_search,
        case_sensitive: case_sensitive,
        max_results_reached: results.length >= maxResults,
        timestamp: new Date().toISOString()
    };
}
async function handleGetDirectoryTree(args) {
    const { path: rootPath, max_depth = 3, show_hidden = false, include_files = true } = args;
    const safePath_resolved = safePath(rootPath);
    async function buildTree(currentPath, currentDepth) {
        if (currentDepth > max_depth)
            return null;
        try {
            const stats = await fs.stat(currentPath);
            const name = path.basename(currentPath);
            if (!show_hidden && name.startsWith('.'))
                return null;
            if (shouldExcludePath(currentPath))
                return null;
            const node = {
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
                            if (childNode)
                                node.children.push(childNode);
                        }
                        else if (include_files) {
                            const childNode = await buildTree(childPath, currentDepth + 1);
                            if (childNode)
                                node.children.push(childNode);
                        }
                    }
                }
                catch {
                    // 권한 없는 디렉토리
                    node.error = 'Access denied';
                }
            }
            return node;
        }
        catch {
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
async function handleGetDiskUsage(args) {
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
    }
    catch {
        // Fallback for systems without df command
    }
    return {
        error: 'Unable to get disk usage information',
        path: targetPath,
        timestamp: new Date().toISOString()
    };
}
async function handleFindLargeFiles(args) {
    const { path: searchPath, min_size = '100MB', max_results = 50 } = args;
    const safePath_resolved = safePath(searchPath);
    const maxResults = Math.min(max_results, 100);
    // 크기 파싱 (예: 100MB -> bytes)
    const parseSize = (sizeStr) => {
        const match = sizeStr.match(/^(\d+(\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
        if (!match)
            return 100 * 1024 * 1024; // 기본값 100MB
        const value = parseFloat(match[1]);
        const unit = (match[3] || 'B').toUpperCase();
        const units = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024,
            'TB': 1024 * 1024 * 1024 * 1024
        };
        return value * (units[unit] || 1);
    };
    const minSizeBytes = parseSize(min_size);
    const results = [];
    async function findLargeFilesRecursive(dirPath) {
        if (results.length >= maxResults)
            return;
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (results.length >= maxResults)
                    break;
                const fullPath = path.join(dirPath, entry.name);
                if (shouldExcludePath(fullPath))
                    continue;
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
                    }
                    catch {
                        // 파일 접근 실패 무시
                    }
                }
                else if (entry.isDirectory()) {
                    await findLargeFilesRecursive(fullPath);
                }
            }
        }
        catch {
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
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
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
    console.error('Fast Filesystem MCP Server v2.7.0 running on stdio (with configurable backup feature)');
}
// RegExp escape 함수
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// 편집 관련 핸들러 함수들
async function handleEditFile(args) {
    const { path: filePath, edits = [], old_text, new_text, backup = true, create_if_missing = false } = args;
    const safePath_resolved = safePath(filePath);
    // 파일 존재 확인
    let fileExists = true;
    try {
        await fs.access(safePath_resolved);
    }
    catch {
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
    const changes = [];
    let totalChanges = 0;
    const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
    // 백업 생성 (설정에 따라)
    if (fileExists && backup && CREATE_BACKUP_FILES) {
        await fs.copyFile(safePath_resolved, backupPath);
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
            }
            else {
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
    }
    catch (error) {
        // 에러 시 백업에서 복구 (단, 파일 쓰기 관련 에러만)
        if (fileExists && backup && CREATE_BACKUP_FILES && backupPath && error instanceof Error &&
            (error.message.includes('EACCES') || error.message.includes('EPERM') ||
                error.message.includes('ENOENT') || error.message.includes('write'))) {
            try {
                await fs.copyFile(backupPath, safePath_resolved);
            }
            catch {
                // 복구 실패는 무시
            }
        }
        throw error;
    }
}
// 정교한 블록 편집 핸들러 (desktop-commander 방식)
async function handleEditBlock(args) {
    const { path: filePath, old_text, new_text, expected_replacements = 1, backup = true } = args;
    const safePath_resolved = safePath(filePath);
    // 파일 존재 확인
    let fileExists = true;
    try {
        await fs.access(safePath_resolved);
    }
    catch {
        fileExists = false;
        throw new Error(`File does not exist: ${safePath_resolved}`);
    }
    const originalContent = await fs.readFile(safePath_resolved, 'utf-8');
    const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
    // 백업 생성 (설정에 따라)
    if (backup && CREATE_BACKUP_FILES) {
        await fs.copyFile(safePath_resolved, backupPath);
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
    }
    catch (error) {
        // 에러 시 백업에서 복구
        if (backup && CREATE_BACKUP_FILES && backupPath) {
            try {
                await fs.copyFile(backupPath, safePath_resolved);
            }
            catch {
                // 복구 실패는 무시
            }
        }
        throw error;
    }
}
async function handleEditMultipleBlocks(args) {
    const { path: filePath, edits, backup = true } = args;
    const safePath_resolved = safePath(filePath);
    const content = await fs.readFile(safePath_resolved, 'utf-8');
    const lines = content.split('\n');
    let modifiedLines = [...lines];
    const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
    let totalChanges = 0;
    // 백업 생성 (설정에 따라)
    if (backup && CREATE_BACKUP_FILES) {
        await fs.copyFile(safePath_resolved, backupPath);
    }
    try {
        // 편집을 라인 번호 역순으로 정렬 (뒤에서부터 편집하여 인덱스 변화 방지)
        const sortedEdits = [...edits].sort((a, b) => {
            const lineA = a.line_number || 0;
            const lineB = b.line_number || 0;
            return lineB - lineA;
        });
        for (const edit of sortedEdits) {
            const { old_text, new_text, line_number, mode = 'replace' } = edit;
            let changesCount = 0;
            switch (mode) {
                case 'replace':
                    if (old_text && new_text !== undefined) {
                        for (let i = 0; i < modifiedLines.length; i++) {
                            if (modifiedLines[i].includes(old_text)) {
                                modifiedLines[i] = modifiedLines[i].replace(old_text, new_text);
                                changesCount++;
                            }
                        }
                    }
                    else if (line_number && new_text !== undefined) {
                        const idx = line_number - 1;
                        if (idx >= 0 && idx < modifiedLines.length) {
                            modifiedLines[idx] = new_text;
                            changesCount++;
                        }
                    }
                    break;
                case 'insert_before':
                    if (line_number && new_text !== undefined) {
                        const idx = line_number - 1;
                        if (idx >= 0) {
                            modifiedLines.splice(idx, 0, new_text);
                            changesCount++;
                        }
                    }
                    break;
                case 'insert_after':
                    if (line_number && new_text !== undefined) {
                        const idx = line_number;
                        if (idx >= 0) {
                            modifiedLines.splice(idx, 0, new_text);
                            changesCount++;
                        }
                    }
                    break;
                case 'delete_line':
                    if (line_number) {
                        const idx = line_number - 1;
                        if (idx >= 0 && idx < modifiedLines.length) {
                            modifiedLines.splice(idx, 1);
                            changesCount++;
                        }
                    }
                    break;
            }
            totalChanges += changesCount;
        }
        // 수정된 내용 저장
        const newContent = modifiedLines.join('\n');
        await fs.writeFile(safePath_resolved, newContent, 'utf-8');
        const stats = await fs.stat(safePath_resolved);
        return {
            message: `Multiple blocks edited successfully`,
            path: safePath_resolved,
            total_edits: edits.length,
            total_changes: totalChanges,
            original_lines: lines.length,
            new_lines: modifiedLines.length,
            backup_created: backupPath,
            backup_enabled: CREATE_BACKUP_FILES,
            size: stats.size,
            size_readable: formatSize(stats.size),
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        // 에러 시 백업에서 복구
        if (backup && CREATE_BACKUP_FILES && backupPath) {
            try {
                await fs.copyFile(backupPath, safePath_resolved);
            }
            catch {
                // 복구 실패
            }
        }
        throw error;
    }
}
async function handleExtractLines(args) {
    const { path: filePath, line_numbers, start_line, end_line, pattern, context_lines = 0 } = args;
    const safePath_resolved = safePath(filePath);
    const content = await fs.readFile(safePath_resolved, 'utf-8');
    const lines = content.split('\n');
    let extractedLines = [];
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
    }
    else if (start_line && end_line) {
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
    }
    else if (pattern) {
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
async function handleSearchAndReplace(args) {
    const { path: filePath, search_pattern, replace_text, use_regex = false, case_sensitive = true, max_replacements = -1, backup = true } = args;
    const safePath_resolved = safePath(filePath);
    const content = await fs.readFile(safePath_resolved, 'utf-8');
    const backupPath = backup && CREATE_BACKUP_FILES ? `${safePath_resolved}.backup.${Date.now()}` : null;
    // 백업 생성 (설정에 따라)
    if (backup && CREATE_BACKUP_FILES) {
        await fs.copyFile(safePath_resolved, backupPath);
    }
    try {
        let newContent;
        let replacementCount = 0;
        if (use_regex) {
            const flags = case_sensitive ? 'g' : 'gi';
            const regex = new RegExp(search_pattern, flags);
            if (max_replacements > 0) {
                // 제한된 횟수만 치환
                let count = 0;
                newContent = content.replace(regex, (match) => {
                    if (count < max_replacements) {
                        count++;
                        replacementCount++;
                        return replace_text;
                    }
                    return match;
                });
            }
            else {
                // 모든 매칭 치환
                newContent = content.replace(regex, () => {
                    replacementCount++;
                    return replace_text;
                });
            }
        }
        else {
            // 단순 문자열 치환
            const searchStr = case_sensitive ? search_pattern : search_pattern.toLowerCase();
            const contentToSearch = case_sensitive ? content : content.toLowerCase();
            newContent = content;
            let lastIndex = 0;
            let currentIndex = contentToSearch.indexOf(searchStr, lastIndex);
            while (currentIndex !== -1 && (max_replacements === -1 || replacementCount < max_replacements)) {
                newContent = newContent.substring(0, currentIndex) +
                    replace_text +
                    newContent.substring(currentIndex + search_pattern.length);
                replacementCount++;
                lastIndex = currentIndex + replace_text.length;
                // 다음 매칭 위치 찾기
                const adjustedContent = case_sensitive ? newContent : newContent.toLowerCase();
                currentIndex = adjustedContent.indexOf(searchStr, lastIndex);
            }
        }
        await fs.writeFile(safePath_resolved, newContent, 'utf-8');
        const stats = await fs.stat(safePath_resolved);
        return {
            message: `Search and replace completed`,
            path: safePath_resolved,
            search_pattern: search_pattern,
            replace_text: replace_text,
            replacements_made: replacementCount,
            use_regex: use_regex,
            case_sensitive: case_sensitive,
            backup_created: backupPath,
            backup_enabled: CREATE_BACKUP_FILES,
            size: stats.size,
            size_readable: formatSize(stats.size),
            timestamp: new Date().toISOString()
        };
    }
    catch (error) {
        // 에러 시 백업에서 복구
        if (backup && CREATE_BACKUP_FILES && backupPath) {
            try {
                await fs.copyFile(backupPath, safePath_resolved);
            }
            catch {
                // 복구 실패
            }
        }
        throw error;
    }
}
main().catch((error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map