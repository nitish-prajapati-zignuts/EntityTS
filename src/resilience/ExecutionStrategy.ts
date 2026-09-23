export interface IExecutionStrategy {
  execute<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ExecutionStrategyOptions {
  /**
   * Maximum number of retry attempts. Default is 3.
   */
  maxRetryCount?: number;

  /**
   * Initial delay before first retry in milliseconds. Default is 100ms.
   */
  initialDelayMs?: number;

  /**
   * Maximum delay between retries in milliseconds. Default is 2000ms.
   */
  maxDelayMs?: number;

  /**
   * Multiplier for exponential backoff. Default is 2.
   */
  backoffMultiplier?: number;

  /**
   * Whether to add random jitter (0% - 25%) to prevent thundering herd. Default is true.
   */
  jitter?: boolean;

  /**
   * Whether to retry on database deadlocks. Default is true.
   */
  retryOnDeadlocks?: boolean;

  /**
   * Whether to retry on transient connection/timeout errors. Default is true.
   */
  retryOnTransientErrors?: boolean;

  /**
   * Optional custom predicate to determine if an error should be retried.
   */
  isTransient?: (error: unknown) => boolean;

  /**
   * Callback invoked before each retry attempt.
   */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Checks whether a given database error is transient and safe to retry.
 */
export function isTransientError(
  error: any,
  options?: { retryOnDeadlocks?: boolean; retryOnTransientErrors?: boolean }
): boolean {
  if (!error) return false;

  const retryDeadlocks = options?.retryOnDeadlocks !== false;
  const retryTransient = options?.retryOnTransientErrors !== false;

  const msg = String(error.message || '');
  const code = String(error.code || '');
  const errno = error.errno !== undefined ? String(error.errno) : '';

  // 1. Deadlock & Serialization Failures
  if (retryDeadlocks) {
    // Postgres / CockroachDB (40P01: deadlock, 40001: serialization failure)
    if (code === '40P01' || code === '40001') return true;

    // MySQL / PlanetScale (1205: lock wait timeout, 1213: deadlock)
    if (
      errno === '1205' ||
      errno === '1213' ||
      code === 'ER_LOCK_DEADLOCK' ||
      code === 'ER_LOCK_WAIT_TIMEOUT'
    ) {
      return true;
    }

    // MSSQL (1205: deadlock victim)
    if (error.number === 1205 || errno === '1205') return true;

    // SQLite
    if (
      code === 'SQLITE_BUSY' ||
      code === 'SQLITE_LOCKED' ||
      msg.includes('database is locked') ||
      msg.includes('database is busy')
    ) {
      return true;
    }

    if (/deadlock|lock wait timeout|serialization failure/i.test(msg)) {
      return true;
    }
  }

  // 2. Connection Drops & Network Timeouts
  if (retryTransient) {
    // Common Node.js socket / network error codes
    const networkCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EPIPE',
      'ENOTFOUND',
      'EHOSTUNREACH',
      'EAI_AGAIN',
    ];
    if (networkCodes.includes(code)) return true;

    // Postgres transient codes:
    // 57P01 (admin_shutdown), 57P02 (crash_shutdown), 57P03 (cannot_connect_now)
    // 53300 (too_many_connections)
    // 08000, 08003, 08006, 08001, 08004 (connection exceptions)
    const pgTransient = ['57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006'];
    if (pgTransient.includes(code)) return true;

    // MySQL server gone away or lost connection
    if (errno === '2006' || errno === '2013' || code === 'PROTOCOL_CONNECTION_LOST') {
      return true;
    }

    // MSSQL timeout & transport errors (-2: timeout, 233, 10053, 10054, 10060)
    if (error.number === -2 || [233, 10053, 10054, 10060].includes(error.number)) {
      return true;
    }

    if (/timeout|connection reset|server closed the connection|connection terminated|socket hang up/i.test(msg)) {
      return true;
    }
  }

  return false;
}

export class DefaultExecutionStrategy implements IExecutionStrategy {
  private readonly options: Required<Omit<ExecutionStrategyOptions, 'isTransient' | 'onRetry'>> & {
    isTransient?: (error: unknown) => boolean;
    onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  };

  constructor(options?: ExecutionStrategyOptions) {
    this.options = {
      maxRetryCount: options?.maxRetryCount ?? 3,
      initialDelayMs: options?.initialDelayMs ?? 100,
      maxDelayMs: options?.maxDelayMs ?? 2000,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      jitter: options?.jitter ?? true,
      retryOnDeadlocks: options?.retryOnDeadlocks ?? true,
      retryOnTransientErrors: options?.retryOnTransientErrors ?? true,
      isTransient: options?.isTransient,
      onRetry: options?.onRetry,
    };
  }

  public async execute<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await operation();
      } catch (error) {
        if (attempt > this.options.maxRetryCount) {
          throw error;
        }

        const isRetryable = this.options.isTransient
          ? this.options.isTransient(error)
          : isTransientError(error, {
              retryOnDeadlocks: this.options.retryOnDeadlocks,
              retryOnTransientErrors: this.options.retryOnTransientErrors,
            });

        if (!isRetryable) {
          throw error;
        }

        // Exponential backoff
        const baseDelay = Math.min(
          this.options.maxDelayMs,
          this.options.initialDelayMs * Math.pow(this.options.backoffMultiplier, attempt - 1)
        );

        // Add random jitter between 0% and 25% if enabled
        const jitterFactor = this.options.jitter ? 1 + Math.random() * 0.25 : 1;
        const delayMs = Math.round(baseDelay * jitterFactor);

        if (this.options.onRetry) {
          this.options.onRetry(error, attempt, delayMs);
        }

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
}
