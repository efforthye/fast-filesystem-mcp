# Fast Filesystem MCP
A high-performance Model Context Protocol (MCP) server that provides secure filesystem access for Claude and other AI assistants. Built with TypeScript and optimized for Claude's token limits and performance requirements. Also, This project is based on the vercel-labs/mcp-on-vercel template.

## Live Demo
- Production Deployment: https://fast.filesystem.mayo.im/api/server
- GitHub Repository: https://github.com/efforthye/fast-filesystem-mcp

## Quick Setup
### Option 1: Full System Access (Default)
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://fast.filesystem.mayo.im/api/server"
      ]
    }
  }
}
```
- Access: Home directory, /tmp, /Users, /home, current working directory

### Option 2: Restricted Access (Recommended)
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://fast.filesystem.mayo.im/api/server",
        "/Users/username/Documents",
        "/Users/username/projects"
      ]
    }
  }
}
```
- Access: Only the specified directories

## Configuration
### macOS Setup
1. Open: ~/Library/Application Support/Claude/claude_desktop_config.json
2. Add the configuration above
3. Replace "/Users/username" with your actual username
4. Restart Claude Desktop

### Windows Setup
1. Open: %APPDATA%\Claude\claude_desktop_config.json
2. Add the configuration above
3. Replace paths with Windows paths (e.g., "C:\\Users\\username\\Documents")
4. Restart Claude Desktop

## Usage Examples
Once configured, you can use natural language commands in Claude Desktop
- "Show me the allowed directories"
- "List files in my Documents folder"
- "Read the first 50 lines of README.md"
- "Search for Python files in my projects"
- "Create a new directory called 'new-project'"
- "Find all files containing 'TODO' in my code"

## Features
### Core Functionality
- File reading with chunking support
- Directory listing with pagination
- File and content search
- File writing and directory creation
- File metadata and statistics

### Claude Optimizations
- Response size limits (5MB max)
- Automatic chunking for large files
- Pagination for large directories
- Line-based reading for text files
- Early truncation warnings

### Security Features
- Path validation and access control
- Configurable allowed directories
- Protection against directory traversal
- Safe file operations only

## Improvements Over Other Filesystem MCPs
### Performance Optimizations
- Built specifically for Claude's token limits
- Automatic content chunking and pagination
- Memory-efficient file reading
- Optimized for large directory structures

### Enhanced Security
- Client-side directory restrictions
- Server-side path validation
- Protection against unauthorized access
- Safe defaults for system-wide access

### Better Error Handling
- Detailed error messages with context
- Graceful handling of permission issues
- Clear feedback for oversized operations
- Helpful suggestions for large files/directories

## API Reference
### Available Tools
`list_allowed_directories`
- Shows currently accessible directories
- Displays Claude optimization limits
- No parameters required

`read_file`
- path: File path to read
- start_offset: Starting byte position (optional)
- max_size: Maximum bytes to read (optional)
- line_start: Starting line number (optional)
- line_count: Number of lines to read (optional)
- encoding: Text encoding (default: utf-8)

`list_directory`
- path: Directory path to list
- page: Page number (default: 1)
- page_size: Items per page (optional)
- pattern: Filename filter pattern (optional)
- show_hidden: Show hidden files (default: false)
- sort_by: Sort order (name|size|modified|type)
- reverse: Reverse sort order (default: false)

`write_file`
- path: File path to write
- content: File content
- encoding: Text encoding (default: utf-8)
- create_dirs: Create directories if needed (default: true)
- append: Append mode (default: false)

`search_files`
- path: Directory to search in
- pattern: Search pattern
- content_search: Search file contents (default: false)
- case_sensitive: Case sensitive search (default: false)
- max_results: Maximum results (optional)
- file_extensions: File type filter (optional)

`get_file_info`
- path: File or directory path
- Returns detailed metadata and recommendations

`create_directory`
- path: Directory path to create
- Creates parent directories automatically

## Troubleshooting
### Claude Desktop Not Connecting
1. Verify the config file location and format
2. Restart Claude Desktop completely
3. Check that the URL is accessible

### Access Denied Errors
1. Verify paths are within allowed directories
2. Check file/directory permissions
3. Use absolute paths instead of relative paths

### Performance Issues
1. Use pagination for large directories
2. Limit file read sizes for large files
3. Use search filters to reduce result sets

## Contributing
1. Fork the repository
2. Create feature branch: git checkout -b feature/new-feature
3. Commit changes: git commit -m 'Add new feature'
4. Push to branch: git push origin feature/new-feature
5. Open Pull Request

## Support
For issues or questions, please open an issue on the GitHub repository.
