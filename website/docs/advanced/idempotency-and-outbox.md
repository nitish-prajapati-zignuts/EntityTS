---
id: idempotency-and-outbox
title: Idempotency & Outbox Pattern
sidebar_position: 5
---

# Idempotency & Outbox Pattern

EntityTS includes production-ready engines for guaranteed at-least-once message delivery and exactly-once API execution.

---

## Transactional Outbox Pattern

Guarantees that database state changes and outbound event messages are committed atomically in the same database transaction:

```ts
import { OutboxEngine } from 'entityts/outbox';

const outbox = new OutboxEngine(adapter);

// Publish inside unit of work
await db.transaction(async txDb => {
  const user = await txDb.users.add({ name: 'Bob', email: 'bob@example.com' });

  await outbox.publish(
    'UserRegistered',
    {
      userId: user.id,
      email: user.email,
    },
    { transaction: txDb.getTransaction() },
  );
});

// Outbox background worker process
await outbox.startWorker(async message => {
  await kafkaProducer.send({ topic: message.topic, message: message.payload });
});
```

---

## Distributed Idempotency Keys

Guard HTTP endpoints or message consumers against duplicate submissions:

```ts
import { IdempotencyEngine } from 'entityts/idempotency';

const idempotency = new IdempotencyEngine(adapter);

app.post('/api/orders', async (req, res) => {
  const key = req.headers['idempotency-key'] as string;

  const result = await idempotency.execute(
    key,
    async () => {
      return await orderService.createOrder(req.body);
    },
    { ttlSeconds: 86400 },
  );

  res.json(result);
});
```
