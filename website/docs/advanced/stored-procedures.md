---
id: stored-procedures
title: Stored Procedures & Functions
sidebar_position: 2
---

# Stored Procedures & Database Routines

EntityTS provides enterprise-grade, strongly typed stored procedure and user-defined function execution across **Microsoft SQL Server**, **MySQL / MariaDB**, **PostgreSQL**, and **Oracle Database**.

Whether you are calling legacy procedures with complex `OUTPUT` parameters, reading multiple tabular result sets (Dapper-style `GridReader`), or passing Table-Valued Parameters (TVP), EntityTS provides a clean and unified TypeScript API.

---

## Key Capabilities

- **Automatic Type Inference**: Plain JavaScript values automatically infer SQL types (`string` → `NVarChar`, `number` → `Int`/`Decimal`, `Date` → `DateTime2`).
- **Multi-Result Sets**: Fetch composite datasets (e.g. Header + Details + Totals) in a single database network round-trip.
- **Typed OUTPUT & INOUT Parameters**: Full TypeScript compile-time safety on returned `.out` properties.
- **Transaction & Timeout Binding**: Execute procedures within an active `DbTransaction` or `UnitOfWork` with statement timeout safeguards.
- **Dialect-Aware Translation**: Automatically emits `EXEC` (MSSQL), `CALL` (MySQL / PostgreSQL), or `SELECT * FROM fn()` (PostgreSQL Functions).

---

## 1. Single Result Set Queries

Fetch tabular records into typed entity or view models.

```ts
import { AppDbContext, Order } from './db';

const db = new AppDbContext();

// Fetches active orders for customer
const orders = await db
  .procedure('usp_GetCustomerOrders')
  .input({ CustomerId: 101, Status: 'SHIPPED' })
  .query<Order>();

console.log(`Retrieved ${orders.length} orders`);
```

### Multi-Database Behavior

| Database                 | Generated SQL Execution                                       |
| :----------------------- | :------------------------------------------------------------ |
| **Microsoft SQL Server** | `EXEC usp_GetCustomerOrders @CustomerId = @p0, @Status = @p1` |
| **MySQL / MariaDB**      | `CALL sp_get_customer_orders(?, ?)`                           |
| **PostgreSQL**           | `SELECT * FROM fn_get_customer_orders($1, $2)`                |
| **Oracle**               | `BEGIN usp_GetCustomerOrders(:p0, :p1, :cur); END;`           |

---

## 2. OUTPUT & INOUT Parameters

Execute business actions (like creating an invoice, generating order tokens, or processing payments) that return data via `OUTPUT` or `INOUT` parameters.

```ts
const { out, returnValue, rowsAffected } = await db
  .procedure('usp_CreateInvoice')
  .input({
    CustomerId: 42,
    SubTotal: 249.99,
    TaxRate: 0.08,
  })
  .output<{
    InvoiceNumber: string;
    GeneratedId: number;
    CalculatedTotal: number;
  }>()
  .run();

console.log('Invoice No:', out.InvoiceNumber); // e.g. "INV-2026-0042"
console.log('New ID:', out.GeneratedId); // e.g. 1092
console.log('Final Total:', out.CalculatedTotal); // e.g. 269.99
console.log('Return Status:', returnValue); // 0 = Success
```

---

## 3. Multiple Result Sets (GridReader)

Fetch multiple related tables in a single round-trip without issuing multiple queries.

### Tuple Syntax (`.queryMultiple<T>()`)

```ts
interface CustomerSummary {
  id: number;
  name: string;
  email: string;
}

interface OrderHistory {
  orderId: number;
  orderDate: Date;
  total: number;
}

interface NotificationItem {
  id: number;
  message: string;
}

// Single round-trip returning 3 tables
const [customer, orders, alerts] = await db
  .procedure('usp_GetCustomerDashboard')
  .input({ CustomerId: 101 })
  .queryMultiple<[CustomerSummary[], OrderHistory[], NotificationItem[]]>();

console.log('Customer:', customer[0].name);
console.log('Total Orders:', orders.length);
console.log('Unread Alerts:', alerts.length);
```

### Sequential Reader Syntax (`.reader()`)

For dynamic or branch-dependent result sets, consume tables sequentially:

```ts
const reader = await db
  .procedure('usp_GetComplexReport')
  .input({ Year: 2026, Quarter: 1 })
  .reader();

const executiveSummary = reader.readFirst<ExecutiveSummary>(); // Table 1 (first row)
const regionalSales = reader.read<RegionalSales>(); // Table 2 (all rows)
const productBreakdown = reader.read<ProductBreakdown>(); // Table 3 (all rows)
```

---

## 4. Scalar Queries & Maintenance Actions

### Single Scalar Value

```ts
const totalRevenue = await db
  .procedure('usp_CalculateRevenue')
  .input({ Year: 2026, Month: 9 })
  .scalar<number>();

console.log('Monthly Revenue:', totalRevenue);
```

### Action Mutation (Fire & Forget / DML)

```ts
const { rowsAffected } = await db
  .procedure('usp_PurgeOldSessions')
  .input({ OlderThanDays: 30 })
  .run();

console.log(`Purged ${rowsAffected} expired sessions.`);
```

---

## 5. Transactions & Execution Timeouts

Bind stored procedure execution to an existing Unit of Work or database transaction with custom timeouts:

```ts
await db.useTransaction(async tx => {
  // Step 1: Debit source account via stored procedure
  await db
    .procedure('usp_DebitAccount')
    .input({ AccountId: fromId, Amount: 500 })
    .inTransaction(tx)
    .withTimeout(10000) // 10 second timeout
    .run();

  // Step 2: Credit target account via stored procedure
  await db
    .procedure('usp_CreditAccount')
    .input({ AccountId: toId, Amount: 500 })
    .inTransaction(tx)
    .withTimeout(10000)
    .run();

  // Step 3: Insert audit log
  await db.auditLogs.inTransaction(tx).add({
    action: 'FUNDS_TRANSFER',
    details: `Transferred 500 from ${fromId} to ${toId}`,
  });
});
```

---

## 6. Detailed Multi-Database Setup Examples

### SQL Server (MSSQL) Definition

```sql
CREATE PROCEDURE usp_CreateOrder
    @CustomerId INT,
    @Total DECIMAL(18,2),
    @OrderId INT OUTPUT,
    @TrackingNumber NVARCHAR(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO Orders (CustomerId, Total, CreatedAt)
    VALUES (@CustomerId, @Total, GETUTCDATE());

    SET @OrderId = SCOPE_IDENTITY();
    SET @TrackingNumber = 'TRK-' + CAST(@OrderId AS NVARCHAR(20));
    RETURN 0;
END;
```

### MySQL / MariaDB Definition

```sql
CREATE PROCEDURE sp_create_order(
    IN p_customer_id INT,
    IN p_total DECIMAL(18,2),
    OUT p_order_id INT,
    OUT p_tracking_number VARCHAR(50)
)
BEGIN
    INSERT INTO orders (customer_id, total, created_at)
    VALUES (p_customer_id, p_total, UTC_TIMESTAMP());

    SET p_order_id = LAST_INSERT_ID();
    SET p_tracking_number = CONCAT('TRK-', p_order_id);
END;
```

### PostgreSQL Stored Procedure (`CALL`)

```sql
CREATE OR REPLACE PROCEDURE sp_create_order(
    IN p_customer_id INT,
    IN p_total NUMERIC,
    INOUT p_order_id INT DEFAULT NULL,
    INOUT p_tracking_number VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO orders (customer_id, total, created_at)
    VALUES (p_customer_id, p_total, clock_timestamp())
    RETURNING id INTO p_order_id;

    p_tracking_number := 'TRK-' || p_order_id;
END;
$$;
```
