import { DbContext } from '../context/DbContext';
import { DbSet } from '../set/DbSet';
import { Entity, Table, Column, PrimaryKey } from '../decorators';
import { SqlType } from '../procedure/SqlType';
import { SqliteAdapter } from '../adapters/SqliteAdapter';
import { MockDbAdapter } from '../adapters/MockDbAdapter';
import { IDbAdapter } from '../adapters/IDbAdapter';
import { BenchmarkRunner } from './BenchmarkRunner';
import { BenchmarkOptions, BenchmarkResult } from './BenchmarkMetrics';

@Entity()
@Table('benchmark_users')
export class BenchmarkUser {
  @PrimaryKey({ autoIncrement: true })
  @Column({ name: 'id', type: SqlType.Int })
  id!: number;

  @Column({ name: 'name', type: SqlType.VarChar, maxLength: 100 })
  name!: string;

  @Column({ name: 'role', type: SqlType.VarChar, maxLength: 50 })
  role!: string;

  @Column({ name: 'score', type: SqlType.Int })
  score!: number;

  @Column({ name: 'email', type: SqlType.VarChar, maxLength: 150 })
  email?: string;
}

export class BenchmarkDbContext extends DbContext {
  public users = this.set(BenchmarkUser);

  public async getUserSummary(minScore: number): Promise<unknown> {
    return this.procedure('GetUserSummary').input({ minScore }).execute();
  }
}

/**
 * Creates and configures the Execution Benchmark Suite for EntityTS.
 */
export async function createExecutionBenchmarkSuite(
  customAdapter?: IDbAdapter,
): Promise<{ runner: BenchmarkRunner; context: BenchmarkDbContext; cleanup: () => Promise<void> }> {
  let adapter: IDbAdapter;
  let isSqlite = false;

  // 1,000 initial benchmark seed records
  const initialUsers: Array<{
    id: number;
    name: string;
    role: string;
    score: number;
    email: string;
  }> = [];
  for (let i = 1; i <= 1000; i++) {
    initialUsers.push({
      id: i,
      name: `User_${i}`,
      role: i % 10 === 0 ? 'admin' : i % 3 === 0 ? 'manager' : 'user',
      score: 50 + (i % 50),
      email: `user_${i}@example.com`,
    });
  }

  if (customAdapter) {
    adapter = customAdapter;
  } else {
    try {
      const sqlite = new SqliteAdapter({ filename: ':memory:' });
      await sqlite.connect();
      isSqlite = true;
      adapter = sqlite;
    } catch {
      // Fallback to in-memory MockDbAdapter
      adapter = new MockDbAdapter({
        tables: {
          benchmark_users: initialUsers,
        },
        procedures: {
          getusersummary: {
            returnValue: 0,
            rowsAffected: 10,
          },
        },
      });
      await adapter.connect();
    }
  }

  if (isSqlite) {
    await adapter.executeNonQuery(`
      CREATE TABLE IF NOT EXISTS benchmark_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        score INTEGER NOT NULL,
        email TEXT
      );
    `);

    // Fast seed into SQLite
    for (const u of initialUsers) {
      await adapter.executeNonQuery(
        `INSERT INTO benchmark_users (id, name, role, score, email) VALUES (?, ?, ?, ?, ?)`,
        [
          { name: 'p0', value: u.id },
          { name: 'p1', value: u.name },
          { name: 'p2', value: u.role },
          { name: 'p3', value: u.score },
          { name: 'p4', value: u.email },
        ],
      );
    }
  }

  const context = new BenchmarkDbContext({
    adapter,
  });

  const runner = new BenchmarkRunner();

  // -------------------------------------------------------------------------
  // Category 1: Raw SQL Execution
  // -------------------------------------------------------------------------

  runner.add({
    name: 'Direct Adapter executeQuery',
    category: 'Raw SQL',
    fn: async () => {
      await adapter.executeQuery('SELECT * FROM benchmark_users WHERE role = ? LIMIT 10', [
        { name: 'p0', value: 'user' },
      ]);
    },
  });

  runner.add({
    name: 'DbContext.queryRaw (parameterized)',
    category: 'Raw SQL',
    fn: async () => {
      await context.queryRaw('SELECT * FROM benchmark_users WHERE role = ? LIMIT 10', ['user']);
    },
  });

  runner.add({
    name: 'DbContext.sql Tagged Template',
    category: 'Raw SQL',
    fn: async () => {
      const role = 'user';
      await context.sql`SELECT * FROM benchmark_users WHERE role = ${role} LIMIT 10`;
    },
  });

  runner.add({
    name: 'DbContext.queryScalar (COUNT)',
    category: 'Raw SQL',
    fn: async () => {
      await context.queryScalar('SELECT COUNT(*) FROM benchmark_users');
    },
  });

  // -------------------------------------------------------------------------
  // Category 2: DbSet Query Execution
  // -------------------------------------------------------------------------

  runner.add({
    name: 'DbSet.first() [Limit 1]',
    category: 'DbSet Query',
    fn: async () => {
      await context.users.first();
    },
  });

  runner.add({
    name: 'DbSet.where().toList() [10 rows]',
    category: 'DbSet Query',
    fn: async () => {
      await context.users.where({ role: 'admin' }).take(10).toList();
    },
  });

  runner.add({
    name: 'DbSet Complex Filter & Order & Page',
    category: 'DbSet Query',
    fn: async () => {
      await context.users
        .where(q => q.gt('score', 60).and().eq('role', 'user'))
        .orderBy('score', 'desc')
        .skip(10)
        .take(20)
        .toList();
    },
  });

  runner.add({
    name: 'DbSet.toList() [Hydrate 100 Entities]',
    category: 'DbSet Query',
    fn: async () => {
      await context.users.take(100).toList();
    },
  });

  runner.add({
    name: 'DbSet.cache().toList() [Cached Read]',
    category: 'DbSet Query',
    fn: async () => {
      await context.users.cache(60000, 'bench_cached_users').take(20).toList();
    },
  });

  // -------------------------------------------------------------------------
  // Category 3: Write & Mutation Execution
  // -------------------------------------------------------------------------

  let insertCounter = 10000;
  runner.add({
    name: 'DbSet.add() [Single Insert]',
    category: 'Mutations',
    fn: async () => {
      insertCounter++;
      await context.users.add({
        name: `TempUser_${insertCounter}`,
        role: 'user',
        score: 75,
        email: `temp_${insertCounter}@bench.com`,
      });
    },
  });

  runner.add({
    name: 'DbSet.addRange() [Batch 10 Inserts]',
    category: 'Mutations',
    fn: async () => {
      const batch: Partial<BenchmarkUser>[] = [];
      for (let b = 0; b < 10; b++) {
        insertCounter++;
        batch.push({
          name: `Batch_${insertCounter}`,
          role: 'user',
          score: 80,
          email: `batch_${insertCounter}@bench.com`,
        });
      }
      await context.users.addRange(batch);
    },
  });

  runner.add({
    name: 'DbSet.bulkInsert() [Bulk 50 Inserts]',
    category: 'Mutations',
    fn: async () => {
      const bulk: Partial<BenchmarkUser>[] = [];
      for (let b = 0; b < 50; b++) {
        insertCounter++;
        bulk.push({
          name: `Bulk_${insertCounter}`,
          role: 'user',
          score: 85,
          email: `bulk_${insertCounter}@bench.com`,
        });
      }
      await context.users.bulkInsert(bulk);
    },
  });

  runner.add({
    name: 'DbSet.update() [Single Update]',
    category: 'Mutations',
    fn: async () => {
      await context.users.update(1, { score: 99 });
    },
  });

  // -------------------------------------------------------------------------
  // Category 4: Change Tracking Execution
  // -------------------------------------------------------------------------

  runner.add({
    name: 'ChangeTracker Proxy Mutation & Track',
    category: 'Change Tracking',
    fn: async () => {
      const user = await context.users.first();
      if (user) {
        const tracked = context.changeTracker.track(user);
        tracked.score += 1;
        context.changeTracker.clear();
      }
    },
  });

  // -------------------------------------------------------------------------
  // Category 5: Stored Procedure Execution
  // -------------------------------------------------------------------------

  const sprocTarget = isSqlite
    ? 'SELECT * FROM benchmark_users WHERE score >= ?'
    : 'GetUserSummary';

  runner.add({
    name: 'StoredProcedureBuilder Execution',
    category: 'Stored Procedure',
    fn: async () => {
      await context.procedure(sprocTarget).input({ minScore: 70 }).execute();
    },
  });

  // -------------------------------------------------------------------------
  // Category 6: Resilient Execution Overhead
  // -------------------------------------------------------------------------

  runner.add({
    name: 'executeResilient Wrapper Overhead',
    category: 'Resilience',
    fn: async () => {
      await context.executeResilient(async () => {
        return context.users.first();
      });
    },
  });

  const cleanup = async () => {
    await adapter.disconnect();
  };

  return { runner, context, cleanup };
}

/**
 * Convenience helper to run the complete execution benchmark suite.
 */
export async function runExecutionBenchmarks(
  options: BenchmarkOptions = {},
  adapter?: IDbAdapter,
): Promise<BenchmarkResult[]> {
  const { runner, cleanup } = await createExecutionBenchmarkSuite(adapter);
  try {
    return await runner.run(options);
  } finally {
    await cleanup();
  }
}
