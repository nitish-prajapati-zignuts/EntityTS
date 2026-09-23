---
id: vector-embeddings
title: AI Vector Search & Embeddings
sidebar_position: 4
---

# AI Vector Search & Embeddings

EntityTS provides first-class support for **pgvector** and high-dimensional vector embeddings for AI semantic search.

---

## Entity Vector Decorator

```ts
import { Entity, PrimaryKey, Column, Vector } from 'entityts';

@Entity({ tableName: 'documents' })
export class Document {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column()
  content!: string;

  @Vector({ dimensions: 1536 })
  embedding!: number[];
}
```

---

## Nearest-Neighbor Search

```ts
const userQueryVector = [0.012, -0.043, 0.812, ...];

// Find top 5 most semantically similar documents
const matches = await db.documents
  .nearest(d => d.embedding, userQueryVector, {
    metric: 'cosine', // 'cosine' (<=>), 'l2' (<->), 'innerProduct' (<#>)
    limit: 5,
  })
  .toList();
```
