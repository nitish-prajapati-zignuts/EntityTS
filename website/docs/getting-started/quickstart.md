---
id: quickstart
title: Quick Start
sidebar_position: 1
---

# Quick Start Guide

Get up and running with **EntityTS** in your TypeScript project in just a few simple steps.

---

## 1. Installation

Install `entityts` and its required peer dependency `reflect-metadata`:

```bash
npm install entityts reflect-metadata
```

Make sure your `tsconfig.json` enables experimental decorators:

```json title="tsconfig.json"
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Import `reflect-metadata` once at the very top of your application entrypoint (e.g. `src/index.ts` or `src/main.ts`):

```ts
import 'reflect-metadata';
```

---

## 2. Define an Entity

Use standard decorators to define your entity class and table mapping:

```ts title="src/models/User.ts"
import { Entity, PrimaryKey, Column } from 'entityts';

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column()
  name!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ default: 'user' })
  role!: string;

  @Column({ default: true })
  isActive!: boolean;
}
```

---

## 3. Create your DbContext

Extend `DbContext` and declare your `DbSet<T>` properties:

```ts title="src/data/AppDbContext.ts"
import { DbContext, DbSet } from 'entityts';
import { User } from '../models/User';

export class AppDbContext extends DbContext {
  users!: DbSet<User>;
}
```

---

## 4. Initialize and Query

Instantiate your context with a database connection string:

```ts title="src/app.ts"
import 'reflect-metadata';
import { AppDbContext } from './data/AppDbContext';
import { User } from './models/User';

async function main() {
  const db = new AppDbContext({
    connectionString: 'sqlite::memory:',
  });

  // Automatically ensure tables exist (for dev/testing)
  await db.ensureCreated();

  // 1. Insert a new record
  const alice = await db.users.add({
    name: 'Alice Johnson',
    email: 'alice@example.com',
    role: 'admin',
    isActive: true,
  });
  console.log('Created user:', alice);

  // 2. Query with fluent LINQ operators
  const activeAdmins = await db.users
    .where('role', '=', 'admin')
    .where('isActive', '=', true)
    .orderBy(u => u.name, 'asc')
    .toList();

  console.log('Active Admins:', activeAdmins);
}

main().catch(console.error);
```
