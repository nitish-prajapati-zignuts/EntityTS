import {
  DbContextOptionsBuilder,
  NeonAdapter,
  PlanetScaleAdapter,
  TursoAdapter,
  CockroachDbAdapter,
  D1Adapter,
  SupabaseAdapter,
  MigrationBuilder,
  BulkInsertBuilder,
  DbException,
} from '../src';

describe('Serverless & Edge Adapters (Neon, PlanetScale, Turso, CockroachDB, D1, Supabase)', () => {
  describe('DbContextOptionsBuilder extensions', () => {
    it('configures useNeon correctly', () => {
      const options = new DbContextOptionsBuilder()
        .useNeon('postgresql://user:pass@ep-cool.us-east-2.aws.neon.tech/neondb')
        .build();

      expect(options.provider).toBe('neon');
      expect(options.adapter).toBeInstanceOf(NeonAdapter);
      expect(options.adapter?.provider).toBe('neon');
    });

    it('configures usePlanetScale correctly', () => {
      const options = new DbContextOptionsBuilder()
        .usePlanetScale({ url: 'mysql://root:pass@aws.connect.psdb.cloud/mydb' })
        .build();

      expect(options.provider).toBe('planetscale');
      expect(options.adapter).toBeInstanceOf(PlanetScaleAdapter);
      expect(options.adapter?.provider).toBe('planetscale');
    });

    it('configures useTurso correctly', () => {
      const options = new DbContextOptionsBuilder()
        .useTurso({ url: 'libsql://mydb-user.turso.io', authToken: 'secret-token' })
        .build();

      expect(options.provider).toBe('turso');
      expect(options.adapter).toBeInstanceOf(TursoAdapter);
      expect(options.adapter?.provider).toBe('turso');
    });

    it('configures useCockroachDb correctly', () => {
      const options = new DbContextOptionsBuilder()
        .useCockroachDb('postgresql://user:pass@cluster.cockroachlabs.cloud:26257/defaultdb')
        .build();

      expect(options.provider).toBe('cockroachdb');
      expect(options.adapter).toBeInstanceOf(CockroachDbAdapter);
      expect(options.adapter?.provider).toBe('cockroachdb');
    });

    it('configures useD1 correctly with a mock D1Database binding', () => {
      const mockD1 = {
        prepare: jest.fn().mockReturnValue({
          bind: jest.fn().mockReturnThis(),
          all: jest.fn().mockResolvedValue({ results: [{ ping: 1 }] }),
          run: jest.fn().mockResolvedValue({ meta: { changes: 1, last_row_id: 10 } }),
        }),
      };

      const options = new DbContextOptionsBuilder().useD1(mockD1).build();

      expect(options.provider).toBe('d1');
      expect(options.adapter).toBeInstanceOf(D1Adapter);
      expect(options.adapter?.provider).toBe('d1');
    });

    it('configures useSupabase correctly', () => {
      const options = new DbContextOptionsBuilder()
        .useSupabase(
          'postgresql://postgres.project:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
        )
        .build();

      expect(options.provider).toBe('supabase');
      expect(options.adapter).toBeInstanceOf(SupabaseAdapter);
      expect(options.adapter?.provider).toBe('supabase');
    });
  });

  describe('Adapter parameter formatting and identifier escaping', () => {
    it('NeonAdapter uses double quotes and $1 placeholders', () => {
      const adapter = new NeonAdapter('postgresql://localhost/db');
      expect(adapter.provider).toBe('neon');
      expect(adapter.escapeIdentifier('users')).toBe('"users"');
      expect(adapter.formatParameterPlaceholder('param', 1)).toBe('$1');
      expect(adapter.formatParameterPlaceholder('param', 2)).toBe('$2');
    });

    it('PlanetScaleAdapter uses backticks and ? placeholders', () => {
      const adapter = new PlanetScaleAdapter('mysql://localhost/db');
      expect(adapter.provider).toBe('planetscale');
      expect(adapter.escapeIdentifier('users')).toBe('`users`');
      expect(adapter.formatParameterPlaceholder('param', 1)).toBe('?');
    });

    it('TursoAdapter uses double quotes and ? placeholders', () => {
      const adapter = new TursoAdapter({ url: 'libsql://localhost' });
      expect(adapter.provider).toBe('turso');
      expect(adapter.escapeIdentifier('users')).toBe('"users"');
      expect(adapter.formatParameterPlaceholder('param', 1)).toBe('?');
    });

    it('CockroachDbAdapter uses double quotes and $1 placeholders', () => {
      const adapter = new CockroachDbAdapter('postgresql://localhost:26257/defaultdb');
      expect(adapter.provider).toBe('cockroachdb');
      expect(adapter.escapeIdentifier('users')).toBe('"users"');
      expect(adapter.formatParameterPlaceholder('param', 1)).toBe('$1');
    });

    it('D1Adapter uses double quotes and ? placeholders', () => {
      const mockD1 = { prepare: jest.fn() };
      const adapter = new D1Adapter(mockD1);
      expect(adapter.provider).toBe('d1');
      expect(adapter.escapeIdentifier('users')).toBe('"users"');
      expect(adapter.formatParameterPlaceholder('param', 1)).toBe('?');
    });

    it('SupabaseAdapter uses double quotes and $1 placeholders', () => {
      const adapter = new SupabaseAdapter('postgresql://localhost/db');
      expect(adapter.provider).toBe('supabase');
      expect(adapter.escapeIdentifier('users')).toBe('"users"');
      expect(adapter.formatParameterPlaceholder('param', 1)).toBe('$1');
    });
  });

  describe('D1Adapter operations', () => {
    it('throws if constructor receives invalid binding', () => {
      expect(() => new D1Adapter(null as any)).toThrow(DbException);
      expect(() => new D1Adapter({} as any)).toThrow(DbException);
    });

    it('executes query and nonQuery using D1 binding', async () => {
      const mockStmt = {
        bind: jest.fn().mockReturnThis(),
        all: jest.fn().mockResolvedValue({ results: [{ id: 1, name: 'Alice' }] }),
        run: jest.fn().mockResolvedValue({ meta: { changes: 1, last_row_id: 42 } }),
      };
      const mockD1 = {
        prepare: jest.fn().mockReturnValue(mockStmt),
        exec: jest.fn().mockResolvedValue(undefined),
      };

      const adapter = new D1Adapter(mockD1);

      const rows = await adapter.executeQuery<{ id: number; name: string }>(
        'SELECT * FROM users WHERE id = ?',
        [{ name: 'p0', value: 1 }],
      );

      expect(mockD1.prepare).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?');
      expect(mockStmt.bind).toHaveBeenCalledWith(1);
      expect(rows).toEqual([{ id: 1, name: 'Alice' }]);

      const nonQuery = await adapter.executeNonQuery('INSERT INTO users (name) VALUES (?)', [
        { name: 'p0', value: 'Bob' },
      ]);

      expect(nonQuery.rowsAffected).toBe(1);
      expect(nonQuery.insertId).toBe(42);

      const scalar = await adapter.executeScalar<number>('SELECT COUNT(*) FROM users');
      expect(scalar).toBe(1);

      const ping = await adapter.ping();
      expect(ping).toBe(true);

      const tx = await adapter.beginTransaction();
      expect(mockD1.exec).toHaveBeenCalledWith('BEGIN TRANSACTION');
      await tx.commit();
      expect(mockD1.exec).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('Dialect Integration across new providers', () => {
    it('MigrationBuilder generates PostgreSQL dialect DDL for Neon, CockroachDB, and Supabase', () => {
      const neon = new NeonAdapter('postgresql://localhost/db');
      const crdb = new CockroachDbAdapter('postgresql://localhost/db');
      const supa = new SupabaseAdapter('postgresql://localhost/db');

      for (const adapter of [neon, crdb, supa]) {
        const mb = new MigrationBuilder();
        mb.createTable('products', t => {
          t.increments('id');
          t.string('name', 100).notNullable();
        });

        const sql = mb.getSqlStatements(adapter);
        expect(sql[0]).toContain('"id" SERIAL PRIMARY KEY');
        expect(sql[0]).toContain('"name" VARCHAR(100) NOT NULL');
      }
    });

    it('MigrationBuilder generates MySQL dialect DDL for PlanetScale', () => {
      const ps = new PlanetScaleAdapter('mysql://localhost/db');
      const mb = new MigrationBuilder();
      mb.createTable('products', t => {
        t.increments('id');
        t.string('name', 100);
      });
      mb.renameColumn('products', 'name', 'product_name', 'VARCHAR(150)');

      const sql = mb.getSqlStatements(ps);
      expect(sql[0]).toContain('`id` INT AUTO_INCREMENT PRIMARY KEY');
      expect(sql[1]).toContain(
        'ALTER TABLE `products` CHANGE COLUMN `name` `product_name` VARCHAR(150);',
      );
    });

    it('MigrationBuilder generates SQLite dialect DDL for Turso and D1', () => {
      const turso = new TursoAdapter({ url: 'libsql://localhost' });
      const d1 = new D1Adapter({ prepare: jest.fn() });

      for (const adapter of [turso, d1]) {
        const mb = new MigrationBuilder();
        mb.createTable('items', t => {
          t.increments('id');
        });
        mb.alterColumn('items', 'price', 'INTEGER');
        mb.addForeignKey('items', 'cat_id', 'categories', 'id');

        const sql = mb.getSqlStatements(adapter);
        expect(sql[0]).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
        expect(sql[1]).toContain('-- SQLite: recreate table to alter column');
        expect(sql[2]).toContain('-- SQLite: foreign key');
      }
    });

    it('BulkInsertBuilder handles ignoreDuplicates across all dialect families', async () => {
      const dummyTx = {
        commit: jest.fn(),
        rollback: jest.fn(),
        isCompleted: false,
        getDriver: () => ({}),
      } as any;

      const neon = new NeonAdapter('postgresql://localhost/db');
      neon.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 2 });

      const bibNeon = new BulkInsertBuilder<{ id: number; name: string }>(
        neon,
        'users',
        undefined,
        dummyTx,
      );
      await bibNeon.execute([{ id: 1, name: 'Alice' }], { ignoreDuplicates: true });
      expect((neon.executeNonQuery as jest.Mock).mock.calls[0][0]).toContain(
        'ON CONFLICT DO NOTHING',
      );

      const ps = new PlanetScaleAdapter('mysql://localhost/db');
      ps.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });
      const bibPs = new BulkInsertBuilder<{ id: number; name: string }>(
        ps,
        'users',
        undefined,
        dummyTx,
      );
      await bibPs.execute([{ id: 1, name: 'Bob' }], { ignoreDuplicates: true });
      expect((ps.executeNonQuery as jest.Mock).mock.calls[0][0]).toContain(
        'INSERT IGNORE INTO `users`',
      );

      const turso = new TursoAdapter({ url: 'libsql://localhost' });
      turso.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });
      const bibTurso = new BulkInsertBuilder<{ id: number; name: string }>(
        turso,
        'users',
        undefined,
        dummyTx,
      );
      await bibTurso.execute([{ id: 1, name: 'Charlie' }], { ignoreDuplicates: true });
      expect((turso.executeNonQuery as jest.Mock).mock.calls[0][0]).toContain(
        'INSERT OR IGNORE INTO "users"',
      );
    });
  });
});
