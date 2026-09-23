// Ambient module declarations for optional peer dependencies that lack @types packages.
// These are declared as `any` because they are loaded dynamically at runtime via
// `await import(...)` and only present if the consumer installs them.

declare module 'mssql';
declare module 'better-sqlite3';
declare module 'mysql2/promise';
declare module 'pg';
declare module '@neondatabase/serverless';
declare module '@planetscale/database';
declare module '@libsql/client';
declare module '@cloudflare/workers-types';
