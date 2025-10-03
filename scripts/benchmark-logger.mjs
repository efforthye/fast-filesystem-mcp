#!/usr/bin/env node

/**
 * Fast Filesystem MCP - Logger Benchmark Test
 * 
 * Comprehensive performance comparison between:
 * - Custom SafeMCPLogger (DEBUG=false)
 * - Custom SafeMCPLogger (DEBUG=true)
 * - Native console.log
 */

import { logger, SafeMCPLogger } from '../dist/logger/index.js';
import fs from 'fs';
import path from 'path';

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║         MCP Logger Performance Benchmark Test            ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Test configuration
const ITERATIONS = 100000;
const TEST_MESSAGE = 'This is a test log message with some data';
const TEST_DATA = { id: 123, name: 'test', values: [1, 2, 3, 4, 5] };

// Store original console methods before any modifications
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug
};

console.log(`📊 Test Configuration:`);
console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
console.log(`   Message: "${TEST_MESSAGE}"`);
console.log(`   Data: ${JSON.stringify(TEST_DATA)}\n`);

console.log('⏱️  Running benchmarks...\n');

// ====================
// Test 1: Native console.log (baseline)
// ====================
console.log('1️⃣  Testing native console.log (baseline)...');

// Temporarily suppress output for benchmarking
const originalStdoutWrite = process.stdout.write;
process.stdout.write = () => true;

const consoleStart = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  originalConsole.log(TEST_MESSAGE, TEST_DATA);
}
const consoleEnd = process.hrtime.bigint();
const consoleTime = Number(consoleEnd - consoleStart) / 1_000_000; // Convert to ms

// Restore stdout
process.stdout.write = originalStdoutWrite;

console.log(`   ✓ Completed in ${consoleTime.toFixed(2)}ms\n`);

// ====================
// Test 2: SafeMCPLogger with DEBUG=false
// ====================
console.log('2️⃣  Testing SafeMCPLogger (DEBUG=false)...');

process.env.DEBUG_MCP = 'false';
process.env.MCP_DEBUG = 'false';
delete process.env.MCP_LOG_FILE;

const loggerOff = new SafeMCPLogger();

const loggerOffStart = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  loggerOff.info(TEST_MESSAGE, TEST_DATA);
}
const loggerOffEnd = process.hrtime.bigint();
const loggerOffTime = Number(loggerOffEnd - loggerOffStart) / 1_000_000;

console.log(`   ✓ Completed in ${loggerOffTime.toFixed(2)}ms\n`);

// ====================
// Test 3: SafeMCPLogger with DEBUG=true (stderr output)
// ====================
console.log('3️⃣  Testing SafeMCPLogger (DEBUG=true)...');

process.env.DEBUG_MCP = 'true';
process.env.MCP_DEBUG = 'true';
delete process.env.MCP_LOG_FILE;

const loggerOn = new SafeMCPLogger();

// Suppress stderr output during benchmark
const originalStderrWrite = process.stderr.write;
process.stderr.write = () => true;

const loggerOnStart = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  loggerOn.info(TEST_MESSAGE, TEST_DATA);
}
const loggerOnEnd = process.hrtime.bigint();
const loggerOnTime = Number(loggerOnEnd - loggerOnStart) / 1_000_000;

// Restore stderr
process.stderr.write = originalStderrWrite;

console.log(`   ✓ Completed in ${loggerOnTime.toFixed(2)}ms\n`);

// ====================
// Test 4: SafeMCPLogger with file logging
// ====================
console.log('4️⃣  Testing SafeMCPLogger (File logging)...');

const logFile = './benchmark-test.log';
process.env.DEBUG_MCP = 'true';
process.env.MCP_LOG_FILE = logFile;

const loggerFile = new SafeMCPLogger();

const loggerFileStart = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  loggerFile.info(TEST_MESSAGE, TEST_DATA);
}
const loggerFileEnd = process.hrtime.bigint();
const loggerFileTime = Number(loggerFileEnd - loggerFileStart) / 1_000_000;

// Clean up log file
if (fs.existsSync(logFile)) {
  const fileSize = fs.statSync(logFile).size;
  console.log(`   ✓ Completed in ${loggerFileTime.toFixed(2)}ms`);
  console.log(`   📁 Log file size: ${(fileSize / 1024 / 1024).toFixed(2)}MB`);
  fs.unlinkSync(logFile);
} else {
  console.log(`   ✓ Completed in ${loggerFileTime.toFixed(2)}ms\n`);
}

console.log();

// ====================
// Results Analysis
// ====================
console.log('═══════════════════════════════════════════════════════════');
console.log('📊 BENCHMARK RESULTS');
console.log('═══════════════════════════════════════════════════════════\n');

// Raw times
console.log('⏱️  Execution Times:');
console.log(`   1. Console.log (baseline):     ${consoleTime.toFixed(2)}ms`);
console.log(`   2. Logger (DEBUG=false):        ${loggerOffTime.toFixed(2)}ms`);
console.log(`   3. Logger (DEBUG=true):         ${loggerOnTime.toFixed(2)}ms`);
console.log(`   4. Logger (File logging):       ${loggerFileTime.toFixed(2)}ms\n`);

// Performance comparison
console.log('🚀 Performance Comparison (vs console.log):');

const calcImprovement = (baseline, test) => {
  const improvement = ((baseline / test - 1) * 100);
  if (improvement > 0) {
    return `${improvement.toFixed(1)}% faster ✅`;
  } else {
    return `${Math.abs(improvement).toFixed(1)}% slower ⚠️`;
  }
};

console.log(`   Logger (DEBUG=false):  ${calcImprovement(consoleTime, loggerOffTime)}`);
console.log(`   Logger (DEBUG=true):   ${calcImprovement(consoleTime, loggerOnTime)}`);
console.log(`   Logger (File):         ${calcImprovement(consoleTime, loggerFileTime)}\n`);

// Operations per second
console.log('⚡ Operations per Second:');
const opsPerSec = (time) => Math.round(ITERATIONS / (time / 1000));

console.log(`   Console.log:           ${opsPerSec(consoleTime).toLocaleString()} ops/sec`);
console.log(`   Logger (DEBUG=false):  ${opsPerSec(loggerOffTime).toLocaleString()} ops/sec`);
console.log(`   Logger (DEBUG=true):   ${opsPerSec(loggerOnTime).toLocaleString()} ops/sec`);
console.log(`   Logger (File):         ${opsPerSec(loggerFileTime).toLocaleString()} ops/sec\n`);

// Time per operation (microseconds)
console.log('⏲️  Time per Operation:');
const timePerOp = (time) => ((time * 1000) / ITERATIONS).toFixed(3);

console.log(`   Console.log:           ${timePerOp(consoleTime)}μs`);
console.log(`   Logger (DEBUG=false):  ${timePerOp(loggerOffTime)}μs`);
console.log(`   Logger (DEBUG=true):   ${timePerOp(loggerOnTime)}μs`);
console.log(`   Logger (File):         ${timePerOp(loggerFileTime)}μs\n`);

// ====================
// Summary and Recommendations
// ====================
console.log('═══════════════════════════════════════════════════════════');
console.log('📝 SUMMARY & RECOMMENDATIONS');
console.log('═══════════════════════════════════════════════════════════\n');

const speedupFactor = (consoleTime / loggerOffTime).toFixed(1);

if (loggerOffTime < consoleTime) {
  console.log(`✅ SUCCESS: Custom logger with DEBUG=false is ${speedupFactor}x faster!`);
  console.log(`   • Saves ${(consoleTime - loggerOffTime).toFixed(2)}ms per ${ITERATIONS.toLocaleString()} operations`);
  console.log(`   • Perfect for production environments`);
} else {
  console.log(`⚠️  Custom logger has slight overhead, but provides safety benefits`);
}

console.log('\n💡 Recommendations:');
console.log('   1. Use DEBUG=false in production for maximum performance');
console.log('   2. Use DEBUG=true during development for debugging');
console.log('   3. Use file logging for persistent debug traces');
console.log('   4. Logger prevents JSON-RPC communication errors in MCP\n');

// Performance grade
const grade = loggerOffTime < consoleTime * 0.5 ? 'A+' : 
              loggerOffTime < consoleTime * 0.75 ? 'A' :
              loggerOffTime < consoleTime ? 'B' :
              loggerOffTime < consoleTime * 1.25 ? 'C' : 'D';

console.log(`🏆 Performance Grade: ${grade}`);

if (grade === 'A+') {
  console.log('   Exceptional performance optimization achieved!');
} else if (grade === 'A') {
  console.log('   Excellent performance optimization!');
} else if (grade === 'B') {
  console.log('   Good performance with safety benefits!');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('                    Test Complete!                          ');
console.log('═══════════════════════════════════════════════════════════');
