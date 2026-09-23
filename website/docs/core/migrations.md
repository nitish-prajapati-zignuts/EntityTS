---
id: migrations
title: Migrations & Schema DDL
sidebar_position: 3
---

# Migrations & Schema DDL

EntityTS provides Code-First schema generation, automatic diffing, and programmatic migration management.

---

## Code-First Schema Generation

```ts
import { SchemaGenerator } from 'entityts';

// Ensure all tables defined in context are created
await db.ensureCreated();

// Generate SQL DDL script for current models
const ddl = SchemaGenerator.generateDdl(db, 'postgres');
console.log(ddl);
```

---

## Migration Runner

Programmatic schema migrations with up/down tracking:

```ts
import { MigrationRunner, MigrationBuilder } from 'entityts';

const runner = new MigrationRunner(adapter);

await runner.up([
  {
    name: '20260923_CreateUsers',
    up: async (builder: MigrationBuilder) => {
      builder.createTable('users', table => {
        table.increments('id').primaryKey();
        table.string('name').notNull();
        table.string('email').unique().notNull();
        table.timestamps();
      });
    },
    down: async (builder: MigrationBuilder) => {
      builder.dropTable('users');
    },
  },
]);
```
