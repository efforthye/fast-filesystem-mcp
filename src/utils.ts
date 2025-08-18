import { promises as fs } from 'fs';
import path from 'path';

// 상수들
export const DEFAULT_ALLOWED_DIRECTORIES = ['/tmp', process.cwd()];
export const DEFAULT_EXCLUDE_PATTERNS = [
  '.venv', 'venv', 'node_modules', '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.coverage',
  'dist', 'build', 'target', 'bin', 'obj', '.vs', '.vscode',
  'Thumbs.db', '.DS_Store', '*.tmp', '*.temp', '*.log',
  '.env', '.env.local', '.env.production', 'package-lock.json', 'yarn.lock'
];

export const CLAUDE_MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB
export const CLAUDE_MAX_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
export const CLAUDE_MAX_LINES = 2000;
export const CLAUDE_MAX_DIR_ITEMS = 1000;

// 유틸리티 함수들
export function isPathAllowed(targetPath: string): boolean {
  const absolutePath = path.resolve(targetPath);
  return DEFAULT_ALLOWED_DIRECTORIES.some(allowedDir => 
    absolutePath.startsWith(path.resolve(allowedDir))
  );
}

export function safePath(inputPath: string): string {
  if (!isPathAllowed(inputPath)) {
    throw new Error(`Access denied to path: ${inputPath}`);
  }
  return path.resolve(inputPath);
}

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

export function shouldExcludePath(targetPath: string, excludePatterns: string[] = []): boolean {
  const patterns = [...DEFAULT_EXCLUDE_PATTERNS, ...excludePatterns];
  const pathName = path.basename(targetPath).toLowerCase();
  const pathParts = targetPath.split(path.sep);
  
  return patterns.some(pattern => {
    const patternLower = pattern.toLowerCase();
    
    if (pattern.includes('*') || pattern.includes('?')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
      return regex.test(pathName);
    }
    
    return pathParts.some(part => part.toLowerCase() === patternLower) || 
           pathName === patternLower;
  });
}

export function truncateContent(content: string, maxSize: number = CLAUDE_MAX_RESPONSE_SIZE) {
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxSize) {
    return { content, truncated: false };
  }
  
  let truncated = content;
  while (Buffer.byteLength(truncated, 'utf8') > maxSize) {
    truncated = truncated.slice(0, -1);
  }
  
  return {
    content: truncated,
    truncated: true,
    original_size: contentBytes,
    truncated_size: Buffer.byteLength(truncated, 'utf8')
  };
}
