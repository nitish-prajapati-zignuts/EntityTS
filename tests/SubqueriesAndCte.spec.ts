import { DbSet } from '../src/set/DbSet';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { QueryBuilder } from '../src/query/QueryBuilder';

interface Order {
  id: number;
  customerId: number;
  total: number;
}

interface Account {
  id: number;
  balance: number;
  status: string;
}

describe('CTEs and Subqueries', () => {
  let adapter: MockDbAdapter;
  let ordersSet: DbSet<Order>;
  let accountsSet: DbSet<Account>;

  beforeEach(() => {
    adapter = new MockDbAdapter({
      tables: {
        orders: [
          { id: 1, customerId: 10, total: 500 },
          { id: 2, customerId: 20, total: 1200 },
        ],
        accounts: [
          { id: 10, balance: 150000, status: 'active' },
          { id: 20, balance: 20000, status: 'active' },
        ],
      },
    });
    ordersSet = new DbSet<Order>(adapter, 'orders');
    accountsSet = new DbSet<Account>(adapter, 'accounts');
  });

  describe('Common Table Expressions (CTEs)', () => {
    it('compiles a single WITH clause', async () => {
      const highBalanceQuery = accountsSet.where({ status: 'active' });
      const query = ordersSet.withCte('active_accounts', highBalanceQuery);

      await query.toList();

      expect(adapter.executedQueries).toHaveLength(1);
      const { sql, params } = adapter.executedQueries[0];
      expect(sql).toContain('WITH "active_accounts" AS (SELECT * FROM "accounts" WHERE "status" = @p0)');
      expect(sql).toContain('SELECT * FROM "orders"');
      expect(params?.[0].value).toBe('active');
    });

    it('compiles a WITH RECURSIVE clause', async () => {
      const empSet = new DbSet<any>(adapter, 'employees');
      const baseQuery = empSet.where((w: any) => w.isNull('managerId'));
      const query = ordersSet.withCte('org_tree', baseQuery, true);

      await query.toList();

      const { sql } = adapter.executedQueries[0];
      expect(sql).toContain('WITH RECURSIVE "org_tree" AS (SELECT * FROM "employees" WHERE "managerId" IS NULL)');
    });

    it('compiles multiple chained CTEs', async () => {
      const q1 = accountsSet.where({ status: 'active' });
      const q2 = accountsSet.where({ balance: 100000 });

      const query = ordersSet
        .withCte('active_acc', q1)
        .withCte('rich_acc', q2);

      await query.toList();

      const { sql } = adapter.executedQueries[0];
      expect(sql).toContain('WITH "active_acc" AS (SELECT * FROM "accounts" WHERE "status" = @p0), "rich_acc" AS (SELECT * FROM "accounts" WHERE "balance" = @p1) SELECT * FROM "orders"');
    });
  });

  describe('Subqueries and Existence Predicates', () => {
    it('creates an aliased subquery with asSubquery', () => {
      const sub = accountsSet.where({ status: 'active' }).asSubquery('hvc');
      expect(sub.alias).toBe('hvc');
      expect(sub.tableName).toBe('accounts');
      expect(typeof sub.toSelectSql).toBe('function');
    });

    it('compiles whereExists with dynamic proxy field join predicate', async () => {
      const highValueCustomers = accountsSet
        .where(w => w.gt('balance', 100000))
        .asSubquery('hvc');

      const query = ordersSet.whereExists(highValueCustomers, (order, hvc) => {
        order.customerId.eq(hvc.id);
      });

      await query.toList();

      expect(adapter.executedQueries).toHaveLength(1);
      const { sql, params } = adapter.executedQueries[0];
      expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM "accounts" AS "hvc" WHERE "balance" > @p0 AND ("orders"."customerId" = "hvc"."id"))');
      expect(params?.[0].value).toBe(100000);
    });

    it('compiles whereNotExists correctly', async () => {
      const sub = accountsSet.asSubquery('sub_acc');
      const query = ordersSet.whereNotExists(sub, (order, subAcc) => {
        order.customerId.eq(subAcc.id);
      });

      await query.toList();

      const { sql } = adapter.executedQueries[0];
      expect(sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM "accounts" AS "sub_acc" WHERE ("orders"."customerId" = "sub_acc"."id"))');
    });

    it('supports whereExists with fluent WhereClause callback', async () => {
      const sub = accountsSet.asSubquery('hvc');
      const query = ordersSet.whereExists(sub, clause => {
        clause.eq('status', 'active');
      });

      await query.toList();

      const { sql } = adapter.executedQueries[0];
      expect(sql).toContain('WHERE EXISTS (SELECT 1 FROM "accounts" AS "hvc" WHERE "status" = @p0)');
    });
  });
});
