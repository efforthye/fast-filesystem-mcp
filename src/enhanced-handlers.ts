import { promises as fs } from 'fs';
import path from 'path';
import { 
  ResponseSizeMonitor, 
  AutoChunkingHelper, 
  createChunkedResponse,
  globalTokenManager
} from './auto-chunking.js';
import {
  safePath,
  formatSize,
  shouldExcludePath,
  truncateContent,
  CLAUDE_MAX_CHUNK_SIZE,
  CLAUDE_MAX_LINES,
  CLAUDE_MAX_DIR_ITEMS
} from './utils.js';
import { logger } from './logger/index.js';

// handleReadFile 함수 (자동 청킹 지원)
export async function handleReadFileWithAutoChunking(args: any) {
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
  
  const monitor = new ResponseSizeMonitor(0.9); // 900KB 제한
  let actualLineStart = line_start || 0;
  let actualStartOffset = start_offset || 0;
  
  // Continuation token 처리
  if (continuation_token) {
    const token = globalTokenManager.getToken(continuation_token);
    if (token && token.type === 'read_file' && token.path === filePath) {
      actualLineStart = token.line_start || actualLineStart;
      actualStartOffset = token.byte_offset || actualStartOffset;
    }
  }
  
  const safePath_resolved = safePath(filePath);
  const stats = await fs.stat(safePath_resolved);
  
  if (!stats.isFile()) {
    throw new Error('Path is not a file');
  }
  
  const maxReadSize = max_size ? Math.min(max_size, CLAUDE_MAX_CHUNK_SIZE) : CLAUDE_MAX_CHUNK_SIZE;
  
  // 라인 모드 - 자동 청킹 지원
  if (line_start !== undefined || continuation_token) {
    const linesToRead = line_count ? Math.min(line_count, CLAUDE_MAX_LINES) : CLAUDE_MAX_LINES;
    
    // 파일 읽기 (전체 또는 스트리밍)
    let fileContent: string;
    if (stats.size > 10 * 1024 * 1024) { // 10MB 이상은 스트리밍
      // 스트리밍 읽기 로직 (기존 코드 유지)
      const fileHandle = await fs.open(safePath_resolved, 'r');
      const stream = fileHandle.createReadStream({ encoding: encoding as BufferEncoding });
      
      let currentLine = 0;
      let buffer = '';
      const lines: string[] = [];
      
      for await (const chunk of stream) {
        buffer += chunk;
        const chunkLines = buffer.split('\n');
        buffer = chunkLines.pop() || '';
        
        for (const line of chunkLines) {
          if (currentLine >= actualLineStart && lines.length < linesToRead) {
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
      
      if (buffer && currentLine >= actualLineStart && lines.length < linesToRead) {
        lines.push(buffer);
      }
      
      await fileHandle.close();
      fileContent = lines.join('\n');
    } else {
      // 작은 파일은 전체 읽기
      fileContent = await fs.readFile(safePath_resolved, encoding as BufferEncoding);
    }
    
    // 자동 청킹 적용
    if (auto_chunk) {
      const chunkResult = AutoChunkingHelper.chunkTextByLines(
        fileContent, 
        monitor, 
        actualLineStart
      );
      
      let continuationTokenId: string | undefined;
      if (chunkResult.hasMore) {
        continuationTokenId = globalTokenManager.generateToken('read_file', filePath, {
          ...args,
          line_start: chunkResult.nextStartLine,
          encoding
        });
        
        globalTokenManager.updateToken(continuationTokenId, {
          line_start: chunkResult.nextStartLine,
          path: filePath
        });
      }
      
      const response = createChunkedResponse({
        content: chunkResult.content,
        mode: 'lines',
        start_line: actualLineStart,
        lines_read: chunkResult.content.split('\n').length,
        file_size: stats.size,
        file_size_readable: formatSize(stats.size),
        encoding: encoding,
        path: safePath_resolved,
        auto_chunked: true
      }, chunkResult.hasMore, monitor, continuationTokenId);
      
      return response;
    } else {
      // 기존 방식 (청킹 없음)
      const allLines = fileContent.split('\n');
      const selectedLines = allLines.slice(actualLineStart, actualLineStart + linesToRead);
      
      return {
        content: selectedLines.join('\n'),
        mode: 'lines',
        start_line: actualLineStart,
        lines_read: selectedLines.length,
        file_size: stats.size,
        file_size_readable: formatSize(stats.size),
        encoding: encoding,
        has_more: actualLineStart + selectedLines.length < allLines.length,
        path: safePath_resolved,
        auto_chunked: false
      };
    }
  }
  
  // 바이트 모드 - 자동 청킹 지원
  const fileHandle = await fs.open(safePath_resolved, 'r');
  
  if (auto_chunk) {
    // 전체 파일 읽기 (메모리가 허용하는 경우)
    let content: string;
    if (stats.size < CLAUDE_MAX_CHUNK_SIZE) {
      const buffer = Buffer.alloc(Math.min(stats.size, maxReadSize));
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, actualStartOffset);
      content = buffer.subarray(0, bytesRead).toString(encoding as BufferEncoding);
      await fileHandle.close();
      
      // 청킹 적용
      const chunkResult = AutoChunkingHelper.chunkTextByLines(content, monitor, 0);
      
      let continuationTokenId: string | undefined;
      if (chunkResult.hasMore) {
        const nextOffset = actualStartOffset + Buffer.byteLength(chunkResult.content, encoding as BufferEncoding);
        continuationTokenId = globalTokenManager.generateToken('read_file', filePath, {
          ...args,
          start_offset: nextOffset,
          encoding
        });
        
        globalTokenManager.updateToken(continuationTokenId, {
          byte_offset: nextOffset,
          path: filePath
        });
      }
      
      const response = createChunkedResponse({
        content: chunkResult.content,
        mode: 'bytes',
        start_offset: actualStartOffset,
        bytes_read: Buffer.byteLength(chunkResult.content, encoding as BufferEncoding),
        file_size: stats.size,
        file_size_readable: formatSize(stats.size),
        encoding: encoding,
        path: safePath_resolved,
        auto_chunked: true
      }, chunkResult.hasMore, monitor, continuationTokenId);
      
      return response;
    }
  }
  
  // 기존 바이트 모드 (대용량 파일이거나 auto_chunk=false)
  const buffer = Buffer.alloc(maxReadSize);
  const { bytesRead } = await fileHandle.read(buffer, 0, maxReadSize, actualStartOffset);
  await fileHandle.close();
  
  const content = buffer.subarray(0, bytesRead).toString(encoding as BufferEncoding);
  const result = truncateContent(content);
  
  return {
    content: result.content,
    mode: 'bytes',
    start_offset: actualStartOffset,
    bytes_read: bytesRead,
    file_size: stats.size,
    file_size_readable: formatSize(stats.size),
    encoding: encoding,
    truncated: result.truncated,
    has_more: actualStartOffset + bytesRead < stats.size,
    path: safePath_resolved,
    auto_chunked: false
  };
}

// handleListDirectory 함수 (자동 청킹 지원)
export async function handleListDirectoryWithAutoChunking(args: any) {
  const { 
    path: dirPath, 
    page = 1, 
    page_size, 
    pattern, 
    show_hidden = false, 
    sort_by = 'name', 
    reverse = false,
    continuation_token,
    auto_chunk = true
  } = args;
  
  const monitor = new ResponseSizeMonitor(0.9); // 900KB 제한
  let actualPage = page;
  
  // Continuation token 처리
  if (continuation_token) {
    const token = globalTokenManager.getToken(continuation_token);
    if (token && token.type === 'list_directory' && token.path === dirPath) {
      actualPage = token.page || actualPage;
    }
  }
  
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
  
  const startIdx = (actualPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  
  // 자동 청킹 지원
  if (auto_chunk) {
    const allItems: any[] = [];
    let currentIdx = startIdx;
    
    // 항목들을 하나씩 처리하면서 응답 크기 모니터링
    while (currentIdx < Math.min(endIdx, filteredEntries.length)) {
      const entry = filteredEntries[currentIdx];
      
      try {
        const fullPath = path.join(safePath_resolved, entry.name);
        const itemStats = await fs.stat(fullPath);
        
        const item = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? itemStats.size : null,
          size_readable: entry.isFile() ? formatSize(itemStats.size) : null,
          modified: itemStats.mtime.toISOString(),
          created: itemStats.birthtime.toISOString(),
          permissions: itemStats.mode,
          path: fullPath
        };
        
        // 응답 크기 확인
        if (!monitor.canAddContent(item)) {
          break;
        }
        
        monitor.addContent(item);
        allItems.push(item);
        currentIdx++;
        
      } catch {
        // 권한 오류 등으로 stat 실패한 경우
        const fallbackItem = {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: null,
          size_readable: null,
          modified: null,
          created: null,
          permissions: null,
          path: path.join(safePath_resolved, entry.name)
        };
        
        if (monitor.canAddContent(fallbackItem)) {
          monitor.addContent(fallbackItem);
          allItems.push(fallbackItem);
          currentIdx++;
        } else {
          break;
        }
      }
    }
    
    const hasMore = currentIdx < filteredEntries.length;
    let continuationTokenId: string | undefined;
    
    if (hasMore) {
      const nextPage = Math.floor(currentIdx / pageSize) + 1;
      continuationTokenId = globalTokenManager.generateToken('list_directory', dirPath, {
        ...args,
        page: nextPage
      });
      
      globalTokenManager.updateToken(continuationTokenId, {
        page: nextPage,
        path: dirPath
      });
    }
    
    const response = createChunkedResponse({
      path: safePath_resolved,
      items: allItems,
      page: actualPage,
      page_size: pageSize,
      total_count: filteredEntries.length,
      total_pages: Math.ceil(filteredEntries.length / pageSize),
      items_in_response: allItems.length,
      sort_by: sort_by,
      reverse: reverse,
      auto_chunked: true,
      timestamp: new Date().toISOString()
    }, hasMore, monitor, continuationTokenId);
    
    return response;
    
  } else {
    // 기존 방식 (청킹 없음)
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
      page: actualPage,
      page_size: pageSize,
      total_count: filteredEntries.length,
      total_pages: Math.ceil(filteredEntries.length / pageSize),
      has_more: endIdx < filteredEntries.length,
      sort_by: sort_by,
      reverse: reverse,
      auto_chunked: false,
      timestamp: new Date().toISOString()
    };
  }
}

// handleSearchFiles 함수 (자동 청킹 지원)
export async function handleSearchFilesWithAutoChunking(args: any) {
  const { 
    path: searchPath, 
    pattern, 
    content_search = false, 
    case_sensitive = false, 
    max_results = 100,
    context_lines = 0,
    file_pattern = '',
    include_binary = false,
    continuation_token,
    auto_chunk = true
  } = args;
  
  const monitor = new ResponseSizeMonitor(0.9); // 900KB 제한
  let fileIndex = 0;
  let lastFile = '';
  
  // Continuation token 처리
  if (continuation_token) {
    const token = globalTokenManager.getToken(continuation_token);
    if (token && token.type === 'search_files' && token.path === searchPath) {
      fileIndex = token.file_index || 0;
      lastFile = token.last_file || '';
    }
  }
  
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
      const regexStr = file_pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      fileRegex = new RegExp(`^${regexStr}$`, 'i');
    } catch {
      // 정규표현식 변환 실패시 단순 문자열 포함 검사
    }
  }
  
  let currentFileIndex = 0;
  let shouldStartProcessing = !continuation_token; // 토큰이 없으면 처음부터
  
  async function searchDirectory(dirPath: string): Promise<boolean> {
    if (results.length >= maxResults) return false;
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(dirPath, entry.name);
        
        if (shouldExcludePath(fullPath)) continue;
        
        if (entry.isFile()) {
          // continuation 지점 확인
          if (!shouldStartProcessing) {
            if (currentFileIndex >= fileIndex && fullPath >= lastFile) {
              shouldStartProcessing = true;
            } else {
              currentFileIndex++;
              continue;
            }
          }
          
          // 파일 패턴 필터링
          if (fileRegex && !fileRegex.test(entry.name)) {
            currentFileIndex++;
            continue;
          }
          
          const searchName = case_sensitive ? entry.name : entry.name.toLowerCase();
          let matched = false;
          let matchType = '';
          let matchedLines: any[] = [];
          
          // 파일명 검색
          if (regexPattern ? regexPattern.test(entry.name) : searchName.includes(searchPattern)) {
            matched = true;
            matchType = 'filename';
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
              is_binary: false,
              file_index: currentFileIndex
            };
            
            // 자동 청킹 확인
            if (auto_chunk && !monitor.canAddContent(result)) {
              // 응답 크기 한계 도달
              return false;
            }
            
            if (auto_chunk) {
              monitor.addContent(result);
            }
            results.push(result);
          }
          
          currentFileIndex++;
          
        } else if (entry.isDirectory()) {
          const canContinue = await searchDirectory(fullPath);
          if (!canContinue) return false;
        }
      }
    } catch (error) {
      // Silent: suppress warnings to prevent JSON parsing errors
      if (process.env.DEBUG_MCP === 'true') {
        logger.warn(`Failed to search directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return true;
  }
  
  const startTime = Date.now();
  const canContinue = await searchDirectory(safePath_resolved);
  const searchTime = Date.now() - startTime;
  
  const hasMore = !canContinue || (results.length >= maxResults && currentFileIndex < Number.MAX_SAFE_INTEGER);
  let continuationTokenId: string | undefined;
  
  if (hasMore && auto_chunk) {
    const lastResult = results[results.length - 1];
    continuationTokenId = globalTokenManager.generateToken('search_files', searchPath, {
      ...args,
      file_index: currentFileIndex,
      last_file: lastResult?.path || lastFile
    });
    
    globalTokenManager.updateToken(continuationTokenId, {
      file_index: currentFileIndex,
      last_file: lastResult?.path || lastFile,
      path: searchPath
    });
  }
  
  if (auto_chunk) {
    const response = createChunkedResponse({
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
      ripgrep_enhanced: true,
      auto_chunked: true,
      current_file_index: currentFileIndex,
      timestamp: new Date().toISOString()
    }, hasMore, monitor, continuationTokenId);
    
    return response;
  } else {
    // 기존 방식
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
      ripgrep_enhanced: true,
      auto_chunked: false,
      timestamp: new Date().toISOString()
    };
  }
}
