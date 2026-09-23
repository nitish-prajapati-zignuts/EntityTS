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
  ReplicaRoutingDbAdapter,
  PostgresAdapter,
} from '../src';

@Entity()
@Table('users')
class User {
  @PrimaryKey()
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ type: SqlType.VarChar })
  name!: string;
}

class TestDbContext extends DbContext {
  public users = this.set(User);
}

describe('Primary / Read-Replica Connection Splitting', () => {
  let primaryAdapter: MockDbAdapter;
  let replica1: MockDbAdapter;
  let replica2: MockDbAdapter;
  let routingAdapter: ReplicaRoutingDbAdapter;

  beforeEach(() => {
    primaryAdapter = new MockDbAdapter();
    primaryAdapter.executeQuery = jest.fn().mockResolvedValue([{ id: 1, name: 'From Primary' }]);
    primaryAdapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    primaryAdapter.executeProcedure = jest.fn().mockResolvedValue({ records: [], outputParams: {}, returnValue: 0, rowsAffected: 0 });

    replica1 = new MockDbAdapter();
    replica1.executeQuery = jest.fn().mockResolvedValue([{ id: 1, name: 'From Replica 1' }]);
    replica1.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    replica1.executeProcedure = jest.fn().mockResolvedValue({ records: [], outputParams: {}, returnValue: 0, rowsAffected: 0 });

    replica2 = new MockDbAdapter();
    replica2.executeQuery = jest.fn().mockResolvedValue([{ id: 1, name: 'From Replica 2' }]);
    replica2.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });
    replica2.executeProcedure = jest.fn().mockResolvedValue({ records: [], outputParams: {}, returnValue: 0, rowsAffected: 0 });

    routingAdapter = new ReplicaRoutingDbAdapter(primaryAdapter, [replica1, replica2], {
      strategy: 'round-robin',
    });
  });

  describe('ReplicaRoutingDbAdapter query routing', () => {
    it('routes SELECT read queries across replicas using round-robin', async () => {
      const q1 = await routingAdapter.executeQuery('SELECT * FROM users');
      expect(replica1.executeQuery).toHaveBeenCalledTimes(1);
      expect(replica2.executeQuery).toHaveBeenCalledTimes(0);
      expect(primaryAdapter.executeQuery).toHaveBeenCalledTimes(0);
      expect(q1).toEqual([{ id: 1, name: 'From Replica 1' }]);

      const q2 = await routingAdapter.executeQuery('SELECT * FROM users');
      expect(replica1.executeQuery).toHaveBeenCalledTimes(1);
      expect(replica2.executeQuery).toHaveBeenCalledTimes(1);
      expect(primaryAdapter.executeQuery).toHaveBeenCalledTimes(0);
      expect(q2).toEqual([{ id: 1, name: 'From Replica 2' }]);

      const q3 = await routingAdapter.executeQuery('SELECT * FROM users');
      expect(replica1.executeQuery).toHaveBeenCalledTimes(2);
      expect(replica2.executeQuery).toHaveBeenCalledTimes(1);
      expect(q3).toEqual([{ id: 1, name: 'From Replica 1' }]);
    });

    it('routes non-SELECT statements (INSERT/UPDATE/DELETE) exclusively to primary', async () => {
      await routingAdapter.executeNonQuery('INSERT INTO users (name) VALUES (?)', [{ name: 'p0', value: 'Alice' }]);
      expect(primaryAdapter.executeNonQuery).toHaveBeenCalledTimes(1);
      expect(replica1.executeNonQuery).toHaveBeenCalledTimes(0);
      expect(replica2.executeNonQuery).toHaveBeenCalledTimes(0);

      await routingAdapter.executeNonQuery('UPDATE users SET name = ? WHERE id = ?');
      expect(primaryAdapter.executeNonQuery).toHaveBeenCalledTimes(2);
    });

    it('routes stored procedures to primary', async () => {
      await routingAdapter.executeProcedure('usp_UpdateUser', []);
      expect(primaryAdapter.executeProcedure).toHaveBeenCalledTimes(1);
      expect(replica1.executeProcedure).toHaveBeenCalledTimes(0);
    });

    it('locks queries inside a transaction to the primary database', async () => {
      const tx = await routingAdapter.beginTransaction();
      expect(tx).toBeDefined();

      // Read query executed within transaction must execute on primary
      const result = await routingAdapter.executeQuery('SELECT * FROM users', [], tx);
      expect(primaryAdapter.executeQuery).toHaveBeenCalledTimes(1);
      expect(replica1.executeQuery).toHaveBeenCalledTimes(0);
      expect(replica2.executeQuery).toHaveBeenCalledTimes(0);
      expect(result).toEqual([{ id: 1, name: 'From Primary' }]);

      await tx.commit();
    });

    it('routes scalar non-SELECT queries to primary and SELECT queries to replica', async () => {
      replica1.executeScalar = jest.fn().mockResolvedValue(10);
      primaryAdapter.executeScalar = jest.fn().mockResolvedValue(1);

      const count = await routingAdapter.executeScalar('SELECT COUNT(*) FROM users');
      expect(replica1.executeScalar).toHaveBeenCalledTimes(1);
      expect(count).toBe(10);
    });

    it('falls back safely to primary when no replicas are configured', async () => {
      const soloAdapter = new ReplicaRoutingDbAdapter(primaryAdapter, []);
      const rows = await soloAdapter.executeQuery('SELECT * FROM users');
      expect(primaryAdapter.executeQuery).toHaveBeenCalledTimes(1);
      expect(rows).toEqual([{ id: 1, name: 'From Primary' }]);
    });
  });

  describe('DbSet .usePrimary() integration', () => {
    it('forces read query to execute on primary when usePrimary() is chained', async () => {
      const options = new DbContextOptionsBuilder()
        .useAdapter(routingAdapter)
        .build();

      const ctx = new TestDbContext(options);

      // Normal read goes to replica
      await ctx.users.toList();
      expect(replica1.executeQuery).toHaveBeenCalledTimes(1);
      expect(primaryAdapter.executeQuery).toHaveBeenCalledTimes(0);

      // usePrimary() routes read to primary
      const primaryResult = await ctx.users.usePrimary().toList();
      expect(primaryAdapter.executeQuery).toHaveBeenCalledTimes(1);
      expect(primaryResult).toEqual([{ id: 1, name: 'From Primary' }]);

      await ctx.dispose();
    });
  });

  describe('DbContextOptionsBuilder .withReadReplicas() auto-wiring', () => {
    it('configures ReplicaRoutingDbAdapter automatically from builder', () => {
      const options = new DbContextOptionsBuilder()
        .usePostgres('postgresql://primary.db:5432/app')
        .withReadReplicas([
          'postgresql://replica1.db:5432/app',
          'postgresql://replica2.db:5432/app',
        ], { strategy: 'round-robin' })
        .build();

      expect(options.adapter).toBeInstanceOf(ReplicaRoutingDbAdapter);
      const routing = options.adapter as ReplicaRoutingDbAdapter;
      expect(routing.getPrimaryAdapter()).toBeInstanceOf(PostgresAdapter);
      expect(routing.getReplicaAdapters()).toHaveLength(2);
      expect(routing.getReplicaAdapters()[0]).toBeInstanceOf(PostgresAdapter);
      expect(routing.getReplicaAdapters()[1]).toBeInstanceOf(PostgresAdapter);
    });
  });
});
