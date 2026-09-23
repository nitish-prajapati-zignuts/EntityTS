import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  PrimaryKey,
  Column,
  Version,
  DbSet,
  NeonAdapter,
  PlanetScaleAdapter,
  TursoAdapter,
  CockroachDbAdapter,
  SupabaseAdapter,
  D1Adapter,
} from '../src';

@Entity()
@Table('integration_users')
class IntegrationUser {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Version()
  version!: number;
}

// ─── 1. SQLite In-Memory Integration (Always Active) ──────────────────────────

describe('SQLite Integration (In-Memory Engine & Connection Pool)', () => {
  class SqliteTestContext extends DbContext {
    public users = this.set(IntegrationUser);

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.useSqlite(':memory:').withConnectionPool({
        minConnections: 1,
        maxConnections: 5,
        heartbeatIntervalMs: 0,
      });
    }
  }

  let ctx: SqliteTestContext;

  beforeAll(async () => {
    ctx = new SqliteTestContext();
    await ctx.connect();

    // Create table directly
    await ctx.executeRaw(`
      CREATE TABLE integration_users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )
    `);
  });

  afterAll(async () => {
    await ctx.disconnect();
  });

  it('verifies connection pool health on SQLite', async () => {
    expect(ctx.pool).toBeDefined();
    const health = await ctx.pool!.health();

    expect(health.isAlive).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.totalConnections).toBeGreaterThanOrEqual(1);
  });

  it('performs CRUD operations with optimistic locking on SQLite', async () => {
    // 1. Insert
    const user = await ctx.users.add({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      version: 1,
    });
    expect(user.id).toBe(1);

    // 2. Query
    const found = await ctx.users.find(1);
    expect(found).toBeDefined();
    expect(found?.name).toBe('Alice');
    expect(found?.version).toBe(1);

    // 3. Update with automatic version increment
    const updated = await ctx.users.update(1, { name: 'Alice Smith' }, 1);
    expect(updated.name).toBe('Alice Smith');
    expect(updated.version).toBe(2);

    // 4. Query Raw
    const rawRows = await ctx.queryRaw<{ id: number; name: string }>(
      'SELECT id, name FROM integration_users WHERE id = 1',
    );
    expect(rawRows.length).toBe(1);
    expect(rawRows[0].name).toBe('Alice Smith');

    // 5. Delete
    await ctx.users.remove(1, 2);
    const afterDelete = await ctx.users.find(1);
    expect(afterDelete).toBeNull();
  });

  it('executes atomic transactions on SQLite', async () => {
    await ctx.useTransaction(async tx => {
      const set = ctx.users.inTransaction(tx);
      await set.add({ id: 2, name: 'Bob', email: 'bob@test.com', version: 1 });
      await set.add({ id: 3, name: 'Charlie', email: 'charlie@test.com', version: 1 });
    });

    const bob = await ctx.users.find(2);
    const charlie = await ctx.users.find(3);
    expect(bob).toBeDefined();
    expect(charlie).toBeDefined();
  });
});

// ─── 2. PostgreSQL Live Integration (CI Container / Live Instance) ───────────

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL_POSTGRES;
const describePg = postgresUrl ? describe : describe.skip;

describePg('PostgreSQL Live Integration (CI Container)', () => {
  class PostgresTestContext extends DbContext {
    public users = this.set(IntegrationUser);

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.usePostgres(postgresUrl!).withConnectionPool({
        minConnections: 2,
        maxConnections: 10,
        heartbeatIntervalMs: 0,
      });
    }
  }

  let ctx: PostgresTestContext;

  beforeAll(async () => {
    ctx = new PostgresTestContext();
    await ctx.connect();

    await ctx.executeRaw(`
      CREATE TABLE IF NOT EXISTS integration_users (
        id INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        version INT NOT NULL DEFAULT 1
      )
    `);
  });

  afterAll(async () => {
    try {
      await ctx.executeRaw('DROP TABLE IF EXISTS integration_users');
      await ctx.disconnect();
    } catch {}
  });

  it('verifies connection pool health against PostgreSQL container', async () => {
    expect(ctx.pool).toBeDefined();
    const health = await ctx.pool!.health();

    expect(health.isAlive).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.totalConnections).toBeGreaterThanOrEqual(1);
  });

  it('inserts, updates with versioning, and queries on PostgreSQL', async () => {
    await ctx.executeRaw('DELETE FROM integration_users');

    const added = await ctx.users.add({
      id: 10,
      name: 'Diana',
      email: 'diana@pg.com',
      version: 1,
    });
    expect(added.id).toBe(10);

    const found = await ctx.users.find(10);
    expect(found?.name).toBe('Diana');

    const updated = await ctx.users.update(10, { name: 'Diana Prince' }, 1);
    expect(updated.name).toBe('Diana Prince');
    expect(updated.version).toBe(2);

    await ctx.users.remove(10, 2);
    expect(await ctx.users.find(10)).toBeNull();
  });
});

// ─── 3. MySQL Live Integration (CI Container / Live Instance) ─────────────────

const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL_MYSQL;
const describeMysql = mysqlUrl ? describe : describe.skip;

describeMysql('MySQL Live Integration (CI Container)', () => {
  class MysqlTestContext extends DbContext {
    public users = this.set(IntegrationUser);

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.useMysql(mysqlUrl!).withConnectionPool({
        minConnections: 2,
        maxConnections: 10,
        heartbeatIntervalMs: 0,
      });
    }
  }

  let ctx: MysqlTestContext;

  beforeAll(async () => {
    ctx = new MysqlTestContext();
    await ctx.connect();

    await ctx.executeRaw(`
      CREATE TABLE IF NOT EXISTS integration_users (
        id INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        version INT NOT NULL DEFAULT 1
      )
    `);
  });

  afterAll(async () => {
    try {
      await ctx.executeRaw('DROP TABLE IF EXISTS integration_users');
      await ctx.disconnect();
    } catch {}
  });

  it('verifies connection pool health against MySQL container', async () => {
    expect(ctx.pool).toBeDefined();
    const health = await ctx.pool!.health();

    expect(health.isAlive).toBe(true);
    expect(health.status).toBe('healthy');
  });

  it('inserts, updates, and deletes on MySQL', async () => {
    await ctx.executeRaw('DELETE FROM integration_users');

    const added = await ctx.users.add({
      id: 20,
      name: 'Evan',
      email: 'evan@mysql.com',
      version: 1,
    });
    expect(added.id).toBe(20);

    const updated = await ctx.users.update(20, { name: 'Evan Wright' }, 1);
    expect(updated.name).toBe('Evan Wright');
    expect(updated.version).toBe(2);

    await ctx.users.remove(20, 2);
    expect(await ctx.users.find(20)).toBeNull();
  });
});

// ─── 4. MSSQL Live Integration (CI Container / Live Instance) ─────────────────

const mssqlUrl = process.env.MSSQL_URL || process.env.DATABASE_URL_MSSQL;
const describeMssql = mssqlUrl ? describe : describe.skip;

describeMssql('MSSQL Server Live Integration (CI Container)', () => {
  class MssqlTestContext extends DbContext {
    public users = this.set(IntegrationUser);

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.useSqlServer(mssqlUrl!).withConnectionPool({
        minConnections: 2,
        maxConnections: 10,
        heartbeatIntervalMs: 0,
      });
    }
  }

  let ctx: MssqlTestContext;

  beforeAll(async () => {
    ctx = new MssqlTestContext();
    // Allow SQL Server container up to 30s to initialize master database
    let connected = false;
    for (let i = 0; i < 15; i++) {
      try {
        await ctx.connect();
        connected = true;
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    if (!connected) {
      await ctx.connect();
    }

    await ctx.executeRaw(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='integration_users' and xtype='U')
      CREATE TABLE integration_users (
        id INT PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        email NVARCHAR(255) NOT NULL,
        version INT NOT NULL DEFAULT 1
      )
    `);
  }, 45000);

  afterAll(async () => {
    try {
      await ctx.executeRaw('DROP TABLE IF EXISTS integration_users');
      await ctx.disconnect();
    } catch {}
  });

  it('verifies connection pool health against MSSQL container', async () => {
    expect(ctx.pool).toBeDefined();
    const health = await ctx.pool!.health();

    expect(health.isAlive).toBe(true);
    expect(health.status).toBe('healthy');
  });
});

// ─── 5. Serverless & Cloud Adapters Verification ─────────────────────────────

describe('Serverless & Cloud Adapters (Neon, PlanetScale, Turso, CockroachDB, Supabase, D1)', () => {
  it('correctly configures Neon PostgreSQL serverless adapter', () => {
    const builder = new DbContextOptionsBuilder()
      .useNeon('postgresql://user:pass@ep-serverless.us-east-2.aws.neon.tech/neondb')
      .withConnectionPool({ minConnections: 1, maxConnections: 5 });
    const opts = builder.build();

    expect(opts.provider).toBe('neon');
    expect(opts.poolOptions).toBeDefined();
    expect(opts.adapter).toBeDefined();
  });

  it('correctly configures PlanetScale MySQL serverless adapter', () => {
    const builder = new DbContextOptionsBuilder()
      .usePlanetScale({ url: 'mysql://user:pass@aws.connect.psdb.cloud/mydb' })
      .withConnectionPool({ minConnections: 1, maxConnections: 5 });
    const opts = builder.build();

    expect(opts.provider).toBe('planetscale');
    expect(opts.adapter?.provider).toBe('planetscale');
  });

  it('correctly configures Turso SQLite / libSQL serverless adapter', () => {
    const builder = new DbContextOptionsBuilder()
      .useTurso({ url: 'libsql://my-db.turso.io', authToken: 'token123' })
      .withConnectionPool({ minConnections: 1, maxConnections: 5 });
    const opts = builder.build();

    expect(opts.provider).toBe('turso');
    expect(opts.adapter?.provider).toBe('turso');
  });

  it('correctly configures CockroachDB distributed SQL adapter', () => {
    const builder = new DbContextOptionsBuilder().useCockroachDb(
      'postgresql://user:pass@cluster.cockroachlabs.cloud:26257/defaultdb',
    );
    const opts = builder.build();

    expect(opts.provider).toBe('cockroachdb');
    expect(opts.adapter?.provider).toBe('cockroachdb');
  });

  it('correctly configures Supabase PostgreSQL adapter', () => {
    const builder = new DbContextOptionsBuilder().useSupabase(
      'postgresql://postgres:secret@db.supabase.co:5432/postgres',
    );
    const opts = builder.build();

    expect(opts.provider).toBe('supabase');
    expect(opts.adapter?.provider).toBe('supabase');
  });

  it('correctly configures Cloudflare D1 serverless SQLite adapter', () => {
    const mockD1 = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      }),
    };
    const builder = new DbContextOptionsBuilder().useD1(mockD1 as any);
    const opts = builder.build();

    expect(opts.provider).toBe('d1');
    expect(opts.adapter?.provider).toBe('d1');
  });
});
