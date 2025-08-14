# Deployment Guide

This document outlines the process for updating and deploying new versions of the fast-filesystem-mcp package to npm.

## Prerequisites

- npm account with publishing permissions
- Local development environment set up
- Git repository access

## Deployment Process

### 1. Version Update

Update the version number in `package.json`:

```bash
# Manual version update in package.json
# Change "version": "2.1.4" to "2.1.5" (or desired version)

# Or use npm commands:
npm version patch  # 2.1.4 → 2.1.5 (bug fixes)
npm version minor  # 2.1.4 → 2.2.0 (new features)
npm version major  # 2.1.4 → 3.0.0 (breaking changes)
```

### 2. Commit and Push Changes

```bash
cd /Users/cryptotax/Desktop/programs/personal/mcp/fast-filesystem-mcp

# Stage all changes
git add .

# Commit with descriptive message
git commit -m "Update to v2.1.5 - describe changes here"

# Push to GitHub
git push origin main
```

### 3. Build and Deploy

```bash
# Build TypeScript to JavaScript
npm run build

# Publish to npm
npm publish
```

### 4. One-liner Deployment (Recommended)

For quick updates, use this single command:

```bash
cd /Users/cryptotax/Desktop/programs/personal/mcp/fast-filesystem-mcp && npm run build && npm publish
```

## Version Numbering Guidelines

Follow semantic versioning (semver):

- **Patch** (x.y.Z): Bug fixes, small improvements
- **Minor** (x.Y.z): New features, backward compatible
- **Major** (X.y.z): Breaking changes, API changes

## Verification

After deployment, verify the update:

1. Check npm registry: https://www.npmjs.com/package/fast-filesystem-mcp
2. Test installation: `npx -y fast-filesystem-mcp`
3. Verify in Claude Desktop with npx configuration

## Troubleshooting

### Common Issues

1. **Authentication Error**
   ```bash
   npm login
   # Follow the browser authentication process
   ```

2. **Build Errors**
   ```bash
   # Clean and rebuild
   rm -rf dist/
   npm run build
   ```

3. **Version Already Exists**
   - Update version number in package.json
   - Commit and try again

### Publishing Checklist

- [ ] Version number updated
- [ ] Changes committed and pushed to GitHub
- [ ] TypeScript compiled successfully
- [ ] No build errors
- [ ] npm login completed
- [ ] Package published successfully
- [ ] Deployment verified on npm registry

## Notes

- The package uses TypeScript and compiles to `index.js`
- Binary executable is defined in package.json `bin` field
- Users install via `npx -y fast-filesystem-mcp` (no global installation needed)
- Vercel deployment is disabled - this is a local-only MCP server