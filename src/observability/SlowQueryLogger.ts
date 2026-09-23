import { QueryHooks } from '../hooks/QueryHook';

export interface SlowQueryLoggerOptions {
  thresholdMs?: number;
  logger?: (message: string, durationMs: number, sql: string, params?: unknown[]) => void;
}

export function createSlowQueryLogger(options?: SlowQueryLoggerOptions): QueryHooks {
  const threshold = options?.thresholdMs ?? 200;
  const logFn =
    options?.logger ||
    ((msg: string) => {
      console.warn(msg);
    });

  return {
    onAfterQuery: (sql, params, durationMs) => {
      const ms = durationMs ?? 0;
      if (ms >= threshold) {
        logFn(
          `[SLOW QUERY] execution took ${ms}ms (threshold: ${threshold}ms): ${sql}`,
          ms,
          sql,
          params
        );
      }
    },
  };
}
