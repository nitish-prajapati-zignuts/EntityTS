---
id: stored-procedures
title: Stored Procedures & Functions
sidebar_position: 2
---

# Stored Procedures & Functions

EntityTS offers enterprise-first, type-safe stored procedure and user-defined function execution across PostgreSQL, MySQL, and Microsoft SQL Server.

---

## Simplified Fluent API

```ts
// Input parameters + plain typed result array
const customers = await db
  .sproc('GetTopCustomers')
  .input({ minSpend: 1000, limit: 10 })
  .query<Customer>();

// Stored Procedure with Output Parameter
const result = await db
  .sproc('ProcessPayment')
  .input({ orderId: 456, amount: 99.99 })
  .output<{ paymentId: number; status: string }>()
  .run();

console.log(result.outputs.paymentId);
```

---

## Multiple Result Sets

```ts
const [orders, orderItems] = await db
  .sproc('GetOrderDetails')
  .input({ orderId: 101 })
  .queryMultiple<[Order[], OrderItem[]]>();
```

---

## Class-Based Decorator Definition

```ts
import { StoredProcedure, SqlParameter, ParamDirection } from 'entityts';

@StoredProcedure('sp_GenerateMonthlyReport')
export class GenerateMonthlyReportSproc {
  @SqlParameter({ name: 'Month', type: 'Int' })
  month!: number;

  @SqlParameter({ name: 'Year', type: 'Int' })
  year!: number;

  @SqlParameter({ name: 'TotalGenerated', direction: ParamDirection.Output, type: 'Int' })
  totalGenerated?: number;
}

// Execution
const sproc = new GenerateMonthlyReportSproc();
sproc.month = 9;
sproc.year = 2026;
await db.execute(sproc);
console.log('Total:', sproc.totalGenerated);
```
