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
// 기본 제외 패턴 (보안 및 성능)
const DEFAULT_EXCLUDE_PATTERNS = [
    '.venv', 'venv', 'node_modules', '.git', '.svn', '.hg',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.coverage',
    'dist', 'build', 'target', 'bin', 'obj', '.vs', '.vscode',
    '*.pyc', '*.pyo', '*.pyd', '.DS_Store', 'Thumbs.db'
];
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
            const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
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
    version: '2.3.0',
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
                        verify_write: { type: 'boolean', description: '작성 후 검증', default: true }
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
            version: '2.3.0',
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
    if (line_start !== undefined) {
        const linesToRead = line_count ? Math.min(line_count, CLAUDE_MAX_LINES) : CLAUDE_MAX_LINES;
        const fileContent = await fs.readFile(safePath_resolved, encoding);
        const lines = fileContent.split('\n');
        const selectedLines = lines.slice(line_start, line_start + linesToRead);
        return {
            content: selectedLines.join('\n'),
            mode: 'lines',
            start_line: line_start,
            lines_read: selectedLines.length,
            total_lines: lines.length,
            file_size: stats.size,
            file_size_readable: formatSize(stats.size),
            encoding: encoding,
            path: safePath_resolved
        };
    }
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
    const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false } = args;
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
    if (append) {
        await fs.appendFile(resolvedPath, content, encoding);
    }
    else {
        await fs.writeFile(resolvedPath, content, encoding);
    }
    const stats = await fs.stat(resolvedPath);
    return {
        message: `File ${append ? 'appended' : 'written'} successfully`,
        path: resolvedPath,
        size: stats.size,
        size_readable: formatSize(stats.size),
        encoding: encoding,
        mode: append ? 'append' : 'write',
        timestamp: new Date().toISOString()
    };
}
// 새로운 대용량 파일 작성 핸들러
async function handleLargeWriteFile(args) {
    const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false, chunk_size = 64 * 1024, // 64KB 청크
    backup = true, retry_attempts = 3, verify_write = true } = args;
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
        // 1. 디렉토리 생성
        if (create_dirs) {
            const dir = path.dirname(resolvedPath);
            await fs.mkdir(dir, { recursive: true });
        }
        // 2. 디스크 공간 확인
        const contentSize = Buffer.byteLength(content, encoding);
        await checkDiskSpace(path.dirname(resolvedPath), contentSize);
        // 3. 기존 파일 백업 (덮어쓰기 모드이고 파일이 존재할 경우)
        let originalExists = false;
        let originalSize = 0;
        if (!append && backup) {
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
        const result = await writeFileWithRetry(append ? resolvedPath : tempPath, content, encoding, chunk_size, retry_attempts, append);
        // 5. 원자적 이동 (append가 아닌 경우)
        if (!append) {
            await fs.rename(tempPath, resolvedPath);
        }
        // 6. 작성 검증 (옵션)
        if (verify_write) {
            const finalStats = await fs.stat(resolvedPath);
            const expectedSize = contentSize + (append ? originalSize : 0);
            if (finalStats.size !== expectedSize) {
                throw new Error(`File size verification failed. Expected: ${expectedSize}, Actual: ${finalStats.size}`);
            }
        }
        const finalStats = await fs.stat(resolvedPath);
        return {
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
            backup_created: originalExists && backup ? backupPath : null,
            timestamp: new Date().toISOString(),
            performance: {
                total_time_ms: result.totalTime,
                write_speed_mbps: (contentSize / (1024 * 1024)) / (result.totalTime / 1000)
            }
        };
    }
    catch (error) {
        // 에러 복구
        try {
            // 임시 파일 정리
            await fs.unlink(tempPath).catch(() => { });
            // 백업에서 복구 (실패한 경우)
            if (!append && backup) {
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
    console.error('Fast Filesystem MCP Server running on stdio');
}
main().catch((error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map