---
id: dbcontext
title: DbContext & DbSet
sidebar_position: 1
---

# DbContext & DbSet

The `DbContext` is the primary unit of work and repository coordinator in **EntityTS**. It manages database connections, transactions, and entity sets (`DbSet<T>`).

---

## Defining a DbContext

```ts
import { DbContext, DbSet } from 'entityts';
import { User } from '../models/User';
import { Order } from '../models/Order';
import { Product } from '../models/Product';

export class AppDbContext extends DbContext {
  users!: DbSet<User>;
  orders!: DbSet<Order>;
  products!: DbSet<Product>;
}
```

When `new AppDbContext(...)` is instantiated, EntityTS automatically discovers all declared `DbSet<T>` properties using reflection and initializes them with the active database adapter.

---

## Global Query Filters

You can configure global query filters (e.g. for multi-tenant isolation or soft deletes) directly in your context:

```ts
export class AppDbContext extends DbContext {
  users!: DbSet<User>;

  constructor(
    options: any,
    private readonly tenantId: string,
  ) {
    super(options);
  }

  protected override onModelCreating(builder: ModelBuilder): void {
    // Automatically apply tenantId filter to all User queries
    builder.entity(User).hasQueryFilter(u => u.eq('tenantId', this.tenantId));
  }
}
```

To bypass global query filters for administrative tasks:

```ts
const allUsers = await db.users.ignoreQueryFilters().toList();
```

---

## Lifecycle Hooks

EntityTS supports lifecycle hooks on `DbContext` and individual `DbSet` instances:

```ts
db.users.on('created', async user => {
  console.log(`User created: ${user.name}`);
});

db.users.on('updated', async user => {
  console.log(`User updated: ${user.name}`);
});
```
