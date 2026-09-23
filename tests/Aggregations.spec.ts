import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Entity,
  Table,
  PrimaryKey,
  Column,
  SqlType,
  MockDbAdapter,
} from '../src';

@Entity()
@Table('orders')
class Order {
  @PrimaryKey()
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'customer_id', type: SqlType.Int })
  customerId!: number;

  @Column({ type: SqlType.VarChar })
  status!: string;

  @Column({ type: SqlType.Decimal })
  total!: number;

  @Column({ type: SqlType.Int })
  quantity!: number;
}

class OrderDbContext extends DbContext {
  public orders = this.set(Order);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        orders: [
          { id: 1, customer_id: 101, status: 'completed', total: 500, quantity: 2 },
          { id: 2, customer_id: 101, status: 'completed', total: 700, quantity: 3 },
          { id: 3, customer_id: 102, status: 'completed', total: 200, quantity: 1 },
          { id: 4, customer_id: 102, status: 'pending', total: 1500, quantity: 5 },
          { id: 5, customer_id: 103, status: 'completed', total: 1200, quantity: 4 },
        ],
      },
    });
  }
}

describe('Advanced Fluent Aggregations (GroupBy, Having, Select, Arrow Aggregates)', () => {
  let ctx: OrderDbContext;

  beforeEach(() => {
    ctx = new OrderDbContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  describe('Direct Arrow Function Aggregates on DbSet', () => {
    it('executes sum using an arrow function selector', async () => {
      const totalAmount = await ctx.orders.sum(o => o.total);
      expect(totalAmount).toBe(4100);
    });

    it('executes avg using an arrow function selector', async () => {
      const averageTotal = await ctx.orders.avg(o => o.total);
      expect(averageTotal).toBe(820);
    });

    it('executes min and max using arrow function selectors', async () => {
      const minOrder = await ctx.orders.min(o => o.total);
      const maxOrder = await ctx.orders.max(o => o.total);
      expect(minOrder).toBe(200);
      expect(maxOrder).toBe(1500);
    });

    it('executes count with an arrow condition', async () => {
      const completedCount = await ctx.orders.count(o => o.eq('status', 'completed'));
      expect(completedCount).toBe(4);
    });

    it('evaluates any() and all() predicates', async () => {
      const hasCompleted = await ctx.orders.any(o => o.eq('status', 'completed'));
      expect(hasCompleted).toBe(true);

      const hasCancelled = await ctx.orders.any(o => o.eq('status', 'cancelled'));
      expect(hasCancelled).toBe(false);

      const allCompleted = await ctx.orders.all(o => o.eq('status', 'completed'));
      expect(allCompleted).toBe(false);
    });
  });

  describe('GroupBy, Having, and Projection pipeline', () => {
    it('compiles expected SQL for GroupBy with Having and Select projection', () => {
      const query = ctx.orders
        .where({ status: 'completed' })
        .groupBy(o => o.customerId)
        .having(g => g.sum(o => o.total).greaterThan(1000))
        .select(g => ({
          customerId: g.key,
          orderCount: g.count(),
          totalSpent: g.sum(o => o.total),
          averageOrder: g.avg(o => o.total),
        }));

      const { sql, params } = query.toSql();
      expect(sql).toContain(
        'SELECT "customer_id" AS "customerId", COUNT(*) AS "orderCount", SUM("total") AS "totalSpent", AVG("total") AS "averageOrder"',
      );
      expect(sql).toContain('FROM "orders"');
      expect(sql).toContain('WHERE "status" = @p0');
      expect(sql).toContain('GROUP BY "customer_id"');
      expect(sql).toContain('HAVING SUM(total) > @p1');
      expect(params).toHaveLength(2);
      expect(params[0].value).toBe('completed');
      expect(params[1].value).toBe(1000);
    });

    it('supports between comparator in having clauses', () => {
      const query = ctx.orders
        .groupBy(o => o.customerId)
        .having(g => g.sum(o => o.total).between(500, 2000))
        .select(g => ({
          customerId: g.key,
          total: g.sum(o => o.total),
        }));

      const { sql, params } = query.toSql();
      expect(sql).toContain('HAVING SUM(total) BETWEEN @p0 AND @p1');
      expect(params[0].value).toBe(500);
      expect(params[1].value).toBe(2000);
    });

    it('executes grouped query and converts numeric aggregate return values', async () => {
      // Mock returns aggregate rows matching SQL query
      const mockAdapter = (ctx as any).adapter as MockDbAdapter;
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([
        { customerId: 101, orderCount: '2', totalSpent: '1200', averageOrder: '600' },
        { customerId: 103, orderCount: '1', totalSpent: '1200', averageOrder: '1200' },
      ]);

      const stats = await ctx.orders
        .where({ status: 'completed' })
        .groupBy(o => o.customerId)
        .having(g => g.sum(o => o.total).greaterThan(1000))
        .select(g => ({
          customerId: g.key,
          orderCount: g.count(),
          totalSpent: g.sum(o => o.total),
          averageOrder: g.avg(o => o.total),
        }))
        .toList();

      expect(stats).toHaveLength(2);
      expect(stats[0]).toEqual({
        customerId: 101,
        orderCount: 2,
        totalSpent: 1200,
        averageOrder: 600,
      });
      expect(stats[1].customerId).toBe(103);
      expect(stats[1].totalSpent).toBe(1200);
    });

    it('supports composite grouping keys', () => {
      const query = ctx.orders
        .groupBy(o => [o.customerId, o.status])
        .select(g => ({
          customerId: g.key.customerId,
          status: g.key.status,
          count: g.count(),
        }));

      const { sql } = query.toSql();
      expect(sql).toContain('GROUP BY "customer_id", "status"');
      expect(sql).toContain('"customer_id" AS "customerId"');
      expect(sql).toContain('"status" AS "status"');
    });

    it('supports orderBy, take, and skip on projected grouped query', () => {
      const query = ctx.orders
        .groupBy(o => o.customerId)
        .select(g => ({
          customerId: g.key,
          total: g.sum(o => o.total),
        }))
        .orderBy('total', 'desc')
        .take(5)
        .skip(10);

      const { sql } = query.toSql();
      expect(sql).toContain('ORDER BY "total" DESC');
      expect(sql).toContain('LIMIT 5 OFFSET 10');
    });
  });
});
