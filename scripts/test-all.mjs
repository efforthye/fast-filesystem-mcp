#!/usr/bin/env node

/**
 * Comprehensive test runner for bulk ripgrep optimization
 * Runs all tests and provides a complete validation report
 */

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(spawn);

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`🔧 Running: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

async function runTestSuite(name, command, args = []) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 ${name}`);
  console.log(`${'='.repeat(60)}`);
  
  const startTime = Date.now();
  
  try {
    await runCommand(command, args);
    const duration = Date.now() - startTime;
    console.log(`\n✅ ${name} completed successfully in ${duration}ms`);
    return { name, success: true, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`\n❌ ${name} failed: ${error.message}`);
    return { name, success: false, duration, error: error.message };
  }
}

async function checkPrerequisites() {
  console.log('🔍 Checking prerequisites...');
  
  const checks = [
    { name: 'Node.js', command: 'node', args: ['--version'] },
    { name: 'npm', command: 'npm', args: ['--version'] },
    { name: 'TypeScript build', command: 'npm', args: ['run', 'build'] }
  ];
  
  for (const check of checks) {
    try {
      await runCommand(check.command, check.args, { stdio: 'pipe' });
      console.log(`   ✅ ${check.name}: Available`);
    } catch (error) {
      console.log(`   ❌ ${check.name}: Not available - ${error.message}`);
      throw new Error(`Prerequisite ${check.name} not met`);
    }
  }
  
  console.log('✅ All prerequisites met');
}

async function main() {
  console.log('🚀 Comprehensive Test Suite for Bulk Ripgrep Optimization');
  console.log('=========================================================\n');
  
  try {
    // Check prerequisites
    await checkPrerequisites();
    
    // Define test suites
    const testSuites = [
      {
        name: 'Unit Tests (Logic Validation)',
        command: 'node',
        args: ['scripts/test-bulk-optimization.mjs']
      },
      {
        name: 'Smoke Tests (Functional Validation)',
        command: 'node', 
        args: ['scripts/smoke-bulk-search.mjs']
      },
      {
        name: 'Performance Benchmark',
        command: 'node',
        args: ['scripts/benchmark-search.mjs']
      },
      {
        name: 'Original Smoke Test (Regression)',
        command: 'node',
        args: ['scripts/smoke-stdio.mjs', '--allow', '.']
      }
    ];
    
    // Run all test suites
    const results = [];
    
    for (const suite of testSuites) {
      const result = await runTestSuite(suite.name, suite.command, suite.args);
      results.push(result);
    }
    
    // Generate comprehensive report
    console.log('\n' + '='.repeat(80));
    console.log('📊 COMPREHENSIVE TEST REPORT');
    console.log('='.repeat(80));
    
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`   Total Test Suites: ${results.length}`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏱️  Total Time: ${totalTime}ms`);
    
    console.log(`\n📋 DETAILED RESULTS:`);
    results.forEach(result => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${status} ${result.name} (${result.duration}ms)`);
      if (result.error) {
        console.log(`      Error: ${result.error}`);
      }
    });
    
    // Validation summary
    console.log(`\n🎯 VALIDATION STATUS:`);
    
    const unitTestsPassed = results.find(r => r.name.includes('Unit Tests'))?.success;
    const smokeTestsPassed = results.find(r => r.name.includes('Smoke Tests'))?.success;
    const benchmarkPassed = results.find(r => r.name.includes('Benchmark'))?.success;
    const regressionPassed = results.find(r => r.name.includes('Regression'))?.success;
    
    console.log(`   🧪 Logic Validation: ${unitTestsPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   🔧 Functional Validation: ${smokeTestsPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   🚀 Performance Validation: ${benchmarkPassed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   🔄 Regression Validation: ${regressionPassed ? '✅ PASS' : '❌ FAIL'}`);
    
    // Final verdict
    if (failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED!');
      console.log('✨ Your bulk ripgrep optimization is ready for production!');
      console.log('\n💡 Next steps:');
      console.log('   1. Push your feature branch');
      console.log('   2. Create a Pull Request');
      console.log('   3. Include these test results in your PR description');
    } else {
      console.log('\n⚠️  SOME TESTS FAILED');
      console.log('🔧 Please review the failed tests and fix issues before proceeding.');
      console.log('\n💡 Debugging tips:');
      console.log('   1. Check the detailed error messages above');
      console.log('   2. Run individual test suites for more details');
      console.log('   3. Verify your implementation matches the expected behavior');
    }
    
    process.exit(failed === 0 ? 0 : 1);
    
  } catch (error) {
    console.error('\n❌ Test suite setup failed:', error.message);
    console.log('\n🔧 Please ensure:');
    console.log('   1. All dependencies are installed (npm install)');
    console.log('   2. Project builds successfully (npm run build)');
    console.log('   3. You are in the project root directory');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});