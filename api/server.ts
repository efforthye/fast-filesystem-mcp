import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

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
      // 간단한 와일드카드 매칭
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

// MCP 툴 목록 정의
const MCP_TOOLS = [
  {
    name: 'list_allowed_directories',
    description: '허용된 디렉토리 목록을 조회합니다',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'read_file',
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
    name: 'write_file',
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
    name: 'list_directory',
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
    name: 'get_file_info',
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
    name: 'create_directory',
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
    name: 'copy_file',
    description: '파일/디렉토리를 복사합니다',
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
    name: 'move_file',
    description: '파일/디렉토리를 이동하거나 이름을 변경합니다',
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
    name: 'delete_file',
    description: '파일/디렉토리를 삭제합니다',
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
    name: 'search_files',
    description: '파일을 검색합니다 (이름/내용)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '검색할 디렉토리' },
        pattern: { type: 'string', description: '검색 패턴' },
        content_search: { type: 'boolean', description: '파일 내용 검색', default: false },
        case_sensitive: { type: 'boolean', description: '대소문자 구분', default: false },
        max_results: { type: 'number', description: '최대 결과 수', default: 100 },
        file_extensions: { type: 'string', description: '파일 확장자 필터 (쉼표 구분)' },
        exclude_patterns: { type: 'string', description: '제외 패턴 (쉼표 구분)' }
      },
      required: ['path', 'pattern']
    }
  },
  {
    name: 'watch_directory',
    description: '디렉토리 변경사항을 모니터링합니다',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '모니터링할 디렉토리' },
        recursive: { type: 'boolean', description: '하위 디렉토리 포함', default: true }
      },
      required: ['path']
    }
  },
  {
    name: 'get_directory_tree',
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
    name: 'compress_files',
    description: '파일/디렉토리를 압축합니다',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '압축할 파일/디렉토리 목록' },
        output_path: { type: 'string', description: '출력 압축 파일 경로' },
        format: { type: 'string', description: '압축 형식', enum: ['zip', 'tar', 'tar.gz'], default: 'zip' }
      },
      required: ['paths', 'output_path']
    }
  },
  {
    name: 'extract_archive',
    description: '압축 파일을 해제합니다',
    inputSchema: {
      type: 'object',
      properties: {
        archive_path: { type: 'string', description: '압축 파일 경로' },
        extract_to: { type: 'string', description: '해제할 디렉토리' },
        overwrite: { type: 'boolean', description: '덮어쓰기 허용', default: false }
      },
      required: ['archive_path', 'extract_to']
    }
  },
  {
    name: 'calculate_checksum',
    description: '파일의 체크섬을 계산합니다',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '파일 경로' },
        algorithm: { type: 'string', description: '해시 알고리즘', enum: ['md5', 'sha1', 'sha256'], default: 'sha256' }
      },
      required: ['path']
    }
  },
  {
    name: 'compare_files',
    description: '두 파일을 비교합니다',
    inputSchema: {
      type: 'object',
      properties: {
        path1: { type: 'string', description: '첫 번째 파일 경로' },
        path2: { type: 'string', description: '두 번째 파일 경로' },
        show_diff: { type: 'boolean', description: '차이점 표시', default: true }
      },
      required: ['path1', 'path2']
    }
  },
  {
    name: 'get_disk_usage',
    description: '디스크 사용량을 조회합니다',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '조회할 경로', default: '/' }
      }
    }
  },
  {
    name: 'find_large_files',
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
    name: 'cleanup_directory',
    description: '디렉토리를 정리합니다 (임시파일, 캐시 등)',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '정리할 디렉토리' },
        dry_run: { type: 'boolean', description: '실제 삭제 없이 미리보기', default: true },
        patterns: { type: 'string', description: '삭제할 패턴 (쉼표 구분)' }
      },
      required: ['path']
    }
  },
  {
    name: 'batch_rename',
    description: '여러 파일을 일괄 이름 변경합니다',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '대상 디렉토리' },
        pattern: { type: 'string', description: '파일 필터 패턴' },
        rename_pattern: { type: 'string', description: '새 이름 패턴' },
        dry_run: { type: 'boolean', description: '실제 변경 없이 미리보기', default: true }
      },
      required: ['path', 'pattern', 'rename_pattern']
    }
  }
];

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET') {
      res.status(200).json({
        status: 'online',
        name: 'fast-filesystem',
        version: '2.0.0',
        deployment: new Date().toISOString(),
        environment: 'production',
        config: {
          url: 'https://fast-filesystem-mcp.vercel.app/api/server',
          claude_desktop_config: {
            "mcpServers": {
              "fast-filesystem": {
                "command": "npx",
                "args": [
                  "@modelcontextprotocol/server-fetch",
                  "https://fast-filesystem-mcp.vercel.app/api/server"
                ]
              }
            }
          }
        },
        tools: MCP_TOOLS.map(tool => tool.name),
        total_tools: MCP_TOOLS.length,
        features: [
          'Advanced file operations',
          'Directory tree traversal',
          'File search and content search',
          'Compression and extraction',
          'File comparison and checksums',
          'Batch operations',
          'Disk usage monitoring',
          'Claude optimized responses'
        ],
        github: 'https://github.com/efforthye/fast-filesystem-mcp'
      });
    } else if (req.method === 'POST') {
      const { method, params, id } = req.body || {};
      
      if (method === 'tools/list') {
        res.status(200).json({
          jsonrpc: '2.0',
          id: id || 1,
          result: { tools: MCP_TOOLS }
        });
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        
        try {
          let result;
          
          switch (name) {
            case 'list_allowed_directories':
              result = await handleListAllowedDirectories();
              break;
            case 'read_file':
              result = await handleReadFile(args);
              break;
            case 'write_file':
              result = await handleWriteFile(args);
              break;
            case 'list_directory':
              result = await handleListDirectory(args);
              break;
            case 'get_file_info':
              result = await handleGetFileInfo(args);
              break;
            case 'create_directory':
              result = await handleCreateDirectory(args);
              break;
            case 'copy_file':
              result = await handleCopyFile(args);
              break;
            case 'move_file':
              result = await handleMoveFile(args);
              break;
            case 'delete_file':
              result = await handleDeleteFile(args);
              break;
            case 'search_files':
              result = await handleSearchFiles(args);
              break;
            case 'get_directory_tree':
              result = await handleGetDirectoryTree(args);
              break;
            case 'get_disk_usage':
              result = await handleGetDiskUsage(args);
              break;
            case 'find_large_files':
              result = await handleFindLargeFiles(args);
              break;
            case 'calculate_checksum':
              result = await handleCalculateChecksum(args);
              break;
            case 'compare_files':
              result = await handleCompareFiles(args);
              break;
            default:
              throw new Error(`Tool not implemented: ${name}`);
          }
          
          res.status(200).json({
            jsonrpc: '2.0',
            id: id || 1,
            result: {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            }
          });
        } catch (error) {
          res.status(500).json({
            jsonrpc: '2.0',
            id: id || 1,
            error: {
              code: -32603,
              message: 'Internal error',
              data: error instanceof Error ? error.message : 'Unknown error'
            }
          });
        }
      } else {
        res.status(200).json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            status: 'ok',
            name: 'fast-filesystem',
            version: '2.0.0',
            timestamp: new Date().toISOString()
          }
        });
      }
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({
        error: 'Method Not Allowed',
        allowed_methods: ['GET', 'POST']
      });
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

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
      version: '2.0.0',
      total_tools: MCP_TOOLS.length,
      timestamp: new Date().toISOString()
    }
  };
}

async function handleReadFile(args: any) {
  const { path: filePath, start_offset = 0, max_size, line_start, line_count, encoding = 'utf-8' } = args;
  
  const safePath_resolved = safePath(filePath);
  const stats = await fs.stat(safePath_resolved);
  
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }
  
  const maxReadSize = max_size ? Math.min(max_size, CLAUDE_MAX_CHUNK_SIZE) : CLAUDE_MAX_CHUNK_SIZE;
  
  if (line_start !== undefined) {
    const linesToRead = line_count ? Math.min(line_count, CLAUDE_MAX_LINES) : CLAUDE_MAX_LINES;
    const fileContent = await fs.readFile(safePath_resolved, encoding as BufferEncoding);
    const lines = fileContent.split('\n');
    const selectedLines = lines.slice(line_start, line_start + linesToRead);
    
    return {
      content: selectedLines,
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

async function handleWriteFile(args: any) {
  const { path: filePath, content, encoding = 'utf-8', create_dirs = true, append = false } = args;
  
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
  
  if (create_dirs) {
    const dir = path.dirname(resolvedPath);
    await fs.mkdir(dir, { recursive: true });
  }
  
  if (append) {
    await fs.appendFile(resolvedPath, content, encoding as BufferEncoding);
  } else {
    await fs.writeFile(resolvedPath, content, encoding as BufferEncoding);
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

async function handleCopyFile(args: any) {
  const { source, destination, overwrite = false } = args;
  
  const safeSrcPath = safePath(source);
  const safeDstPath = safePath(destination);
  
  if (!overwrite) {
    try {
      await fs.access(safeDstPath);
      throw new Error('Destination already exists and overwrite is false');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  
  await fs.copyFile(safeSrcPath, safeDstPath);
  const stats = await fs.stat(safeDstPath);
  
  return {
    message: 'File copied successfully',
    source: safeSrcPath,
    destination: safeDstPath,
    size: stats.size,
    size_readable: formatSize(stats.size),
    timestamp: new Date().toISOString()
  };
}

async function handleMoveFile(args: any) {
  const { source, destination } = args;
  
  const safeSrcPath = safePath(source);
  const safeDstPath = safePath(destination);
  
  await fs.rename(safeSrcPath, safeDstPath);
  const stats = await fs.stat(safeDstPath);
  
  return {
    message: 'File moved successfully',
    source: safeSrcPath,
    destination: safeDstPath,
    size: stats.size,
    size_readable: formatSize(stats.size),
    timestamp: new Date().toISOString()
  };
}

async function handleDeleteFile(args: any) {
  const { path: targetPath, recursive = false } = args;
  
  const safePath_resolved = safePath(targetPath);
  const stats = await fs.stat(safePath_resolved);
  
  if (stats.isDirectory()) {
    if (recursive) {
      await fs.rmdir(safePath_resolved, { recursive: true });
    } else {
      await fs.rmdir(safePath_resolved);
    }
  } else {
    await fs.unlink(safePath_resolved);
  }
  
  return {
    message: `${stats.isDirectory() ? 'Directory' : 'File'} deleted successfully`,
    path: safePath_resolved,
    type: stats.isDirectory() ? 'directory' : 'file',
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
    file_extensions, 
    exclude_patterns 
  } = args;
  
  const safePath_resolved = safePath(searchPath);
  const maxResults = Math.min(max_results, 200);
  const results: any[] = [];
  
  const extensions = file_extensions ? file_extensions.split(',').map((ext: string) => ext.trim().toLowerCase()) : null;
  const excludeList = exclude_patterns ? exclude_patterns.split(',').map((p: string) => p.trim()) : [];
  const searchPattern = case_sensitive ? pattern : pattern.toLowerCase();
  
  async function searchDirectory(dirPath: string) {
    if (results.length >= maxResults) return;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(dirPath, entry.name);
        
        if (shouldExcludePath(fullPath, excludeList)) continue;
        
        if (entry.isFile()) {
          if (extensions) {
            const ext = path.extname(entry.name).toLowerCase().slice(1);
            if (!extensions.includes(ext)) continue;
          }
          
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
            } catch {
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
        } else if (entry.isDirectory()) {
          await searchDirectory(fullPath);
        }
      }
    } catch {
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

async function handleCalculateChecksum(args: any) {
  const { path: filePath, algorithm = 'sha256' } = args;
  
  const safePath_resolved = safePath(filePath);
  const stats = await fs.stat(safePath_resolved);
  
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }
  
  try {
    const { stdout } = await execAsync(`${algorithm}sum "${safePath_resolved}"`);
    const checksum = stdout.split(' ')[0];
    
    return {
      path: safePath_resolved,
      algorithm: algorithm,
      checksum: checksum,
      file_size: stats.size,
      file_size_readable: formatSize(stats.size),
      timestamp: new Date().toISOString()
    };
  } catch {
    return {
      error: `Unable to calculate ${algorithm} checksum`,
      path: safePath_resolved,
      timestamp: new Date().toISOString()
    };
  }
}

async function handleCompareFiles(args: any) {
  const { path1, path2, show_diff = true } = args;
  
  const safePath1 = safePath(path1);
  const safePath2 = safePath(path2);
  
  const [stats1, stats2] = await Promise.all([
    fs.stat(safePath1),
    fs.stat(safePath2)
  ]);
  
  if (!stats1.isFile() || !stats2.isFile()) {
    throw new Error('Both paths must be files');
  }
  
  const result: any = {
    path1: safePath1,
    path2: safePath2,
    size1: stats1.size,
    size2: stats2.size,
    size1_readable: formatSize(stats1.size),
    size2_readable: formatSize(stats2.size),
    modified1: stats1.mtime.toISOString(),
    modified2: stats2.mtime.toISOString(),
    sizes_match: stats1.size === stats2.size,
    timestamp: new Date().toISOString()
  };
  
  if (show_diff && stats1.size < 1024 * 1024) { // 1MB 이하만 diff 표시
    try {
      const [content1, content2] = await Promise.all([
        fs.readFile(safePath1, 'utf-8'),
        fs.readFile(safePath2, 'utf-8')
      ]);
      
      result.content_identical = content1 === content2;
      
      if (!result.content_identical && content1.length < 10000 && content2.length < 10000) {
        // 간단한 diff 정보
        const lines1 = content1.split('\n');
        const lines2 = content2.split('\n');
        
        result.line_count1 = lines1.length;
        result.line_count2 = lines2.length;
        result.diff_available = true;
      }
    } catch {
      result.content_comparison = 'Unable to compare content (binary files?)';
    }
  }
  
  return result;
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
