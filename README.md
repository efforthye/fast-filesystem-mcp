# Fast Filesystem MCP Server

A high-performance filesystem MCP server that provides advanced file operations for Claude Desktop with Claude-optimized chunking, pagination, and comprehensive directory operations.

## Features

- File reading/writing with chunking support
- Directory browsing with pagination
- File/directory search (name and content)
- Directory tree structure display
- Large file detection
- Disk usage monitoring
- Claude-optimized response size limits

## Quick Setup (Recommended)

No installation required! Just add this to your Claude Desktop configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\\Claude\\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": ["-y", "fast-filesystem-mcp"]
    }
  }
}
```

**Important**: Restart Claude Desktop after adding the configuration.

## Alternative Setup (Global Installation)

If you prefer to install globally:

```bash
npm install -g fast-filesystem-mcp
```

Then use this configuration:

```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "fast-filesystem-mcp"
    }
  }
}
```

## Available Tools

- `fast_list_allowed_directories` - List accessible directories
- `fast_read_file` - Read files with chunking support
- `fast_write_file` - Write/modify files
- `fast_list_directory` - List directory contents with pagination
- `fast_get_file_info` - Get detailed file/directory information
- `fast_create_directory` - Create directories
- `fast_search_files` - Search files by name or content
- `fast_get_directory_tree` - Generate directory tree structures
- `fast_get_disk_usage` - Show disk space information
- `fast_find_large_files` - Find files above size thresholds

## Security

By default, only the following directories are accessible:
- Home directory (`$HOME`)
- `/tmp`
- `/Users` (macOS)
- `/home` (Linux)

Excluded directories/files:
- `node_modules`, `.git`, `.venv`, etc.
- System cache and build directories

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

## Development

```bash
git clone https://github.com/efforthye/fast-filesystem-mcp.git
cd fast-filesystem-mcp
npm install
npm run build
npm run start
```

## License

MIT