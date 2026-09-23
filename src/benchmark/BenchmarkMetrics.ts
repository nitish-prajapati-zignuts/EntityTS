/**
 * Result metrics collected for an individual benchmark scenario.
 */
export interface BenchmarkResult {
  /** Name of the benchmark scenario */
  name: string;
  /** Category or subsystem being benchmarked */
  category: string;
  /** Number of timed iterations executed */
  iterations: number;
  /** Total elapsed time in milliseconds */
  totalTimeMs: number;
  /** Throughput: operations per second */
  opsPerSec: number;
  /** Mean execution time per iteration in milliseconds */
  meanMs: number;
  /** Minimum execution time observed in milliseconds */
  minMs: number;
  /** Maximum execution time observed in milliseconds */
  maxMs: number;
  /** 50th percentile (median) latency in milliseconds */
  p50Ms: number;
  /** 95th percentile latency in milliseconds */
  p95Ms: number;
  /** 99th percentile latency in milliseconds */
  p99Ms: number;
  /** Net change in heap memory usage during execution in Kilobytes */
  memoryDeltaKb: number;
}

/**
 * Definition of an individual benchmark scenario.
 */
export interface BenchmarkScenario {
  /** Unique descriptive name of the scenario */
  name: string;
  /** Grouping category (e.g., 'Raw SQL', 'DbSet Query', 'Bulk Mutations') */
  category: string;
  /** Optional custom iteration count for this scenario */
  iterations?: number;
  /** Optional custom warmup count for this scenario */
  warmupIterations?: number;
  /** Optional setup callback run once before timed iterations */
  setup?: () => Promise<void> | void;
  /** The operation to be benchmarked and timed */
  fn: () => Promise<void> | void;
  /** Optional teardown callback run once after timed iterations */
  teardown?: () => Promise<void> | void;
}

/**
 * Configuration options for the benchmark runner.
 */
export interface BenchmarkOptions {
  /** Default iterations per scenario (default: 500) */
  iterations?: number;
  /** Default warmup iterations per scenario (default: 50) */
  warmupIterations?: number;
  /** Optional regex pattern or substring filter to select specific scenarios */
  filter?: string;
  /** Suppress console output if true */
  silent?: boolean;
}
