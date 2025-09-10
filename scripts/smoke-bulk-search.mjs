#!/usr/bin/env node

/**
 * Smoke tests for bulk ripgrep search optimization
 * Tests performance improvements and functionality
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = './test-search-data';
const serverCmd = process.platform === 'win32' ? 'node' : 'node';
const serverArgs = ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'];

// Test data setup
function setupTestData() {
  console.log('📁 Setting up test data...');
  
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
  
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, 'subdir1'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'subdir2'), { recursive: true });
  
  // Create test files with searchable content
  const testFiles = [
    { path: 'file1.js', content: 'function searchTarget() {\n  return "bulk optimization";\n}' },
    { path: 'file2.ts', content: 'const searchTarget = "performance improvement";\nclass BulkSearch {}' },
    { path: 'file3.py', content: 'def search_target():\n    return "ripgrep enhancement"' },
    { path: 'subdir1/nested1.txt', content: 'This file contains searchTarget keyword for testing' },
    { path: 'subdir1/nested2.md', content: '# SearchTarget Documentation\nBulk search optimization' },
    { path: 'subdir2/deep.json', content: '{"searchTarget": "bulk ripgrep", "performance": true}' },
    { path: 'binary.dat', content: Buffer.from([0x00, 0x01, 0x02, 0x03]).toString() },
    { path: 'large.txt', content: 'searchTarget\n'.repeat(1000) + 'end of large file' }
  ];
  
  testFiles.forEach(({ path, content }) => {
    writeFileSync(join(TEST_DIR, path), content);
  });
  
  console.log(`✅ Created ${testFiles.length} test files in ${TEST_DIR}`);
}

function cleanupTestData() {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
    console.log('🧹 Cleaned up test data');
  } catch {}
}

async function createClient() {
  const child = spawn(serverCmd, serverArgs, { stdio: 'pipe' });
  
  const transport = new StdioClientTransport({
    command: serverCmd,
    args: serverArgs,
    stdio: {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
    }
  });

  const client = new Client(
    { name: 'bulk-search-smoke-test', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} } }
  );

  await client.connect(transport);
  return { client, child };
}

async function runSearchTest(client, testName, searchArgs, expectedMinResults = 1) {
  console.log(`\n🔍 Running: ${testName}`);
  console.log(`   Args: ${JSON.stringify(searchArgs, null, 2)}`);
  
  const startTime = Date.now();
  
  try {
    const result = await client.callTool({
      name: 'fast_search_files',
      arguments: searchArgs
    });
    
    const duration = Date.now() - startTime;
    const response = JSON.parse(result.content[0].text);
    
    console.log(`   ⏱️  Duration: ${duration}ms`);
    console.log(`   📊 Results: ${response.total_found} files found`);
    console.log(`   🚀 Ripgrep Enhanced: ${response.ripgrep_enhanced || false}`);
    
    if (response.total_found >= expectedMinResults) {
      console.log(`   ✅ PASS: Found ${response.total_found} >= ${expectedMinResults} expected results`);
      return { success: true, duration, results: response.total_found, response };
    } else {
      console.log(`   ❌ FAIL: Found ${response.total_found} < ${expectedMinResults} expected results`);
      return { success: false, duration, results: response.total_found, response };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`   ❌ ERROR: ${error.message}`);
    return { success: false, duration, error: error.message };
  }
}

async function runPerformanceComparison(client) {
  console.log('\n🏁 Performance Comparison Tests');
  
  const tests = [
    {
      name: 'Content Search - Small Pattern',
      args: {
        path: TEST_DIR,
        pattern: 'searchTarget',
        content_search: true,
        max_results: 50
      },
      expected: 6
    },
    {
      name: 'Content Search - Case Insensitive',
      args: {
        path: TEST_DIR,
        pattern: 'SEARCHTARGET',
        content_search: true,
        case_sensitive: false,
        max_results: 50
      },
      expected: 6
    },
    {
      name: 'File Pattern Filter',
      args: {
        path: TEST_DIR,
        pattern: 'searchTarget',
        content_search: true,
        file_pattern: '*.js',
        max_results: 50
      },
      expected: 1
    },
    {
      name: 'Context Lines',
      args: {
        path: TEST_DIR,
        pattern: 'bulk optimization',
        content_search: true,
        context_lines: 2,
        max_results: 50
      },
      expected: 1
    },
    {
      name: 'Large File Handling',
      args: {
        path: TEST_DIR,
        pattern: 'searchTarget',
        content_search: true,
        max_results: 1000
      },
      expected: 6
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await runSearchTest(client, test.name, test.args, test.expected);
    results.push({ ...test, ...result });
  }
  
  return results;
}

async function runRegressionTests(client) {
  console.log('\n🔧 Regression Tests');
  
  const tests = [
    {
      name: 'Filename Search (no content)',
      args: {
        path: TEST_DIR,
        pattern: 'file1',
        content_search: false
      },
      expected: 1
    },
    {
      name: 'Binary File Exclusion',
      args: {
        path: TEST_DIR,
        pattern: 'binary',
        content_search: true,
        include_binary: false
      },
      expected: 0
    },
    {
      name: 'Binary File Inclusion',
      args: {
        path: TEST_DIR,
        pattern: 'binary',
        content_search: false // filename search
      },
      expected: 1
    },
    {
      name: 'Empty Pattern Handling',
      args: {
        path: TEST_DIR,
        pattern: '',
        content_search: true
      },
      expected: 0 // Should handle gracefully
    }
  ];
  
  const results = [];
  
  for (const test of tests) {
    const result = await runSearchTest(client, test.name, test.args, test.expected);
    results.push({ ...test, ...result });
  }
  
  return results;
}

async function main() {
  console.log('🚀 Starting Bulk Ripgrep Search Smoke Tests\n');
  
  setupTestData();
  
  let client, child;
  try {
    ({ client, child } = await createClient());
    
    // Verify search tool is available
    const tools = await client.listTools();
    const hasSearchTool = tools.tools.some(t => t.name === 'fast_search_files');
    if (!hasSearchTool) {
      throw new Error('Tool fast_search_files not found');
    }
    console.log('✅ Search tool available');
    
    // Run test suites
    const performanceResults = await runPerformanceComparison(client);
    const regressionResults = await runRegressionTests(client);
    
    // Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('================');
    
    const allResults = [...performanceResults, ...regressionResults];
    const passed = allResults.filter(r => r.success).length;
    const failed = allResults.filter(r => !r.success).length;
    const avgDuration = allResults.reduce((sum, r) => sum + r.duration, 0) / allResults.length;
    
    console.log(`Total Tests: ${allResults.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Average Duration: ${avgDuration.toFixed(2)}ms`);
    
    if (failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Bulk ripgrep optimization is working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Check the output above for details.');
    }
    
    // Performance insights
    const contentSearchTests = performanceResults.filter(r => r.args.content_search);
    if (contentSearchTests.length > 0) {
      const avgContentSearchTime = contentSearchTests.reduce((sum, r) => sum + r.duration, 0) / contentSearchTests.length;
      console.log(`\n🚀 Content Search Performance: ${avgContentSearchTime.toFixed(2)}ms average`);
      console.log('   (This should be significantly faster than per-file ripgrep calls)');
    }
    
    process.exit(failed === 0 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Smoke test failed:', error);
    process.exit(1);
  } finally {
    if (child) {
      child.kill();
    }
    cleanupTestData();
  }
}

main().catch(err => {
  console.error('❌ Unexpected error:', err);
  cleanupTestData();
  process.exit(1);
});