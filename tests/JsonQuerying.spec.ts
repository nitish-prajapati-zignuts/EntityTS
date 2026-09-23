import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  PrimaryKey,
  Column,
  QueryBuilder,
  PostgresAdapter,
  MysqlAdapter,
  SqliteAdapter,
  MssqlAdapter,
  MockDbAdapter,
} from '../src';

@Entity()
@Table('users')
class User {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  name!: string;

  @Column()
  metadata!: any;
}

class UserDbContext extends DbContext {
  public users = this.set(User);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        users: [
          {
            id: 1,
            name: 'Alice',
            metadata: {
              address: { city: 'New York', zip: '10001' },
              preferences: { theme: 'dark', notifications: true },
              tags: ['admin', 'vip'],
            },
          },
          {
            id: 2,
            name: 'Bob',
            metadata: {
              address: { city: 'San Francisco', zip: '94101' },
              preferences: { theme: 'light', notifications: false },
              tags: ['user'],
            },
          },
          {
            id: 3,
            name: 'Charlie',
            metadata: {
              address: { city: 'New York', zip: '10002' },
              preferences: { theme: 'dark', notifications: false },
              tags: ['contractor'],
            },
          },
        ],
      },
    });
  }
}

describe('Native JSON Column Querying & Path Navigation', () => {
  describe('Dialect-Specific SQL Translation', () => {
    it('translates to PostgreSQL arrow operators (metadata->\'address\'->>\'city\')', () => {
      const pgAdapter = new PostgresAdapter('postgresql://localhost/test');
      const qb = new QueryBuilder(pgAdapter, 'users');
      qb.getWhereClause().whereJson('metadata', 'address.city', '=', 'New York');

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain('"metadata"->\'address\'->>\'city\' = $1');
      expect(params[0].value).toBe('New York');
    });

    it('translates single-level paths in PostgreSQL to direct unquote arrow (->>)', () => {
      const pgAdapter = new PostgresAdapter('postgresql://localhost/test');
      const qb = new QueryBuilder(pgAdapter, 'users');
      qb.getWhereClause().whereJson('metadata', 'theme', '=', 'dark');

      const { sql } = qb.toSelectSql();
      expect(sql).toContain('"metadata"->>\'theme\' = $1');
    });

    it('translates to MySQL JSON_UNQUOTE(JSON_EXTRACT(metadata, \'$.address.city\'))', () => {
      const mysqlAdapter = new MysqlAdapter('mysql://localhost/test');
      const qb = new QueryBuilder(mysqlAdapter, 'users');
      qb.getWhereClause().whereJson('metadata', 'address.city', '=', 'New York');

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain("JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.address.city')) = ?");
      expect(params[0].value).toBe('New York');
    });

    it('translates to SQLite json_extract(metadata, \'$.address.city\')', () => {
      const sqliteAdapter = new SqliteAdapter(':memory:');
      const qb = new QueryBuilder(sqliteAdapter, 'users');
      qb.getWhereClause().whereJson('metadata', 'address.city', '=', 'New York');

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain("json_extract(\"metadata\", '$.address.city') = ?");
      expect(params[0].value).toBe('New York');
    });

    it('translates to MSSQL JSON_VALUE(metadata, \'$.address.city\')', () => {
      const mssqlAdapter = new MssqlAdapter('Server=localhost;Database=test;');
      const qb = new QueryBuilder(mssqlAdapter, 'users');
      qb.getWhereClause().whereJson('metadata', 'address.city', '=', 'New York');

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain("JSON_VALUE([metadata], '$.address.city') = @p0");
      expect(params[0].value).toBe('New York');
    });
  });

  describe('DbSet.whereJson Fluent Querying', () => {
    let ctx: UserDbContext;

    beforeEach(() => {
      ctx = new UserDbContext();
    });

    it('queries JSON property with equality operator', async () => {
      const nyUsers = await ctx.users
        .whereJson('metadata', 'address.city', '=', 'New York')
        .toList();

      expect(nyUsers).toHaveLength(2);
      expect(nyUsers.map(u => u.name).sort()).toEqual(['Alice', 'Charlie']);
    });

    it('defaults operator to "=" when 3 arguments are passed', async () => {
      const sfUsers = await ctx.users
        .whereJson('metadata', 'address.city', 'San Francisco')
        .toList();

      expect(sfUsers).toHaveLength(1);
      expect(sfUsers[0].name).toBe('Bob');
    });

    it('supports chained conditions combining regular columns and JSON paths', async () => {
      const darkNyUsers = await ctx.users
        .whereJson('metadata', 'address.city', '=', 'New York')
        .whereJson('metadata', 'preferences.theme', '=', 'dark')
        .toList();

      expect(darkNyUsers).toHaveLength(2);
      expect(darkNyUsers.map(u => u.name)).toEqual(['Alice', 'Charlie']);
    });

    it('supports inequality operator (!=)', async () => {
      const nonNyUsers = await ctx.users
        .whereJson('metadata', 'address.city', '!=', 'New York')
        .toList();

      expect(nonNyUsers).toHaveLength(1);
      expect(nonNyUsers[0].name).toBe('Bob');
    });

    it('supports nested whereJson inside where callback', async () => {
      const users = await ctx.users
        .where(w => {
          w.whereJson('metadata', 'address.city', '=', 'New York');
        })
        .toList();

      expect(users).toHaveLength(2);
    });
  });
});
