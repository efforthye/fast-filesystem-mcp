# Fast Filesystem MCP
Advanced filesystem operations for Claude Desktop with large file handling capabilities and Claude-optimized features.

## Quick Start
Add to your Claude Desktop config.
- **Basic setup**
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

- **With backup files enabled**
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": ["-y", "fast-filesystem-mcp"],
      "env": {
        "CREATE_BACKUP_FILES": "true"
      }
    }
  }
}
```

### Backup Configuration
Control backup file creation behavior:
- `CREATE_BACKUP_FILES=false` (default): Disables backup file creation to reduce clutter  
- `CREATE_BACKUP_FILES=true`: Creates backup files before modifications

**Note**: Backup files are created with timestamps (e.g., `file.txt.backup.1755485284402`) to prevent data loss during edits.

## New Version Update
- npm uninstall -g fast-filesystem-mcp
- npm cache clean --force
- npm install -g fast-filesystem-mcp
- npm list -g fast-filesystem-mcp
- fast-filesystem-mcp --version

## Features
### Core File Operations
- Fast File Reading/Writing: Optimized for Claude Desktop with chunking support
- Large File Handling: Stream-based writing for files of any size
- Directory Operations: Comprehensive directory listing, creation, and management
- File Search: Name and content-based file searching with filtering

### Advanced Capabilities
- Pagination Support: Handle large directories efficiently
- Chunked Reading: Read large files in manageable chunks
- Streaming Writes: Memory-efficient writing for large files
- Backup & Recovery: Automatic backup creation and error recovery
- Retry Logic: Built-in retry mechanism for reliable operations

### Performance Optimizations
- Claude-Optimized: Response sizes and formats optimized for Claude
- Memory Efficient: Streaming operations prevent memory overflow
- Smart Exclusions: Automatically excludes system files and directories
- Progress Tracking: Real-time progress monitoring for large operations

## Available Tools

### File Operations
- `fast_read_file` - Read files with chunking support
- `fast_write_file` - Write or modify files
- `fast_large_write_file` - Stream-based writing for large files
- `fast_get_file_info` - Get detailed file information

### Complex File Management
- `fast_copy_file` - Copy files and directories with advanced options
- `fast_move_file` - Move/rename files and directories safely
- `fast_delete_file` - Delete files and directories with protection
- `fast_batch_file_operations` - Execute multiple file operations in sequence

### Archive Management
- `fast_compress_files` - Create compressed archives (tar, tar.gz, tar.bz2)
- `fast_extract_archive` - Extract compressed archives with options

### Directory Synchronization 
- `fast_sync_directories` - Advanced directory synchronization with multiple modes

### Advanced Editing Tools
- `fast_edit_file` - Precise line-based file editing with multiple modes
- `fast_edit_block` - Safe block editing with exact string matching
- `fast_edit_blocks` - Batch block editing for multiple precise changes
- `fast_edit_multiple_blocks` - Edit multiple sections in a single operation
- `fast_extract_lines` - Extract specific lines or ranges from files

### Directory Operations
- `fast_list_directory` - List directory contents with pagination
- `fast_create_directory` - Create directories recursively
- `fast_get_directory_tree` - Get directory tree structure

### Search Operations
- `fast_search_files` - Search files by name or content
- `fast_search_code` - Advanced code search with ripgrep integration
- `fast_find_large_files` - Find large files in directories

### System Operations
- `fast_get_disk_usage` - Check disk usage information
- `fast_list_allowed_directories` - List allowed directories

## Editing Tools

### Precise File Editing

The fast-filesystem MCP now includes powerful editing tools for source code and text files:

#### `fast_edit_file` - Single Block Editing
Supports multiple editing modes:
- **replace**: Replace text or entire lines
- **replace_range**: Replace multiple lines at once  
- **insert_before**: Insert content before specified line
- **insert_after**: Insert content after specified line
- **delete_line**: Delete specific lines

```json
{
  "tool": "fast_edit_file",
  "arguments": {
    "path": "/path/to/file.js",
    "mode": "replace",
    "line_number": 10,
    "new_text": "const newVariable = 'updated value';",
    "backup": true
  }
}
```

#### `fast_edit_multiple_blocks` - Batch Editing
Edit multiple parts of a file in a single operation:

```json
{
  "tool": "fast_edit_multiple_blocks", 
  "arguments": {
    "path": "/path/to/file.js",
    "edits": [
      {
        "mode": "replace",
        "old_text": "oldFunction()",
        "new_text": "newFunction()"
      },
      {
        "mode": "insert_after",
        "line_number": 5,
        "new_text": "// Added comment"
      }
    ],
    "backup": true
  }
}
```

#### `fast_extract_lines` - Line Extraction
Extract specific lines by number, range, or pattern:

```json
{
  "tool": "fast_extract_lines",
  "arguments": {
    "path": "/path/to/file.js",
    "pattern": "function.*",
    "context_lines": 2
  }
}
```

#### `fast_search_and_replace` - Advanced Replace
Powerful search and replace with regex support:

```json
{
  "tool": "fast_search_and_replace",
  "arguments": {
    "path": "/path/to/file.js", 
    "search_pattern": "console\\.log\\(.*\\)",
    "replace_text": "logger.info($1)",
    "use_regex": true,
    "max_replacements": 10,
    "backup": true
  }
}
```

### Editing Features
- **Automatic Backup**: Creates backups before modifications
- **Error Recovery**: Restores from backup on failure
- **Line-based Operations**: Precise control over specific lines
- **Pattern Matching**: Regular expression support
- **Batch Operations**: Multiple edits in single transaction
- **Context Extraction**: Extract lines with surrounding context

### Large File Writing
- `fast_large_write_file`
  - Streaming: Writes files in chunks to prevent memory issues
  - Backup: Automatically creates backups before overwriting
  - Verification: Verifies file integrity after writing
  - Retry Logic: Automatic retry on failure with exponential backoff
  - Progress Tracking: Real-time monitoring of write progress

## License
MIT

## Repository
https://github.com/efforthye/fast-filesystem-mcp
