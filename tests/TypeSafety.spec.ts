import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { DbSet } from '../src/set/DbSet';
import { WhereClause } from '../src/query/WhereClause';

interface IOrder {
  id: string;
  customerId: string;
  total: number;
  status: string;
  createdAt: Date;
}

describe('Type Safety & Autocompletion Suggestions', () => {
  let adapter: MockDbAdapter;
  let orderSet: DbSet<IOrder>;

  beforeEach(() => {
    adapter = new MockDbAdapter({
      tables: {
        orders: [
          { id: '1', customerId: 'c1', total: 100, status: 'completed', createdAt: new Date() },
          { id: '2', customerId: 'c1', total: 200, status: 'completed', createdAt: new Date() },
          { id: '3', customerId: 'c2', total: 50, status: 'pending', createdAt: new Date() },
          { id: '4', customerId: 'c2', total: 1200, status: 'completed', createdAt: new Date() },
        ],
      },
    });
    orderSet = new DbSet<IOrder>(adapter, 'orders');
  });

  describe('WhereClause Strong Typing & Selector Functions', () => {
    it('accepts arrow function selectors and matches types', () => {
      const clause = new WhereClause<IOrder>();
      clause
        .eq(o => o.status, 'completed')
        .gt(o => o.total, 50)
        .in(o => o.customerId, ['c1', 'c2'])
        .between(o => o.total, 10, 500);

      expect(clause.conditions).toHaveLength(4);
      expect(clause.conditions[0].column).toBe('status');
      expect(clause.conditions[0].value).toBe('completed');
      expect(clause.conditions[1].column).toBe('total');
      expect(clause.conditions[1].value).toBe(50);
    });

    it('accepts keyof property names with value type checking', () => {
      const clause = new WhereClause<IOrder>();
      clause
        .eq('status', 'completed')
        .gt('total', 100)
        .in('customerId', ['c1']);

      expect(clause.conditions[0].column).toBe('status');
      expect(clause.conditions[1].column).toBe('total');
      expect(clause.conditions[2].column).toBe('customerId');
    });

    it('accepts arbitrary string columns as fallback for unmapped or computed columns', () => {
      const clause = new WhereClause<IOrder>();
      clause.eq('custom_unmapped_column', 'any_val');
      expect(clause.conditions[0].column).toBe('custom_unmapped_column');
    });
  });

  describe('DbSet Fluent Query Autocompletion & Selectors', () => {
    it('supports orderBy with arrow functions and property keys', async () => {
      const q1 = orderSet.orderBy(o => o.total, 'desc');
      const q2 = orderSet.orderBy('total', 'asc').thenBy(o => o.createdAt);
      const q3 = orderSet.orderByDescending('createdAt');

      expect(q1).toBeInstanceOf(DbSet);
      expect(q2).toBeInstanceOf(DbSet);
      expect(q3).toBeInstanceOf(DbSet);
    });

    it('supports sum, avg, min, max with arrow selectors and property keys', async () => {
      const sumByArrow = await orderSet.sum(o => o.total);
      const sumByKey = await orderSet.sum('total');
      expect(sumByArrow).toBe(1550);
      expect(sumByKey).toBe(1550);

      const avgByArrow = await orderSet.avg(o => o.total);
      const avgByKey = await orderSet.avg('total');
      expect(avgByArrow).toBe(387.5);
      expect(avgByKey).toBe(387.5);

      const minVal = await orderSet.min(o => o.total);
      const maxVal = await orderSet.max('total');
      expect(minVal).toBe(50);
      expect(maxVal).toBe(1200);
    });
  });

  describe('Fluent GroupBy & Projected Result Unpacking Inference', () => {
    it('properly infers result object types without manual casting', async () => {
      adapter.executeQuery = jest.fn().mockResolvedValue([
        { customerId: 'c1', orderCount: '2', totalSpent: '300', averageOrder: '150' },
        { customerId: 'c2', orderCount: '1', totalSpent: '1200', averageOrder: '1200' },
      ]);

      const stats = await orderSet
        .where({ status: 'completed' })
        .groupBy(o => o.customerId)
        .having(g => [
          g.sum(o => o.total).greaterThan(100),
          g.key.equals('c1'),
        ])
        .select(g => ({
          customerId: g.key,
          orderCount: g.count(),
          totalSpent: g.sum(o => o.total),
          averageOrder: g.avg(o => o.total),
        }))
        .toList();

      expect(stats).toHaveLength(2);

      // Verify compile-time type assignment (these will fail compilation if types do not match)
      const first = stats[0];
      const customerId: string = first.customerId;
      const orderCount: number = first.orderCount;
      const totalSpent: number = first.totalSpent;
      const averageOrder: number = first.averageOrder;

      expect(customerId).toBe('c1');
      expect(orderCount).toBe(2);
      expect(totalSpent).toBe(300);
      expect(averageOrder).toBe(150);
    });

    it('supports string property names in group proxy aggregations with autocomplete', async () => {
      adapter.executeQuery = jest.fn().mockResolvedValue([
        { customerId: 'c1', totalSpent: '300' },
      ]);

      const result = await orderSet
        .groupBy(o => o.customerId)
        .having(g => g.sum('total').greaterThan(200))
        .select(g => ({
          customerId: g.key,
          totalSpent: g.sum('total'),
        }))
        .firstOrThrow();

      const customerId: string = result.customerId;
      const totalSpent: number = result.totalSpent;

      expect(customerId).toBe('c1');
      expect(totalSpent).toBe(300);
    });
  });
});
