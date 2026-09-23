import path from 'path';

export interface AppConfig {
  port: number;
  dbProvider: 'sqlite' | 'postgres';
  sqlitePath: string;
  databaseUrl?: string;
  logQueries: boolean;
  slowQueryThresholdMs: number;
  cacheTtlMs: number;
  /** When true, EXPLAIN is run alongside every SELECT and the plan is printed to stdout. */
  explainQueries: boolean;
  /** When true, EXPLAIN ANALYZE is used (actually executes the query for accurate timing). */
  explainAnalyze: boolean;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbProvider: (process.env.DB_PROVIDER as 'sqlite' | 'postgres') || (process.env.DATABASE_URL ? 'postgres' : 'sqlite'),
  sqlitePath: process.env.SQLITE_PATH || path.resolve(__dirname, '../../data/app.db'),
  databaseUrl: process.env.DATABASE_URL,
  logQueries: process.env.LOG_QUERIES !== 'false',
  slowQueryThresholdMs: parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '100', 10),
  cacheTtlMs: parseInt(process.env.CACHE_TTL_MS || '30000', 10),
  explainQueries: process.env.EXPLAIN_QUERIES === 'true',
  explainAnalyze: process.env.EXPLAIN_ANALYZE === 'true',
};
