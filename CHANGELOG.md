# Fast Filesystem MCP Changelog

## v2.7.0 - Configurable Backup System

### New Features
- **Configurable Backup System**: Control backup file creation via `CREATE_BACKUP_FILES` environment variable
- **Backup Control**: Set `CREATE_BACKUP_FILES=true` to enable backup file creation (default: false to reduce clutter)
- **Smart Backup Management**: Backup files only created when necessary and when enabled

### Configuration
```json
{
  "mcpServers": {
    "fast-filesystem": {
      "command": "npx",
      "args": ["-y", "fast-filesystem-mcp"],
      "env": {
        "CREATE_BACKUP_FILES": "false"
      }
    }
  }
}
```

### Key Changes
- All editing functions now respect the `ENABLE_BACKUP` setting
- Backup status included in response information
- Default behavior: backups enabled (set to `false` to disable)
- Enhanced server info includes backup configuration status

### Performance Improvements
- Reduced file system clutter when backups disabled
- Faster operations when backup creation is skipped
- Maintained data safety with configurable backup options

## v2.5.3 - Token Optimization and Large File Focus

### Token Usage Optimization
- **Simplified emoji guidelines**: Short English messages instead of verbose Korean
- **Reduced response size**: Removed unnecessary emoji detection details
- **Token savings**: Approximately 70% reduction in token usage per operation

### Key Changes
- Emoji guidelines now show simple "Emojis not recommended in files" message
- Removed detailed emoji position tracking and verbose recommendations
- Streamlined file info responses
- Updated README to focus on large file handling capabilities

### Performance Improvements
- Faster response processing due to smaller payloads
- Better cost efficiency for large-scale file operations
- Maintained all core functionality while reducing verbosity

## v2.5.2
- Universal emoji guidelines for all file types

## v2.5.1
- Smart emoji guideline system

## v2.5.0
- Checkpoint system and emoji removal features

## v2.4.1
- Basic filesystem functionality
- Large file streaming support
- Pagination support
- Claude optimizations
