import { promises as fs } from 'fs';
import { realpathSync, statSync } from 'fs';
import path from 'path';

// 상수들
// Align defaults with original author intent: HOME, /tmp, user roots.
export const DEFAULT_ALLOWED_DIRECTORIES = (() => {
  const list: string[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '/home';
  list.push(home);
  list.push('/tmp');
  if (process.platform === 'win32') {
    // Broad user root for Windows
    list.push('C:/Users');
  } else {
    list.push('/Users', '/home');
  }
  // Dedupe and normalize
  return Array.from(new Set(list.map(p => path.resolve(p))));
})();
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
// Runtime-managed allowed directories (start with defaults)
const allowedDirSet: Set<string> = new Set(
  DEFAULT_ALLOWED_DIRECTORIES.map(p => path.resolve(p))
);

export function getAllowedDirectories(): string[] {
  return Array.from(allowedDirSet);
}

export function addAllowedDirectories(paths: string[]): { added: string[]; skipped: { path: string; reason: string }[]; current: string[] } {
  const added: string[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const p of paths) {
    try {
      const candidate = path.isAbsolute(p) ? p : path.resolve(p);
      const real = realpathSync(candidate);
      const st = statSync(real);
      if (!st.isDirectory()) {
        skipped.push({ path: p, reason: 'not_a_directory' });
        continue;
      }
      const resolved = path.resolve(real);
      if (!allowedDirSet.has(resolved)) {
        allowedDirSet.add(resolved);
        added.push(resolved);
      }
    } catch {
      skipped.push({ path: p, reason: 'invalid_or_inaccessible' });
    }
  }

  return { added, skipped, current: Array.from(allowedDirSet) };
}

export function isPathAllowed(targetPath: string): boolean {
  const absolutePath = path.resolve(targetPath);
  for (const allowedDir of allowedDirSet) {
    if (absolutePath.startsWith(path.resolve(allowedDir))) return true;
  }
  return false;
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
