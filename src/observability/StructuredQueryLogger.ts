import { QueryHooks } from '../hooks/QueryHook';

export type LogFormat = 'prisma' | 'compact' | 'json';

export interface StructuredQueryLoggerOptions {
  /**
   * Log badge / prefix.
   * Defaults to `'prisma:query'` to match Prisma's output style, or custom string e.g. `'nsp:query'`.
   */
  prefix?: string;

  /**
   * Structured format:
   * - `'prisma'`: Multi-line format displaying query, duration, and parameters (Prisma default)
   * - `'compact'`: Single-line formatted log
   * - `'json'`: Structured JSON object for CloudWatch, Datadog, ELK
   */
  format?: LogFormat;

  /**
   * Whether to include ANSI terminal colors.
   * Defaults to `true` when output is an interactive terminal (TTY) or not explicitly disabled.
   */
  colorize?: boolean;

  /**
   * Custom output destination callback.
   * Defaults to `console.log` (or `console.error` for failed queries).
   */
  logger?: (message: string) => void;

  /**
   * Execution time threshold in milliseconds above which a query is flagged as slow.
   * Defaults to `100` ms.
   */
  slowThresholdMs?: number;
}

/**
 * Creates a structured query logger that formats executed SQL operations like Prisma.
 *
 * @usecase Output clean, structured, and colored query execution logs matching Prisma's signature style.
 * @param options - Configuration options for prefix, format ('prisma' | 'compact' | 'json'), and colorization.
 * @returns `QueryHooks` ready to pass to `options.withHooks(...)`.
 * @example
 * ```ts
 * options.withHooks(createStructuredQueryLogger({ format: 'prisma' }));
 * ```
 */
export function createStructuredQueryLogger(options?: StructuredQueryLoggerOptions): QueryHooks {
  const prefix = options?.prefix ?? 'prisma:query';
  const format = options?.format ?? 'prisma';
  const colorize = options?.colorize ?? (process.stdout ? process.stdout.isTTY !== false : true);
  const logFn = options?.logger ?? ((msg: string) => console.log(msg));
  const slowThreshold = options?.slowThresholdMs ?? 100;

  // ANSI Escape Codes
  const cCyan = colorize ? '\x1b[36m' : '';
  const cGreen = colorize ? '\x1b[32m' : '';
  const cYellow = colorize ? '\x1b[33m' : '';
  const cRed = colorize ? '\x1b[31m' : '';
  const cGray = colorize ? '\x1b[90m' : '';
  const cWhite = colorize ? '\x1b[37m' : '';
  const cReset = colorize ? '\x1b[0m' : '';

  const formatParams = (params?: unknown[]): string => {
    if (!params || params.length === 0) return '[]';
    try {
      return JSON.stringify(params);
    } catch {
      return String(params);
    }
  };

  return {
    onAfterQuery: (sql: string, params?: unknown[], durationMs?: number) => {
      const ms = durationMs ?? 0;
      const isSlow = ms >= slowThreshold;
      const durationColor = isSlow ? cYellow : cGreen;

      if (format === 'json') {
        const jsonPayload = JSON.stringify({
          timestamp: new Date().toISOString(),
          level: isSlow ? 'warn' : 'info',
          target: prefix,
          query: sql,
          params: params ?? [],
          durationMs: ms,
        });
        logFn(jsonPayload);
        return;
      }

      if (format === 'compact') {
        const paramsStr =
          params && params.length ? ` ${cGray}-- params: ${formatParams(params)}${cReset}` : '';
        const durStr = ` ${durationColor}(${ms}ms)${cReset}`;
        logFn(`${cCyan}${prefix}${cReset} ${cWhite}${sql}${cReset}${paramsStr}${durStr}`);
        return;
      }

      // Default: 'prisma' multi-line structured format
      const badge = `${cCyan}${prefix}${cReset}`;
      const queryLine = `${badge} ${cWhite}${sql}${cReset}`;
      const durLine = `  ${cGray}Duration:${cReset} ${durationColor}${ms}ms${cReset}`;
      const paramsLine = `  ${cGray}Params:  ${cReset} ${formatParams(params)}`;

      logFn(`${queryLine}\n${durLine}\n${paramsLine}`);
    },

    onError: (err: Error, sql: string, params?: unknown[]) => {
      const errPrefix = prefix.replace(':query', ':error');
      if (format === 'json') {
        logFn(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            target: errPrefix,
            query: sql,
            params: params ?? [],
            error: err.message,
          }),
        );
        return;
      }

      const badge = `${cRed}${errPrefix}${cReset}`;
      const queryLine = `${badge} ${cWhite}${sql}${cReset}`;
      const paramsLine = `  ${cGray}Params:${cReset} ${formatParams(params)}`;
      const errLine = `  ${cRed}Error:  ${err.message}${cReset}`;

      logFn(`${queryLine}\n${paramsLine}\n${errLine}`);
    },
  };
}
