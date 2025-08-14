import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { promises as fs } from "fs";
import path from "path";
import { ReadStream } from "fs";
import { createReadStream } from "fs";

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
    // 클라이언트에서 전달한 경로들 사용
    CLIENT_ALLOWED_DIRECTORIES = clientPaths.map(dir => dir.trim()).filter(dir => dir.length > 0);
    return CLIENT_ALLOWED_DIRECTORIES;
  }
  
  // 환경변수 또는 기본값 사용
  const envPaths = process.env.ALLOWED_DIRECTORIES 
    ? process.env.ALLOWED_DIRECTORIES.split(',').map(dir => dir.trim())
    : [process.env.HOME || '/tmp'];
    
  CLIENT_ALLOWED_DIRECTORIES = envPaths;
  return CLIENT_ALLOWED_DIRECTORIES;
}

// 허용된 디렉토리 목록 반환
function getAllowedDirectories(): string[] {
  return CLIENT_ALLOWED_DIRECTORIES.length > 0 
    ? CLIENT_ALLOWED_DIRECTORIES 
    : [process.env.HOME || '/tmp'];
}

// 제외 패턴 (보안 및 성능)
const DEFAULT_EXCLUDE_PATTERNS = [
  '.venv', 'venv', 'node_modules', '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.coverage',
  'dist', 'build', 'target', 'bin', 'obj', '.vs', '.vscode',
  '*.pyc', '*.pyo', '*.pyd', '.DS_Store', 'Thumbs.db'
];

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

function truncateContent(content: string, maxSize: number = CLAUDE_MAX_RESPONSE_SIZE) {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxSize) {
    return { content, truncated: false };
  }
  
  // UTF-8 고려하여 안전하게 자르기
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

// MCP 핸들러 생성
const handler = createMcpHandler((server, request) => {
  
  // URL에서 클라이언트 경로 추출 (server-fetch의 추가 args가 쿼리로 전달됨)
  let clientPaths: string[] = [];
  
  try {
    if (request) {
      const url = new URL(request.url);
      
      // server-fetch의 추가 args들이 path0, path1, path2... 쿼리 파라미터로 전달됨
      let pathIndex = 0;
      while (true) {
        const pathParam = url.searchParams.get(`path${pathIndex}`);
        if (!pathParam) break;
        
        const decodedPath = decodeURIComponent(pathParam.trim());
        if (decodedPath && decodedPath !== '') {
          clientPaths.push(decodedPath);
        }
        pathIndex++;
      }
      
      // 또는 paths 파라미터로 쉼표 구분된 경로들
      const pathsParam = url.searchParams.get('paths');
      if (pathsParam && clientPaths.length === 0) {
        clientPaths = pathsParam.split(',').map(p => decodeURIComponent(p.trim()));
      }
    }
  } catch (error) {
    console.log('Failed to parse client paths from URL:', error);
  }
  
  // 클라이언트에서 전달받은 경로로 허용 디렉토리 초기화
  // 경로가 제공되지 않으면 전체 시스템 접근 허용 (보안상 기본 경로들만)
  if (clientPaths.length > 0) {
    initializeAllowedDirectories(clientPaths);
    console.log('Using client-specified paths:', clientPaths);
  } else {
    // 기본 전체 접근 경로들 (안전한 기본값들)
    const defaultPaths = [
      process.env.HOME || '/home',
      '/tmp',
      '/Users', 
      '/home',
      process.cwd()
    ].filter(p => p); // undefined 제거
    
    initializeAllowedDirectories(defaultPaths);
    console.log('Using default full access paths:', defaultPaths);
  }
  
  console.log('Final allowed directories:', getAllowedDirectories());
  
  // 허용된 디렉토리 목록 조회
  server.tool(
    "list_allowed_directories",
    {},
    async () => ({
      content: [{ 
        type: "text", 
        text: JSON.stringify({
          allowed_directories: getAllowedDirectories(),
          current_working_directory: process.cwd(),
          claude_limits: {
            max_response_size_mb: CLAUDE_MAX_RESPONSE_SIZE / (1024**2),
            max_chunk_size_mb: CLAUDE_MAX_CHUNK_SIZE / (1024**2),
            max_lines_per_read: CLAUDE_MAX_LINES,
            max_dir_items: CLAUDE_MAX_DIR_ITEMS
          }
        }, null, 2)
      }]
    })
  );

  // 파일 읽기
  server.tool(
    "read_file",
    {
      path: z.string().describe("읽을 파일 경로"),
      start_offset: z.number().optional().describe("시작 바이트 위치"),
      max_size: z.number().optional().describe("읽을 최대 크기"),
      line_start: z.number().optional().describe("시작 라인 번호"),
      line_count: z.number().optional().describe("읽을 라인 수"),
      encoding: z.string().default("utf-8").describe("텍스트 인코딩")
    },
    async ({ path: filePath, start_offset = 0, max_size, line_start, line_count, encoding = "utf-8" }) => {
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
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                content: selectedLines,
                mode: "lines",
                start_line: line_start,
                lines_read: selectedLines.length,
                file_size: stats.size,
                encoding: encoding
              }, null, 2)
            }]
          };
        }
        
        // 바이트 모드
        const buffer = Buffer.alloc(maxReadSize);
        const fd = await fs.open(safePath_resolved, 'r');
        const { bytesRead } = await fd.read(buffer, 0, maxReadSize, start_offset);
        await fd.close();
        
        const content = buffer.subarray(0, bytesRead).toString(encoding as BufferEncoding);
        const result = truncateContent(content);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              content: result.content,
              mode: "bytes",
              start_offset: start_offset,
              bytes_read: bytesRead,
              file_size: stats.size,
              encoding: encoding,
              truncated: result.truncated,
              has_more: start_offset + bytesRead < stats.size
            }, null, 2)
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
              error_type: error instanceof Error ? error.constructor.name : "Error"
            })
          }]
        };
      }
    }
  );

  // 디렉토리 목록 조회
  server.tool(
    "list_directory",
    {
      path: z.string().describe("조회할 디렉토리 경로"),
      page: z.number().default(1).describe("페이지 번호 (1부터 시작)"),
      page_size: z.number().optional().describe("페이지당 항목 수"),
      pattern: z.string().optional().describe("파일명 필터 패턴"),
      show_hidden: z.boolean().default(false).describe("숨김 파일 표시 여부"),
      sort_by: z.enum(["name", "size", "modified", "type"]).default("name").describe("정렬 기준"),
      reverse: z.boolean().default(false).describe("역순 정렬 여부")
    },
    async ({ path: dirPath, page = 1, page_size, pattern, show_hidden = false, sort_by = "name", reverse = false }) => {
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
            // 간단한 패턴 매칭 (contains)
            return entry.name.toLowerCase().includes(pattern.toLowerCase());
          }
          return true;
        });
        
        // 정렬
        filteredEntries.sort((a, b) => {
          let comparison = 0;
          
          switch (sort_by) {
            case "name":
              comparison = a.name.localeCompare(b.name);
              break;
            case "type":
              const aType = a.isDirectory() ? "directory" : "file";
              const bType = b.isDirectory() ? "directory" : "file";
              comparison = aType.localeCompare(bType);
              break;
            default:
              comparison = a.name.localeCompare(b.name);
          }
          
          return reverse ? -comparison : comparison;
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
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              path: safePath_resolved,
              items: items,
              page: page,
              page_size: pageSize,
              total_count: filteredEntries.length,
              total_pages: Math.ceil(filteredEntries.length / pageSize),
              has_more: endIdx < filteredEntries.length,
              claude_optimized: true
            }, null, 2)
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
              error_type: error instanceof Error ? error.constructor.name : "Error"
            })
          }]
        };
      }
    }
  );

  // 파일 쓰기
  server.tool(
    "write_file",
    {
      path: z.string().describe("파일 경로"),
      content: z.string().describe("파일 내용"),
      encoding: z.string().default("utf-8").describe("텍스트 인코딩"),
      create_dirs: z.boolean().default(true).describe("디렉토리 자동 생성 여부"),
      append: z.boolean().default(false).describe("추가 모드 여부")
    },
    async ({ path: filePath, content, encoding = "utf-8", create_dirs = true, append = false }) => {
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
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: `File ${append ? 'appended' : 'written'} successfully`,
              path: resolvedPath,
              directory: path.dirname(resolvedPath),
              filename: path.basename(resolvedPath),
              size: stats.size,
              size_readable: formatSize(stats.size),
              encoding: encoding,
              mode: append ? "append" : "write"
            }, null, 2)
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
              error_type: error instanceof Error ? error.constructor.name : "Error"
            })
          }]
        };
      }
    }
  );

  // 파일 검색
  server.tool(
    "search_files",
    {
      path: z.string().describe("검색할 디렉토리 경로"),
      pattern: z.string().describe("검색 패턴"),
      content_search: z.boolean().default(false).describe("파일 내용도 검색할지 여부"),
      case_sensitive: z.boolean().default(false).describe("대소문자 구분 여부"),
      max_results: z.number().optional().describe("최대 결과 수"),
      file_extensions: z.string().optional().describe("파일 확장자 필터 (쉼표로 구분)")
    },
    async ({ path: searchPath, pattern, content_search = false, case_sensitive = false, max_results, file_extensions }) => {
      try {
        const safePath_resolved = safePath(searchPath);
        const maxResults = max_results ? Math.min(max_results, 100) : 100;
        
        const results: any[] = [];
        const extensions = file_extensions ? file_extensions.split(',').map(ext => ext.trim().toLowerCase()) : null;
        const searchPattern = case_sensitive ? pattern : pattern.toLowerCase();
        
        async function searchDirectory(dirPath: string) {
          if (results.length >= maxResults) return;
          
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
              if (results.length >= maxResults) break;
              
              const fullPath = path.join(dirPath, entry.name);
              
              if (entry.isFile()) {
                // 확장자 필터
                if (extensions) {
                  const ext = path.extname(entry.name).toLowerCase().slice(1);
                  if (!extensions.includes(ext)) continue;
                }
                
                const searchName = case_sensitive ? entry.name : entry.name.toLowerCase();
                let matched = false;
                let matchType = "";
                
                // 파일명 검색
                if (searchName.includes(searchPattern)) {
                  matched = true;
                  matchType = "filename";
                }
                
                // 내용 검색 (작은 파일만)
                if (!matched && content_search) {
                  try {
                    const stats = await fs.stat(fullPath);
                    if (stats.size < 1024 * 1024) { // 1MB 제한
                      const content = await fs.readFile(fullPath, 'utf-8');
                      const searchContent = case_sensitive ? content : content.toLowerCase();
                      if (searchContent.includes(searchPattern)) {
                        matched = true;
                        matchType = "content";
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
                    modified: stats.mtime.toISOString()
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
          content: [{
            type: "text",
            text: JSON.stringify({
              results: results,
              total_found: results.length,
              search_pattern: pattern,
              search_path: safePath_resolved,
              max_results_reached: results.length >= maxResults,
              claude_optimized: true
            }, null, 2)
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
              error_type: error instanceof Error ? error.constructor.name : "Error"
            })
          }]
        };
      }
    }
  );

  // 파일/디렉토리 정보 조회
  server.tool(
    "get_file_info",
    {
      path: z.string().describe("조회할 파일 또는 디렉토리 경로")
    },
    async ({ path: targetPath }) => {
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
        
        // 추가 정보
        if (stats.isFile()) {
          (info as any).extension = path.extname(safePath_resolved);
          
          // 대용량 파일 가이드
          if (stats.size > CLAUDE_MAX_CHUNK_SIZE) {
            (info as any).claude_guide = {
              message: "File is too large for single read",
              recommended_chunk_size_mb: CLAUDE_MAX_CHUNK_SIZE / (1024**2),
              total_chunks: Math.ceil(stats.size / CLAUDE_MAX_CHUNK_SIZE),
              example_read: `read_file('${targetPath}', { start_offset: 0, max_size: ${CLAUDE_MAX_CHUNK_SIZE} })`
            };
          }
        } else if (stats.isDirectory()) {
          try {
            const entries = await fs.readdir(safePath_resolved);
            (info as any).item_count = entries.length;
            
            if (entries.length > CLAUDE_MAX_DIR_ITEMS) {
              (info as any).claude_guide = {
                message: "Directory has too many items for single list",
                recommended_page_size: CLAUDE_MAX_DIR_ITEMS,
                total_pages: Math.ceil(entries.length / CLAUDE_MAX_DIR_ITEMS)
              };
            }
          } catch {
            (info as any).item_count = "Unable to count";
          }
        }
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(info, null, 2)
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
              error_type: error instanceof Error ? error.constructor.name : "Error"
            })
          }]
        };
      }
    }
  );

  // 디렉토리 생성
  server.tool(
    "create_directory",
    {
      path: z.string().describe("생성할 디렉토리 경로")
    },
    async ({ path: dirPath }) => {
      try {
        const safePath_resolved = safePath(dirPath);
        
        await fs.mkdir(safePath_resolved, { recursive: true });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              message: "Directory created successfully",
              path: safePath_resolved
            }, null, 2)
          }]
        };
        
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
              error_type: error instanceof Error ? error.constructor.name : "Error"
            })
          }]
        };
      }
    }
  );

});

export { handler as GET, handler as POST, handler as DELETE };
