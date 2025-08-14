import { promises as fs } from 'fs';
import path from 'path';

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

// Vercel serverless 함수
export default async function handler(req: any, res: any) {
  try {
    if (req.method === 'GET') {
      // Health check - 브라우저에서 접근 시 보여줄 페이지
      res.setHeader('Content-Type', 'text/html');
      res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Fast Filesystem MCP Server</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px 20px;
              background: #f5f5f5;
              color: #333;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 12px;
              box-shadow: 0 2px 20px rgba(0,0,0,0.1);
            }
            .status {
              display: inline-block;
              background: #10b981;
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              font-size: 14px;
              font-weight: 600;
            }
            .config {
              background: #1f2937;
              color: #f9fafb;
              padding: 20px;
              border-radius: 8px;
              font-family: monospace;
              font-size: 14px;
              overflow-x: auto;
              margin: 20px 0;
            }
            h1 { color: #1f2937; margin-bottom: 10px; }
            h2 { color: #374151; margin-top: 30px; }
            .feature {
              margin: 10px 0;
              padding-left: 20px;
            }
            .feature:before {
              content: "✓";
              color: #10b981;
              font-weight: bold;
              margin-left: -20px;
              margin-right: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 Fast Filesystem MCP Server</h1>
            <div class="status">ONLINE</div>
            
            <h2>📋 Server Information</h2>
            <ul>
              <li><strong>Name:</strong> fast-filesystem</li>
              <li><strong>Version:</strong> 1.0.0</li>
              <li><strong>Deployment:</strong> ${new Date().toISOString()}</li>
              <li><strong>Environment:</strong> Production</li>
            </ul>

            <h2>🔧 Claude Desktop Configuration</h2>
            <p>Add this configuration to your Claude Desktop settings:</p>
            
            <div class="config">{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://fast-filesystem-mcp.vercel.app/api/server"
      ]
    }
  }
}</div>

            <h2>📁 Configuration File Location</h2>
            <ul>
              <li><strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
              <li><strong>Windows:</strong> <code>%APPDATA%\\Claude\\claude_desktop_config.json</code></li>
            </ul>

            <h2>🛠 Available Tools</h2>
            <div class="feature">list_allowed_directories - 허용된 디렉토리 목록 조회</div>
            <div class="feature">read_file - 파일 읽기</div>
            <div class="feature">list_directory - 디렉토리 목록 조회</div>
            <div class="feature">write_file - 파일 쓰기</div>
            <div class="feature">get_file_info - 파일/디렉토리 정보 조회</div>
            <div class="feature">create_directory - 디렉토리 생성</div>

            <h2>🔗 Links</h2>
            <ul>
              <li><a href="https://github.com/efforthye/fast-filesystem-mcp" target="_blank">GitHub Repository</a></li>
              <li><a href="https://docs.anthropic.com" target="_blank">Claude Documentation</a></li>
            </ul>

            <h2>🚀 Usage Examples</h2>
            <p>After configuration, try these commands in Claude Desktop:</p>
            <ul>
              <li>"허용된 디렉토리를 보여줘"</li>
              <li>"홈 폴더의 파일들을 나열해줘"</li>
              <li>"README.md 파일을 읽어줘"</li>
              <li>"새 디렉토리를 만들어줘"</li>
            </ul>

            <h2>⚡ Server Status</h2>
            <p>Last updated: ${new Date().toLocaleString('ko-KR')}</p>
            <p>Server is running and ready to handle MCP requests.</p>
          </div>
        </body>
        </html>
      `);
    } else if (req.method === 'POST') {
      // MCP 요청 처리
      const { method, params, id } = req.body || {};
      
      // 기본 JSON-RPC 응답
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
        // 기본 서버 정보 응답
        res.status(200).json({
          jsonrpc: '2.0',
          id: id || 1,
          result: {
            status: 'ok',
            message: 'Fast Filesystem MCP Server is running',
            server: {
              name: 'fast-filesystem',
              version: '1.0.0'
            },
            timestamp: new Date().toISOString()
          }
        });
      }
    } else {
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).json({
        error: 'Method Not Allowed',
        message: 'Only GET and POST methods are supported'
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
