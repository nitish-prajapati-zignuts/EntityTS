import { QueryBuilder } from '../src/query/QueryBuilder';
import { WhereClause } from '../src/query/WhereClause';
import { IDbAdapter } from '../src/adapters/IDbAdapter';
import { DbSet } from '../src/set/DbSet';

function createMockAdapter(provider: string): IDbAdapter {
  return {
    provider,
    escapeIdentifier: (id: string) => (provider === 'mssql' ? `[${id}]` : provider === 'mysql' ? `\`${id}\`` : `"${id}"`),
    formatParameterPlaceholder: (name: string, index: number) => {
      if (provider === 'postgres') return `$${index}`;
      if (provider === 'mssql') return `@${name}`;
      return '?';
    },
    connect: jest.fn(),
    disconnect: jest.fn(),
    execute: jest.fn(),
    query: jest.fn(),
    beginTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    isConnected: () => true,
  } as unknown as IDbAdapter;
}

describe('Pessimistic Row Locking Across Dialects', () => {
  describe('PostgreSQL / Neon / CockroachDB Locking Syntax', () => {
    it('generates FOR UPDATE for exclusive row locks', () => {
      const adapter = createMockAdapter('postgres');
      const qb = new QueryBuilder(adapter, 'accounts');
      const { sql } = qb.where(new WhereClause().eq('id', 101)).forUpdate().toSelectSql();

      expect(sql).toContain('SELECT * FROM "accounts" WHERE "id" = $1 FOR UPDATE');
    });

    it('generates FOR UPDATE NOWAIT', () => {
      const adapter = createMockAdapter('postgres');
      const qb = new QueryBuilder(adapter, 'accounts');
      const { sql } = qb.where(new WhereClause().eq('id', 101)).forUpdateNoWait().toSelectSql();

      expect(sql).toContain('SELECT * FROM "accounts" WHERE "id" = $1 FOR UPDATE NOWAIT');
    });

    it('generates FOR UPDATE SKIP LOCKED for worker queues', () => {
      const adapter = createMockAdapter('postgres');
      const qb = new QueryBuilder(adapter, 'tasks');
      const { sql } = qb.where(new WhereClause().eq('status', 'PENDING')).forUpdateSkipLocked().toSelectSql();

      expect(sql).toContain('SELECT * FROM "tasks" WHERE "status" = $1 FOR UPDATE SKIP LOCKED');
    });

    it('generates FOR SHARE for shared read locks', () => {
      const adapter = createMockAdapter('postgres');
      const qb = new QueryBuilder(adapter, 'rates');
      const { sql } = qb.where(new WhereClause().eq('currency', 'USD')).forShare().toSelectSql();

      expect(sql).toContain('SELECT * FROM "rates" WHERE "currency" = $1 FOR SHARE');
    });
  });

  describe('SQL Server (MSSQL) Table Hint Locking Syntax', () => {
    it('generates WITH (UPDLOCK, ROWLOCK, HOLDLOCK) for exclusive row locks', () => {
      const adapter = createMockAdapter('mssql');
      const qb = new QueryBuilder(adapter, 'accounts');
      const { sql } = qb.where(new WhereClause().eq('id', 101)).forUpdate().toSelectSql();

      expect(sql).toContain('SELECT * FROM [accounts] WITH (UPDLOCK, ROWLOCK, HOLDLOCK) WHERE [id] = @p0');
    });

    it('generates WITH (UPDLOCK, ROWLOCK, NOWAIT) for no-wait exclusive locks', () => {
      const adapter = createMockAdapter('mssql');
      const qb = new QueryBuilder(adapter, 'accounts');
      const { sql } = qb.where(new WhereClause().eq('id', 101)).forUpdateNoWait().toSelectSql();

      expect(sql).toContain('SELECT * FROM [accounts] WITH (UPDLOCK, ROWLOCK, NOWAIT) WHERE [id] = @p0');
    });

    it('generates WITH (UPDLOCK, ROWLOCK, READPAST) for skip locked rows', () => {
      const adapter = createMockAdapter('mssql');
      const qb = new QueryBuilder(adapter, 'queue');
      const { sql } = qb.forUpdateSkipLocked().toSelectSql();

      expect(sql).toContain('SELECT * FROM [queue] WITH (UPDLOCK, ROWLOCK, READPAST)');
    });

    it('generates WITH (HOLDLOCK, ROWLOCK) for shared read locks', () => {
      const adapter = createMockAdapter('mssql');
      const qb = new QueryBuilder(adapter, 'accounts');
      const { sql } = qb.forShare().toSelectSql();

      expect(sql).toContain('SELECT * FROM [accounts] WITH (HOLDLOCK, ROWLOCK)');
    });
  });

  describe('MySQL / PlanetScale Locking Syntax', () => {
    it('generates FOR UPDATE and LOCK IN SHARE MODE', () => {
      const adapter = createMockAdapter('mysql');
      const qb1 = new QueryBuilder(adapter, 'accounts');
      const { sql: sql1 } = qb1.forUpdate().toSelectSql();
      expect(sql1).toContain('SELECT * FROM `accounts` FOR UPDATE');

      const qb2 = new QueryBuilder(adapter, 'accounts');
      const { sql: sql2 } = qb2.forShare().toSelectSql();
      expect(sql2).toContain('SELECT * FROM `accounts` LOCK IN SHARE MODE');
    });
  });

  describe('DbSet Locking Chaining and withLock helper', () => {
    it('propagates locking methods through DbSet chaining', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');

      const lockedSet = accounts.where({ id: 101 }).forUpdate();
      const { sql } = (lockedSet as any).queryBuilder.toSelectSql();
      expect(sql).toContain('SELECT * FROM "accounts" WHERE "id" = $1 FOR UPDATE');
    });

    it('supports withLock generic selector', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');

      const qb1 = (accounts.withLock('no-wait') as any).queryBuilder;
      expect(qb1.toSelectSql().sql).toContain('FOR UPDATE NOWAIT');

      const qb2 = (accounts.withLock('skip-locked') as any).queryBuilder;
      expect(qb2.toSelectSql().sql).toContain('FOR UPDATE SKIP LOCKED');
    });
  });

  describe('.lock() — Unified Pessimistic Locking API (PostgreSQL)', () => {
    it('.lock("pessimistic") emits FOR UPDATE', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('pessimistic') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('FOR UPDATE');
    });

    it('.lock("shared") emits FOR SHARE', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('shared') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('FOR SHARE');
    });

    it('.lock("no-wait") emits FOR UPDATE NOWAIT', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('no-wait') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('FOR UPDATE NOWAIT');
    });

    it('.lock("skip-locked") emits FOR UPDATE SKIP LOCKED', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('skip-locked') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    });

    it('.lock("optimistic") adds no SQL lock modifier', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('optimistic') as any).queryBuilder.toSelectSql();
      expect(sql).not.toContain('FOR UPDATE');
      expect(sql).not.toContain('FOR SHARE');
    });

    it('.lock() chains correctly after .where()', () => {
      const adapter = createMockAdapter('postgres');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.where({ id: 1 }).lock('pessimistic') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('WHERE');
      expect(sql).toContain('FOR UPDATE');
    });
  });

  describe('.lock() — Unified Pessimistic Locking API (MSSQL)', () => {
    it('.lock("pessimistic") emits WITH (UPDLOCK, ROWLOCK, HOLDLOCK)', () => {
      const adapter = createMockAdapter('mssql');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('pessimistic') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('UPDLOCK');
      expect(sql).toContain('HOLDLOCK');
    });

    it('.lock("shared") emits WITH (HOLDLOCK, ROWLOCK)', () => {
      const adapter = createMockAdapter('mssql');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('shared') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('HOLDLOCK');
    });

    it('.lock("skip-locked") emits WITH (UPDLOCK, ROWLOCK, READPAST)', () => {
      const adapter = createMockAdapter('mssql');
      const accounts = new DbSet(adapter, 'accounts');
      const { sql } = (accounts.lock('skip-locked') as any).queryBuilder.toSelectSql();
      expect(sql).toContain('READPAST');
    });
  });
});
