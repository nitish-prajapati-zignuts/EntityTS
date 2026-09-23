---
id: locking
title: Concurrency & Locking
sidebar_position: 3
---

# Concurrency & Locking

EntityTS provides both optimistic concurrency checks and pessimistic row-level database locks.

---

## Optimistic Concurrency Control

Use `@Version` or `@ConcurrencyCheck` to automatically guard against lost updates:

```ts
@Entity({ tableName: 'products' })
export class Product {
  @PrimaryKey()
  id!: number;

  @Column()
  price!: number;

  @Version()
  version!: number;
}
```

If another request modifies the entity concurrently, EntityTS throws a `DbUpdateConcurrencyException`.

---

## Pessimistic Locking

Acquire exclusive or shared locks during query execution:

```ts
// PostgreSQL: SELECT ... FOR UPDATE SKIP LOCKED
// MSSQL: SELECT ... WITH (UPDLOCK, ROWLOCK, READPAST)
const nextJob = await db.jobs.where('status', '=', 'pending').lock('skip-locked').firstOrDefault();
```

Supported lock modes:

- `'pessimistic'` (`FOR UPDATE` / `WITH (UPDLOCK, ROWLOCK)`)
- `'shared'` (`FOR SHARE` / `WITH (HOLDLOCK, ROWLOCK)`)
- `'no-wait'` (`FOR UPDATE NOWAIT` / `WITH (UPDLOCK, NOWAIT)`)
- `'skip-locked'` (`FOR UPDATE SKIP LOCKED` / `WITH (READPAST)`)
