# npm run version:patch
# ./scripts/publish-both.sh

#!/bin/bash
# Two-registry publishing script
echo "Publishing to both npm and GitHub Packages..."

# Save original package.json
cp package.json package.json.backup

# Publish to npm.js (original name)
echo "Publishing to npm.js as 'fast-filesystem-mcp'..."
npm run build && npm publish --registry=https://registry.npmjs.org

# Create GitHub version (with scope)
echo "Publishing to GitHub Packages as '@efforthye/fast-filesystem-mcp'..."
sed 's/"fast-filesystem-mcp"/"@efforthye\/fast-filesystem-mcp"/g' package.json > package-github.json
cp package-github.json package.json
npm run build && npm publish --registry=https://npm.pkg.github.com

# Restore original version  
cp package.json.backup package.json

# Cleanup
rm package.json.backup package-github.json

echo "Published to both registries!"
