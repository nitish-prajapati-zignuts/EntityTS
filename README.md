# EntityTS

> **Enterprise-grade TypeScript ORM and Stored Procedure Engine for Node.js**, inspired by EF Core with Prisma-grade developer ergonomics. Powered by a **100% native proprietary SQL compiler** (zero Knex, zero runtime query builder bloat), strictly isolated database drivers, and multi-table result sets.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-311%20passing-brightgreen.svg)]()

---

## Table of Contents

- [Key Architectural Highlights](#key-architectural-highlights)
- [Installation & Isolated Drivers](#installation--isolated-drivers)
- [Quick Start in 2 Minutes](#quick-start-in-2-minutes)
  - [1. Define Entity](#1-define-entity)
  - [2. Define DbContext](#2-define-dbcontext)
  - [3. Application Usage (Singleton Pattern)](#3-application-usage-singleton-pattern)
- [Database Providers Configuration](#database-providers-configuration)
- [Stored Procedures (Single & Multiple Tables)](#stored-procedures-single--multiple-tables)
  - [Multiple Result Sets (Multiple Tables)](#multiple-result-sets-multiple-tables)
  - [Output Parameters & Return Values](#output-parameters--return-values)
  - [Sequential Streaming Reader](#sequential-streaming-reader)
- [DbSet LINQ Querying](#dbset-linq-querying)
  - [Filtering, Sorting & Pagination](#filtering-sorting--pagination)
  - [Keyset / Cursor Pagination](#keyset--cursor-pagination)
  - [Native JSON Path Querying](#native-json-path-querying)
  - [Dialect-Aware Full-Text Search](#dialect-aware-full-text-search)
  - [Safe Raw SQL ($queryRaw & $executeRaw)](#safe-raw-sql-queryraw--executeraw)
- [Relations & Eager Loading (.include)](#relations--eager-loading-include)
- [Change Tracking & Entity Mutations](#change-tracking--entity-mutations)
- [Soft Delete & Audit Fields](#soft-delete--audit-fields)
- [High-Performance Bulk Operations](#high-performance-bulk-operations)
- [Transactions, Savepoints & Resilience](#transactions-savepoints--resilience)
- [Framework Integration (Express, Fastify, NestJS)](#framework-integration-express-fastify-nestjs)
- [Framework Integration (Express, Fastify, NestJS)](#framework-integration-express-fastify-nestjs)
- [EntityTS CLI Suite](#entityts-cli-suite)
  - [Execution Benchmarks](#execution-benchmarks)
  - [Code-First Migrations](#code-first-migrations)
  - [Database-First Scaffolding](#database-first-scaffolding)
- [Execution Performance Benchmarking](#execution-performance-benchmarking)
- [Unit Testing with MockDbAdapter](#unit-testing-with-mockdbadapter)

---

## Key Architectural Highlights

- ⚡ **First-Class Stored Procedures**: Native typed input/output parameters, return codes, and multi-table results (`.queryMultiple<[T1, T2]>()`).
- 🗄️ **Zero-Bloat Isolated Drivers**: If you use SQL Server (`mssql`), only `mssql` is installed—never forces `pg`, `mysql2`, or `better-sqlite3`.
- 🚀 **100% Native Execution Engine**: No Knex, no external query builder dependencies. Proprietary cross-dialect AST SQL compiler.
- 🔍 **Prisma-Grade Developer Ergonomics**: Keyset cursor pagination, nested `.include()` eager loading, `$queryRaw`, soft deletes, and automatic audit fields.
- 🏛️ **Flexible Architectures**: Native support for **Application-Wide Singleton** (one connection pool shared across your server) or **Scoped Per-Request** instances.
- ⚡ **High-Throughput Execution & Benchmarking**: Built-in comprehensive benchmark suite profiling raw SQL, DbSet LINQ, bulk operations, and stored procedures (`npm run benchmark` or `entityts benchmark`).

---

## Installation & Isolated Drivers

Install the core package:

```bash
npm install entityts reflect-metadata
# or
pnpm add entityts reflect-metadata
# or
yarn add entityts reflect-metadata
# or
bun add entityts reflect-metadata
```

### Install ONLY the Database Driver You Need

`@nsp/dbcontext` guarantees **driver isolation**. It does **not** install unused database drivers into your project.

Use the built-in CLI tool to install the driver for your specific database:

```bash
# Microsoft SQL Server (installs mssql only — NEVER touches pg)
npx nsp add mssql

# PostgreSQL (installs pg only — NEVER touches mssql)
npx nsp add postgres

# MySQL / MariaDB (installs mysql2 only)
npx nsp add mysql

# SQLite (installs better-sqlite3 only)
npx nsp add sqlite

# Serverless (Turso, Neon, PlanetScale)
npx nsp add turso
npx nsp add neon
npx nsp add planetscale
```

> 💡 **Driver Isolation Guard**: If your `DbContext` is configured for SQL Server (`mssql`), running `nsp add postgres` will automatically warn and block to prevent accidental package bloat.

### Enable TypeScript Decorators

Ensure your `tsconfig.json` contains:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## Quick Start in 2 Minutes

### 1. Define Entity

```typescript
import { Entity, Table, Column, PrimaryKey, CreatedAt, UpdatedAt, SqlType } from '@nsp/dbcontext';

@Entity()
@Table('users')
export class User {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'full_name', type: SqlType.VarChar, maxLength: 100 })
  name!: string;

  @Column({ name: 'email', unique: true })
  email!: string;

  @Column({ name: 'score', type: SqlType.Int, defaultValue: 0 })
  score!: number;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;
}
```

### 2. Define DbContext

```typescript
import { DbContext, DbContextOptionsBuilder } from '@nsp/dbcontext';
import { User } from './User';

export class AppDbContext extends DbContext {
  // Register DbSet collections
  public users = this.set(User);

  protected override onConfiguring(options: DbContextOptionsBuilder): void {
    // Connect to SQL Server:
    options.useSqlServer(process.env.DATABASE_URL || 'Server=localhost;Database=mydb;User Id=sa;Password=secret;');

    // Or PostgreSQL:
    // options.usePostgres(process.env.DATABASE_URL || 'postgresql://localhost:5432/mydb');

    // Or MySQL:
    // options.useMysql(process.env.DATABASE_URL || 'mysql://root:secret@localhost:3306/mydb');

    // Or SQLite:
    // options.useSqlite('./data.db');
  }
}
```

### 3. Application Usage (Singleton Pattern)

In modern Node.js web applications (Express, Fastify, NestJS), you can create **one shared instance** of `AppDbContext` for the entire application to reuse the connection pool:

```typescript
// db.ts
import { AppDbContext } from './AppDbContext';
export const db = new AppDbContext();

// server.ts
import express from 'express';
import { db } from './db';

const app = express();
app.use(express.json());

// Query records
app.get('/users', async (req, res) => {
  const users = await db.users
    .where(u => u.gt('score', 50))
    .orderBy('name', 'asc')
    .toList();

  res.json(users);
});

// Insert record
app.post('/users', async (req, res) => {
  const user = await db.users.add(req.body);
  res.status(201).json(user);
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
```

---

## Database Providers Configuration

`DbContextOptionsBuilder` offers intuitive configuration for standard and serverless databases:

```typescript
// SQL Server (mssql)
options.useSqlServer({
  server: 'localhost',
  port: 1433,
  user: 'sa',
  password: 'Password123!',
  database: 'AppDb',
  options: { encrypt: true, trustServerCertificate: true },
  pool: { max: 20, min: 2 }
});

// PostgreSQL (pg)
options.usePostgres('postgresql://user:pass@localhost:5432/app_db');

// MySQL / MariaDB (mysql2)
options.useMysql('mysql://root:secret@localhost:3306/app_db');

// SQLite (better-sqlite3)
options.useSqlite('./data/app.db');

// Turso / libSQL (edge serverless)
options.useTurso({
  url: 'libsql://my-db.turso.io',
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Neon (serverless postgres)
options.useNeon(process.env.NEON_DATABASE_URL!);

// PlanetScale (serverless mysql)
options.usePlanetScale({
  host: process.env.DATABASE_HOST,
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD
});
```

---

## Stored Procedures (Single & Multiple Tables)

Stored procedures are first-class citizens in `@nsp/dbcontext`.

### 1. Basic Procedure Execution

```typescript
// Returns typed records directly
const topUsers = await db.procedure('usp_GetTopUsers')
  .input({ MinScore: 100, DepartmentId: 4 })
  .query<User>();

// Returns single scalar value
const totalSales = await db.procedure('usp_GetTotalSales')
  .input({ Year: 2026 })
  .scalar<number>();

// Executes non-query procedure and returns rowsAffected and return code
const { rowsAffected, returnValue } = await db.procedure('usp_ArchiveInactive')
  .input({ DaysThreshold: 90 })
  .run();
```

---

### Multiple Result Sets (Multiple Tables)

When a stored procedure executes multiple `SELECT` statements, `@nsp/dbcontext` returns the tables as a strongly typed tuple via `.queryMultiple<[T1, T2]>()`:

```typescript
// Stored procedure executing 3 SELECT queries:
// 1. SELECT * FROM Customers WHERE Id = @Id;
// 2. SELECT * FROM Orders WHERE CustomerId = @Id;
// 3. SELECT * FROM Rewards WHERE CustomerId = @Id;

const [customers, orders, rewards] = await db.procedure('usp_GetCustomerDashboard')
  .input({ Id: 101 })
  .queryMultiple<[Customer[], Order[], Reward[]]>();

console.log(customers[0].name);
console.log(`Customer has ${orders.length} orders`);
console.log(`Reward Tier: ${rewards[0].tier}`);
```

#### Multi-Table Query with Output Parameters:

```typescript
const { records: [customers, orders], out } = await db.procedure('usp_GetCustomerDashboard')
  .input({ Id: 101 })
  .output<{ Status: string; ExecutionMs: number }>()
  .queryMultiple<[Customer[], Order[]]>();

console.log(out.Status);     // Strongly-typed output parameter
console.log(customers);      // Table 1 records
console.log(orders);         // Table 2 records
```

---

### Sequential Streaming Reader

For large result sets, read tables sequentially using `.reader()`:

```typescript
const reader = await db.procedure('usp_GetQuarterlyReport')
  .input({ Quarter: 'Q1', Year: 2026 })
  .reader();

// Read 1st table: Summary
const summary = await reader.read<ReportSummary>();

// Move to next table: Line Items
if (await reader.nextResult()) {
  const items = await reader.read<ReportItem>();
}

// Move to next table: Audit Logs
if (await reader.nextResult()) {
  const auditLogs = await reader.read<AuditEntry>();
}

// Access output params or return value at the end
const returnValue = reader.returnValue;
```

---

