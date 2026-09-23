---
id: entities-and-models
title: Entities & Decorators
sidebar_position: 2
---

# Entities & Decorators

Entity models are standard TypeScript classes decorated with EntityTS metadata annotations.

---

## Model Decorators

| Decorator                              | Description                                |
| -------------------------------------- | ------------------------------------------ |
| `@Entity({ tableName })`               | Marks class as a database table entity     |
| `@PrimaryKey({ autoIncrement })`       | Declares primary key column                |
| `@Column({ type, nullable, default })` | Maps a property to a table column          |
| `@Index({ name, unique })`             | Declares database index                    |
| `@CreatedAt()` / `@UpdatedAt()`        | Automatic timestamp auditing               |
| `@SoftDelete()`                        | Soft deletion with `deletedAt` filtering   |
| `@Version()`                           | Optimistic concurrency integer counter     |
| `@ConcurrencyCheck()`                  | Column-level concurrency check             |
| `@Encrypted()`                         | AES-256 transparent field-level encryption |
| `@HasMany(() => Target, 'fk')`         | One-to-Many relationship                   |
| `@BelongsTo(() => Target, 'fk')`       | Many-to-One relationship                   |
| `@HasOne(() => Target, 'fk')`          | One-to-One relationship                    |

---

## Example Complete Model

```ts
import {
  Entity,
  PrimaryKey,
  Column,
  CreatedAt,
  UpdatedAt,
  SoftDelete,
  Version,
  HasMany,
} from 'entityts';
import { Post } from './Post';

@Entity({ tableName: 'users' })
export class User {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column({ length: 100 })
  name!: string;

  @Column({ unique: true })
  email!: string;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;

  @SoftDelete()
  deletedAt?: Date;

  @Version()
  version!: number;

  @HasMany(() => Post, 'authorId')
  posts?: Post[];
}
```
