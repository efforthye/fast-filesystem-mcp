# Fast Filesystem MCP Changelog

## v3.4.0 - Tool Optimization & Windows Support Enhancement

### 🗑️ Deprecated Tool Removal
- **Removed fast_edit_file**: Deprecated legacy editing tool has been completely removed
  - This tool was causing conflicts and performance issues
  - All editing functionality now handled by more robust alternatives:
    - `fast_edit_block` - Precise block editing with safety checks
    - `fast_safe_edit` - Smart editing with risk detection
    - `fast_edit_multiple_blocks` - Multi-block editing
    - `fast_edit_blocks` - Batch editing operations

### 🪟 Windows Support Enhancement
- **Improved Windows compatibility**: Enhanced cross-platform file operations
- **Better path handling**: Improved Windows path normalization and handling
- **Enhanced system integration**: Better integration with Windows filesystem features

### 👥 Contributors
- **New contributor**: @sting8k - Windows support improvements and tool optimization

### 🔧 Technical Improvements
- **Cleaner codebase**: Removed redundant and problematic code
- **Better maintainability**: Simplified tool hierarchy reduces maintenance overhead
- **Improved performance**: Elimination of conflicting tools improves overall performance

### 🛠️ Migration Guide
If you were using `fast_edit_file`, please migrate to:
- For simple edits: Use `fast_edit_block` 
- For multiple edits: Use `fast_edit_blocks`
- For safer edits: Use `fast_safe_edit`

### 📋 Full Feature Set
All other functionality remains unchanged:
- File reading/writing with auto-chunking
- Directory operations and tree navigation
- Advanced search capabilities (ripgrep integration)
- Complex file operations (copy, move, delete, batch)
- Archive management (compress/extract)
- Directory synchronization
- Large file streaming support

---

# Changelog

## v3.1.0 - Advanced File Operations & Complex File Tasks

### Major New Features - Complex File Operations

#### **File Management Operations**
- **fast_copy_file**: Copy files and directories with advanced options
  - Recursive directory copying
  - Timestamp preservation
  - Overwrite protection
  - Automatic directory creation

- **fast_move_file**: Move/rename files and directories
  - Cross-device move support (copy + delete fallback)
  - Backup creation before overwrite
  - Directory creation
  - Safe overwrite handling

- **fast_delete_file**: Safe file and directory deletion
  - Protection against system directories
  - Confirmation requirements with force override
  - Recursive directory deletion
  - Backup before deletion option

#### **Batch Operations**
- **fast_batch_file_operations**: Execute multiple file operations in sequence
  - Support for copy, move, delete, rename operations
  - Dry-run mode for operation preview
  - Stop-on-error or continue-on-error modes
  - Comprehensive backup system
  - Detailed operation results

#### **Archive Management**
- **fast_compress_files**: Create compressed archives
  - Support for tar, tar.gz, tar.bz2 formats
  - Configurable compression levels
  - Exclude patterns for selective compression
  - Multiple file/directory input support

- **fast_extract_archive**: Extract compressed archives
  - Automatic format detection
  - Selective file extraction
  - Overwrite protection
  - Permission preservation

#### **Directory Synchronization**
- **fast_sync_directories**: Advanced directory synchronization
  - Multiple sync modes: mirror, update, merge
  - Preserve newer files option
  - Delete extra files option
  - Exclude patterns support
  - Dry-run capability

### 🔧 Enhanced Features
- **Cross-platform compatibility**: All operations work on Windows, macOS, and Linux
- **Safety mechanisms**: Multiple confirmation layers and backup systems
- **Performance optimization**: Efficient handling of large file operations
- **Error recovery**: Comprehensive error handling with rollback capabilities
- **Detailed reporting**: Comprehensive operation summaries and results

### 📋 Usage Examples

#### Batch File Operations
```typescript
await fast_batch_file_operations({
  operations: [
    { operation: "copy", source: "/src/file1.txt", destination: "/dest/file1.txt" },
    { operation: "move", source: "/temp/file2.txt", destination: "/archive/file2.txt" },
    { operation: "delete", source: "/tmp/old_file.txt" }
  ],
  dry_run: false,
  create_backup: true,
  stop_on_error: true
});
```

#### Directory Synchronization
```typescript
await fast_sync_directories({
  source_dir: "/source/project",
  target_dir: "/backup/project",
  sync_mode: "update",
  delete_extra: false,
  preserve_newer: true,
  exclude_patterns: [".git", "node_modules", "*.log"]
});
```

#### File Compression
```typescript
await fast_compress_files({
  paths: ["/project/src", "/project/docs"],
  output_path: "/backups/project_backup.tar.gz",
  format: "tar.gz",
  compression_level: 6,
  exclude_patterns: ["*.log", "node_modules", ".git"]
});
```

### 🛡️ Safety & Security
- **System directory protection**: Prevents accidental deletion of critical paths
- **Backup integration**: Configurable backup creation before destructive operations
- **Force confirmation**: Explicit confirmation required for dangerous operations
- **Path validation**: Comprehensive path safety checks
- **Error recovery**: Automatic rollback on operation failures

### 🎯 Performance Improvements
- **Streaming operations**: Large file handling with memory efficiency
- **Parallel processing**: Batch operations with optimal resource usage
- **Cross-device optimization**: Intelligent handling of cross-filesystem operations
- **Progress tracking**: Detailed operation progress and timing information

### 📦 Updated Dependencies
- Enhanced error handling throughout all operations
- Improved logging and debugging capabilities
- Better integration with system tools (tar, etc.)

### 🔄 Breaking Changes
- None - All existing functionality remains fully compatible

### 📈 What This Solves
This update directly addresses the feedback about "복잡한 파일 작업" (complex file operations) by providing:
1. **파일 이동, 복사 등의 고급 작업** - Full support for advanced file operations
2. **여러 파일 일괄 처리 기능** - Comprehensive batch processing capabilities
3. **Archive management** - Complete compression and extraction support
4. **Directory synchronization** - Advanced sync capabilities

### 🏆 Benefits
- **Productivity**: Handle complex file operations without switching tools
- **Safety**: Multiple safety layers prevent data loss
- **Efficiency**: Batch operations reduce overhead and improve performance
- **Flexibility**: Configurable options for different use cases
- **Reliability**: Comprehensive error handling and recovery mechanisms

---

## v2.8.0 - Batch Block Editing

### New Features
- **fast_edit_blocks**: New tool for efficient batch block editing
- **Multiple precise edits**: Process multiple `fast_edit_block` operations in a single call
- **Safety-first approach**: Each edit validates expected replacements before applying changes
- **Performance optimization**: Significantly faster than sequential `fast_edit_block` calls

### Usage Example
```typescript
await fast_edit_blocks({
  path: "/path/to/file.ts",
  edits: [
    {
      old_text: "// old comment 1",
      new_text: "// new comment 1",
      expected_replacements: 1
    },
    {
      old_text: "function oldName()",
      new_text: "function newName()",
      expected_replacements: 1
    }
  ],
  backup: true
});
```

### Key Benefits
- **Speed**: Process multiple edits in one operation instead of multiple calls
- **Safety**: Each edit includes safety checks and expected replacement counts
- **Efficiency**: Reduced overhead for large-scale code refactoring
- **Reliability**: Maintains backup and error recovery features

### Technical Details
- Sequential processing ensures each edit applies to the current state
- Detailed edit results with success/failure status for each operation
- Maintains all safety features of `fast_edit_block`
- Backward compatible with existing tools

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
