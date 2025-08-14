#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
const execAsync = promisify(exec);
// Claude 최적화 설정
const CLAUDE_MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const CLAUDE_MAX_CHUNK_SIZE = 2 * 1024 * 1024;
const CLAUDE_MAX_LINES = 2000;
const CLAUDE_MAX_DIR_ITEMS = 1000;
// 기본 허용 디렉토리들
const DEFAULT_ALLOWED_DIRECTORIES = [
    process.env.HOME || '/home',
    '/tmp',
    '/Users',
    '/home'
];
// 기본 제외 패턴 (보안 및 성능)
const DEFAULT_EXCLUDE_PATTERNS = [
    '.venv', 'venv', 'node_modules', '.git', '.svn', '.hg',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.coverage',
    'dist', 'build', 'target', 'bin', 'obj', '.vs', '.vscode',
    '*.pyc', '*.pyo', '*.pyd', '.DS_Store', 'Thumbs.db'
];
// 유틸리티 함수들
function isPathAllowed(targetPath) {
    const absolutePath = path.resolve(targetPath);
    return DEFAULT_ALLOWED_DIRECTORIES.some(allowedDir => absolutePath.startsWith(path.resolve(allowedDir)));
}
function safePath(inputPath) {
    if (!isPathAllowed(inputPath)) {
        throw new Error(`Access denied to path: ${inputPath}`);
    }
    return path.resolve(inputPath);
}
function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}
function shouldExcludePath(targetPath, excludePatterns = []) {
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
function truncateContent(content, maxSize = CLAUDE_MAX_RESPONSE_SIZE) {
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
function calculateFileHash(filePath, algorithm = 'sha256') {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash(algorithm);
        const stream = require('fs').createReadStream(filePath);
        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}
function generateDiff(original, modified, filename = "file") {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    const diff = [`--- a/${filename}`, `+++ b/${filename}`];
    let originalIndex = 0;
    let modifiedIndex = 0;
    while (originalIndex < originalLines.length || modifiedIndex < modifiedLines.length) {
        if (originalIndex < originalLines.length && modifiedIndex < modifiedLines.length) {
            if (originalLines[originalIndex] === modifiedLines[modifiedIndex]) {
                originalIndex++;
                modifiedIndex++;
                continue;
            }
        }
        if (originalIndex < originalLines.length) {
            diff.push(`-${originalLines[originalIndex]}`);
            originalIndex++;
        }
        if (modifiedIndex < modifiedLines.length) {
            diff.push(`+${modifiedLines[modifiedIndex]}`);
            modifiedIndex++;
        }
    }
    return diff.join('\n');
}
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.md': 'text/markdown'
    };
    return mimeTypes[ext] || 'application/octet-stream';
}
async function copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        }
        else {
            await fs.copyFile(srcPath, destPath);
        }
    }
}
// MCP 서버 생성
const server = new Server({
    name: 'fast-filesystem',
    version: '2.2.1',
}, {
    capabilities: {
        tools: {},
    },
});
// 서버 시작
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Fast Filesystem MCP Server running on stdio');
}
main().catch((error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
});
//# sourceMappingURL=minimal.js.map