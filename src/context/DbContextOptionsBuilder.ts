import { DbContextOptions, LogMode, LogFunction, NamingConvention } from './DbContextOptions';
import { QueryHooks } from '../hooks/QueryHook';
import { IQueryCache } from '../cache/IQueryCache';
import { IDbAdapter } from '../adapters/IDbAdapter';
import { MssqlAdapter, MssqlAdapterConfig } from '../adapters/MssqlAdapter';
import { PostgresAdapter, PostgresAdapterConfig } from '../adapters/PostgresAdapter';
import { MysqlAdapter, MysqlAdapterConfig } from '../adapters/MysqlAdapter';
import { SqliteAdapter, SqliteAdapterConfig } from '../adapters/SqliteAdapter';
import { MockDbAdapter, MockDbAdapterOptions } from '../adapters/MockDbAdapter';
import { NeonAdapter, NeonAdapterConfig } from '../adapters/NeonAdapter';
import { PlanetScaleAdapter, PlanetScaleAdapterConfig } from '../adapters/PlanetScaleAdapter';
import { TursoAdapter, TursoAdapterConfig } from '../adapters/TursoAdapter';
import { CockroachDbAdapter, CockroachDbAdapterConfig } from '../adapters/CockroachDbAdapter';
import { D1Adapter, D1AdapterConfig, D1DatabaseLike } from '../adapters/D1Adapter';
import { SupabaseAdapter, SupabaseAdapterConfig } from '../adapters/SupabaseAdapter';
import { ReplicaRoutingDbAdapter, ReplicaRoutingOptions } from '../adapters/ReplicaRoutingDbAdapter';
import { IExecutionStrategy, ExecutionStrategyOptions, DefaultExecutionStrategy } from '../resilience';
import { createQueryPlanLogger, QueryPlanLoggerOptions } from '../observability/QueryPlanAnalyzer';

/**
 * Fluent options builder for configuring a `DbContext` instance.
 *
 * Provides methods for configuring database drivers, connection strings, logging,
 * caching providers, query lifecycle hooks, naming conventions, read replicas, and retry resilience.
 */
export class DbContextOptionsBuilder {
  private options: DbContextOptions = {};

  /**
   * Configures the context to connect to a Microsoft SQL Server database.
   *
   * @usecase Connect to on-premise or Azure SQL Server instances.
   * @param config - Connection configuration object or connection string.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * options.useSqlServer('Server=localhost;Database=mydb;User Id=sa;Password=secret;');
   * ```
   */
  public useSqlServer(config: MssqlAdapterConfig | string): this {
    this.options.provider = 'mssql';
    this.options.mssqlConfig = config;
    this.options.adapter = new MssqlAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to a PostgreSQL database.
   *
   * @usecase Connect to PostgreSQL instances (standard pg, RDS, Google Cloud SQL, etc.).
   * @param config - Connection configuration object or connection URI string.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * options.usePostgres('postgresql://user:pass@localhost:5432/mydb');
   * ```
   */
  public usePostgres(config: PostgresAdapterConfig | string): this {
    this.options.provider = 'postgres';
    this.options.postgresConfig = config;
    this.options.adapter = new PostgresAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to a MySQL or MariaDB database.
   *
   * @usecase Connect to MySQL or MariaDB database servers.
   * @param config - Connection configuration object or connection URI string.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * options.useMysql('mysql://root:secret@localhost:3306/mydb');
   * ```
   */
  public useMysql(config: MysqlAdapterConfig | string): this {
    this.options.provider = 'mysql';
    this.options.mysqlConfig = config;
    this.options.adapter = new MysqlAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to a SQLite database.
   *
   * @usecase Connect to local file-based or in-memory SQLite databases for development, desktop apps, or tests.
   * @param config - Database file path string (e.g. `'./data.db'` or `':memory:'`) or config object.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * options.useSqlite('./dev.db');
   * ```
   */
  public useSqlite(config: SqliteAdapterConfig | string): this {
    this.options.provider = 'sqlite';
    this.options.sqliteConfig = config;
    this.options.adapter = new SqliteAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to a Neon Serverless PostgreSQL database over HTTP/WebSockets.
   *
   * @usecase Connect to Neon serverless Postgres with instant branching and autoscaling.
   * @param config - Neon connection string or configuration object.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * options.useNeon(process.env.NEON_DATABASE_URL!);
   * ```
   */
  public useNeon(config: NeonAdapterConfig | string): this {
    this.options.provider = 'neon';
    this.options.neonConfig = config;
    this.options.adapter = new NeonAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to PlanetScale MySQL via HTTP.
   *
   * @usecase Connect to PlanetScale's serverless MySQL platform in edge runtimes or serverless functions.
   * @param config - PlanetScale connection string or configuration object.
   * @returns `this` builder instance for chaining.
   */
  public usePlanetScale(config: PlanetScaleAdapterConfig | string): this {
    this.options.provider = 'planetscale';
    this.options.planetscaleConfig = config;
    this.options.adapter = new PlanetScaleAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to Turso (libSQL) distributed edge database.
   *
   * @usecase Connect to Turso edge SQLite databases with replication across global regions.
   * @param config - Turso database URL or configuration object.
   * @returns `this` builder instance for chaining.
   */
  public useTurso(config: TursoAdapterConfig | string): this {
    this.options.provider = 'turso';
    this.options.tursoConfig = config;
    this.options.adapter = new TursoAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to a CockroachDB distributed SQL cluster.
   *
   * @usecase Connect to CockroachDB for multi-region active-active high availability.
   * @param config - CockroachDB connection string or configuration object.
   * @returns `this` builder instance for chaining.
   */
  public useCockroachDb(config: CockroachDbAdapterConfig | string): this {
    this.options.provider = 'cockroachdb';
    this.options.cockroachConfig = config;
    this.options.adapter = new CockroachDbAdapter(config);
    return this;
  }

  /**
   * Configures the context to connect to Cloudflare D1 serverless database.
   *
   * @usecase Run queries on Cloudflare Workers edge runtime directly bound to Cloudflare D1.
   * @param bindingOrConfig - Cloudflare D1 environment binding or config object.
   * @returns `this` builder instance for chaining.
   */
  public useD1(bindingOrConfig: D1DatabaseLike | D1AdapterConfig): this {
    this.options.provider = 'd1';
    this.options.d1Config = bindingOrConfig;
    this.options.adapter = new D1Adapter(bindingOrConfig);
    return this;
  }

  /**
   * Configures the context to connect to a Supabase Postgres database.
   *
   * @usecase Connect to Supabase Postgres database.
   * @param config - Supabase connection string or configuration object.
   * @returns `this` builder instance for chaining.
   */
  public useSupabase(config: SupabaseAdapterConfig | string): this {
    this.options.provider = 'supabase';
    this.options.supabaseConfig = config;
    this.options.adapter = new SupabaseAdapter(config);
    return this;
  }


  /**
   * Supplies a custom database adapter implementing the `IDbAdapter` interface.
   *
   * @usecase Use a customized adapter, wrapper, or unsupported database driver.
   * @param adapter - An instance of `IDbAdapter`.
   * @returns `this` builder instance for chaining.
   */
  public useAdapter(adapter: IDbAdapter): this {
    this.options.adapter = adapter;
    this.options.provider = adapter.provider;
    return this;
  }

  /**
   * Configures an in-memory mock database adapter for fast unit testing.
   *
   * @usecase Ideal for unit testing business logic and services without needing a live database connection.
   * @param mockOptions - Mock behavior configuration.
   * @returns `this` builder instance for chaining.
   */
  public useMock(mockOptions?: MockDbAdapterOptions): this {
    const mock = new MockDbAdapter(mockOptions);
    this.options.adapter = mock;
    this.options.provider = 'mock';
    return this;
  }

  /**
   * Enables query logging in -style structured format, JSON, compact, or through a custom logger function.
   *
   * @usecase Debug executed SQL queries with duration, parameter values, and error states like in .
   * @param logging - `''` (or `true`) for -style structured logs, `'json'`, `'compact'`, or a custom `(sql, params, ms) => void` callback.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * // 1. -style structured multi-line logging:
   * options.withLogging('');
   *
   * // 2. Structured JSON for cloud log aggregators:
   * options.withLogging('json');
   *
   * // 3. Custom function:
   * options.withLogging((sql, params, ms) => console.log(`[SQL ${ms}ms] ${sql}`));
   * ```
   */
  public withLogging(logging: LogMode): this {
    this.options.logging = logging;
    return this;
  }

  /**
   * Registers global query lifecycle hooks for auditing, tracing, or telemetry.
   *
   * @usecase Add OpenTelemetry spans, metrics, security audits, or performance alerts on slow queries.
   * @param hooks - Object with `beforeExecute`, `afterExecute`, and `onError` handlers.
   * @returns `this` builder instance for chaining.
   */
  public withHooks(hooks: QueryHooks): this {
    this.options.hooks = hooks;
    return this;
  }

  /**
   * Attaches a live query plan analyzer that transparently runs `EXPLAIN [ANALYZE]` alongside
   * each SELECT query and prints a detailed plan report — including estimated/actual row counts,
   * planner cost, index usage, Seq Scan detection, and Nested Loop warnings.
   *
   * Supported providers: `postgres`, `neon`, `cockroachdb`, `supabase`, `mysql`, `sqlite`, `turso`, `d1`.
   *
   * @usecase
   * Identify missing indexes, full-table scans, and join strategy issues directly in server logs
   * during development or staging without needing an external database GUI.
   *
   * @param planOpts - Configuration: `analyze` flag, `thresholdMs`, `warnOnSeqScan`, and more.
   *   The `adapter` property is **automatically filled** from the configured adapter.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * // In onConfiguring — EXPLAIN (no re-execution) on every SELECT:
   * options.withQueryPlanner();
   *
   * // EXPLAIN ANALYZE on queries slower than 50ms, with alerting:
   * options.withQueryPlanner({
   *   analyze: true,
   *   thresholdMs: 50,
   *   warnOnSeqScan: true,
   *   onPlan: (plan) => {
   *     if (plan.hasSeqScan) alerting.warn('seq_scan', plan.sql);
   *   },
   * });
   * ```
   */
  public withQueryPlanner(planOpts?: Omit<QueryPlanLoggerOptions, 'adapter'>): this {
    // Adapter is resolved lazily at build() time through a deferred hook registration.
    // We store the pending planner config and merge it during build().
    (this as any)._pendingPlannerOpts = planOpts ?? {};
    return this;
  }

  /**
   * Registers a query cache provider (e.g. Redis, Memcached, or in-memory LRU).
   *
   * @usecase Enables `.cache(ttlMs)` queries on `DbSet` to reduce database load on frequent reads.
   * @param cache - Implementation of `IQueryCache`.
   * @returns `this` builder instance for chaining.
   */
  public withCache(cache: IQueryCache): this {
    this.options.cache = cache;
    return this;
  }

  /**
   * Configures column and table naming conventions (e.g. `snake_case`, `camelCase`, `PascalCase`).
   *
   * @usecase Automatically convert TypeScript camelCase property names to database snake_case columns.
   * @param convention - Target naming convention.
   * @returns `this` builder instance for chaining.
   */
  public withNamingConvention(convention: NamingConvention): this {
    this.options.namingConvention = convention;
    return this;
  }

  /**
   * Sets the default command timeout for all queries executed through this context.
   *
   * @usecase Prevent slow or stalled queries from hanging server processes indefinitely.
   * @param timeoutMs - Command timeout in milliseconds.
   * @returns `this` builder instance for chaining.
   */
  public withCommandTimeout(timeoutMs: number): this {
    this.options.commandTimeoutMs = timeoutMs;
    return this;
  }

  /**
   * Sets the active tenant identifier for multi-tenant data isolation.
   *
   * All entities with `@TenantId()` will be automatically partitioned by this identifier.
   *
   * @usecase Multi-tenant SaaS applications scoping requests to a specific organization or account.
   * @param tenantId - The active tenant identifier (string or number).
   * @returns `this` builder instance for chaining.
   */
  public withTenant(tenantId: string | number): this {
    this.options.tenantId = tenantId;
    return this;
  }

  /**
   * Configures one or more read replicas for automatic query load balancing.
   *
   * Read queries (`SELECT`) route to replicas using round-robin or random distribution, while writes route to primary.
   *
   * @usecase Scale database read capacity horizontally across read replicas.
   * @param replicas - Array of replica adapters or connection configurations.
   * @param options - Replica routing configuration (e.g. strategy, health checks).
   * @returns `this` builder instance for chaining.
   */
  public withReadReplicas(
    replicas: (IDbAdapter | string | any)[],
    options?: ReplicaRoutingOptions
  ): this {
    this.options.readReplicas = replicas;
    this.options.replicaOptions = options;
    return this;
  }

  /**
   * Configures a custom execution strategy or options for handling retries and transient failures.
   *
   * @usecase Implement custom retry policies for cloud database environments.
   * @param strategyOrOptions - An `IExecutionStrategy` instance or `ExecutionStrategyOptions`.
   * @returns `this` builder instance for chaining.
   */
  public withExecutionStrategy(
    strategyOrOptions?: IExecutionStrategy | ExecutionStrategyOptions
  ): this {
    if (!strategyOrOptions) {
      this.options.executionStrategy = new DefaultExecutionStrategy();
    } else if (
      typeof strategyOrOptions === 'object' &&
      strategyOrOptions !== null &&
      'execute' in strategyOrOptions &&
      typeof (strategyOrOptions as any).execute === 'function'
    ) {
      this.options.executionStrategy = strategyOrOptions as IExecutionStrategy;
    } else {
      this.options.executionStrategyOptions = strategyOrOptions as ExecutionStrategyOptions;
      this.options.executionStrategy = new DefaultExecutionStrategy(
        strategyOrOptions as ExecutionStrategyOptions
      );
    }
    return this;
  }

  /**
   * Enables automatic retry with exponential backoff for transient connection errors and deadlocks.
   *
   * @usecase Guard against transient network hiccups and temporary database locking deadlocks.
   * @param maxRetryCount - Maximum number of retry attempts (default: 3).
   * @param maxDelayMs - Maximum delay between retries in milliseconds (default: 2000).
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * options.enableRetryOnFailure(3, 2000);
   * ```
   */
  public enableRetryOnFailure(maxRetryCount = 3, maxDelayMs = 2000): this {
    return this.withExecutionStrategy({
      maxRetryCount,
      maxDelayMs,
      retryOnDeadlocks: true,
      retryOnTransientErrors: true,
    });
  }

  /**
   * Builds and resolves the final `DbContextOptions` object.
   *
   * @returns Configured `DbContextOptions` object.
   */
  public build(): DbContextOptions {
    const opts = { ...this.options };
    if (opts.readReplicas && opts.readReplicas.length > 0 && opts.adapter) {
      const replicaAdapters: IDbAdapter[] = opts.readReplicas.map(r => {
        if (typeof r === 'object' && r !== null && 'executeQuery' in r && typeof r.executeQuery === 'function') {
          return r as IDbAdapter;
        }
        // Auto-create replica adapter based on primary provider
        switch (opts.provider) {
          case 'postgres':
            return new PostgresAdapter(r);
          case 'mysql':
            return new MysqlAdapter(r);
          case 'sqlite':
            return new SqliteAdapter(r);
          case 'mssql':
            return new MssqlAdapter(r);
          case 'neon':
            return new NeonAdapter(r);
          case 'planetscale':
            return new PlanetScaleAdapter(r);
          case 'turso':
            return new TursoAdapter(r);
          case 'cockroachdb':
            return new CockroachDbAdapter(r);
          case 'supabase':
            return new SupabaseAdapter(r);
          case 'd1':
            return new D1Adapter(r);
          default:
            return r as IDbAdapter;
        }
      });

      opts.adapter = new ReplicaRoutingDbAdapter(opts.adapter, replicaAdapters, opts.replicaOptions);
    }

    // Wire deferred query planner hooks (adapter is now resolved)
    const pendingPlannerOpts = (this as any)._pendingPlannerOpts;
    if (pendingPlannerOpts !== undefined && opts.adapter) {
      const plannerHooks = createQueryPlanLogger({ ...pendingPlannerOpts, adapter: opts.adapter });
      // Compose with existing hooks — both sets of hooks fire independently
      if (opts.hooks) {
        const existingHooks = opts.hooks;
        opts.hooks = {
          onBeforeQuery: existingHooks.onBeforeQuery,
          onAfterQuery: async (sql, params, durationMs) => {
            if (existingHooks.onAfterQuery) await existingHooks.onAfterQuery(sql, params, durationMs);
            if (plannerHooks.onAfterQuery) await plannerHooks.onAfterQuery(sql, params, durationMs);
          },
          onError: existingHooks.onError,
        };
      } else {
        opts.hooks = plannerHooks;
      }
    }

    return opts;
  }
}
