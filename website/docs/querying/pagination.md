---
id: pagination
title: Keyset & Offset Pagination
sidebar_position: 2
---

# Keyset & Offset Pagination

EntityTS provides high-performance keyset (cursor) pagination and traditional page-number pagination.

---

## Keyset (Cursor-Based) Pagination

Keyset pagination avoids the $O(N)$ performance degradation of standard `OFFSET` queries by using indexed column comparisons:

```ts
// Initial page load
const page1 = await db.posts.orderBy(p => p.id, 'desc').toCursorPage({ limit: 20 });

console.log(page1.items);
console.log(page1.nextCursor);
console.log(page1.hasNextPage);

// Next page load using token
const page2 = await db.posts
  .orderBy(p => p.id, 'desc')
  .toCursorPage({ limit: 20, cursor: page1.nextCursor });
```

---

## Page-Number (Offset) Pagination

```ts
const paged = await db.users
  .where('isActive', '=', true)
  .orderBy(u => u.name, 'asc')
  .toPagedList({ page: 1, pageSize: 25 });

console.log(`Page ${paged.page} of ${paged.totalPages} (Total: ${paged.totalCount})`);
console.log(paged.items);
```
