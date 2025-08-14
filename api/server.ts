import { createMCPServer } from '@vercel/mcp-adapter';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

// Claude 최적화 설정
const CLAUDE_MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const CLAUDE_MAX_CHUNK_SIZE = 2 * 1024 * 1024;    // 2MB
const CLAUDE_MAX_LINES = 2000;                     // 최대 2000줄
const CLAUDE_MAX_DIR_ITEMS = 1000;                 // 디렉토리 항목 최대 1000개

// 클라이언트에서 전달받은 허용 디렉토리를 저장할 변수
let CLIENT_ALLOWED_DIRECTORIES: string[] = [];

// 허용된 디렉토리 설정 함수
function initializeAllowedDirectories(clientPaths?: string[]): string[] {
  if (clientPaths && clientPaths.length > 0) {
    CLIENT_ALLOWED_DIRECTORIES = clientPaths.map(dir => dir.trim()).filter(dir => dir.length > 0);
    return CLIENT_ALLOWED_DIRECTORIES;
  }
  
  // 기본 전체 접근 경로들 (안전한 기본값들)
  const defaultPaths = [
    process.env.HOME || '/home',
    '/tmp',
    '/Users', 
    '/home',
    process.cwd()
  ].filter(p => p);
  
  CLIENT_ALLOWED_DIRECTORIES = defaultPaths;
  return CLIENT_ALLOWED_DIRECTORIES;
}

// 허용된 디렉토리 목록 반환
function getAllowedDirectories(): string[] {
  return CLIENT_ALLOWED_DIRECTORIES.length > 0 
    ? CLIENT_ALLOWED_DIRECTORIES 
    : [process.env.HOME || '/tmp'];
}

// 유틸리티 함수들
function isPathAllowed(targetPath: string): boolean {
  const absolutePath = path.resolve(targetPath);
  const allowedDirs = getAllowedDirectories();
  return allowedDirs.some(allowedDir => 
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

// MCP 서버 생성
const server = createMCPServer({
  name: "fast-filesystem",
  version: "1.0.0",
});

// 초기화 (전역으로 한 번만 실행)
initializeAllowedDirectories();

// 허용된 디렉토리 목록 조회
server.tool("list_allowed_directories", {
  description: "허용된 디렉토리 목록을 조회합니다",
  parameters: z.object({})
}, async () => {
  return JSON.stringify({
    allowed_directories: getAllowedDirectories(),
    current_working_directory: process.cwd(),
    claude_limits: {
      max_response_size_mb: CLAUDE_MAX_RESPONSE_SIZE / (1024**2),
      max_chunk_size_mb: CLAUDE_MAX_CHUNK_SIZE / (1024**2),
      max_lines_per_read: CLAUDE_MAX_LINES,
      max_dir_items: CLAUDE_MAX_DIR_ITEMS
    }
  }, null, 2);
});

// 파일 읽기
server.tool("read_file", {
  description: "파일을 읽습니다",
  parameters: z.object({
    path: z.string().describe("읽을 파일 경로"),
    start_offset: z.number().optional().describe("시작 바이트 위치"),
    max_size: z.number().optional().describe("읽을 최대 크기"),
    line_start: z.number().optional().describe("시작 라인 번호"),
    line_count: z.number().optional().describe("읽을 라인 수"),
    encoding: z.string().default("utf-8").describe("텍스트 인코딩")
  })
}, async ({ path: filePath, start_offset = 0, max_size, line_start, line_count, encoding = "utf-8" }) => {
  try {
    const safePath_resolved = safePath(filePath);
    const stats = await fs.stat(safePath_resolved);
    
    if (!stats.isFile()) {
      throw new Error("Path is not a file");
    }
    
    // Claude 최적화: 자동 크기 제한
    const maxReadSize = max_size ? Math.min(max_size, CLAUDE_MAX_CHUNK_SIZE) : CLAUDE_MAX_CHUNK_SIZE;
    
    // 라인 모드
    if (line_start !== undefined) {
      const linesToRead = line_count ? Math.min(line_count, CLAUDE_MAX_LINES) : CLAUDE_MAX_LINES;
      const fileContent = await fs.readFile(safePath_resolved, encoding as BufferEncoding);
      const lines = fileContent.split('\n');
      const selectedLines = lines.slice(line_start, line_start + linesToRead);
      
      return JSON.stringify({
        content: selectedLines,
        mode: "lines",
        start_line: line_start,
        lines_read: selectedLines.length,
        file_size: stats.size,
        encoding: encoding
      }, null, 2);
    }
    
    // 바이트 모드
    const buffer = Buffer.alloc(maxReadSize);
    const fd = await fs.open(safePath_resolved, 'r');
    const { bytesRead } = await fd.read(buffer, 0, maxReadSize, start_offset);
    await fd.close();
    
    const content = buffer.subarray(0, bytesRead).toString(encoding as BufferEncoding);
    
    return JSON.stringify({
      content: content,
      mode: "bytes",
      start_offset: start_offset,
      bytes_read: bytesRead,
      file_size: stats.size,
      encoding: encoding,
      has_more: start_offset + bytesRead < stats.size
    }, null, 2);
    
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      error_type: error instanceof Error ? error.constructor.name : "Error"
    });
  }
});

// 디렉토리 목록 조회
server.tool("list_directory", {
  description: "디렉토리 목록을 조회합니다",
  parameters: z.object({
    path: z.string().describe("조회할 디렉토리 경로"),
    page: z.number().default(1).describe("페이지 번호 (1부터 시작)"),
    page_size: z.number().optional().describe("페이지당 항목 수"),
    pattern: z.string().optional().describe("파일명 필터 패턴"),
    show_hidden: z.boolean().default(false).describe("숨김 파일 표시 여부")
  })
}, async ({ path: dirPath, page = 1, page_size, pattern, show_hidden = false }) => {
  try {
    const safePath_resolved = safePath(dirPath);
    const stats = await fs.stat(safePath_resolved);
    
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }
    
    // Claude 최적화: 페이지 크기 자동 제한
    const pageSize = page_size ? Math.min(page_size, 100) : 50;
    
    const entries = await fs.readdir(safePath_resolved, { withFileTypes: true });
    
    // 필터링
    let filteredEntries = entries.filter(entry => {
      if (!show_hidden && entry.name.startsWith('.')) return false;
      if (pattern) {
        return entry.name.toLowerCase().includes(pattern.toLowerCase());
      }
      return true;
    });
    
    // 페이징
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageEntries = filteredEntries.slice(startIdx, endIdx);
    
    // 항목 정보 수집
    const items = await Promise.all(pageEntries.map(async (entry) => {
      try {
        const fullPath = path.join(safePath_resolved, entry.name);
        const itemStats = await fs.stat(fullPath);
        
        return {
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          size: entry.isFile() ? itemStats.size : null,
          size_readable: entry.isFile() ? formatSize(itemStats.size) : null,
          modified: itemStats.mtime.toISOString()
        };
      } catch {
        return {
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          size: null,
          size_readable: null,
          modified: null
        };
      }
    }));
    
    return JSON.stringify({
      path: safePath_resolved,
      items: items,
      page: page,
      page_size: pageSize,
      total_count: filteredEntries.length,
      total_pages: Math.ceil(filteredEntries.length / pageSize),
      has_more: endIdx < filteredEntries.length
    }, null, 2);
    
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      error_type: error instanceof Error ? error.constructor.name : "Error"
    });
  }
});

// 파일 쓰기
server.tool("write_file", {
  description: "파일을 씁니다",
  parameters: z.object({
    path: z.string().describe("파일 경로"),
    content: z.string().describe("파일 내용"),
    encoding: z.string().default("utf-8").describe("텍스트 인코딩"),
    create_dirs: z.boolean().default(true).describe("디렉토리 자동 생성 여부"),
    append: z.boolean().default(false).describe("추가 모드 여부")
  })
}, async ({ path: filePath, content, encoding = "utf-8", create_dirs = true, append = false }) => {
  try {
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
    
    // 디렉토리 생성
    if (create_dirs) {
      const dir = path.dirname(resolvedPath);
      await fs.mkdir(dir, { recursive: true });
    }
    
    // 파일 쓰기
    if (append) {
      await fs.appendFile(resolvedPath, content, encoding as BufferEncoding);
    } else {
      await fs.writeFile(resolvedPath, content, encoding as BufferEncoding);
    }
    
    const stats = await fs.stat(resolvedPath);
    
    return JSON.stringify({
      message: `File ${append ? 'appended' : 'written'} successfully`,
      path: resolvedPath,
      size: stats.size,
      size_readable: formatSize(stats.size),
      encoding: encoding,
      mode: append ? "append" : "write"
    }, null, 2);
    
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      error_type: error instanceof Error ? error.constructor.name : "Error"
    });
  }
});

// 파일/디렉토리 정보 조회
server.tool("get_file_info", {
  description: "파일 또는 디렉토리 정보를 조회합니다",
  parameters: z.object({
    path: z.string().describe("조회할 파일 또는 디렉토리 경로")
  })
}, async ({ path: targetPath }) => {
  try {
    const safePath_resolved = safePath(targetPath);
    const stats = await fs.stat(safePath_resolved);
    
    const info = {
      path: safePath_resolved,
      name: path.basename(safePath_resolved),
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.size,
      size_readable: formatSize(stats.size),
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      accessed: stats.atime.toISOString()
    };
    
    return JSON.stringify(info, null, 2);
    
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      error_type: error instanceof Error ? error.constructor.name : "Error"
    });
  }
});

// 디렉토리 생성
server.tool("create_directory", {
  description: "디렉토리를 생성합니다",
  parameters: z.object({
    path: z.string().describe("생성할 디렉토리 경로")
  })
}, async ({ path: dirPath }) => {
  try {
    const safePath_resolved = safePath(dirPath);
    
    await fs.mkdir(safePath_resolved, { recursive: true });
    
    return JSON.stringify({
      message: "Directory created successfully",
      path: safePath_resolved
    }, null, 2);
    
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
      error_type: error instanceof Error ? error.constructor.name : "Error"
    });
  }
});

export default server.handler();
