import { QueryBuilder } from '../src/query/QueryBuilder';
import { WhereClause } from '../src/query/WhereClause';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { MssqlAdapter } from '../src/adapters/MssqlAdapter';
import { PostgresAdapter } from '../src/adapters/PostgresAdapter';

describe('QueryBuilder', () => {
  let mockAdapter: MockDbAdapter;

  beforeEach(() => {
    mockAdapter = new MockDbAdapter();
  });

  it('generates basic SELECT * query', () => {
    const qb = new QueryBuilder(mockAdapter, 'users');
    const { sql, params } = qb.toSelectSql();

    expect(sql).toBe('SELECT * FROM "users"');
    expect(params).toHaveLength(0);
  });

  it('generates SELECT with specific columns and DISTINCT', () => {
    const qb = new QueryBuilder(mockAdapter, 'users').select('id', 'username', 'email').distinct();

    const { sql } = qb.toSelectSql();
    expect(sql).toBe('SELECT DISTINCT "id", "username", "email" FROM "users"');
  });

  it('generates WHERE with equality, inequality, and comparison operators', () => {
    const where = new WhereClause<any>()
      .eq('status', 'active')
      .and()
      .gte('age', 18)
      .and()
      .lt('score', 100);

    const qb = new QueryBuilder(mockAdapter, 'users').where(where);
    const { sql, params } = qb.toSelectSql();

    expect(sql).toBe(
      'SELECT * FROM "users" WHERE "status" = @p0 AND "age" >= @p1 AND "score" < @p2',
    );
    expect(params).toEqual([
      { name: 'p0', value: 'active' },
      { name: 'p1', value: 18 },
      { name: 'p2', value: 100 },
    ]);
  });

  it('generates WHERE with IN, NOT IN, IS NULL, IS NOT NULL, and BETWEEN', () => {
    const where = new WhereClause<any>()
      .in('role', ['admin', 'manager'])
      .and()
      .isNotNull('verifiedAt')
      .and()
      .between('createdYear', 2020, 2025);

    const qb = new QueryBuilder(mockAdapter, 'users').where(where);
    const { sql, params } = qb.toSelectSql();

    expect(sql).toContain('"role" IN (@p0, @p1)');
    expect(sql).toContain('"verifiedAt" IS NOT NULL');
    expect(sql).toContain('"createdYear" BETWEEN @p2 AND @p3');
    expect(params).toHaveLength(4);
  });

  it('generates nested grouped WHERE conditions', () => {
    const where = new WhereClause<any>()
      .eq('isDeleted', false)
      .and()
      .group(sub => {
        sub.eq('role', 'admin').or().gt('points', 500);
      });

    const qb = new QueryBuilder(mockAdapter, 'users').where(where);
    const { sql, params } = qb.toSelectSql();

    expect(sql).toBe(
      'SELECT * FROM "users" WHERE "isDeleted" = @p0 AND ("role" = @p1 OR "points" > @p2)',
    );
    expect(params).toHaveLength(3);
  });

  it('generates joins correctly', () => {
    const qb = new QueryBuilder(mockAdapter, 'orders', 'o')
      .join('INNER', 'users', 'o.userId', 'u.id', 'u')
      .join('LEFT', 'order_items', 'o.id', 'i.orderId', 'i');

    const { sql } = qb.toSelectSql();
    expect(sql).toBe(
      'SELECT * FROM "orders" AS "o" INNER JOIN "users" AS "u" ON "o"."userId" = "u"."id" LEFT JOIN "order_items" AS "i" ON "o"."id" = "i"."orderId"',
    );
  });

  it('formats SQL Server dialect with square brackets and OFFSET FETCH pagination', () => {
    const mssqlAdapter = new MssqlAdapter('mssql://dummy');
    const qb = new QueryBuilder(mssqlAdapter, 'products')
      .orderBy('name', 'asc')
      .limit(10)
      .offset(20);

    const { sql } = qb.toSelectSql();
    expect(sql).toBe(
      'SELECT * FROM [products] ORDER BY [name] ASC OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY',
    );
  });

  it('formats PostgreSQL dialect with double quotes, $ placeholders, and LIMIT OFFSET pagination', () => {
    const pgAdapter = new PostgresAdapter('postgres://dummy');
    const where = new WhereClause<any>().eq('category', 'books');

    const qb = new QueryBuilder(pgAdapter, 'products')
      .where(where)
      .orderBy('price', 'desc')
      .limit(5)
      .offset(15);

    const { sql, params } = qb.toSelectSql();
    expect(sql).toBe(
      'SELECT * FROM "products" WHERE "category" = $1 ORDER BY "price" DESC LIMIT 5 OFFSET 15',
    );
    expect(params[0].value).toBe('books');
  });

  it('generates parameterized INSERT statement', () => {
    const qb = new QueryBuilder(mockAdapter, 'users');
    const { sql, params } = qb.toInsertSql({ username: 'john', email: 'john@example.com' });

    expect(sql).toBe('INSERT INTO "users" ("username", "email") VALUES (@p0, @p1)');
    expect(params).toEqual([
      { name: 'p0', value: 'john' },
      { name: 'p1', value: 'john@example.com' },
    ]);
  });

  it('generates parameterized UPDATE statement with WHERE clause', () => {
    const qb = new QueryBuilder(mockAdapter, 'users');
    qb.getWhereClause().eq('id', 10);
    const { sql, params } = qb.toUpdateSql({ username: 'johnny' });

    expect(sql).toBe('UPDATE "users" SET "username" = @p0 WHERE "id" = @p1');
    expect(params[0].value).toBe('johnny');
    expect(params[1].value).toBe(10);
  });

  it('generates parameterized DELETE statement with WHERE clause', () => {
    const qb = new QueryBuilder(mockAdapter, 'users');
    qb.getWhereClause().eq('id', 5);
    const { sql, params } = qb.toDeleteSql();

    expect(sql).toBe('DELETE FROM "users" WHERE "id" = @p0');
    expect(params[0].value).toBe(5);
  });

  it('generates COUNT and aggregate statements', () => {
    const qb = new QueryBuilder(mockAdapter, 'orders');
    qb.getWhereClause().gt('amount', 50);

    const countRes = qb.toCountSql();
    expect(countRes.sql).toBe('SELECT COUNT(*) AS total FROM "orders" WHERE "amount" > @p0');

    const sumRes = qb.toAggregateSql('SUM', 'amount');
    expect(sumRes.sql).toBe('SELECT SUM("amount") AS val FROM "orders" WHERE "amount" > @p0');
  });
});
