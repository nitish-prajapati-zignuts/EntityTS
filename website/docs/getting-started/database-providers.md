---
id: database-providers
title: Database Providers & Configuration
sidebar_position: 2
---

# Supported Database Providers

EntityTS features first-class, dialect-aware adapters for all major relational and modern edge/serverless databases.

---

## Provider Compatibility Matrix

| Database Engine          | Driver Package             | Provider Identifier | Key Highlights                                                |
| :----------------------- | :------------------------- | :------------------ | :------------------------------------------------------------ |
| **PostgreSQL**           | `pg`                       | `'postgres'`        | JSONB queries, pgvector embeddings, RETURNING clauses         |
| **MySQL / MariaDB**      | `mysql2`                   | `'mysql'`           | ON DUPLICATE KEY UPDATE, stored procedures with OUT params    |
| **SQLite**               | `better-sqlite3`           | `'sqlite'`          | Zero-latency embedded database, fast `:memory:` test fixtures |
| **Microsoft SQL Server** | `mssql`                    | `'mssql'`           | Table-Valued Parameters (TVP), OUTPUT params, MERGE           |
| **Neon Serverless**      | `@neondatabase/serverless` | `'neon'`            | Serverless PostgreSQL with instant database branching         |
| **Turso (libSQL)**       | `@libsql/client`           | `'turso'`           | Distributed edge SQLite with global replication               |
| **PlanetScale**          | `@planetscale/database`    | `'planetscale'`     | Serverless MySQL over HTTP for edge runtimes                  |
| **Cloudflare D1**        | Built-in binding           | `'d1'`              | Native Cloudflare Workers edge database                       |
| **CockroachDB**          | `pg`                       | `'cockroachdb'`     | Distributed active-active ACID SQL cluster                    |
| **Supabase**             | `pg`                       | `'supabase'`        | Postgres with Row-Level Security (RLS) & pgvector             |

---

## 1. PostgreSQL

### Installation

```bash
npm install pg @types/pg
```

### Configuration via `onConfiguring`

```ts
import { DbContext, DbContextOptionsBuilder } from 'entityts';

export class AppDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    // Standard connection URI
    options
      .usePostgres(process.env.DATABASE_URL || 'postgresql://postgres:secret@localhost:5432/appdb')
      .withLogging(true)
      .enableRetryOnFailure(3);
  }
}
```

---

## 2. MySQL / MariaDB

### Installation

```bash
npm install mysql2
```

### Configuration

```ts
export class AppDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options
      .useMysql('mysql://root:secret@localhost:3306/appdb?timezone=Z')
      .withNamingConvention('snake_case')
      .withLogging('structured');
  }
}
```

---

## 3. SQLite & In-Memory Testing

### Installation

```bash
npm install better-sqlite3 @types/better-sqlite3
```

### Configuration

```ts
export class AppDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    // 1. File database:
    options.useSqlite('./data/app.db');

    // 2. In-Memory database for fast test suites:
    // options.useSqlite(':memory:');
  }
}
```

---

## 4. Microsoft SQL Server (MSSQL)

### Installation

```bash
npm install mssql @types/mssql
```

### Configuration

```ts
export class AppDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    // Standard ADO.NET Connection String:
    options.useSqlServer(
      'Server=localhost,1433;Database=appdb;User Id=sa;Password=SecretPassword!;Encrypt=false;',
    );
  }
}
```

---

## 5. Neon Serverless Postgres

### Installation

```bash
npm install @neondatabase/serverless
```

### Configuration

```ts
export class AppDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useNeon(process.env.NEON_DATABASE_URL!).enableRetryOnFailure(5, 3000);
  }
}
```

---

## 6. Turso (libSQL) Distributed Edge

### Installation

```bash
npm install @libsql/client
```

### Configuration

```ts
export class AppDbContext extends DbContext {
  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useTurso({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
}
```

---

## 7. Cloudflare D1 (Workers Edge)

```ts
import { DbContextOptionsBuilder } from 'entityts';
import { AppDbContext } from './AppDbContext';

export default {
  async fetch(request: Request, env: { DB: any }) {
    const options = new DbContextOptionsBuilder().useD1(env.DB).build();
    const db = new AppDbContext(options);

    const users = await db.users.toList();
    return Response.json(users);
  },
};
```
