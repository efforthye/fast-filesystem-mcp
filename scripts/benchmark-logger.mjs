#!/usr/bin/env node

import { logger, SafeMCPLogger } from '../dist/logger/index.js';

console.log('=== MCP Logger Performance Benchmark ===\n');

// Test configuration
const ITERATIONS = 100000;
const TEST_MESSAGE = 'This is a test log message with some data';
const TEST_DATA = { id: 123, name: 'test', values: [1, 2, 3, 4, 5] };

// Test 1: Console logging (with console override disabled)
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

// Temporarily restore original console for benchmarking
console.log = originalConsole.log;
console.warn = originalConsole.warn;
console.error = originalConsole.error;

console.log(`Running ${ITERATIONS.toLocaleString()} iterations...\n`);

// Benchmark console.log
const consoleStart = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  // Redirect to /dev/null to measure pure overhead
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  console.log(TEST_MESSAGE, TEST_DATA);
  process.stdout.write = originalWrite;
}
const consoleEnd = process.hrtime.bigint();
const consoleTime = Number(consoleEnd - consoleStart) / 1_000_000; // Convert to ms

// Test 2: Logger with debug OFF
process.env.DEBUG_MCP = 'false';
const loggerOff = new SafeMCPLogger();

const loggerOffStart = process.hrtime.bigint();
for (let i = 0; i < ITERATIONS; i++) {
  loggerOff.info(TEST_MESSAGE, TEST_DATA);
}
const loggerOffEnd = process.hrtime.bigint();
const loggerOffTime = Number(loggerOffEnd - loggerOffStart) / 1_000_000;

// Test 3: Logger with debug ON (writing to stderr)
process.env.DEBUG_MCP = 'true';
const loggerOn = new SafeMCPLogger();

// Redirect stderr to /dev/null for fair comparison
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

// Results
console.log('=== Results ===\n');
console.log(`1. Console.log (baseline):     ${consoleTime.toFixed(2)}ms`);
console.log(`2. Logger (DEBUG=false):       ${loggerOffTime.toFixed(2)}ms`);
console.log(`3. Logger (DEBUG=true):        ${loggerOnTime.toFixed(2)}ms`);

console.log('\n=== Performance Comparison ===\n');

const speedupOff = ((consoleTime / loggerOffTime - 1) * 100).toFixed(1);
const speedupOn = ((consoleTime / loggerOnTime - 1) * 100).toFixed(1);

console.log(`Logger (DEBUG=false) is ${speedupOff}% ${parseFloat(speedupOff) > 0 ? 'faster' : 'slower'} than console.log`);
console.log(`Logger (DEBUG=true) is ${speedupOn}% ${parseFloat(speedupOn) > 0 ? 'faster' : 'slower'} than console.log`);

console.log('\n=== Operations per second ===\n');
console.log(`Console.log:            ${(ITERATIONS / (consoleTime / 1000)).toFixed(0).padStart(12)} ops/sec`);
console.log(`Logger (DEBUG=false):   ${(ITERATIONS / (loggerOffTime / 1000)).toFixed(0).padStart(12)} ops/sec`);
console.log(`Logger (DEBUG=true):    ${(ITERATIONS / (loggerOnTime / 1000)).toFixed(0).padStart(12)} ops/sec`);

console.log('\n=== Time per operation ===\n');
console.log(`Console.log:            ${((consoleTime * 1000) / ITERATIONS).toFixed(3)}μs`);
console.log(`Logger (DEBUG=false):   ${((loggerOffTime * 1000) / ITERATIONS).toFixed(3)}μs`);
console.log(`Logger (DEBUG=true):    ${((loggerOnTime * 1000) / ITERATIONS).toFixed(3)}μs`);

console.log('\n=== Summary ===');
if (parseFloat(speedupOff) > 0) {
  console.log(`✅ Custom logger with DEBUG=false provides significant performance improvement!`);
  console.log(`   Saves approximately ${(consoleTime - loggerOffTime).toFixed(2)}ms per ${ITERATIONS.toLocaleString()} operations`);
} else {
  console.log(`⚠️  Custom logger may have slight overhead, but provides safety benefits`);
}
