---
id: relations-and-includes
title: Eager Loading & Relations
sidebar_position: 3
---

# Eager Loading & Relations

EntityTS eliminates the N+1 query problem by batch-loading related entities in single efficient queries.

---

## `.include()` Syntax

```ts
// 1. Single or nested property name
const usersWithPosts = await db.users.include('posts').toList();

// 2. Prisma-style boolean object
const users = await db.users
  .include({
    profile: true,
    posts: true,
    comments: false,
  })
  .toList();

// 3. Conditional boolean flag
const users = await db.users.include('profile', req.query.withProfile === 'true').toList();
```

---

## Lazy / On-Demand Loading

```ts
const user = await db.users.find(1);

// Programmatically fetch relation when needed
const posts = await db.users.fetchRelation(user, 'posts');
```
