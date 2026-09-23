import { createExecutionBenchmarkSuite, runExecutionBenchmarks } from '../src/benchmark';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';

describe('Execution Benchmarks', () => {
  it('instantiates the execution benchmark suite and registers scenarios', async () => {
    const { runner, context, cleanup } = await createExecutionBenchmarkSuite();
    try {
      expect(runner).toBeInstanceOf(BenchmarkRunner);
      expect(context).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it('runs benchmarks with custom iterations and returns structured metrics', async () => {
    const results = await runExecutionBenchmarks({
      iterations: 20,
      warmupIterations: 5,
      silent: true,
      filter: 'Raw SQL|DbSet.first',
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
    for (const r of results) {
      expect(r.iterations).toBe(20);
      expect(r.opsPerSec).toBeGreaterThan(0);
      expect(r.meanMs).toBeGreaterThan(0);
      expect(r.p50Ms).toBeGreaterThan(0);
      expect(r.minMs).toBeLessThanOrEqual(r.maxMs);
      expect(typeof r.memoryDeltaKb).toBe('number');
    }
  });

  it('works with MockDbAdapter fallback seamlessly', async () => {
    const mock = new MockDbAdapter({
      tables: {
        benchmark_users: [
          { id: 1, name: 'MockUser1', role: 'admin', score: 100 },
          { id: 2, name: 'MockUser2', role: 'user', score: 80 },
        ],
      },
    });

    const results = await runExecutionBenchmarks(
      {
        iterations: 10,
        warmupIterations: 2,
        silent: true,
        filter: 'Direct Adapter',
      },
      mock
    );

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Direct Adapter executeQuery');
    expect(results[0].opsPerSec).toBeGreaterThan(0);
  });
});
