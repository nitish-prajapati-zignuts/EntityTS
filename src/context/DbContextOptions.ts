import { IDbAdapter, DbProvider } from '../adapters/IDbAdapter';
import { MssqlAdapterConfig } from '../adapters/MssqlAdapter';
import { PostgresAdapterConfig } from '../adapters/PostgresAdapter';
import { MysqlAdapterConfig } from '../adapters/MysqlAdapter';
import { SqliteAdapterConfig } from '../adapters/SqliteAdapter';
import { NeonAdapterConfig } from '../adapters/NeonAdapter';
import { PlanetScaleAdapterConfig } from '../adapters/PlanetScaleAdapter';
import { TursoAdapterConfig } from '../adapters/TursoAdapter';
import { CockroachDbAdapterConfig } from '../adapters/CockroachDbAdapter';
import { D1AdapterConfig, D1DatabaseLike } from '../adapters/D1Adapter';
import { SupabaseAdapterConfig } from '../adapters/SupabaseAdapter';
import { ReplicaRoutingOptions } from '../adapters/ReplicaRoutingDbAdapter';
import { QueryHooks } from '../hooks/QueryHook';
import { IQueryCache } from '../cache/IQueryCache';
import { IExecutionStrategy, ExecutionStrategyOptions } from '../resilience';

export type NamingConvention = 'camelCase' | 'snake_case' | 'PascalCase';
export type LogMode = boolean | 'prisma' | 'compact' | 'json' | LogFunction;
export type LogFunction = (sql: string, params?: unknown[], durationMs?: number) => void;

export interface DbContextOptions {
  provider?: DbProvider;
  adapter?: IDbAdapter;
  mssqlConfig?: MssqlAdapterConfig | string;
  postgresConfig?: PostgresAdapterConfig | string;
  mysqlConfig?: MysqlAdapterConfig | string;
  sqliteConfig?: SqliteAdapterConfig | string;
  neonConfig?: NeonAdapterConfig | string;
  planetscaleConfig?: PlanetScaleAdapterConfig | string;
  tursoConfig?: TursoAdapterConfig | string;
  cockroachConfig?: CockroachDbAdapterConfig | string;
  d1Config?: D1DatabaseLike | D1AdapterConfig;
  supabaseConfig?: SupabaseAdapterConfig | string;
  readReplicas?: (IDbAdapter | string | any)[];
  replicaOptions?: ReplicaRoutingOptions;
  logging?: LogMode;
  hooks?: QueryHooks;
  cache?: IQueryCache;
  namingConvention?: NamingConvention;
  commandTimeoutMs?: number;
  executionStrategy?: IExecutionStrategy;
  executionStrategyOptions?: ExecutionStrategyOptions;
  tenantId?: string | number;
}

