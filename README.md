# Fast Filesystem MCP Server

A high-performance filesystem MCP server that provides advanced file operations for Claude Desktop with Claude-optimized chunking, pagination, and comprehensive directory operations.

## Features

### Core Operations
- File reading/writing with chunking support
- Directory browsing with pagination
- File/directory search (name and content)
- Directory tree structure display
- Large file detection
- Disk usage monitoring
- Claude-optimized response size limits

### Advanced Operations (NEW in v2.2.0)
- File/directory move and rename operations
- Smart file copying with overwrite protection
- Safe file deletion with recursive support
- Intelligent file editing with diff preview
- File comparison (hash, size, content)
- Streaming file reading (head/tail/range)
- Directory size calculation with largest files
- Directory change monitoring

## Quick Setup

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

## Available Tools

### Core Tools
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

### Advanced Tools (NEW)
- `fast_move_file` - Move or rename files and directories
- `fast_copy_file` - Copy files and directories with smart handling
- `fast_delete_file` - Delete files/directories with safety checks
- `fast_edit_file` - Edit files with diff preview and backup
- `fast_compare_files` - Compare files using hash, size, or content
- `fast_read_file_streaming` - Advanced file reading (head/tail/range)
- `fast_calculate_directory_size` - Calculate directory sizes with stats
- `fast_watch_directory` - Monitor directory changes over time

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

### Basic Operations
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

### Advanced Operations
```
"Move the file 'old.txt' to 'backup/old.txt'"
"Copy the entire 'src' directory to 'backup/src'"
"Delete the temporary files in '/tmp/myapp'"
"Edit config.json and replace 'localhost' with '127.0.0.1'"
"Compare file1.txt and file2.txt using hash method"
"Show me the first 20 lines of the log file"
"Calculate the total size of the node_modules directory"
"Monitor the downloads folder for 30 seconds"
```

### File Editing Examples
```
"Edit package.json and change the version from '1.0.0' to '1.1.0'"
"Replace all occurrences of 'oldFunction' with 'newFunction' in src/"
"Show me a preview of changes before applying them (dry run)"
```

### Streaming Read Examples
```
"Show me the last 50 lines of the error log"
"Read lines 100-200 from the data file"
"Show me the first 10 lines of each config file"
```

## Performance Features

- **Claude Optimized**: Response sizes automatically limited for optimal Claude performance
- **Smart Chunking**: Large files automatically split into manageable chunks
- **Intelligent Caching**: Frequently accessed metadata cached for speed
- **Exclusion Patterns**: Automatically skips system and build directories
- **Pagination Support**: Handle large directories without overwhelming Claude
- **Stream Processing**: Memory-efficient processing of large files

## Development

```bash
git clone https://github.com/efforthye/fast-filesystem-mcp.git
cd fast-filesystem-mcp
npm install
npm run build
npm run start
```

## Changelog

### v2.2.0 (Latest)
- Added 8 new advanced filesystem tools
- File/directory move and copy operations
- Smart file editing with diff preview
- File comparison capabilities
- Streaming file reading (head/tail/range)
- Directory size calculation
- Directory change monitoring
- Enhanced error handling and safety checks

### v2.1.x
- Core filesystem operations
- Claude optimization features
- Security and performance improvements

## License

MIT