---
id: transactions
title: Unit of Work & Transactions
sidebar_position: 1
---

# Unit of Work & Transactions

EntityTS guarantees ACID atomicity with manual transaction control and automatic execution scopes.

---

## Explicit Transaction Control

```ts
const tx = await db.beginTransaction();
try {
  const accountA = await db.accounts.inTransaction(tx).find(1);
  const accountB = await db.accounts.inTransaction(tx).find(2);

  await db.accounts.inTransaction(tx).update(accountA.id, {
    balance: accountA.balance - 100,
  });

  await db.accounts.inTransaction(tx).update(accountB.id, {
    balance: accountB.balance + 100,
  });

  await tx.commit();
} catch (err) {
  await tx.rollback();
  throw err;
}
```

---

## Scoped Transaction Wrapper

```ts
await db.transaction(async txDb => {
  await txDb.orders.add({ userId: 1, total: 250 });
  await txDb.inventory.update(productId, { stock: currentStock - 1 });
});
```
