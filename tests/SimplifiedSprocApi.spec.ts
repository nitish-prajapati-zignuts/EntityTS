/**
 * Tests for the simplified stored procedure API:
 *   .input({ ... })           — object-based input params, auto type inference
 *   .output<T>(names?)        — typed output params, returns SprocOutputBuilder
 *   .query<T>()               — simple row list
 *   .scalar<T>()              — first column of first row
 *   .run()                    — fire-and-forget
 *   .output<T>().query<T>()   — rows + typed output params together
 *   .output<T>().run()        — no rows, just typed output params
 *   .output<T>().queryMultiple<[A[], B[]]>() — multiple result sets + output params
 */
import { StoredProcedureBuilder } from '../src/procedure/StoredProcedureBuilder';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { ParameterDirection } from '../src/procedure/ParameterDirection';
import { SqlType } from '../src/procedure/SqlType';

interface Order {
  id: number;
  amount: number;
}

interface Product {
  sku: string;
  stock: number;
}

describe('Simplified Stored Procedure API', () => {
  let adapter: MockDbAdapter;

  beforeEach(() => {
    adapter = new MockDbAdapter();
  });

  // ─────────────────────────────────────────────────────────────
  //  .input() — auto type inference
  // ─────────────────────────────────────────────────────────────

  describe('.input()', () => {
    it('accepts a plain object and registers all keys as Input params', () => {
      const builder = new StoredProcedureBuilder(adapter, 'usp_Filter')
        .input({
          Name: 'Alice',
          Age: 30,
          Active: true,
          Score: 9.5,
          CreatedAt: new Date('2024-01-01'),
        });

      const params = builder.getParams();
      expect(params).toHaveLength(5);

      const name  = params.find(p => p.name === 'Name');
      const age   = params.find(p => p.name === 'Age');
      const active = params.find(p => p.name === 'Active');
      const score = params.find(p => p.name === 'Score');
      const date  = params.find(p => p.name === 'CreatedAt');

      // Auto inferred types
      expect(name?.type).toBe(SqlType.NVarChar);
      expect(age?.type).toBe(SqlType.Int);
      expect(active?.type).toBe(SqlType.Bit);
      expect(score?.type).toBe(SqlType.Decimal);
      expect(date?.type).toBe(SqlType.DateTime2);

      // All are Input direction
      params.forEach(p => expect(p.direction).toBe(ParameterDirection.Input));
    });

    it('strips leading @ from parameter names', () => {
      const builder = new StoredProcedureBuilder(adapter, 'usp_Test')
        .input({ '@UserId': 1 });

      const params = builder.getParams();
      expect(params[0].name).toBe('UserId');
    });

    it('can be called multiple times — merges params', () => {
      const builder = new StoredProcedureBuilder(adapter, 'usp_Multi')
        .input({ A: 1 })
        .input({ B: 'hello' });

      expect(builder.getParams()).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  .query<T>() — simple shorthand
  // ─────────────────────────────────────────────────────────────

  describe('.query<T>()', () => {
    it('returns a plain typed array without wrapping in result object', async () => {
      adapter.registerProcedure('usp_GetOrders', {
        records: [{ id: 1, amount: 99 }, { id: 2, amount: 150 }],
        returnValue: 0,
        rowsAffected: 2,
      });

      const orders = await new StoredProcedureBuilder(adapter, 'usp_GetOrders')
        .input({ CustomerId: 10 })
        .query<Order>();

      expect(Array.isArray(orders)).toBe(true);
      expect(orders).toHaveLength(2);
      expect(orders[0].amount).toBe(99);
    });

    it('returns empty array when procedure yields no rows', async () => {
      adapter.registerProcedure('usp_GetOrders', { records: [] });

      const orders = await new StoredProcedureBuilder(adapter, 'usp_GetOrders')
        .input({ CustomerId: 999 })
        .query<Order>();

      expect(orders).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  .scalar<T>() — simple shorthand
  // ─────────────────────────────────────────────────────────────

  describe('.scalar<T>()', () => {
    it('returns the first value of the first row', async () => {
      adapter.registerProcedure('usp_CountPending', {
        records: [{ pendingCount: 42 }],
        returnValue: 0,
      });

      const count = await new StoredProcedureBuilder(adapter, 'usp_CountPending')
        .input({ UserId: 7 })
        .scalar<number>();

      expect(count).toBe(42);
    });

    it('returns null when no rows', async () => {
      adapter.registerProcedure('usp_CountPending', { records: [] });

      const count = await new StoredProcedureBuilder(adapter, 'usp_CountPending')
        .scalar<number>();

      expect(count).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  .run() — fire-and-forget
  // ─────────────────────────────────────────────────────────────

  describe('.run()', () => {
    it('returns rowsAffected and returnValue without needing output params', async () => {
      adapter.registerProcedure('usp_DeleteUser', {
        rowsAffected: 1,
        returnValue: 0,
      });

      const result = await new StoredProcedureBuilder(adapter, 'usp_DeleteUser')
        .input({ UserId: 5, Reason: 'violation' })
        .run();

      expect(result.rowsAffected).toBe(1);
      expect(result.returnValue).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  .output<T>().run() — output params, no result set
  // ─────────────────────────────────────────────────────────────

  describe('.output<T>().run()', () => {
    it('returns typed output params with no rows', async () => {
      interface CreateResult {
        NewUserId: number;
        SlugGenerated: string;
      }

      adapter.registerProcedure('usp_CreateUser', {
        outputParams: { NewUserId: 1001, SlugGenerated: 'alice-smith' },
        returnValue: 0,
        rowsAffected: 1,
      });

      const { out, rowsAffected, returnValue } = await new StoredProcedureBuilder(
        adapter,
        'usp_CreateUser'
      )
        .input({ Name: 'Alice Smith', Email: 'alice@example.com' })
        .output<CreateResult>(['NewUserId', 'SlugGenerated'])
        .run();

      // Typed access — no `as any`, no index signature needed
      expect(out.NewUserId).toBe(1001);
      expect(out.SlugGenerated).toBe('alice-smith');
      expect(rowsAffected).toBe(1);
      expect(returnValue).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  .output<T>().query<TRecord>() — rows + output params
  // ─────────────────────────────────────────────────────────────

  describe('.output<T>().query<TRecord>()', () => {
    it('returns both typed rows and typed output params', async () => {
      interface SummaryOut {
        TotalAmount: number;
        ProcessedAt: string;
      }

      adapter.registerProcedure('usp_GetOrderSummary', {
        records: [{ id: 1, amount: 99 }, { id: 2, amount: 150 }],
        outputParams: { TotalAmount: 249, ProcessedAt: '2024-09-21' },
        returnValue: 0,
        rowsAffected: 2,
      });

      const { records, out } = await new StoredProcedureBuilder(
        adapter,
        'usp_GetOrderSummary'
      )
        .input({ CustomerId: 10, StatusFilter: 'paid' })
        .output<SummaryOut>(['TotalAmount', 'ProcessedAt'])
        .query<Order>();

      expect(records).toHaveLength(2);
      expect(records[0].amount).toBe(99);
      expect(out.TotalAmount).toBe(249);
      expect(out.ProcessedAt).toBe('2024-09-21');
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  .output<T>().queryMultiple<[A[], B[]]>() — multiple result sets
  // ─────────────────────────────────────────────────────────────

  describe('.output<T>().queryMultiple<>()', () => {
    it('returns multiple result sets with typed output params', async () => {
      interface DashboardOut {
        LastRefreshed: string;
      }

      adapter.registerProcedure('usp_GetDashboard', {
        records: [
          [{ id: 1, amount: 100 }],
          [{ sku: 'ABC', stock: 50 }],
        ],
        outputParams: { LastRefreshed: '2024-09-21T10:00:00Z' },
        returnValue: 0,
        rowsAffected: 2,
      });

      const { records, out } = await new StoredProcedureBuilder(
        adapter,
        'usp_GetDashboard'
      )
        .input({ DeptId: 4 })
        .output<DashboardOut>(['LastRefreshed'])
        .queryMultiple<[Order[], Product[]]>();

      const [orders, products] = records;
      expect(orders[0].amount).toBe(100);
      expect(products[0].sku).toBe('ABC');
      expect(out.LastRefreshed).toBe('2024-09-21T10:00:00Z');
    });
  });

  // ─────────────────────────────────────────────────────────────
  //  Mixed: advanced + simplified in same builder
  // ─────────────────────────────────────────────────────────────

  describe('Mixed advanced and simplified API', () => {
    it('supports combining .input() with .withOutputParam() and .withTimeout()', async () => {
      adapter.registerProcedure('usp_AdvancedProc', {
        outputParams: { ResultCode: 200 },
        returnValue: 0,
        rowsAffected: 1,
      });

      const result = await new StoredProcedureBuilder(adapter, 'usp_AdvancedProc')
        .input({ UserId: 42 })                          // simplified input
        .withOutputParam('ResultCode', SqlType.Int)     // advanced output
        .withTimeout(5000)                              // advanced option
        .execute();

      expect(result.outputParams['ResultCode']).toBe(200);
    });
  });
});
