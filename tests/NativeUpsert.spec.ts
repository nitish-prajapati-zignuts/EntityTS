import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';
import { Entity, Table, PrimaryKey, Column } from '../src/decorators';
import { QueryBuilder } from '../src/query/QueryBuilder';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';

@Table('accounts')
class Account {
  @PrimaryKey()
  id!: number;

  @Column()
  email!: string;

  @Column()
  name!: string;

  @Column()
  balance!: number;
}

class AccountDbContext extends DbContext {
  public accounts = this.set(Account);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock();
  }
}

function createMockAdapter(provider: string): any {
  return {
    provider,
    escapeIdentifier: (id: string) =>
      provider === 'mssql' ? `[${id}]` : provider === 'mysql' ? `\`${id}\`` : `"${id}"`,
    formatParameterPlaceholder: (name: string, index: number) => {
      if (provider === 'postgres') return `$${index}`;
      if (provider === 'mssql') return `@${name}`;
      return '?';
    },
  };
}

describe('Native Upsert Support (INSERT ... ON CONFLICT / ON DUPLICATE KEY UPDATE / MERGE)', () => {
  describe('Dialect-Specific SQL Compilation in QueryBuilder', () => {
    it('compiles PostgreSQL / Neon / Supabase syntax with ON CONFLICT and RETURNING *', () => {
      const adapter = createMockAdapter('postgres');
      const qb = new QueryBuilder(adapter, 'accounts');

      const { sql, params } = qb.toUpsertSql(
        { email: 'user@corp.com' },
        { balance: 5000, name: 'Updated' }
      );

      expect(sql).toContain('INSERT INTO "accounts"');
      expect(sql).toContain('ON CONFLICT ("email") DO UPDATE SET');
      expect(sql).toContain('"balance" = EXCLUDED."balance"');
      expect(sql).toContain('"name" = EXCLUDED."name"');
      expect(sql).toContain('RETURNING *');
      expect(params).toHaveLength(3);
    });

    it('compiles MySQL / PlanetScale syntax with ON DUPLICATE KEY UPDATE', () => {
      const adapter = createMockAdapter('mysql');
      const qb = new QueryBuilder(adapter, 'accounts');

      const { sql, params } = qb.toUpsertSql(
        { email: 'user@corp.com' },
        { balance: 5000, name: 'Updated' }
      );

      expect(sql).toContain('INSERT INTO `accounts`');
      expect(sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(sql).toContain('`balance` = VALUES(`balance`)');
      expect(sql).toContain('`name` = VALUES(`name`)');
      expect(sql).not.toContain('RETURNING *');
      expect(params).toHaveLength(3);
    });

    it('compiles MSSQL syntax with MERGE INTO and OUTPUT INSERTED.*', () => {
      const adapter = createMockAdapter('mssql');
      const qb = new QueryBuilder(adapter, 'accounts');

      const { sql, params } = qb.toUpsertSql(
        { email: 'user@corp.com' },
        { balance: 5000, name: 'Updated' }
      );

      expect(sql).toContain('MERGE INTO [accounts] AS target');
      expect(sql).toContain('USING (VALUES (@p0, @p1, @p2)) AS source ([email], [balance], [name])');
      expect(sql).toContain('ON target.[email] = source.[email]');
      expect(sql).toContain('WHEN MATCHED THEN UPDATE SET target.[balance] = source.[balance], target.[name] = source.[name]');
      expect(sql).toContain('WHEN NOT MATCHED THEN INSERT ([email], [balance], [name]) VALUES (source.[email], source.[balance], source.[name])');
      expect(sql).toContain('OUTPUT INSERTED.*;');
      expect(params).toHaveLength(3);
    });

    it('compiles SQLite syntax with ON CONFLICT and RETURNING *', () => {
      const adapter = new MockDbAdapter();
      (adapter as any).provider = 'sqlite';
      const qb = new QueryBuilder(adapter, 'accounts');

      const { sql, params } = qb.toUpsertSql(
        { email: 'user@corp.com' },
        { balance: 5000, name: 'Updated' }
      );

      expect(sql).toContain('INSERT INTO "accounts"');
      expect(sql).toContain('ON CONFLICT ("email") DO UPDATE SET');
      expect(sql).toContain('RETURNING *');
    });
  });

  describe('Runtime Execution via DbSet.upsert(conflictTarget, updatePayload)', () => {
    let db: AccountDbContext;

    beforeEach(() => {
      db = new AccountDbContext();
    });

    afterEach(async () => {
      await db.dispose();
    });

    it('inserts a new entity when conflict target does not exist', async () => {
      const created = await db.accounts.upsert(
        { email: 'user@corp.com' },
        { balance: 5000, name: 'Created' }
      );

      expect(created).toBeDefined();
      expect(created.email).toBe('user@corp.com');
      expect(created.balance).toBe(5000);
      expect(created.name).toBe('Created');

      const inDb = await db.accounts.first({ email: 'user@corp.com' });
      expect(inDb).toBeDefined();
      expect(inDb?.balance).toBe(5000);
    });

    it('updates existing entity when conflict target matches existing row', async () => {
      // First insert initial row
      await db.accounts.add({
        email: 'user@corp.com',
        name: 'Initial Name',
        balance: 1000,
      });

      // Now perform native upsert on existing email
      const updated = await db.accounts.upsert(
        { email: 'user@corp.com' },
        { balance: 5000, name: 'Updated Name' }
      );

      expect(updated).toBeDefined();
      expect(updated.email).toBe('user@corp.com');
      expect(updated.balance).toBe(5000);
      expect(updated.name).toBe('Updated Name');

      // Verify database has only 1 row and was updated
      const count = await db.accounts.count({ email: 'user@corp.com' });
      expect(count).toBe(1);

      const inDb = await db.accounts.first({ email: 'user@corp.com' });
      expect(inDb?.balance).toBe(5000);
      expect(inDb?.name).toBe('Updated Name');
    });

    it('maintains backwards compatibility with Prisma-style upsert({ where, update, create })', async () => {
      const res1 = await db.accounts.upsert({
        where: { email: 'prisma@corp.com' },
        create: { name: 'Prisma User', balance: 200 },
        update: { balance: 999 },
      });
      expect(res1.balance).toBe(200);

      const res2 = await db.accounts.upsert({
        where: { email: 'prisma@corp.com' },
        create: { name: 'Prisma User', balance: 200 },
        update: { balance: 999 },
      });
      expect(res2.balance).toBe(999);
    });

    it('maintains backwards compatibility with entity-and-keys upsert(entity, [keys])', async () => {
      const res = await db.accounts.upsert(
        { email: 'legacy@corp.com', name: 'Legacy', balance: 123 },
        ['email']
      );
      expect(res.email).toBe('legacy@corp.com');
      expect(res.balance).toBe(123);
    });
  });
});
