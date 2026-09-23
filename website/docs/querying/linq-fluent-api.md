---
id: linq-fluent-api
title: LINQ Fluent Query API
sidebar_position: 1
---

# LINQ Fluent Query API

**EntityTS** brings the full expressive power of **Language Integrated Query (LINQ)** and **Entity Framework Core (EF Core)** to TypeScript.

All querying is structured around strongly-typed, composable LINQ method chaining—providing autocompletion, compile-time safety, and automatic SQL compilation across PostgreSQL, MySQL, SQLite, and MSSQL.

---

## 🔍 Filtering (`where`)

EntityTS provides multiple LINQ filtering patterns:

### 1. Strongly-Typed Lambda Selectors

```ts
// Property selector with comparison operator and operand
const adultUsers = await db.users
  .where(u => u.age, '>=', 18)
  .where(u => u.isActive, '=', true)
  .toList();
```

### 2. LINQ WhereClause Builder (Complex Boolean Logic)

```ts
// Fluent boolean expression tree with AND / OR precedence
const highValueCustomers = await db.users
  .where(w => w.eq('role', 'admin').or(w.gt('loginCount', 100).and().eq('tier', 'platinum')))
  .toList();
```

### 3. Direct Key-Value Equality

```ts
const verifiedStaff = await db.users
  .where('isVerified', '=', true)
  .where('department', '=', 'Engineering')
  .toList();
```

---

## 🎯 Projections (`select`)

Project database records into refined DTOs, picking only the columns you need:

```ts
// Select specific columns with type-safe property names
const summaries = await db.users
  .where(u => u.isActive, '=', true)
  .select('id', 'name', 'email')
  .toList();
// Result type: Array<{ id: number; name: string; email: string }>
```

---

## 📊 Sorting (`orderBy` & `thenBy`)

Chain primary and secondary sort criteria with compile-time property verification:

```ts
const sortedUsers = await db.users
  .where(u => u.isActive, '=', true)
  .orderBy(u => u.department, 'asc')
  .thenBy(u => u.createdAt, 'desc')
  .toList();
```

---

## 🔗 Eager Loading (`include` & `thenInclude`)

Eagerly load related entities without N+1 query overhead:

```ts
const usersWithDetails = await db.users
  .include(u => u.posts)
  .thenInclude(p => p.comments)
  .include(u => u.profile)
  .where(u => u.isActive, '=', true)
  .toList();
```

---

## 🔢 Pagination & Slicing (`skip` & `take`)

Implement standard LINQ offset pagination or high-performance keyset cursor pagination:

```ts
// Standard LINQ skip & take
const pageRecords = await db.users
  .orderBy(u => u.id, 'asc')
  .skip(20)
  .take(10)
  .toList();

// Keyset Cursor Pagination
const cursorPage = await db.posts
  .orderBy(p => p.id, 'desc')
  .toCursorPage({ limit: 25, cursor: previousCursorToken });
```

---

## 🔎 Single Element Lookups

Retrieve specific elements matching LINQ predicates:

```ts
// Returns first matching entity, or null if none found
const user = await db.users.firstOrDefault(u => u.email === 'alice@example.com');

// Throws EntityNotFoundException if not found
const requiredUser = await db.users.firstOrThrow(u => u.id === 42);

// Fast primary key lookup
const userById = await db.users.find(42);

// Single entity verification (throws if multiple records match)
const singleUser = await db.users.singleOrDefault(u => u.username === 'alice_dev');
```

---

## 📈 Aggregations & Quantifiers

Perform aggregate calculations directly in the database engine:

```ts
// Count
const totalCount = await db.users.count();
const activeAdmins = await db.users.where('role', '=', 'admin').count();

// Quantifiers (any / all)
const hasSuperAdmin = await db.users.any(u => u.role === 'superadmin');
const allVerified = await db.users.all(u => u.isVerified === true);

// Numeric Aggregations (sum, avg, min, max)
const totalRevenue = await db.orders.sum(o => o.totalAmount);
const averageAge = await db.users.avg(u => u.age);
const lowestPrice = await db.products.min(p => p.price);
const peakScore = await db.scores.max(s => s.score);
```

---

## 📦 Grouping & Summary Projections (`groupBy`)

Group records by key and project calculated aggregate summaries:

```ts
const salesByDepartment = await db.orders
  .groupBy(o => o.department)
  .select((group, g) => ({
    department: g.department,
    orderCount: group.count(),
    totalRevenue: group.sum('totalAmount'),
    avgTicket: group.avg('totalAmount'),
  }))
  .toList();
```

---

## ⚡ Performance Modifiers

```ts
// AsNoTracking: Bypass change tracking for read-only query performance
const readOnlyData = await db.users
  .asNoTracking()
  .where(u => u.isActive, '=', true)
  .toList();

// Distinct: Eliminate duplicate rows
const uniqueRoles = await db.users.select('role').distinct().toList();
```
