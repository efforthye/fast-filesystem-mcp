import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';

// Claude 최적화 설정
const CLAUDE_MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const CLAUDE_MAX_CHUNK_SIZE = 2 * 1024 * 1024;    // 2MB
const CLAUDE_MAX_LINES = 2000;                     // 최대 2000줄

// 기본 허용 디렉토리들
const DEFAULT_ALLOWED_DIRECTORIES = [
  process.env.HOME || '/home',
  '/tmp',
  '/Users', 
  '/home'
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

// MCP 서버 생성
const server = new Server(
  {
    name: 'fast-filesystem',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 허용된 디렉토리 목록 조회
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_allowed_directories',
        description: '허용된 디렉토리 목록을 조회합니다',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'read_file',
        description: '파일을 읽습니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '읽을 파일 경로',
            },
            start_offset: {
              type: 'number',
              description: '시작 바이트 위치',
            },
            max_size: {
              type: 'number',
              description: '읽을 최대 크기',
            },
            line_start: {
              type: 'number',
              description: '시작 라인 번호',
            },
            line_count: {
              type: 'number',
              description: '읽을 라인 수',
            },
            encoding: {
              type: 'string',
              description: '텍스트 인코딩',
              default: 'utf-8',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_directory',
        description: '디렉토리 목록을 조회합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '조회할 디렉토리 경로',
            },
            page: {
              type: 'number',
              description: '페이지 번호 (1부터 시작)',
              default: 1,
            },
            page_size: {
              type: 'number',
              description: '페이지당 항목 수',
            },
            pattern: {
              type: 'string',
              description: '파일명 필터 패턴',
            },
            show_hidden: {
              type: 'boolean',
              description: '숨김 파일 표시 여부',
              default: false,
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: '파일을 씁니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '파일 경로',
            },
            content: {
              type: 'string',
              description: '파일 내용',
            },
            encoding: {
              type: 'string',
              description: '텍스트 인코딩',
              default: 'utf-8',
            },
            create_dirs: {
              type: 'boolean',
              description: '디렉토리 자동 생성 여부',
              default: true,
            },
            append: {
              type: 'boolean',
              description: '추가 모드 여부',
              default: false,
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'get_file_info',
        description: '파일 또는 디렉토리 정보를 조회합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '조회할 파일 또는 디렉토리 경로',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'create_directory',
        description: '디렉토리를 생성합니다',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '생성할 디렉토리 경로',
            },
          },
          required: ['path'],
        },
      },
    ],
  };
});

// 도구 호출 핸들러
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'list_allowed_directories':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                allowed_directories: DEFAULT_ALLOWED_DIRECTORIES,
                current_working_directory: process.cwd(),
                claude_limits: {
                  max_response_size_mb: CLAUDE_MAX_RESPONSE_SIZE / (1024**2),
                  max_chunk_size_mb: CLAUDE_MAX_CHUNK_SIZE / (1024**2),
                  max_lines_per_read: CLAUDE_MAX_LINES,
                }
              }, null, 2),
            },
          ],
        };

      case 'read_file':
        const { path: filePath, start_offset = 0, max_size, line_start, line_count, encoding = 'utf-8' } = args as any;
        
        try {
          const safePath_resolved = safePath(filePath);
          const stats = await fs.stat(safePath_resolved);
          
          if (!stats.isFile()) {
            throw new Error('Path is not a file');
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
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    content: selectedLines,
                    mode: 'lines',
                    start_line: line_start,
                    lines_read: selectedLines.length,
                    file_size: stats.size,
                    encoding: encoding
                  }, null, 2),
                },
              ],
            };
          }
          
          // 바이트 모드
          const buffer = Buffer.alloc(maxReadSize);
          const fd = await fs.open(safePath_resolved, 'r');
          const { bytesRead } = await fd.read(buffer, 0, maxReadSize, start_offset);
          await fd.close();
          
          const content = buffer.subarray(0, bytesRead).toString(encoding as BufferEncoding);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  content: content,
                  mode: 'bytes',
                  start_offset: start_offset,
                  bytes_read: bytesRead,
                  file_size: stats.size,
                  encoding: encoding,
                  has_more: start_offset + bytesRead < stats.size
                }, null, 2),
              },
            ],
          };
          
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : 'Unknown error',
                  error_type: error instanceof Error ? error.constructor.name : 'Error'
                }),
              },
            ],
          };
        }

      case 'list_directory':
        const { path: dirPath, page = 1, page_size, pattern, show_hidden = false } = args as any;
        
        try {
          const safePath_resolved = safePath(dirPath);
          const stats = await fs.stat(safePath_resolved);
          
          if (!stats.isDirectory()) {
            throw new Error('Path is not a directory');
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
                type: entry.isDirectory() ? 'directory' : 'file',
                size: entry.isFile() ? itemStats.size : null,
                size_readable: entry.isFile() ? formatSize(itemStats.size) : null,
                modified: itemStats.mtime.toISOString()
              };
            } catch {
              return {
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
                size: null,
                size_readable: null,
                modified: null
              };
            }
          }));
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  path: safePath_resolved,
                  items: items,
                  page: page,
                  page_size: pageSize,
                  total_count: filteredEntries.length,
                  total_pages: Math.ceil(filteredEntries.length / pageSize),
                  has_more: endIdx < filteredEntries.length
                }, null, 2),
              },
            ],
          };
          
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : 'Unknown error',
                  error_type: error instanceof Error ? error.constructor.name : 'Error'
                }),
              },
            ],
          };
        }

      case 'write_file':
        const { path: writeFilePath, content, encoding: writeEncoding = 'utf-8', create_dirs = true, append = false } = args as any;
        
        try {
          let targetPath: string;
          
          if (path.isAbsolute(writeFilePath)) {
            targetPath = writeFilePath;
          } else {
            targetPath = path.join(process.cwd(), writeFilePath);
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
            await fs.appendFile(resolvedPath, content, writeEncoding as BufferEncoding);
          } else {
            await fs.writeFile(resolvedPath, content, writeEncoding as BufferEncoding);
          }
          
          const stats = await fs.stat(resolvedPath);
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: `File ${append ? 'appended' : 'written'} successfully`,
                  path: resolvedPath,
                  size: stats.size,
                  size_readable: formatSize(stats.size),
                  encoding: writeEncoding,
                  mode: append ? 'append' : 'write'
                }, null, 2),
              },
            ],
          };
          
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : 'Unknown error',
                  error_type: error instanceof Error ? error.constructor.name : 'Error'
                }),
              },
            ],
          };
        }

      case 'get_file_info':
        const { path: infoPath } = args as any;
        
        try {
          const safePath_resolved = safePath(infoPath);
          const stats = await fs.stat(safePath_resolved);
          
          const info = {
            path: safePath_resolved,
            name: path.basename(safePath_resolved),
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            size_readable: formatSize(stats.size),
            created: stats.birthtime.toISOString(),
            modified: stats.mtime.toISOString(),
            accessed: stats.atime.toISOString()
          };
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(info, null, 2),
              },
            ],
          };
          
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : 'Unknown error',
                  error_type: error instanceof Error ? error.constructor.name : 'Error'
                }),
              },
            ],
          };
        }

      case 'create_directory':
        const { path: createDirPath } = args as any;
        
        try {
          const safePath_resolved = safePath(createDirPath);
          
          await fs.mkdir(safePath_resolved, { recursive: true });
          
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  message: 'Directory created successfully',
                  path: safePath_resolved
                }, null, 2),
              },
            ],
          };
          
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  error: error instanceof Error ? error.message : 'Unknown error',
                  error_type: error instanceof Error ? error.constructor.name : 'Error'
                }),
              },
            ],
          };
        }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Vercel serverless 함수로 export
export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'POST') {
      // MCP 요청 처리
      const { method, params } = req.body;
      
      // 간단한 응답으로 테스트
      res.status(200).json({
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            {
              name: 'list_allowed_directories',
              description: '허용된 디렉토리 목록을 조회합니다'
            }
          ]
        }
      });
    } else if (req.method === 'GET') {
      // Health check
      res.status(200).json({
        status: 'ok',
        message: 'Fast Filesystem MCP Server is running',
        name: 'fast-filesystem',
        version: '1.0.0'
      });
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end('Method Not Allowed');
    }
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
