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
        "-y",
        "mcp-remote",
        "https://fast-filesystem-mcp.vercel.app/api/server"
      ]
    }
  }
}
```

### Configuration File Locations
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Important**: Restart Claude Desktop after adding the configuration.

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
"Read the package.json file"
"List files in my Documents folder" 
"Search for TypeScript files containing 'interface'"
"Show me the project folder structure"
"Find files larger than 100MB"
"Create a new directory called 'projects'"
"What's the disk usage of the current directory?"
```

## Features

- **Security**: Path validation and access control to safe directories only
- **Performance**: Smart chunking for large files (2MB chunks)
- **Scalability**: Pagination for large directories (1000 items max)
- **Search**: File and content search capabilities
- **Claude-optimized**: Response size limits (5MB) and efficient streaming
- **Memory-efficient**: Stream-based reading for large files

## Server Info

- **Production URL**: https://fast-filesystem-mcp.vercel.app/api/server
- **Version**: 2.1.0
- **Runtime**: Node.js 18+ on Vercel Serverless
- **Protocol**: JSON-RPC 2.0 over HTTP
- **Transport**: HTTP with mcp-remote client

## Troubleshooting

### Connection Issues
- Restart Claude Desktop after config changes
- Ensure you're using `mcp-remote` (not `@modelcontextprotocol/server-fetch`)
- Check internet connection to Vercel

### Permission Denied
- Check that the path is within allowed directories
- Verify file permissions on your system
- Only `/home`, `/Users`, and `/tmp` directories are accessible

### Large Files
- Use chunked reading with `line_start` and `line_count` parameters
- Files over 2MB are automatically chunked
- For very large files, request specific byte ranges

### Performance Tips
- Use pagination for directories with many files
- Set `max_results` for file searches to reasonable limits
- Consider using `show_hidden: false` to improve directory listing speed

## Complete Configuration Example

```json
{
  "globalShortcut": "Cmd+L",
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://fast-filesystem-mcp.vercel.app/api/server"
      ]
    },
    "other-mcp-servers": {
      "command": "npx",
      "args": ["other-package"]
    }
  }
}
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/name`
3. Commit changes: `git commit -m 'Add feature'`
4. Push to branch: `git push origin feature/name`
5. Open Pull Request

## License

MIT License - see LICENSE file for details.

## Support

If you encounter issues:
1. Check the [troubleshooting section](#troubleshooting)
2. Verify your Claude Desktop configuration
3. Test server status: https://fast-filesystem-mcp.vercel.app/api/server
4. Open an issue on GitHub with error details
