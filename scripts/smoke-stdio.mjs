// Minimal MCP stdio smoke test for --allow
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';

// Usage: node scripts/smoke-stdio.mjs --allow <dir> [--allow <dir2> ...]
// or: pnpm smoke -- --allow <dir>

const serverCmd = process.platform === 'win32' ? 'node' : 'node';
const serverArgs = ['node_modules/tsx/dist/cli.mjs', 'src/index.ts', ...process.argv.slice(2)];

const child = spawn(serverCmd, serverArgs, { stdio: 'pipe' });

const transport = new StdioClientTransport({
  command: serverCmd,
  args: serverArgs,
  // We reuse the spawned child by passing streams explicitly
  // but StdioClientTransport can also spawn for us; here we attach.
  stdio: {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
  }
});

const client = new Client(
  { name: 'smoke-client', version: '0.1.0' },
  { capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} } }
);

async function main() {
  await client.connect(transport);
  const tools = await client.listTools();
  const hasList = tools.tools.some(t => t.name === 'fast_list_allowed_directories');
  if (!hasList) throw new Error('Tool fast_list_allowed_directories not found');

  const res = await client.callTool({ name: 'fast_list_allowed_directories', arguments: {} });
  console.log('\nAllowed directories reported by server:\n');
  for (const c of res.content) {
    if (c.type === 'text') {
      console.log(c.text);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});

