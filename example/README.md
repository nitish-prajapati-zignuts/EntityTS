# @nsp/dbcontext — Express CRUD Operations Showcase

This application demonstrates how to build an **Express web application** using **`@nsp/dbcontext`** with complete **CRUD operations**, advanced querying, bulk mutations, relationships, soft deletion, change tracking, optimistic concurrency, and transactions.

---

## Architecture & Features Demonstrated

| Category | Features Covered |
|---|---|
| **Database Connection** | `AppDbContext` extending `DbContext`, with `onConfiguring` and `onModelCreating` lifecycle hooks |
| **Multi-Database Support** | SQLite (`better-sqlite3`, default zero-setup file) & PostgreSQL (`pg`) via `DATABASE_URL` |
| **Dependency Injection** | `dbContextMiddleware` creating scoped `DbContext` per HTTP request (`req.dbContext`) with auto-disposal |
| **Schema Initialization** | Code-First `ensureCreated()` for automatic table creation without manual SQL migrations |
| **Observability & Caching** | Transparent query caching via `MemoryQueryCache`, query logging, and slow query monitoring hooks |
| **Resilience** | `enableRetryOnFailure()` with exponential backoff on transient connection drops or deadlocks |
| **CRUD: Create** | `.add()` (single), `.addRange()` (batch), `.bulkInsert()` (high-throughput batching) |
| **CRUD: Read** | `.where()` (LINQ fluent filter), `.orderBy()`, `.toPagedList()`, `.toCursorPagedList()`, `.search()`, aggregations (`.count()`, `.avg()`, `.min()`, `.max()`, `.sum()`), eager loading relations (`.include('profile').include('posts')`) |
| **CRUD: Update** | `.update()` (by ID), `.updateWhere()` (conditional), `.upsert()` (insert or update on conflict), proxy change tracking (`.track(id)` + `.saveChanges()`) |
| **CRUD: Delete** | `.remove()` (soft-delete with `@SoftDelete`), `.onlyDeleted()` (trash view), restore, `.hardRemove()` (permanent), `.bulkDelete()` |
| **Bulk Operations** | `.bulkInsert()`, `.bulkUpdate()`, `.bulkUpsert()`, `.bulkDelete()` |
| **Concurrency Control** | Optimistic Concurrency Control via `@Version()` detecting stale updates (HTTP 409 Conflict) |
| **Transactions** | `ctx.useTransaction()` with auto-commit/rollback, credit transfers, savepoints (`savepoint`, `rollbackTo`) |
| **Raw SQL & Procedures** | Parameterized `fromSql()`, `executeSql()`, injection-safe tagged template `ctx.sql\`...\``, and typed Stored Procedure builder |

---

## Directory Structure

```
example/
├── data/                    # Auto-created SQLite database file (app.db)
├── src/
│   ├── config.ts            # Environment and database configuration
│   ├── database/
│   │   ├── AppDbContext.ts  # DbContext subclass with sets, hooks, and caching
│   │   ├── seed.ts          # Initial seed data for users, posts, and products
│   │   └── index.ts
│   ├── entities/            # TypeScript entity models with ORM decorators
│   │   ├── User.ts          # User model with @SoftDelete, @CreatedAt, relations
│   │   ├── Profile.ts       # Profile model with @BelongsTo(() => User)
│   │   ├── Post.ts          # Post model with @BelongsTo and @HasMany
│   │   ├── Comment.ts       # Comment model
│   │   ├── Product.ts       # Product model with @Version optimistic concurrency
│   │   ├── AuditLog.ts      # Transaction audit log model
│   │   └── index.ts
│   ├── routes/              # Modular Express route handlers
│   │   ├── user.routes.ts   # Complete User CRUD and querying endpoints
│   │   ├── product.routes.ts# Bulk operations and concurrency routes
│   │   ├── transaction.routes.ts # Atomic transactions and transfer routes
│   │   ├── sql.routes.ts    # Parameterized raw SQL and stored procedure routes
│   │   └── index.ts
│   ├── app.ts               # Express setup, middleware, and interactive dashboard
│   ├── server.ts            # Server bootstrapper and schema initialization
│   └── test-client.ts       # Automated end-to-end test client for all CRUD routes
├── tsconfig.json            # TypeScript compiler configuration with decorators enabled
└── README.md
```

---

## Quick Start

### 1. Build and Start the Showcase Server

From the repository root:

```bash
# Compile and start the server
npm run example:start
```

The server will automatically:
1. Initialize the database schema (`ensureCreated()`).
2. Seed initial users, posts, comments, profiles, and products.
3. Start the Express server on `http://localhost:3000`.

### 2. Open the Interactive Dashboard

Open your web browser and navigate to:
```
http://localhost:3000/
```
The dashboard lists all 34 endpoint scenarios with one-click copyable `curl` commands and live database health status!

### 3. Run Automated End-to-End Tests

Run the complete test client that verifies all CRUD endpoints against an ephemeral server:

```bash
npm run example:test
```

---

## Switching Database Providers

By default, the application runs on **SQLite** with zero installation required (`example/data/app.db`).

### PostgreSQL
To use PostgreSQL instead, set the `DATABASE_URL` environment variable:

```bash
DATABASE_URL="postgresql://username:password@localhost:5432/my_database" npm run example:start
```

---

## Complete CRUD API Endpoints Reference

### 🟢 Create Operations

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/users` | Single entity insert via `.add()` |
| `POST` | `/api/users/batch` | Batch insert multiple entities via `.addRange()` |
| `POST` | `/api/products/bulk-insert` | High-throughput batch insert via `.bulkInsert()` |

#### Example: Single Create
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","role":"admin","score":100}'
```

---

### 🔵 Read Operations

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/users` | Fluent filter with `.where()`, `.orderBy()`, `.skip()`, `.take()` |
| `GET` | `/api/users/paged` | Offset pagination with metadata via `.toPagedList()` |
| `GET` | `/api/users/cursor` | Keyset / cursor pagination via `.toCursorPagedList()` |
| `GET` | `/api/users/search` | Multi-column full-text search via `.search()` |
| `GET` | `/api/users/stats` | Aggregations: `.count()`, `.avg()`, `.min()`, `.max()`, `.sum()` |
| `GET` | `/api/users/:id` | Single record lookup by ID |
| `GET` | `/api/users/:id/relations` | Eager loading relations without N+1 via `.include('profile').include('posts')` |
| `GET` | `/api/users/cache/demo` | Transparent query caching via `.cache(15000)` |
| `POST` | `/api/users/cache/invalidate` | Query cache invalidation via `.invalidateCache()` |
| `GET` | `/api/users/trash` | Soft-deleted records only via `.onlyDeleted()` |
| `GET` | `/api/users/with-deleted` | All records including soft-deleted via `.withDeleted()` |

#### Example: Filter & Sort
```bash
curl "http://localhost:3000/api/users?role=admin&minScore=80&orderBy=score&order=desc"
```

#### Example: Pagination with Total Counts
```bash
curl "http://localhost:3000/api/users/paged?page=1&pageSize=3"
```

---

### 🟡 Update Operations

| Method | Endpoint | Description |
|---|---|---|
| `PUT` | `/api/users/:id` | Direct update by primary key via `.update()` |
| `PATCH` | `/api/users/bulk-promote` | Conditional update matching predicate via `.updateWhere()` |
| `POST` | `/api/users/upsert` | Upsert (Insert or Update on conflict) via `.upsert()` |
| `PATCH` | `/api/users/:id/track` | EF Core-style Proxy Change Tracking via `.track(id)` & `saveChanges()` |
| `POST` | `/api/users/:id/restore` | Restore soft-deleted entity via `.withDeleted().update()` |
| `PUT` | `/api/products/bulk-update` | Batch update matching keys via `.bulkUpdate()` |
| `POST` | `/api/products/bulk-upsert` | High-throughput upsert via `.bulkUpsert()` |
| `PUT` | `/api/products/:id/concurrency` | Optimistic Concurrency Control via `@Version()` |

#### Example: Optimistic Concurrency Update
```bash
# Succeeds if version matches 1:
curl -X PUT http://localhost:3000/api/products/1/concurrency \
  -H "Content-Type: application/json" \
  -d '{"price": 169.99, "expectedVersion": 1}'

# Fails with HTTP 409 Conflict if another process modified the row:
curl -X PUT http://localhost:3000/api/products/1/concurrency \
  -H "Content-Type: application/json" \
  -d '{"price": 179.99, "expectedVersion": 1}'
```

---

### 🔴 Delete Operations

| Method | Endpoint | Description |
|---|---|---|
| `DELETE` | `/api/users/:id` | Soft-delete entity (sets `deleted_at` timestamp) via `.remove()` |
| `DELETE` | `/api/users/:id/permanent` | Permanent hard delete via `.hardRemove()` |
| `DELETE` | `/api/users/by-role/:role` | Conditional delete matching predicate via `.removeWhere()` |
| `DELETE` | `/api/products/bulk-delete` | Batch delete matching records via `.bulkDelete()` |

---

### 🟣 Transactions & Raw SQL

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/transactions/atomic-multi-entity` | Multi-entity atomic insert with automatic rollback on error |
| `POST` | `/api/transactions/credit-transfer` | Score transfer with rollback protection |
| `POST` | `/api/transactions/resilient` | Resilient transaction with auto-retry on transient errors |
| `POST` | `/api/transactions/savepoints` | Manual transaction with savepoints (`tx.savepoint`, `tx.rollbackTo`) |
| `GET` | `/api/sql/raw-query` | Parameterized SELECT via `ctx.fromSql()` |
| `POST` | `/api/sql/raw-execute` | Parameterized command via `ctx.executeSql()` |
| `GET` | `/api/sql/tagged-query` | Injection-safe tagged template SQL via `ctx.sql\`...\`` |
| `GET` | `/api/sql/procedure-demo` | Fluent Stored Procedure builder API demo |
