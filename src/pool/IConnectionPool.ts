export type PoolStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface PoolHealthResult {
  status: PoolStatus;
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  pendingAcquires: number;
  minConnections: number;
  maxConnections: number;
  lastHeartbeatAt?: Date;
  lastHeartbeatMs?: number;
  isAlive: boolean;
  uptimeSeconds: number;
}

export interface ConnectionPoolOptions {
  /**
   * Minimum number of idle connections maintained in the pool.
   * @default 2
   */
  minConnections?: number;

  /**
   * Maximum number of concurrent active connections allowed.
   * @default 10
   */
  maxConnections?: number;

  /**
   * Milliseconds after which an idle connection may be reclaimed.
   * @default 30000
   */
  idleTimeoutMs?: number;

  /**
   * Maximum time in milliseconds to wait when acquiring a connection before timing out.
   * @default 10000
   */
  acquireTimeoutMs?: number;

  /**
   * Heartbeat interval in milliseconds for periodic database health checks.
   * Set to 0 to disable automated background heartbeat.
   * @default 30000
   */
  heartbeatIntervalMs?: number;

  /**
   * Custom SQL query executed during heartbeat health checks.
   * Defaults to adapter.ping() or 'SELECT 1'.
   */
  heartbeatQuery?: string;
}

export interface IConnectionPool {
  readonly options: Readonly<Required<ConnectionPoolOptions>>;
  readonly status: PoolStatus;

  /**
   * Acquires a connection lease from the pool.
   * Waits if maximum pool capacity is reached until a connection is freed or times out.
   */
  acquire(): Promise<void>;

  /**
   * Releases an acquired connection back to the pool.
   */
  release(): void;

  /**
   * Performs an immediate health check and returns comprehensive pool diagnostics.
   */
  health(): Promise<PoolHealthResult>;

  /**
   * Pings the database and records heartbeat latency.
   */
  ping(): Promise<boolean>;

  /**
   * Initializes the pool, pre-warms minConnections, and starts background heartbeat.
   */
  start(): Promise<void>;

  /**
   * Drains active connections, halts heartbeat timers, and tears down the pool.
   */
  close(): Promise<void>;

  /**
   * Returns current connection counters.
   */
  stats(): {
    total: number;
    active: number;
    idle: number;
    pending: number;
  };
}
