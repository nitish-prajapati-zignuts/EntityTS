---
id: relations-and-includes
title: Eager Loading & Relations
sidebar_position: 3
---

# Eager Loading & Relations

EntityTS eliminates the N+1 query problem by batch-loading related entities in single efficient queries using the LINQ `.include()` and `.thenInclude()` syntax.

---

## LINQ `.include()` Syntax

### 1. Strongly-Typed Lambda Selectors

```ts
// Eager load related posts for each user
const usersWithPosts = await db.users.include(u => u.posts).toList();
```

### 2. Multi-Level Chaining with `.thenInclude()`

```ts
// Eager load nested relations (User -> Posts -> Comments -> Author)
const blogFeed = await db.users
  .include(u => u.posts)
  .thenInclude(p => p.comments)
  .include(u => u.profile)
  .where(u => u.isActive, '=', true)
  .toList();
```

### 3. Property Name String Syntax

```ts
// Eager load via property name key
const usersWithProfile = await db.users.include('profile').include('posts').toList();
```

---

## Lazy / On-Demand Loading

For workflows where related data should only be loaded when explicitly requested:

```ts
const user = await db.users.find(1);

// Programmatically fetch relation when needed
const posts = await db.users.fetchRelation(user, 'posts');
```
