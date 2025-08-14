# Fast Filesystem MCP

A powerful Model Context Protocol (MCP) server providing advanced filesystem operations for Claude and other AI assistants. Migrated from the original McpSynapse project with 10 specialized tools optimized for Claude's performance requirements.

## Live Demo
- **Production Server**: https://fast-filesystem-mcp.vercel.app/api/server
- **GitHub Repository**: https://github.com/efforthye/fast-filesystem-mcp
- **Status**: Online | Version 2.1.0 | 10 Core Tools Available

## Quick Setup

Add this configuration to your Claude Desktop config file:

```json
{
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
```

### Configuration File Locations
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

After adding the configuration, restart Claude Desktop and you're ready to go!

## Available Tools

### Core File Operations

#### `fast_list_allowed_directories`
Shows accessible directories and server information
```
허용된 디렉토리를 보여줘
```

#### `fast_read_file`
Reads files with advanced chunking support
- **Parameters**: `path`, `start_offset`, `max_size`, `line_start`, `line_count`, `encoding`
- **Features**: Smart chunking for large files, line-based reading, encoding support
```
README.md 파일을 읽어줘
파일의 첫 50줄만 읽어줘
```

#### `fast_write_file`
Writes or modifies files with safety features
- **Parameters**: `path`, `content`, `encoding`, `create_dirs`, `append`
- **Features**: Automatic directory creation, append mode, encoding support
```
새 파일을 만들어줘
파일에 내용을 추가해줘
```

#### `fast_list_directory`
Lists directory contents with advanced filtering
- **Parameters**: `path`, `page`, `page_size`, `pattern`, `show_hidden`, `sort_by`, `reverse`
- **Features**: Pagination, sorting, filtering, hidden file control
```
홈 폴더의 파일들을 나열해줘
Python 파일만 보여줘
크기순으로 정렬해서 보여줘
```

#### `fast_get_file_info`
Provides detailed file/directory information
- **Parameters**: `path`
- **Features**: Complete metadata, size analysis, Claude-optimized recommendations
```
이 파일의 정보를 알려줘
디렉토리 크기를 확인해줘
```

### Search & Discovery

#### `fast_search_files`
Powerful file and content search
- **Parameters**: `path`, `pattern`, `content_search`, `case_sensitive`, `max_results`
- **Features**: Filename search, content search, case sensitivity options
```
TODO가 포함된 파일들을 찾아줘
Python 파일에서 'import pandas' 찾아줘
사진 파일들을 검색해줘
```

#### `fast_get_directory_tree`
Generates visual directory tree structures
- **Parameters**: `path`, `max_depth`, `show_hidden`, `include_files`
- **Features**: Customizable depth, hidden file control, file inclusion toggle
```
프로젝트 폴더의 구조를 보여줘
3단계 깊이까지만 트리로 보여줘
```

#### `fast_find_large_files`
Finds files above specified size thresholds
- **Parameters**: `path`, `min_size`, `max_results`
- **Features**: Size parsing (100MB, 1GB), sorted results, extension info
```
100MB 이상의 큰 파일들을 찾아줘
1GB 넘는 파일들을 디렉토리에서 찾아줘
```

### Management Operations

#### `fast_create_directory`
Creates directories with recursive support
- **Parameters**: `path`, `recursive`
- **Features**: Automatic parent directory creation, path validation
```
새 프로젝트 디렉토리를 만들어줘
nested/deep/folder 구조를 생성해줘
```

#### `fast_get_disk_usage`
Shows disk space information
- **Parameters**: `path` (optional)
- **Features**: Human-readable sizes, filesystem details
```
디스크 사용량을 확인해줘
이 폴더의 디스크 사용량은?
```

## Usage Examples

### Basic File Operations
```
• "허용된 디렉토리를 보여줘" - Show accessible directories
• "홈 폴더를 나열해줘" - List home directory
• "README.md를 읽어줘" - Read a file
• "config.json 파일을 만들어줘" - Create a new file
• "이 파일의 정보를 알려줘" - Get file details
```

### Advanced Search & Analysis
```
• "Python 파일들을 찾아줘" - Find Python files
• "TODO 주석이 있는 파일들 검색해줘" - Search file contents
• "프로젝트 구조를 트리로 보여줘" - Show directory tree
• "큰 파일들을 찾아서 정리하자" - Find large files
• "디스크 사용량을 체크해줘" - Check disk usage
```

### Project Management
```
• "새 프로젝트 폴더를 만들어줘" - Create project directory
• "소스코드 파일들만 보여줘" - Filter by file type
• "최근 수정된 파일들을 찾아줘" - Sort by modification date
• "설정 파일들을 검색해줘" - Find configuration files
• "로그 파일에서 에러를 찾아줘" - Search log contents
```

## Features & Optimizations

### Performance Features
- **Smart Chunking**: Automatic handling of large files with 2MB chunks
- **Pagination**: Efficient directory listing with customizable page sizes
- **Response Limits**: 5MB maximum response size optimized for Claude
- **Memory Efficient**: Stream-based reading for large files
- **Fast Search**: Optimized file system traversal with exclude patterns

### Security Features
- **Path Validation**: Prevents directory traversal attacks
- **Access Control**: Configurable allowed directories
- **Safe Defaults**: Excludes system files and sensitive directories
- **Error Isolation**: Graceful handling of permission errors

### Claude Optimizations
- **Token Awareness**: Automatic truncation at Claude's limits
- **Structured Output**: JSON responses optimized for Claude parsing
- **Context Hints**: Intelligent suggestions for large operations
- **Readable Sizes**: Human-friendly file size formatting

## Advanced Configuration

### Custom Allowed Directories
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch", 
        "https://fast-filesystem-mcp.vercel.app/api/server"
      ],
      "env": {
        "ALLOWED_DIRS": "/Users/username/projects,/Users/username/documents"
      }
    }
  }
}
```

### Environment Variables
- `ALLOWED_DIRS`: Comma-separated list of allowed directories
- `MAX_FILE_SIZE`: Maximum file size for operations (default: 10GB)
- `CHUNK_SIZE`: Default chunk size for reading (default: 2MB)

## Architecture

### Technology Stack
- **Runtime**: Node.js on Vercel Serverless
- **Language**: TypeScript for type safety
- **Protocol**: JSON-RPC 2.0 over HTTP
- **Deployment**: Automatic GitHub Actions CI/CD

### Original Heritage
This project is a complete migration from the original **McpSynapse** Python implementation, featuring:
- All 10 original tools ported to TypeScript
- Enhanced performance with serverless architecture
- Improved Claude integration and optimization
- Zero-installation web deployment
- Modern JSON-RPC implementation

## Troubleshooting

### Connection Issues
1. **Server Disconnected**: Restart Claude Desktop after configuration changes
2. **Tool Not Found**: Verify the server URL is accessible
3. **Permission Denied**: Check file/directory permissions and allowed paths

### Performance Issues
1. **Large Files**: Use chunked reading with `start_offset` and `max_size`
2. **Large Directories**: Enable pagination with `page` and `page_size`
3. **Search Timeouts**: Use specific patterns and limit `max_results`

### Common Error Messages
- `Access denied to path`: Path is outside allowed directories
- `Path is not a file/directory`: Invalid path or file type mismatch
- `File too large`: Use chunked reading for files > 2MB

## API Reference

### JSON-RPC Endpoints
- `POST /api/server` - Main MCP protocol endpoint
- `GET /api/server` - Server status and configuration info

### Response Format
All tool responses follow this structure:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{
      "type": "text", 
      "text": "{\\"key\\": \\"value\\"}"
    }]
  }
}
```

## Development

### Local Development
```bash
# Clone the repository
git clone https://github.com/efforthye/fast-filesystem-mcp
cd fast-filesystem-mcp

# Install dependencies
npm install

# Run development server
npm run dev
```

### Testing MCP Connection
```bash
# Test server status
curl https://fast-filesystem-mcp.vercel.app/api/server

# Test MCP initialize
curl -X POST https://fast-filesystem-mcp.vercel.app/api/server \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

## Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/efforthye/fast-filesystem-mcp/issues)
- **Discussions**: [GitHub Discussions](https://github.com/efforthye/fast-filesystem-mcp/discussions)
- **Updates**: Watch the repository for new releases and features

---

**Made for the Claude community** | Migrated from McpSynapse | Optimized for production use
