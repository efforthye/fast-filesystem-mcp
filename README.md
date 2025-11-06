<!-- # fast-filesystem-mcp -->
<!-- <img width="1460" height="82" alt="image" src="https://github.com/user-attachments/assets/d77b4f8a-2d21-4645-9584-39ae9c7a2c26" /> -->
<img width="860" height="92" alt="image" src="https://github.com/user-attachments/assets/f4a8dfea-e922-4306-b769-48337681f5ea" />

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
Control backup file creation behavior.
- `CREATE_BACKUP_FILES=false` (default): Disables backup file creation to reduce clutter  
- `CREATE_BACKUP_FILES=true`: Creates backup files before modifications

**Note**: Backup files are created with timestamps (e.g., `file.txt.backup.1755485284402`) to prevent data loss during edits.

### Debug and Logging Configuration
The MCP server uses a safe logging system that prevents JSON-RPC communication errors.
- `DEBUG_MCP=true` or `MCP_DEBUG=true`: Enable debug logging to stderr
- `MCP_LOG_FILE=/path/to/log.txt`: Write logs to file instead of stderr
- `MCP_SILENT_ERRORS=true` or `SILENT_ERRORS=true`: Suppress error messages in responses

**Note**: Debug output is automatically suppressed by default to prevent JSON parsing errors in Claude Desktop.

## New Version Update
To update to the latest version, follow these steps.
1. **Uninstall previous version**
   ```bash
   npm uninstall -g fast-filesystem-mcp
   ```
2. **Clean cache and dependencies**
   ```bash
   npm cache clean --force
   pnpm store prune
   ```
3. **Install latest version**
   ```bash
   npm install -g fast-filesystem-mcp
   ```
4. **Verify installation**
   ```bash
   npm list -g fast-filesystem-mcp
   fast-filesystem-mcp --version
   ```

## Features
### Core File Operations
- Fast File Reading/Writing: Optimized for Claude Desktop with chunking support
- Sequential Reading: Read large files completely with continuation token support  
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
| Tool | Description |
|------|-------------|
| `fast_read_file` | Read files with chunking support |
| `fast_read_multiple_files` | Read multiple files simultaneously with sequential reading support |
| `fast_write_file` | Write or modify files |
| `fast_large_write_file` | Stream-based writing for large files |
| `fast_get_file_info` | Get detailed file information |

### Complex File Management
| Tool | Description |
|------|-------------|
| `fast_copy_file` | Copy files and directories with advanced options |
| `fast_move_file` | Move/rename files and directories safely |
| `fast_delete_file` | Delete files and directories with protection |
| `fast_batch_file_operations` | Execute multiple file operations in sequence |

### Archive Management
| Tool | Description |
|------|-------------|
| `fast_compress_files` | Create compressed archives (tar, tar.gz, tar.bz2) |
| `fast_extract_archive` | Extract compressed archives with options |

### Directory Synchronization 
| Tool | Description |
|------|-------------|
| `fast_sync_directories` | Advanced directory synchronization with multiple modes |

### Advanced Editing Tools
| Tool | Description |
|------|-------------|
| `fast_edit_file` | Precise line-based file editing with multiple modes |
| `fast_edit_block` | Safe block editing with exact string matching |
| `fast_edit_blocks` | Batch block editing for multiple precise changes |
| `fast_edit_multiple_blocks` | Edit multiple sections in a single operation |
| `fast_extract_lines` | Extract specific lines or ranges from files |

### Directory Operations
| Tool | Description |
|------|-------------|
| `fast_list_directory` | List directory contents with pagination |
| `fast_create_directory` | Create directories recursively |
| `fast_get_directory_tree` | Get directory tree structure |

### Search Operations
| Tool | Description |
|------|-------------|
| `fast_search_files` | Search files by name or content |
| `fast_search_code` | Advanced code search with ripgrep integration |
| `fast_find_large_files` | Find large files in directories |

### System Operations
| Tool | Description |
|------|-------------|
| `fast_get_disk_usage` | Check disk usage information |
| `fast_list_allowed_directories` | List allowed directories |

## Editing Tools
### Precise File Editing
The fast-filesystem MCP now includes powerful editing tools for source code and text files.
#### `fast_edit_file` - Single Block Editing
Supports multiple editing modes.
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
Edit multiple parts of a file in a single operation.
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
Extract specific lines by number, range, or pattern.
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
Powerful search and replace with regex support.

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
Apache 2.0

Copyright 2025 efforthye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

## Badge
<a href="https://glama.ai/mcp/servers/@efforthye/fast-filesystem-mcp">
  <img width="280" height="150" src="https://glama.ai/mcp/servers/@efforthye/fast-filesystem-mcp/badge" />
</a><br/>
<a href="https://mseep.ai/app/efforthye-fast-filesystem-mcp">
  <img height="150" src="https://mseep.net/pr/efforthye-fast-filesystem-mcp-badge.png" alt="MseeP.ai Badge" />
</a><br/>

[![LobeHub MCP Badge](https://lobehub.com/badge/mcp/efforthye-fast-filesystem-mcp)](https://lobehub.com/mcp/efforthye-fast-filesystem-mcp)<br/>
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/eb4a3f2f-f985-4efb-8dc2-3d319cf9b361)<br/>

## Repository
https://github.com/efforthye/fast-filesystem-mcp
