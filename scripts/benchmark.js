#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Parse simple CLI flags
const args = process.argv.slice(2);
let iterations = 500;
let filter = undefined;
let json = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--iterations' || args[i] === '-i') {
    iterations = parseInt(args[++i], 10) || 500;
  } else if (args[i] === '--filter' || args[i] === '-f') {
    filter = args[++i];
  } else if (args[i] === '--json') {
    json = true;
  }
}

// Ensure dist is built
const benchmarkModulePath = path.resolve(__dirname, '../dist/benchmark/index.js');
if (!fs.existsSync(benchmarkModulePath)) {
  if (!json) {
    console.log('Compiling TypeScript sources before running benchmark...');
  }
  execSync('npm run build:fast', { stdio: json ? 'ignore' : 'inherit' });
}

const { runExecutionBenchmarks } = require('../dist/benchmark');

async function main() {
  if (!json) {
    console.log(`\n⚡ Running EntityTS Execution Benchmarks (${iterations} iterations per scenario)...\n`);
  }

  const results = await runExecutionBenchmarks({
    iterations,
    filter,
    silent: json,
  });

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  }
}

main().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
