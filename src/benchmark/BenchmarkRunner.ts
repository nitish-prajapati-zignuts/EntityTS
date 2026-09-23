import { BenchmarkScenario, BenchmarkResult, BenchmarkOptions } from './BenchmarkMetrics';

/**
 * Runner that executes benchmark scenarios with warmup, high-precision timing,
 * percentile distributions, and terminal table formatting.
 */
export class BenchmarkRunner {
  private scenarios: BenchmarkScenario[] = [];

  /**
   * Registers a new benchmark scenario.
   */
  public add(scenario: BenchmarkScenario): this {
    this.scenarios.push(scenario);
    return this;
  }

  /**
   * Registers multiple benchmark scenarios.
   */
  public addRange(scenarios: BenchmarkScenario[]): this {
    this.scenarios.push(...scenarios);
    return this;
  }

  /**
   * Runs all registered scenarios matching the filter options.
   */
  public async run(options: BenchmarkOptions = {}): Promise<BenchmarkResult[]> {
    const defaultIterations = options.iterations ?? 500;
    const defaultWarmup = options.warmupIterations ?? 50;
    const filter = options.filter ? new RegExp(options.filter, 'i') : null;

    const filteredScenarios = filter
      ? this.scenarios.filter(s => filter.test(s.name) || filter.test(s.category))
      : this.scenarios;

    const results: BenchmarkResult[] = [];

    for (const scenario of filteredScenarios) {
      if (!options.silent) {
        process.stdout.write(`  ⏳ Running: [${scenario.category}] ${scenario.name} ...\r`);
      }

      if (scenario.setup) {
        await scenario.setup();
      }

      // Warmup phase (to trigger JIT optimization and stabilize state)
      const warmupCount = scenario.warmupIterations ?? defaultWarmup;
      for (let w = 0; w < warmupCount; w++) {
        await scenario.fn();
      }

      // Timed execution phase
      const iterations = scenario.iterations ?? defaultIterations;
      const durationsMs: number[] = new Array(iterations);

      if (typeof global.gc === 'function') {
        global.gc();
      }
      const initialMemory = process.memoryUsage().heapUsed;
      const suiteStart = process.hrtime.bigint();

      for (let i = 0; i < iterations; i++) {
        const iterStart = process.hrtime.bigint();
        await scenario.fn();
        const iterEnd = process.hrtime.bigint();
        durationsMs[i] = Number(iterEnd - iterStart) / 1_000_000; // to ms
      }

      const suiteEnd = process.hrtime.bigint();
      const finalMemory = process.memoryUsage().heapUsed;
      const totalTimeMs = Number(suiteEnd - suiteStart) / 1_000_000;

      if (scenario.teardown) {
        await scenario.teardown();
      }

      // Calculate statistical metrics
      durationsMs.sort((a, b) => a - b);
      const sum = durationsMs.reduce((acc, val) => acc + val, 0);
      const meanMs = sum / iterations;
      const minMs = durationsMs[0];
      const maxMs = durationsMs[iterations - 1];
      const p50Ms = this.percentile(durationsMs, 50);
      const p95Ms = this.percentile(durationsMs, 95);
      const p99Ms = this.percentile(durationsMs, 99);
      const opsPerSec = totalTimeMs > 0 ? (iterations / totalTimeMs) * 1000 : 0;
      const memoryDeltaKb = Math.round((finalMemory - initialMemory) / 1024);

      const result: BenchmarkResult = {
        name: scenario.name,
        category: scenario.category,
        iterations,
        totalTimeMs: parseFloat(totalTimeMs.toFixed(2)),
        opsPerSec: Math.round(opsPerSec),
        meanMs: parseFloat(meanMs.toFixed(4)),
        minMs: parseFloat(minMs.toFixed(4)),
        maxMs: parseFloat(maxMs.toFixed(4)),
        p50Ms: parseFloat(p50Ms.toFixed(4)),
        p95Ms: parseFloat(p95Ms.toFixed(4)),
        p99Ms: parseFloat(p99Ms.toFixed(4)),
        memoryDeltaKb,
      };

      results.push(result);

      if (!options.silent) {
        process.stdout.write(
          `  ✓ [${scenario.category}] ${scenario.name.padEnd(38)}: ${result.opsPerSec.toLocaleString()} ops/s (p50: ${result.p50Ms}ms)\n`,
        );
      }
    }

    if (!options.silent && results.length > 0) {
      this.printResultsTable(results);
    }

    return results;
  }

  /**
   * Helper to compute percentile value from sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  /**
   * Pretty-prints results in a formatted terminal table.
   */
  public printResultsTable(results: BenchmarkResult[]): void {
    console.log('\n' + '='.repeat(108));
    console.log('  ⚡ EntityTS Execution Performance Benchmark Results');
    console.log('='.repeat(108));

    const header = [
      'Scenario'.padEnd(36),
      'Category'.padEnd(16),
      'Ops/sec'.padStart(12),
      'Mean (ms)'.padStart(11),
      'P50 (ms)'.padStart(10),
      'P95 (ms)'.padStart(10),
      'Memory'.padStart(10),
    ].join(' | ');

    console.log(header);
    console.log('-'.repeat(108));

    let currentCategory = '';
    for (const r of results) {
      if (r.category !== currentCategory && currentCategory !== '') {
        console.log('-'.repeat(108));
      }
      currentCategory = r.category;

      const memStr = `${r.memoryDeltaKb >= 0 ? '+' : ''}${r.memoryDeltaKb} KB`;
      const row = [
        r.name.padEnd(36),
        r.category.padEnd(16),
        r.opsPerSec.toLocaleString().padStart(12),
        r.meanMs.toFixed(3).padStart(11),
        r.p50Ms.toFixed(3).padStart(10),
        r.p95Ms.toFixed(3).padStart(10),
        memStr.padStart(10),
      ].join(' | ');

      console.log(row);
    }

    console.log('='.repeat(108) + '\n');
  }
}
