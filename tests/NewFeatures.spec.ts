import 'reflect-metadata';
import {
  Entity,
  Table,
  Column,
  PrimaryKey,
  Enum,
  Unique,
  ViewEntity,
  CompositeKey,
  ModelMetadataRegistry,
  entityToMigrationBuilder,
  DbSet,
  DbContext,
  SeedRunner,
  SeedModule,
  fastifyDbContext,
  MockDbAdapter,
} from '../src';
import { SqlType } from '../src/procedure/SqlType';

function makeMock(provider: 'sqlite' | 'postgres' | 'mysql' | 'mssql' = 'sqlite'): MockDbAdapter {
  const mock = new MockDbAdapter();
  (mock as any).provider = provider;
  if (provider === 'mysql') {
    (mock as any).escapeIdentifier = (n: string) => `\`${n}\``;
  } else {
    (mock as any).escapeIdentifier = (n: string) => `"${n}"`;
  }
  return mock;
}

describe('New Features in NSP', () => {
  // ─── 1. @Enum Decorator ──────────────────────────────────────────────────
  describe('@Enum decorator', () => {
    @Entity()
    @Table('orders')
    class OrderWithEnum {
      @PrimaryKey()
      @Column({ type: SqlType.Int })
      id!: number;

      @Enum(['pending', 'shipped', 'delivered', 'cancelled'])
      @Column({ type: SqlType.VarChar, maxLength: 50 })
      status!: string;
    }

    it('stores enumValues in column metadata', () => {
      const meta = ModelMetadataRegistry.getInstance().get(OrderWithEnum);
      expect(meta).toBeDefined();
      const statusCol = meta!.columns.get('status');
      expect(statusCol).toBeDefined();
      expect(statusCol?.enumValues).toEqual(['pending', 'shipped', 'delivered', 'cancelled']);
    });

    it('emits CHECK constraint for non-MySQL providers', () => {
      const adapter = makeMock('postgres');
      const meta = ModelMetadataRegistry.getInstance().get(OrderWithEnum)!;
      const builder = entityToMigrationBuilder(meta, adapter);
      const statements = builder.getSqlStatements(adapter);

      expect(statements.some(s => s.includes('CHECK') && s.includes("'pending'"))).toBe(true);
    });

    it('emits ENUM column for MySQL', () => {
      const adapter = makeMock('mysql');
      const meta = ModelMetadataRegistry.getInstance().get(OrderWithEnum)!;
      const builder = entityToMigrationBuilder(meta, adapter);
      const statements = builder.getSqlStatements(adapter);

      expect(statements.some(s => s.includes("ENUM('pending', 'shipped', 'delivered', 'cancelled')"))).toBe(true);
    });
  });

  // ─── 2. @Unique Decorator ────────────────────────────────────────────────
  describe('@Unique decorator', () => {
    @Entity()
    @Table('accounts')
    class AccountWithUnique {
      @PrimaryKey()
      @Column({ type: SqlType.Int })
      id!: number;

      @Unique()
      @Column({ type: SqlType.VarChar, maxLength: 100 })
      username!: string;
    }

    it('sets isUnique: true on column metadata and registers unique index', () => {
      const meta = ModelMetadataRegistry.getInstance().get(AccountWithUnique);
      expect(meta).toBeDefined();
      const col = meta!.columns.get('username');
      expect(col?.isUnique).toBe(true);

      const uniqueIdx = meta!.indexes?.find(i => i.unique && i.columns.includes('username'));
      expect(uniqueIdx).toBeDefined();
    });

    it('emits CREATE UNIQUE INDEX statement in DDL', () => {
      const adapter = makeMock('sqlite');
      const meta = ModelMetadataRegistry.getInstance().get(AccountWithUnique)!;
      const builder = entityToMigrationBuilder(meta, adapter);
      const statements = builder.getSqlStatements(adapter);

      expect(statements.some(s => s.includes('CREATE UNIQUE INDEX') && s.includes('username'))).toBe(true);
    });
  });

  // ─── 3. @ViewEntity Decorator ────────────────────────────────────────────
  describe('@ViewEntity decorator', () => {
    @Entity()
    @ViewEntity('v_monthly_sales')
    class MonthlySalesView {
      @Column({ type: SqlType.VarChar })
      month!: string;

      @Column({ type: SqlType.Decimal })
      totalRevenue!: number;
    }

    it('marks entity with isView = true in metadata', () => {
      const meta = ModelMetadataRegistry.getInstance().get(MonthlySalesView);
      expect(meta).toBeDefined();
      expect(meta?.isView).toBe(true);
      expect(meta?.tableName).toBe('v_monthly_sales');
    });

    it('produces empty DDL statements from entityToMigrationBuilder', () => {
      const adapter = makeMock('postgres');
      const meta = ModelMetadataRegistry.getInstance().get(MonthlySalesView)!;
      const builder = entityToMigrationBuilder(meta, adapter);
      const statements = builder.getSqlStatements(adapter);
      expect(statements).toEqual([]);
    });

    it('throws when attempting to add, update, or remove on a view entity', async () => {
      const adapter = makeMock('sqlite');
      const set = new DbSet<MonthlySalesView>(adapter, MonthlySalesView);

      await expect(set.add({ month: '2025-01', totalRevenue: 1000 })).rejects.toThrow(
        /View entities decorated with @ViewEntity are read-only/
      );

      await expect(set.update(1, { totalRevenue: 2000 })).rejects.toThrow(
        /View entities decorated with @ViewEntity are read-only/
      );

      await expect(set.remove(1)).rejects.toThrow(
        /View entities decorated with @ViewEntity are read-only/
      );
    });
  });

  // ─── 4. @CompositeKey Decorator ──────────────────────────────────────────
  describe('@CompositeKey decorator', () => {
    @Entity()
    @Table('order_items')
    @CompositeKey(['orderId', 'productId'])
    class OrderItem {
      @Column({ type: SqlType.Int })
      orderId!: number;

      @Column({ type: SqlType.Int })
      productId!: number;

      @Column({ type: SqlType.Int })
      quantity!: number;
    }

    it('records compositeKeys in entity metadata', () => {
      const meta = ModelMetadataRegistry.getInstance().get(OrderItem);
      expect(meta).toBeDefined();
      expect(meta?.compositeKeys).toEqual([['orderId', 'productId']]);
    });

    it('emits ALTER TABLE ADD PRIMARY KEY on supported engines', () => {
      const adapter = makeMock('postgres');
      const meta = ModelMetadataRegistry.getInstance().get(OrderItem)!;
      const builder = entityToMigrationBuilder(meta, adapter);
      const statements = builder.getSqlStatements(adapter);

      expect(statements.some(s => s.includes('ADD PRIMARY KEY ("orderId", "productId")'))).toBe(true);
    });
  });

  // ─── 5. DbSet.stream() Async Generator ───────────────────────────────────
  describe('DbSet.stream()', () => {
    @Entity()
    @Table('audit_logs')
    class AuditLog {
      @PrimaryKey()
      @Column({ type: SqlType.Int })
      id!: number;

      @Column({ type: SqlType.VarChar })
      action!: string;
    }

    it('yields entities row by row using pagination polyfill', async () => {
      const adapter = makeMock('sqlite');
      const batch1 = [
        { id: 1, action: 'LOGIN' },
        { id: 2, action: 'LOGOUT' },
      ];
      const batch2 = [
        { id: 3, action: 'PURCHASE' },
      ];

      adapter.executeQuery = jest.fn()
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]) as any;

      const set = new DbSet<AuditLog>(adapter, AuditLog);
      const results: AuditLog[] = [];

      for await (const item of set.stream(2)) {
        results.push(item);
      }

      expect(results).toHaveLength(3);
      expect(results[0].action).toBe('LOGIN');
      expect(results[1].action).toBe('LOGOUT');
      expect(results[2].action).toBe('PURCHASE');
    });

    it('uses adapter.executeStream directly when supported', async () => {
      const adapter = makeMock('postgres');
      const rows = [
        { id: 10, action: 'VIEW' },
        { id: 20, action: 'CLICK' },
      ];

      (adapter as any).executeStream = async function* () {
        for (const r of rows) yield r;
      };

      const set = new DbSet<AuditLog>(adapter, AuditLog);
      const results: AuditLog[] = [];

      for await (const item of set.stream()) {
        results.push(item);
      }

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe(10);
      expect(results[1].id).toBe(20);
    });
  });

  // ─── 6. SeedRunner Framework ─────────────────────────────────────────────
  describe('SeedRunner', () => {
    it('executes seeds, tracks them, and skips already-applied seeds', async () => {
      const adapter = makeMock('sqlite');
      const runner = new SeedRunner(adapter);

      // 1st run: table is empty
      adapter.executeQuery = jest.fn().mockResolvedValueOnce([]) as any; // getAppliedSeeds returns []

      const seedRun1 = jest.fn().mockResolvedValue(undefined);
      const seedRun2 = jest.fn().mockResolvedValue(undefined);

      const seeds: SeedModule[] = [
        { id: '001_roles', name: 'Seed Roles', run: seedRun1 },
        { id: '002_users', name: 'Seed Users', run: seedRun2 },
      ];

      const res = await runner.run(seeds);
      expect(res.applied).toEqual(['Seed Roles', 'Seed Users']);
      expect(seedRun1).toHaveBeenCalledWith(adapter);
      expect(seedRun2).toHaveBeenCalledWith(adapter);

      // 2nd run: both are already applied
      adapter.executeQuery = jest.fn().mockResolvedValueOnce([
        { id: '001_roles', name: 'Seed Roles' },
        { id: '002_users', name: 'Seed Users' },
      ]) as any;

      const seedRun3 = jest.fn();
      const res2 = await runner.run([
        { id: '001_roles', name: 'Seed Roles', run: seedRun3 },
      ]);

      expect(res2.applied).toEqual([]);
      expect(seedRun3).not.toHaveBeenCalled();
    });

    it('returns seed status correctly', async () => {
      const adapter = makeMock('sqlite');
      const runner = new SeedRunner(adapter);

      adapter.executeQuery = jest.fn().mockResolvedValueOnce([
        { id: '001_roles', name: 'Seed Roles', appliedAt: new Date('2025-01-01') },
      ]) as any;

      const seeds: SeedModule[] = [
        { id: '001_roles', name: 'Seed Roles', run: async () => {} },
        { id: '002_users', name: 'Seed Users', run: async () => {} },
      ];

      const statuses = await runner.status(seeds);
      expect(statuses).toHaveLength(2);
      expect(statuses[0].applied).toBe(true);
      expect(statuses[1].applied).toBe(false);
    });

    it('resets tracking table on reset()', async () => {
      const adapter = makeMock('sqlite');
      adapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 }) as any;
      const runner = new SeedRunner(adapter);

      await runner.reset();
      expect(adapter.executeNonQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "__nsp_seeds"')
      );
    });
  });

  // ─── 7. Fastify DI Plugin ────────────────────────────────────────────────
  describe('Fastify DI plugin (fastifyDbContext)', () => {
    class TestDbContext extends DbContext {
      public isDisposed = false;
      constructor(options?: any) {
        super(options || { adapter: makeMock('sqlite') });
      }
      public async dispose(): Promise<void> {
        this.isDisposed = true;
      }
    }

    it('registers onRequest hook and attaches dbContext to request', async () => {
      let registeredHooks: Record<string, Function[]> = {};
      const fakeFastify: any = {
        decorateRequest: jest.fn(),
        hasRequestDecorator: jest.fn().mockReturnValue(false),
        addHook: jest.fn((name: string, fn: Function) => {
          if (!registeredHooks[name]) registeredHooks[name] = [];
          registeredHooks[name].push(fn);
        }),
      };

      await fastifyDbContext(fakeFastify, TestDbContext);

      expect(fakeFastify.decorateRequest).toHaveBeenCalledWith('dbContext', null);
      expect(registeredHooks['onRequest']).toBeDefined();
      expect(registeredHooks['onResponse']).toBeDefined();

      const fakeReq: any = {};
      await registeredHooks['onRequest'][0](fakeReq);
      expect(fakeReq.dbContext).toBeInstanceOf(TestDbContext);

      // Test autoDispose onResponse
      await registeredHooks['onResponse'][0](fakeReq);
      expect(fakeReq.dbContext.isDisposed).toBe(true);
    });
  });
});
