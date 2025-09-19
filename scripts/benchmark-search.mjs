#!/usr/bin/env node

/**
 * Performance benchmark for bulk ripgrep optimization
 * Compares search performance across different scenarios
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const BENCHMARK_DIR = './benchmark-data';
const serverCmd = process.platform === 'win32' ? 'node' : 'node';
const serverArgs = ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'];

function createBenchmarkData(fileCount = 100, contentSize = 'medium') {
  console.log(`📁 Creating benchmark data: ${fileCount} files, ${contentSize} content...`);
  
  try {
    rmSync(BENCHMARK_DIR, { recursive: true, force: true });
  } catch {}
  
  mkdirSync(BENCHMARK_DIR, { recursive: true });
  
  // Create nested directory structure
  for (let i = 0; i < Math.ceil(fileCount / 10); i++) {
    mkdirSync(join(BENCHMARK_DIR, `dir${i}`), { recursive: true });
  }
  
  const contentSizes = {
    small: 100,    // 100 lines
    medium: 1000,  // 1000 lines  
    large: 5000    // 5000 lines
  };
  
  const lines = contentSizes[contentSize] || contentSizes.medium;
  
  // Create files with varying content
  for (let i = 0; i < fileCount; i++) {
    const dirIndex = Math.floor(i / 10);
    const fileName = `file${i}.${['js', 'ts', 'py', 'txt', 'md'][i % 5]}`;
    const filePath = join(BENCHMARK_DIR, `dir${dirIndex}`, fileName);
    
    let content = '';
    for (let line = 0; line < lines; line++) {
      if (line % 50 === 0) {
        content += `searchTarget line ${line} in file ${i}\n`;
      } else if (line % 100 === 0) {
        content += `performance optimization test ${line}\n`;
      } else {
        content += `regular content line ${line} with some text\n`;
      }
    }
    
    writeFileSync(filePath, content);
  }
  
  console.log(`✅ Created ${fileCount} files with ~${lines} lines each`);
}

function cleanupBenchmarkData() {
  try {
    rmSync(BENCHMARK_DIR, { recursive: true, force: true });
    console.log('🧹 Cleaned up benchmark data');
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
    { name: 'benchmark-client', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {}, logging: {} } }
  );

  await client.connect(transport);
  return { client, child };
}

async function runBenchmark(client, name, searchArgs, iterations = 3) {
  console.log(`\n🏁 Benchmark: ${name}`);
  console.log(`   Iterations: ${iterations}`);
  
  const times = [];
  let totalResults = 0;
  
  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    
    try {
      const result = await client.callTool({
        name: 'fast_search_files',
        arguments: searchArgs
      });
      
      const duration = Date.now() - startTime;
      const response = JSON.parse(result.content[0].text);
      
      times.push(duration);
      totalResults = response.total_found;
      
      console.log(`   Run ${i + 1}: ${duration}ms (${response.total_found} results)`);
      
    } catch (error) {
      console.log(`   Run ${i + 1}: ERROR - ${error.message}`);
      return null;
    }
  }
  
  const avgTime = times.reduce((sum, time) => sum + time, 0) / times.length;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  
  console.log(`   📊 Average: ${avgTime.toFixed(2)}ms`);
  console.log(`   📊 Min: ${minTime}ms, Max: ${maxTime}ms`);
  console.log(`   📊 Results: ${totalResults} files found`);
  
  return {
    name,
    avgTime,
    minTime,
    maxTime,
    results: totalResults,
    times
  };
}

async function runBenchmarkSuite() {
  console.log('🚀 Starting Performance Benchmark Suite\n');
  
  const scenarios = [
    {
      name: 'Small Dataset (50 files)',
      fileCount: 50,
      contentSize: 'small'
    },
    {
      name: 'Medium Dataset (200 files)', 
      fileCount: 200,
      contentSize: 'medium'
    },
    {
      name: 'Large Dataset (500 files)',
      fileCount: 500,
      contentSize: 'medium'
    }
  ];
  
  const searchTests = [
    {
      name: 'Content Search - Common Pattern',
      args: {
        path: BENCHMARK_DIR,
        pattern: 'searchTarget',
        content_search: true,
        max_results: 1000
      }
    },
    {
      name: 'Content Search - Rare Pattern',
      args: {
        path: BENCHMARK_DIR,
        pattern: 'performance optimization',
        content_search: true,
        max_results: 1000
      }
    },
    {
      name: 'Filename Search',
      args: {
        path: BENCHMARK_DIR,
        pattern: 'file1',
        content_search: false,
        max_results: 1000
      }
    },
    {
      name: 'File Pattern Filter',
      args: {
        path: BENCHMARK_DIR,
        pattern: 'searchTarget',
        content_search: true,
        file_pattern: '*.js',
        max_results: 1000
      }
    }
  ];
  
  const allResults = [];
  
  for (const scenario of scenarios) {
    console.log(`\n🎯 Scenario: ${scenario.name}`);
    console.log('='.repeat(50));
    
    createBenchmarkData(scenario.fileCount, scenario.contentSize);
    
    let client, child;
    try {
      ({ client, child } = await createClient());
      
      for (const test of searchTests) {
        const result = await runBenchmark(client, test.name, test.args);
        if (result) {
          allResults.push({
            scenario: scenario.name,
            fileCount: scenario.fileCount,
            ...result
          });
        }
      }
      
    } catch (error) {
      console.error(`❌ Error in scenario ${scenario.name}:`, error);
    } finally {
      if (child) {
        child.kill();
      }
      cleanupBenchmarkData();
    }
  }
  
  return allResults;
}

function analyzeBenchmarkResults(results) {
  console.log('\n📈 BENCHMARK ANALYSIS');
  console.log('=====================');
  
  // Group by test type
  const byTestType = {};
  results.forEach(result => {
    if (!byTestType[result.name]) {
      byTestType[result.name] = [];
    }
    byTestType[result.name].push(result);
  });
  
  // Analyze scaling
  Object.keys(byTestType).forEach(testType => {
    console.log(`\n🔍 ${testType}:`);
    
    const testResults = byTestType[testType].sort((a, b) => a.fileCount - b.fileCount);
    
    testResults.forEach(result => {
      const throughput = result.fileCount / (result.avgTime / 1000); // files per second
      console.log(`   ${result.fileCount} files: ${result.avgTime.toFixed(2)}ms (${throughput.toFixed(0)} files/sec)`);
    });
    
    // Calculate scaling factor
    if (testResults.length >= 2) {
      const small = testResults[0];
      const large = testResults[testResults.length - 1];
      const scaleFactor = (large.avgTime / small.avgTime) / (large.fileCount / small.fileCount);
      
      console.log(`   📊 Scaling: ${scaleFactor.toFixed(2)}x (1.0 = linear, <1.0 = sublinear)`);
      
      if (scaleFactor < 1.2) {
        console.log('   ✅ Excellent scaling - bulk optimization working well!');
      } else if (scaleFactor < 2.0) {
        console.log('   👍 Good scaling - optimization providing benefits');
      } else {
        console.log('   ⚠️  Poor scaling - may need further optimization');
      }
    }
  });
  
  // Overall performance summary
  const contentSearchResults = results.filter(r => r.name.includes('Content Search'));
  if (contentSearchResults.length > 0) {
    const avgContentSearchTime = contentSearchResults.reduce((sum, r) => sum + r.avgTime, 0) / contentSearchResults.length;
    const avgThroughput = contentSearchResults.reduce((sum, r) => sum + (r.fileCount / (r.avgTime / 1000)), 0) / contentSearchResults.length;
    
    console.log('\n🚀 PERFORMANCE SUMMARY:');
    console.log(`   Average content search time: ${avgContentSearchTime.toFixed(2)}ms`);
    console.log(`   Average throughput: ${avgThroughput.toFixed(0)} files/second`);
    
    if (avgThroughput > 100) {
      console.log('   🎉 Excellent performance! Bulk optimization is highly effective.');
    } else if (avgThroughput > 50) {
      console.log('   👍 Good performance! Bulk optimization is working well.');
    } else {
      console.log('   ⚠️  Performance could be improved. Consider further optimization.');
    }
  }
}

async function main() {
  try {
    const results = await runBenchmarkSuite();
    
    if (results.length > 0) {
      analyzeBenchmarkResults(results);
      
      console.log('\n✅ Benchmark completed successfully!');
      console.log('💡 Use these results to validate your bulk ripgrep optimization performance.');
    } else {
      console.log('\n❌ No benchmark results collected.');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  } finally {
    cleanupBenchmarkData();
  }
}

main();