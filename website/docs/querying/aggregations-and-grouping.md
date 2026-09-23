---
id: aggregations-and-grouping
title: Aggregations & GroupBy
sidebar_position: 4
---

# Aggregations & GroupBy

EntityTS provides strongly-typed LINQ aggregate operators and multi-column grouping.

---

## LINQ Aggregations

Perform standard LINQ aggregations with compile-time lambda selectors:

```ts
// Count
const totalUsers = await db.users.count();
const activeAdmins = await db.users
  .where(u => u.role, '=', 'admin')
  .where(u => u.isActive, '=', true)
  .count();

// Sum, Avg, Min, Max
const totalRevenue = await db.orders.sum(o => o.totalAmount);
const avgAge = await db.users.avg(u => u.age);
const minPrice = await db.products.min(p => p.price);
const maxScore = await db.scores.max(s => s.score);
```

---

## LINQ Group By & Projections

Group records by key and project calculated aggregate metrics:

```ts
const stats = await db.orders
  .groupBy(o => o.status)
  .select((group, g) => ({
    status: g.status,
    orderCount: group.count(),
    totalRevenue: group.sum('totalAmount'),
    averageOrder: group.avg('totalAmount'),
  }))
  .toList();
```
