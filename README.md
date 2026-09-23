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

