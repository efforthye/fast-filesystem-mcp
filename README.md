# Fast Filesystem MCP

A powerful, Claude-optimized file system MCP (Model Context Protocol) server that provides comprehensive file and directory operations through a web API. Built with TypeScript and deployed on Vercel for easy access and high availability.

*This project was created by cloning and enhancing the [vercel-labs/mcp-on-vercel](https://github.com/vercel-labs/mcp-on-vercel) template.*

## ✨ Improvements Over Standard Filesystem MCPs

**vs. Basic MCP Implementations:**
- **Claude-Optimized Responses**: Automatic chunking and pagination to prevent response size limits
- **Smart Memory Management**: Efficient handling of large files without memory overflow  
- **Enhanced Error Recovery**: Clear error messages with actionable next steps
- **Security Hardening**: Comprehensive path validation and access control
- **Performance Optimization**: Intelligent caching and early termination for large operations

**vs. Python-based Solutions:**
- **Zero Installation**: No Python dependencies or virtual environments needed
- **Serverless Ready**: Native TypeScript deployment on Vercel with automatic scaling
- **Web-First Architecture**: RESTful API design for maximum compatibility
- **Better Integration**: Seamless NPX-based installation for Claude Desktop

## 🚀 Live Demo

**Production URL**: https://fast-filesystem-e2oo1zkp1-efforthyes-projects.vercel.app/api/server

## Features

🚀 **Claude Optimized**: Automatic response size limiting, chunking, and pagination  
📁 **File Operations**: Read, write, search, and manage files with intelligent streaming  
📂 **Directory Management**: List, create, and navigate directories with filtering  
🔍 **Smart Search**: Content and filename search with pattern matching  
🛡️ **Security**: Path validation and access control to prevent unauthorized access  
⚡ **Performance**: Efficient large file handling with memory optimization  
🌐 **Web API**: RESTful interface accessible from anywhere  

## Quick Start

### For Claude Desktop Users

1. **Add MCP Server**: Add this to your Claude Desktop configuration:

**Option 1: Use Public Server (Limited Access)**
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "https://fast-filesystem-e2oo1zkp1-efforthyes-projects.vercel.app/api/server"
      ]
    }
  }
}
```
⚠️ **Limitation**: Only `/tmp` and `/home` directories are accessible with the public server.

**Option 2: Run Local Server (Recommended)**
```bash
git clone https://github.com/efforthye/fast-filesystem-mcp.git
cd fast-filesystem-mcp
pnpm install
export ALLOWED_DIRECTORIES="/Users/username,/your/project/path"  # Set your paths
vercel dev
```

Then use this configuration:
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": [
        "@modelcontextprotocol/server-fetch",
        "http://localhost:3000/api/server"
      ]
    }
  }
}
```

2. **Restart Claude Desktop** and start using file system commands!

### Configuration Locations

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

## Available Tools

### Core File Operations

#### `read_file`
Read files with intelligent chunking and line-based access.
```
read_file(path: string, options?)
- start_offset: number - Starting byte position
- max_size: number - Maximum bytes to read
- line_start: number - Starting line number
- line_count: number - Number of lines to read
- encoding: string - Text encoding (default: utf-8)
```

#### `write_file`
Write or append content to files with automatic directory creation.
```
write_file(path: string, content: string, options?)
- encoding: string - Text encoding
- create_dirs: boolean - Auto-create directories
- append: boolean - Append mode
```

#### `list_directory`
List directory contents with pagination and filtering.
```
list_directory(path: string, options?)
- page: number - Page number (starts from 1)
- page_size: number - Items per page
- pattern: string - File name filter
- show_hidden: boolean - Show hidden files
- sort_by: "name" | "size" | "modified" | "type"
- reverse: boolean - Reverse sort order
```

### Advanced Operations

#### `search_files`
Search for files by name or content with pattern matching.
```
search_files(path: string, pattern: string, options?)
- content_search: boolean - Search file contents
- case_sensitive: boolean - Case sensitive search
- max_results: number - Maximum results
- file_extensions: string - Filter by extensions (comma-separated)
```

#### `get_file_info`
Get detailed information about files or directories.
```
get_file_info(path: string)
```

#### `create_directory`
Create directories with recursive support.
```
create_directory(path: string)
```

### Utility Tools

#### `list_allowed_directories`
Show configured access permissions and system limits.

## Usage Examples

### Reading a Large File in Chunks
```
"Read the first 1000 lines of /path/to/large-file.log"
→ Uses read_file with line_start=0, line_count=1000
```

### Searching for Code Files
```
"Find all Python files containing 'import pandas' in /project/src"
→ Uses search_files with content_search=true, file_extensions="py"
```

### Directory Analysis
```
"Show me the largest files in /project directory"
→ Uses list_directory with sort_by="size", reverse=true
```

## Security & Configuration

### Environment Variables

Set these in your Vercel deployment:

```bash
ALLOWED_DIRECTORIES="/home/user,/project,/tmp"  # Comma-separated allowed paths
REDIS_URL="your_redis_connection_string"        # Required for Vercel
```

### Access Control

- **Path Validation**: Only allowed directories are accessible
- **Automatic Sanitization**: Prevents path traversal attacks
- **Size Limits**: Automatic response limiting for Claude compatibility

### Default Allowed Directories

If no `ALLOWED_DIRECTORIES` is set:
- **Linux/macOS**: User home directory and `/tmp`
- **Windows**: User profile directory

## Claude Optimization Features

### Smart Response Limiting
- **Max Response**: 5MB per response
- **Chunk Size**: 2MB optimal chunks
- **Line Limits**: 2000 lines maximum per read
- **Directory Pagination**: 1000 items max per page

### Performance Features
- **Streaming**: Large file support with memory efficiency
- **Caching**: Intelligent caching for repeated operations
- **Early Termination**: Stops processing when limits reached

### User-Friendly Messages
- **Progress Indicators**: Shows when content is truncated
- **Helpful Suggestions**: Provides next steps for large operations
- **Error Recovery**: Clear error messages with resolution steps

## Development

### Local Development

```bash
# Clone and install
git clone https://github.com/efforthye/fast-filesystem-mcp.git
cd fast-filesystem-mcp
pnpm install

# Set environment variables
echo "ALLOWED_DIRECTORIES=/your/allowed/paths" > .env.local
echo "REDIS_URL=your_redis_url" >> .env.local

# Start development server
vercel dev

# Test endpoint
curl -X POST http://localhost:3000/api/server \
  -H "Content-Type: application/json" \
  -d '{"method": "list_allowed_directories", "params": {}}'
```

### Testing

Test with the included script:
```bash
node scripts/test-client.mjs http://localhost:3000
```

## API Reference

### HTTP Endpoints

All tools are accessible via POST requests to `/api/server`:

```bash
POST /api/server
Content-Type: application/json

{
  "method": "tool_name",
  "params": {
    "param1": "value1",
    "param2": "value2"
  }
}
```

### Response Format

```json
{
  "content": [
    {
      "type": "text",
      "text": "JSON response data"
    }
  ]
}
```

## Example Usage with Claude

Once configured, you can use natural language commands with Claude:

### File Reading Examples
- "Read the first 100 lines of my config file"
- "Show me the contents of package.json"
- "What's in the README file?"

### Directory Operations
- "List all files in my project directory"
- "Show me the largest files in Downloads"
- "Find all Python files in my code folder"

### File Search
- "Search for files containing 'TODO' in my project"
- "Find all JavaScript files with 'import React'"
- "List all .env files in my system"

### File Management
- "Create a new directory called 'backups'"
- "Write a simple Python script to hello.py"
- "Show me information about this large file"

## Troubleshooting

### Common Issues

**"Access denied to path"**
- Check `ALLOWED_DIRECTORIES` environment variable
- Ensure path is within allowed directories
- Use absolute paths when possible

**"File too large"**
- Use `read_file` with `max_size` parameter
- Read in chunks using `start_offset`
- Consider line-based reading for text files

**"Too many directory items"**
- Use pagination with `page` and `page_size`
- Apply filters with `pattern` parameter
- Sort by specific criteria to find relevant files

### Authentication Issues

If you encounter authentication prompts:
1. Ensure the MCP server is public (no authentication required)
2. Check Vercel deployment settings
3. Use the provided public URL in your Claude configuration

### Redis Connection Issues

Ensure Redis is properly configured in Vercel:
1. Go to Storage tab in Vercel dashboard
2. Add Redis database
3. Environment variable `REDIS_URL` should auto-populate

## Contributing

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/new-feature`
3. **Commit changes**: `git commit -m 'Add new feature'`
4. **Push to branch**: `git push origin feature/new-feature`
5. **Open Pull Request**

## Repository Structure

```
fast-filesystem-mcp/
├── api/
│   └── server.ts          # Main MCP server implementation
├── scripts/
│   └── test-client.mjs    # Test client for API endpoints
├── public/
├── package.json           # Dependencies and scripts
├── vercel.json           # Vercel deployment configuration
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## Support

- **Issues**: Report bugs on GitHub Issues
- **Documentation**: Check README and inline code comments
- **Community**: Join discussions in GitHub Discussions

## Live Demo

**Production URL**: https://fast-filesystem-e2oo1zkp1-efforthyes-projects.vercel.app/api/server  
**GitHub Repository**: https://github.com/efforthye/fast-filesystem-mcp  

---

Built with ❤️ for the Claude ecosystem. Fast, secure, and optimized for AI workflows.
