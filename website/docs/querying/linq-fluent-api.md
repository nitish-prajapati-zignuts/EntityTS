---
id: linq-fluent-api
title: LINQ Fluent Query API
sidebar_position: 1
---

# LINQ Fluent Query API

EntityTS provides a complete, type-safe LINQ query builder for constructing queries without raw SQL strings.

---

## Basic Filtering

```ts
// 1. Direct comparison
const users = await db.users.where('role', '=', 'admin').where('isActive', '=', true).toList();

// 2. WhereClause builder callback with logical operators
const filtered = await db.users
  .where(w => w.eq('role', 'admin').or().gte('loginCount', 50))
  .toList();

// 3. Strongly-typed property selector functions
const results = await db.users.where(u => u.age, '>=', 21).toList();
```

---

## Sorting & Projections

```ts
const userSummaries = await db.users
  .where('isActive', '=', true)
  .orderBy(u => u.createdAt, 'desc')
  .select('id', 'name', 'email')
  .toList();
```

---

## Single Item Lookups

```ts
// Returns first matching item or null
const user = await db.users.firstOrDefault({ email: 'alice@example.com' });

// Throws EntityNotFoundException if not found
const user = await db.users.firstOrThrow({ id: 123 });

// Find by primary key directly
const user = await db.users.find(123);
```
