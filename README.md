# Fast Filesystem MCP

A powerful Model Context Protocol (MCP) server providing advanced filesystem operations for Claude and other AI assistants.

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

Restart Claude Desktop after adding the configuration.

## Available Tools

### Core Operations
- `fast_list_allowed_directories` - Show accessible directories
- `fast_read_file` - Read files with chunking support
- `fast_write_file` - Write or modify files
- `fast_list_directory` - List directory contents with pagination
- `fast_get_file_info` - Get detailed file/directory information
- `fast_create_directory` - Create directories

### Advanced Operations
- `fast_search_files` - Search files by name or content
- `fast_get_directory_tree` - Generate directory tree structures
- `fast_find_large_files` - Find files above size thresholds
- `fast_get_disk_usage` - Show disk space information

## Usage Examples

```
"Show me the allowed directories"
"Read the README.md file"
"List files in my Documents folder" 
"Search for Python files containing 'import pandas'"
"Show me the project folder structure"
"Find files larger than 100MB"
"Create a new directory called 'project'"
```

## Features

- Smart chunking for large files (2MB chunks)
- Pagination for large directories 
- File and content search capabilities
- Security: Path validation and access control
- Claude-optimized responses (5MB limit)
- Stream-based reading for memory efficiency

## Server Info

- **Production**: https://fast-filesystem-mcp.vercel.app/api/server
- **Version**: 2.1.0
- **Runtime**: Node.js on Vercel Serverless
- **Protocol**: JSON-RPC 2.0 over HTTP

## Troubleshooting

- **Connection Issues**: Restart Claude Desktop after config changes
- **Permission Denied**: Check file permissions and allowed paths
- **Large Files**: Use chunked reading with start_offset and max_size parameters

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Commit changes: `git commit -m 'Add feature'`
4. Push to branch: `git push origin feature/name`
5. Open Pull Request

## License

MIT License - see LICENSE file for details.
