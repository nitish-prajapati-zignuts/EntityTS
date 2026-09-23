import { IDbAdapter } from '../adapters/IDbAdapter';
import {
  IConnectionPool,
  ConnectionPoolOptions,
  PoolHealthResult,
  PoolStatus,
} from './IConnectionPool';

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class ConnectionPool implements IConnectionPool {
  public readonly options: Readonly<Required<ConnectionPoolOptions>>;

  private _active = 0;
  private _idle = 0;
  private _waiters: Waiter[] = [];
  private readonly _startedAt = new Date();
  private _lastHeartbeatAt?: Date;
  private _lastHeartbeatMs?: number;
  private _lastHeartbeatSuccess = true;
  private _heartbeatTimer?: NodeJS.Timeout;
  private _isClosed = false;

  constructor(
    private readonly adapter: IDbAdapter,
    options?: ConnectionPoolOptions,
  ) {
    const min = options?.minConnections ?? 2;
    const max = Math.max(options?.maxConnections ?? 10, min);

    this.options = Object.freeze({
      minConnections: min,
      maxConnections: max,
      idleTimeoutMs: options?.idleTimeoutMs ?? 30000,
      acquireTimeoutMs: options?.acquireTimeoutMs ?? 10000,
      heartbeatIntervalMs: options?.heartbeatIntervalMs ?? 30000,
      heartbeatQuery: options?.heartbeatQuery ?? 'SELECT 1',
    });

    this._idle = this.options.minConnections;
  }

  public get status(): PoolStatus {
    if (!this._lastHeartbeatSuccess) {
      return 'unhealthy';
    }
    if (
      this._waiters.length > 0 ||
      (this._lastHeartbeatMs !== undefined && this._lastHeartbeatMs > 1500)
    ) {
      return 'degraded';
    }
    return 'healthy';
  }

  public async start(): Promise<void> {
    if (this._isClosed) {
      this._isClosed = false;
    }

    if (this.options.heartbeatIntervalMs > 0 && !this._heartbeatTimer) {
      this._heartbeatTimer = setInterval(async () => {
        try {
          await this.ping();
        } catch {
          // Heartbeat failures update status internally
        }
      }, this.options.heartbeatIntervalMs);

      if (typeof this._heartbeatTimer.unref === 'function') {
        this._heartbeatTimer.unref();
      }
    }
  }

  public async acquire(): Promise<void> {
    if (this._isClosed) {
      throw new Error('Cannot acquire connection: connection pool is closed.');
    }

    if (this._active < this.options.maxConnections) {
      this._active++;
      if (this._idle > 0) {
        this._idle--;
      }
      return;
    }

    // Max capacity reached: wait for connection release or timeout
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex(w => w.resolve === resolve);
        if (idx !== -1) {
          this._waiters.splice(idx, 1);
        }
        reject(
          new Error(
            `Connection pool acquire timeout: could not acquire connection within ${this.options.acquireTimeoutMs}ms (active: ${this._active}, max: ${this.options.maxConnections}).`,
          ),
        );
      }, this.options.acquireTimeoutMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      this._waiters.push({ resolve, reject, timer });
    });
  }

  public release(): void {
    if (this._waiters.length > 0) {
      const nextWaiter = this._waiters.shift()!;
      clearTimeout(nextWaiter.timer);
      nextWaiter.resolve();
      return;
    }

    if (this._active > 0) {
      this._active--;
    }
    if (
      this._active + this._idle < this.options.maxConnections &&
      this._idle < this.options.minConnections
    ) {
      this._idle++;
    }
  }

  public async ping(): Promise<boolean> {
    const start = Date.now();
    try {
      let ok = false;
      if (typeof this.adapter.ping === 'function') {
        ok = await this.adapter.ping();
      } else {
        await this.adapter.executeQuery(this.options.heartbeatQuery);
        ok = true;
      }
      this._lastHeartbeatMs = Date.now() - start;
      this._lastHeartbeatAt = new Date();
      this._lastHeartbeatSuccess = ok;
      return ok;
    } catch {
      this._lastHeartbeatMs = Date.now() - start;
      this._lastHeartbeatAt = new Date();
      this._lastHeartbeatSuccess = false;
      return false;
    }
  }

  public async health(): Promise<PoolHealthResult> {
    const alive = await this.ping();
    const uptimeSeconds = Math.max(0, Math.floor((Date.now() - this._startedAt.getTime()) / 1000));
    const total = this._active + this._idle;

    return {
      status: this.status,
      totalConnections: total,
      activeConnections: this._active,
      idleConnections: this._idle,
      pendingAcquires: this._waiters.length,
      minConnections: this.options.minConnections,
      maxConnections: this.options.maxConnections,
      lastHeartbeatAt: this._lastHeartbeatAt,
      lastHeartbeatMs: this._lastHeartbeatMs,
      isAlive: alive,
      uptimeSeconds,
    };
  }

  public async close(): Promise<void> {
    this._isClosed = true;

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = undefined;
    }

    for (const waiter of this._waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Connection pool was closed while waiting for connection.'));
    }
    this._waiters = [];
    this._active = 0;
    this._idle = 0;
  }

  public stats(): {
    total: number;
    active: number;
    idle: number;
    pending: number;
  } {
    return {
      total: this._active + this._idle,
      active: this._active,
      idle: this._idle,
      pending: this._waiters.length,
    };
  }
}
