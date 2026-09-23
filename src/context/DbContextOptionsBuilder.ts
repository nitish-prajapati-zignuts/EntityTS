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
import {
  ReplicaRoutingDbAdapter,
  ReplicaRoutingOptions,
} from '../adapters/ReplicaRoutingDbAdapter';
import {
  IExecutionStrategy,
  ExecutionStrategyOptions,
  DefaultExecutionStrategy,
} from '../resilience';
import { createQueryPlanLogger, QueryPlanLoggerOptions } from '../observability/QueryPlanAnalyzer';
import { ConnectionPoolOptions } from '../pool/IConnectionPool';
import { PooledDbAdapter } from '../pool/PooledDbAdapter';

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
   * @usecase Connect to Microsoft SQL Server on-premise, AWS RDS for SQL Server, or Azure SQL Database instances.
   * @param config - Connection configuration object with credentials or a standard ADO.NET connection string.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **Connection String:**
   * ```ts
   * options.useSqlServer('Server=localhost,1433;Database=appdb;User Id=sa;Password=Secret123!;Encrypt=false;');
   * ```
   *
   * **Structured Configuration:**
   * ```ts
   * options.useSqlServer({
   *   server: 'localhost',
   *   port: 1433,
   *   database: 'appdb',
   *   user: 'sa',
   *   password: 'SecretPassword!',
   *   options: { encrypt: true, trustServerCertificate: false }
   * });
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
   * @usecase Connect to standard PostgreSQL instances, AWS RDS Postgres, Google Cloud SQL, Supabase, or Railway.
   * @param config - Connection URI string or node-postgres `pg.PoolConfig` object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **Connection URI:**
   * ```ts
   * options.usePostgres('postgresql://postgres:secret@localhost:5432/appdb?sslmode=prefer');
   * ```
   *
   * **Structured Configuration:**
   * ```ts
   * options.usePostgres({
   *   host: 'localhost',
   *   port: 5432,
   *   database: 'appdb',
   *   user: 'postgres',
   *   password: 'secretpassword',
   *   max: 20,
   *   idleTimeoutMillis: 30000,
   * });
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
   * @usecase Connect to MySQL 5.7/8.x or MariaDB database servers across local containers, AWS RDS, or Google Cloud SQL.
   * @param config - Connection URI string or `mysql2.PoolOptions` configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **Connection URI:**
   * ```ts
   * options.useMysql('mysql://root:secret@localhost:3306/appdb?timezone=Z');
   * ```
   *
   * **Structured Configuration:**
   * ```ts
   * options.useMysql({
   *   host: 'localhost',
   *   port: 3306,
   *   database: 'appdb',
   *   user: 'root',
   *   password: 'secretpassword',
   *   connectionLimit: 15,
   * });
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
   * @usecase Connect to local file-based or in-memory SQLite databases for development, testing, CLI tools, or Electron/desktop apps.
   * @param config - Database file path string (e.g. `'./data.db'` or `':memory:'`) or configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **File Path / In-Memory:**
   * ```ts
   * // File database:
   * options.useSqlite('./data/app.db');
   *
   * // Fast in-memory database for unit testing:
   * options.useSqlite(':memory:');
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
   * @usecase Connect to Neon serverless Postgres with instant branching, autoscaling, and connection pooling.
   * @param config - Neon connection string URI or `@neondatabase/serverless` configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * options.useNeon(process.env.NEON_DATABASE_URL || 'postgresql://user:pass@ep-cool-branch-12345.us-east-2.aws.neon.tech/neondb?sslmode=require');
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
   * @usecase Connect to PlanetScale's serverless MySQL platform in serverless functions, Vercel, or AWS Lambda without connection pool exhaustion.
   * @param config - PlanetScale connection string or `@planetscale/database` configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * options.usePlanetScale({
   *   url: process.env.DATABASE_URL,
   * });
   * ```
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
   * @usecase Connect to Turso edge SQLite databases with distributed replication and sub-millisecond global queries.
   * @param config - Turso database URL or `@libsql/client` configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * options.useTurso({
   *   url: process.env.TURSO_DATABASE_URL!,
   *   authToken: process.env.TURSO_AUTH_TOKEN!,
   * });
   * ```
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
   * @usecase Connect to CockroachDB for multi-region active-active high availability and global ACID transactions.
   * @param config - CockroachDB connection string or configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * options.useCockroachDb('postgresql://user:pass@free-tier14.gcp-us-east1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full');
   * ```
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
   * @usecase Run queries directly on Cloudflare Workers edge runtime bound to Cloudflare D1.
   * @param bindingOrConfig - Cloudflare D1 environment binding (`env.DB`) or config object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * export default {
   *   async fetch(req, env) {
   *     const options = new DbContextOptionsBuilder().useD1(env.DB).build();
   *     const db = new AppDbContext(options);
   *     const users = await db.users.toList();
   *     return Response.json(users);
   *   }
   * };
   * ```
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
   * @usecase Connect to Supabase Postgres database with support for Row-Level Security (RLS) and pgvector embeddings.
   * @param config - Supabase connection string or configuration object.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * options.useSupabase('postgresql://postgres.xxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true');
   * ```
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
   * @usecase Use a customized adapter, database wrapper, or driver not bundled by default.
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
   * @usecase Ideal for unit testing business logic and services without spinning up a live database server.
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
   * Enables query logging in structured EF Core format, JSON, compact one-line format, or via a custom logger callback.
   *
   * @usecase Debug executed SQL queries with duration, parameter bindings, and error states.
   * @param logging - `'structured'` (or `true`) for formatted multi-line logs, `'json'`, `'compact'`, or a custom `(sql, params, ms) => void` callback.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * // 1. Formatted multi-line logging:
   * options.withLogging(true);
   *
   * // 2. Structured JSON for cloud log aggregators (Datadog, CloudWatch):
   * options.withLogging('json');
   *
   * // 3. Custom logger (e.g. Winston / Pino):
   * options.withLogging((sql, params, ms) => logger.info({ sql, params, durationMs: ms }));
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
    options?: ReplicaRoutingOptions,
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
    strategyOrOptions?: IExecutionStrategy | ExecutionStrategyOptions,
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
        strategyOrOptions as ExecutionStrategyOptions,
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
   * Configures connection pooling, active connection bounds, and background health heartbeats.
   *
   * @param options - Connection pool settings (min/max connections, idle/acquire timeouts, heartbeat).
   * @returns `this` builder instance for chaining.
   */
  public withConnectionPool(options?: ConnectionPoolOptions): this {
    this.options.poolOptions = options || {};
    return this;
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
        if (
          typeof r === 'object' &&
          r !== null &&
          'executeQuery' in r &&
          typeof r.executeQuery === 'function'
        ) {
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

      opts.adapter = new ReplicaRoutingDbAdapter(
        opts.adapter,
        replicaAdapters,
        opts.replicaOptions,
      );
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
            if (existingHooks.onAfterQuery)
              await existingHooks.onAfterQuery(sql, params, durationMs);
            if (plannerHooks.onAfterQuery) await plannerHooks.onAfterQuery(sql, params, durationMs);
          },
          onError: existingHooks.onError,
        };
      } else {
        opts.hooks = plannerHooks;
      }
    }

    if (opts.poolOptions && opts.adapter && !(opts.adapter instanceof PooledDbAdapter)) {
      opts.adapter = new PooledDbAdapter(opts.adapter, opts.poolOptions);
    }

    return opts;
  }
}
