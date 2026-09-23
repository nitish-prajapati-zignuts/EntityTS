import { DbProvider } from './IDbAdapter';
import { ConnectionException } from '../errors';
import * as fs from 'fs';
import * as path from 'path';

export interface DriverPackageInfo {
  provider: DbProvider;
  packageName: string;
  displayName: string;
  importSpecifier: string;
  typesPackage?: string;
  exclusiveNotes?: string;
}

export const DRIVER_REGISTRY: Record<string, DriverPackageInfo> = {
  mssql: {
    provider: 'mssql',
    packageName: 'mssql',
    importSpecifier: 'mssql',
    displayName: 'Microsoft SQL Server',
    typesPackage: '@types/mssql',
    exclusiveNotes:
      "Do NOT install 'pg' or other database packages; only 'mssql' is required for SQL Server.",
  },
  postgres: {
    provider: 'postgres',
    packageName: 'pg',
    importSpecifier: 'pg',
    displayName: 'PostgreSQL',
    typesPackage: '@types/pg',
    exclusiveNotes:
      "Do NOT install 'mssql' or other database packages; only 'pg' is required for PostgreSQL.",
  },
  mysql: {
    provider: 'mysql',
    packageName: 'mysql2',
    importSpecifier: 'mysql2/promise',
    displayName: 'MySQL / MariaDB',
    exclusiveNotes: "Do NOT install 'pg' or 'mssql'; only 'mysql2' is required for MySQL.",
  },
  sqlite: {
    provider: 'sqlite',
    packageName: 'better-sqlite3',
    importSpecifier: 'better-sqlite3',
    displayName: 'SQLite',
    typesPackage: '@types/better-sqlite3',
    exclusiveNotes: "Do NOT install 'pg' or 'mssql'; only 'better-sqlite3' is required for SQLite.",
  },
  turso: {
    provider: 'turso',
    packageName: '@libsql/client',
    importSpecifier: '@libsql/client',
    displayName: 'Turso (libSQL)',
    exclusiveNotes:
      "Do NOT install other database packages; only '@libsql/client' is required for Turso.",
  },
  neon: {
    provider: 'neon',
    packageName: '@neondatabase/serverless',
    importSpecifier: '@neondatabase/serverless',
    displayName: 'Neon Serverless Postgres',
    exclusiveNotes:
      "Do NOT install 'mssql' or standard 'pg'; only '@neondatabase/serverless' is required for Neon.",
  },
  planetscale: {
    provider: 'planetscale',
    packageName: '@planetscale/database',
    importSpecifier: '@planetscale/database',
    displayName: 'PlanetScale Serverless MySQL',
    exclusiveNotes:
      "Do NOT install 'pg' or 'mssql'; only '@planetscale/database' is required for PlanetScale.",
  },
  cockroachdb: {
    provider: 'cockroachdb',
    packageName: 'pg',
    importSpecifier: 'pg',
    displayName: 'CockroachDB',
    typesPackage: '@types/pg',
    exclusiveNotes: "Do NOT install 'mssql'; only 'pg' is required for CockroachDB.",
  },
  supabase: {
    provider: 'supabase',
    packageName: 'pg',
    importSpecifier: 'pg',
    displayName: 'Supabase (PostgreSQL wire)',
    typesPackage: '@types/pg',
    exclusiveNotes: "Do NOT install 'mssql'; only 'pg' is required for Supabase.",
  },
};

/**
 * Detect the package manager used in the given directory or process.cwd().
 */
export function detectPackageManager(cwd: string = process.cwd()): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock')))
    return 'bun';
  return 'npm';
}

/**
 * Get install command line for a given package and package manager.
 */
export function getInstallCommand(
  pkgName: string,
  pm: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm',
): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm add ${pkgName}`;
    case 'yarn':
      return `yarn add ${pkgName}`;
    case 'bun':
      return `bun add ${pkgName}`;
    case 'npm':
    default:
      return `npm install ${pkgName}`;
  }
}

/**
 * Normalizes provider aliases (e.g. 'sqlserver' -> 'mssql', 'postgresql' -> 'postgres').
 */
export function normalizeProvider(name: string): DbProvider | undefined {
  const lower = name.toLowerCase().trim();
  if (lower === 'mssql' || lower === 'sqlserver' || lower === 'sql-server' || lower === 'ms-sql') {
    return 'mssql';
  }
  if (lower === 'postgres' || lower === 'postgresql' || lower === 'pg') {
    return 'postgres';
  }
  if (lower === 'mysql' || lower === 'mysql2' || lower === 'mariadb') {
    return 'mysql';
  }
  if (lower === 'sqlite' || lower === 'sqlite3' || lower === 'better-sqlite3') {
    return 'sqlite';
  }
  if (lower === 'turso' || lower === 'libsql') {
    return 'turso';
  }
  if (lower === 'neon') {
    return 'neon';
  }
  if (lower === 'planetscale') {
    return 'planetscale';
  }
  if (lower === 'cockroachdb' || lower === 'cockroach') {
    return 'cockroachdb';
  }
  if (lower === 'supabase') {
    return 'supabase';
  }
  return undefined;
}

/**
 * Loads a database driver dynamically and throws a targeted ConnectionException
 * if the package is not installed in the consuming application.
 */
export async function loadDriver<T = any>(
  provider: DbProvider,
  importSpecifier?: string,
): Promise<T> {
  const info = DRIVER_REGISTRY[provider];
  const specifier = importSpecifier || (info ? info.importSpecifier : provider);

  try {
    const mod = await import(specifier);
    return mod.default && (mod.default.ConnectionPool || mod.default.Pool) ? mod.default : mod;
  } catch (err: any) {
    const pm = detectPackageManager();
    const pkg = info ? info.packageName : specifier;
    const displayName = info ? info.displayName : provider;
    const cmd = getInstallCommand(pkg, pm);
    const nspCmd = `nsp add ${provider}`;
    const notes = info?.exclusiveNotes ? `\n\n  ⚠️  ${info.exclusiveNotes}` : '';

    throw new ConnectionException(
      `Database driver '${pkg}' is not installed.\n` +
        `To use ${displayName} with @nsp/dbcontext, install only the required driver:\n\n` +
        `  ${cmd}\n` +
        `  (or run: ${nspCmd})` +
        notes,
      err,
    );
  }
}
