---
id: database-providers
title: Database Providers
sidebar_position: 2
---

# Database Providers

**EntityTS** supports multiple relational database engines with dialect-specific SQL translation and optimized connection pooling.

---

## 1. SQLite / LibSQL / Turso

### Installation

```bash
npm install better-sqlite3 @types/better-sqlite3
# Or for cloud LibSQL/Turso:
npm install @libsql/client
```

### Connection Configuration

```ts
// Local file
const db = new AppDbContext({
  connectionString: 'sqlite://./data/app.db',
});

// In-Memory (for testing)
const db = new AppDbContext({
  connectionString: 'sqlite::memory:',
});

// Turso / LibSQL Cloud
const db = new AppDbContext({
  connectionString: 'libsql://my-db.turso.io?authToken=YOUR_TOKEN',
});
```

---

## 2. PostgreSQL / Neon / CockroachDB

### Installation

```bash
npm install pg @types/pg
# Or serverless Neon:
npm install @neondatabase/serverless
```

### Connection Configuration

```ts
const db = new AppDbContext({
  connectionString: 'postgresql://user:password@localhost:5432/my_database',
  pool: {
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
  },
});
```

---

## 3. MySQL / PlanetScale

### Installation

```bash
npm install mysql2
# Or serverless PlanetScale:
npm install @planetscale/database
```

### Connection Configuration

```ts
const db = new AppDbContext({
  connectionString: 'mysql://user:password@localhost:3306/my_database',
});
```

---

## 4. Microsoft SQL Server (MSSQL)

### Installation

```bash
npm install mssql @types/mssql
```

### Connection Configuration

```ts
const db = new AppDbContext({
  connectionString: 'mssql://sa:YourPassword123@localhost:1433/my_database?encrypt=true',
});
```
