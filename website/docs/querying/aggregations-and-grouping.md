---
id: aggregations-and-grouping
title: Aggregations & GroupBy
sidebar_position: 4
---

# Aggregations & GroupBy

EntityTS provides typed aggregate functions and multi-column grouping.

---

## Aggregations

```ts
// Count
const totalUsers = await db.users.count();
const activeAdmins = await db.users.count({ role: 'admin', isActive: true });

// Sum, Avg, Min, Max
const totalRevenue = await db.orders.sum(o => o.totalAmount);
const avgAge = await db.users.avg('age');
const minPrice = await db.products.min('price');
const maxScore = await db.scores.max('score');
```

---

## Group By & Projections

```ts
const stats = await db.orders
  .groupBy(o => o.status)
  .select((group, g) => ({
    status: g.status,
    orderCount: group.count(),
    totalRevenue: group.sum('totalAmount'),
  }))
  .toList();
```
