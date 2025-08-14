import { promises as fs } from 'fs';
import path from 'path';

const DEFAULT_ALLOWED_DIRECTORIES = [
  process.env.HOME || '/home',
  '/tmp',
  '/Users', 
  '/home'
];

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

export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET') {
      res.status(200).json({
        status: 'online',
        name: 'fast-filesystem',
        version: '1.0.0',
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
        tools: [
          'list_allowed_directories',
          'read_file', 
          'list_directory',
          'write_file',
          'get_file_info',
          'create_directory'
        ],
        github: 'https://github.com/efforthye/fast-filesystem-mcp'
      });
    } else if (req.method === 'POST') {
      const { method, params, id } = req.body || {};
      
      if (method === 'tools/list') {
        res.status(200).json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            tools: [
              {
                name: 'list_allowed_directories',
                description: '허용된 디렉토리 목록을 조회합니다',
                inputSchema: {
                  type: 'object',
                  properties: {},
                  required: []
                }
              },
              {
                name: 'read_file',
                description: '파일을 읽습니다',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: '읽을 파일 경로' }
                  },
                  required: ['path']
                }
              },
              {
                name: 'list_directory',
                description: '디렉토리 목록을 조회합니다',
                inputSchema: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: '조회할 디렉토리 경로' }
                  },
                  required: ['path']
                }
              }
            ]
          }
        });
      } else if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        
        try {
          if (name === 'list_allowed_directories') {
            res.status(200).json({
              jsonrpc: '2.0',
              id: id || 1,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    allowed_directories: DEFAULT_ALLOWED_DIRECTORIES,
                    current_working_directory: process.cwd(),
                    server_info: {
                      name: 'fast-filesystem',
                      version: '1.0.0',
                      timestamp: new Date().toISOString()
                    }
                  }, null, 2)
                }]
              }
            });
          } else {
            res.status(200).json({
              jsonrpc: '2.0',
              id: id || 1,
              error: {
                code: -32601,
                message: `Method not found: ${name}`
              }
            });
          }
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
            version: '1.0.0',
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
