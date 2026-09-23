import {
  MigrationBuilder,
  MigrationRunner,
  MockDbAdapter,
  MigrationModule,
  SqliteAdapter,
  PostgresAdapter,
} from '../src';

describe('Migrations DSL and Runner', () => {
  describe('MigrationBuilder', () => {
    it('generates CREATE TABLE statement with columns and constraints', () => {
      const builder = new MigrationBuilder();
      builder.createTable('users', t => {
        t.increments('id').primary();
        t.string('email', 255).notNullable().unique();
        t.integer('age').defaultTo(18);
        t.boolean('active').defaultTo(true);
        t.timestamp('created_at').defaultToNow();
      });

      const adapter = new MockDbAdapter();
      const stmts = builder.getSqlStatements(adapter);
      expect(stmts.length).toBe(1);
      expect(stmts[0]).toContain('CREATE TABLE "users"');
      expect(stmts[0]).toContain('"email" VARCHAR(255) NOT NULL UNIQUE');
      expect(stmts[0]).toContain('"age" INTEGER NOT NULL DEFAULT 18');
      expect(stmts[0]).toContain('"active" BOOLEAN NOT NULL DEFAULT true');
      expect(stmts[0]).toContain('"created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    });

    it('generates dialect-specific serial auto increment for Postgres', () => {
      const builder = new MigrationBuilder();
      builder.createTable('items', t => {
        t.increments('id').primary();
      });

      const pgAdapter = new PostgresAdapter('postgres://localhost');
      const stmts = builder.getSqlStatements(pgAdapter);
      expect(stmts[0]).toContain('"id" SERIAL PRIMARY KEY');
    });

    it('generates ALTER TABLE ADD COLUMN, DROP TABLE, CREATE INDEX statements', () => {
      const builder = new MigrationBuilder();
      builder
        .addColumn('users', 'phone', 'VARCHAR(50)', col => col.nullable())
        .createIndex('users', ['email'], { unique: true })
        .dropTableIfExists('old_table');

      const adapter = new MockDbAdapter();
      const stmts = builder.getSqlStatements(adapter);
      expect(stmts.length).toBe(3);
      expect(stmts[0]).toContain('ALTER TABLE "users" ADD COLUMN "phone" VARCHAR(50);');
      expect(stmts[1]).toContain('CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");');
      expect(stmts[2]).toContain('DROP TABLE IF EXISTS "old_table";');
    });
  });

  describe('MigrationRunner', () => {
    let adapter: MockDbAdapter;
    let runner: MigrationRunner;

    beforeEach(() => {
      adapter = new MockDbAdapter();
      runner = new MigrationRunner(adapter);
    });

    const m1: MigrationModule = {
      id: '20260101_01',
      name: 'CreateUsersTable',
      up: schema => {
        schema.createTable('users', t => {
          t.increments('id').primary();
          t.string('name').notNullable();
        });
      },
      down: schema => {
        schema.dropTable('users');
      },
    };

    const m2: MigrationModule = {
      id: '20260101_02',
      name: 'AddUserAge',
      up: schema => {
        schema.addColumn('users', 'age', 'INTEGER');
      },
      down: schema => {
        schema.dropColumn('users', 'age');
      },
    };

    it('applies pending migrations in order and records them in migrations table', async () => {
      const res = await runner.up([m1, m2]);
      expect(res.applied).toEqual(['CreateUsersTable', 'AddUserAge']);

      const status = await runner.status([m1, m2]);
      expect(status.every(s => s.applied)).toBe(true);
      expect(status[0].batch).toBe(1);
      expect(status[1].batch).toBe(1);

      // Running up again does not re-apply
      const res2 = await runner.up([m1, m2]);
      expect(res2.applied.length).toBe(0);
    });

    it('rolls back the last batch of migrations on down()', async () => {
      await runner.up([m1]);
      await runner.up([m2]); // m2 is batch 2

      let status = await runner.status([m1, m2]);
      expect(status[0].batch).toBe(1);
      expect(status[1].batch).toBe(2);

      const reverted = await runner.down([m1, m2]);
      expect(reverted.reverted).toEqual(['AddUserAge']);

      status = await runner.status([m1, m2]);
      expect(status[0].applied).toBe(true);
      expect(status[1].applied).toBe(false);
    });
  });
});
