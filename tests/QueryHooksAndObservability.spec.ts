import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  createSlowQueryLogger,
} from '../src';

@Entity()
@Table('logs')
class LogItem {
  @PrimaryKey()
  id!: number;

  @Column()
  message!: string;
}

describe('Query Hooks and Observability', () => {
  it('calls onBeforeQuery and onAfterQuery hooks on queries', async () => {
    const beforeCalls: string[] = [];
    const afterCalls: { sql: string; durationMs: number }[] = [];

    class HookDbContext extends DbContext {
      public logs!: DbSet<LogItem>;

      protected onConfiguring(options: DbContextOptionsBuilder): void {
        options
          .useMock({
            tables: {
              logs: [{ id: 1, message: 'Server started' }],
            },
          })
          .withHooks({
            onBeforeQuery: (sql, params) => {
              beforeCalls.push(sql);
            },
            onAfterQuery: (sql, params, durationMs) => {
              afterCalls.push({ sql, durationMs: durationMs ?? 0 });
            },
          });
      }
    }

    const ctx = new HookDbContext();
    ctx.logs = ctx.set(LogItem);

    const items = await ctx.logs.toList();
    expect(items.length).toBe(1);
    expect(beforeCalls.length).toBeGreaterThan(0);
    expect(afterCalls.length).toBeGreaterThan(0);
    expect(afterCalls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('triggers onError hook when a query fails', async () => {
    let capturedError: Error | undefined;
    let capturedSql: string | undefined;

    class FailingDbContext extends DbContext {
      protected onConfiguring(options: DbContextOptionsBuilder): void {
        options
          .useMock({
            tables: {},
          })
          .withHooks({
            onError: (err, sql) => {
              capturedError = err;
              capturedSql = sql;
            },
          });
      }
    }

    const ctx = new FailingDbContext();
    // Simulate failing adapter
    (ctx.adapter as any).inner.executeQuery = () => {
      throw new Error('Connection terminated unexpectedly');
    };

    await expect(ctx.fromSql('SELECT 1')).rejects.toThrow('Connection terminated');
    expect(capturedError).toBeDefined();
    expect(capturedError?.message).toBe('Connection terminated unexpectedly');
    expect(capturedSql).toBe('SELECT 1');
  });

  it('createSlowQueryLogger warns on slow queries exceeding threshold', async () => {
    const slowLogs: string[] = [];

    const slowLoggerHooks = createSlowQueryLogger({
      thresholdMs: 50,
      logger: msg => slowLogs.push(msg),
    });

    class SlowDbContext extends DbContext {
      protected onConfiguring(options: DbContextOptionsBuilder): void {
        options
          .useMock({
            tables: {
              logs: [{ id: 1, message: 'Slow query test' }],
            },
          })
          .withHooks(slowLoggerHooks);
      }
    }

    const ctx = new SlowDbContext();
    // Wrap executeQuery with an artificial delay
    const orig = (ctx.adapter as any).inner.executeQuery.bind((ctx.adapter as any).inner);
    (ctx.adapter as any).inner.executeQuery = async (sql: any, params: any, tx: any) => {
      await new Promise(r => setTimeout(r, 60));
      return orig(sql, params, tx);
    };

    await ctx.fromSql('SELECT * FROM logs');
    expect(slowLogs.length).toBe(1);
    expect(slowLogs[0]).toContain('[SLOW QUERY]');
  });

  it('executes injection-safe parameterized tagged template SQL via ctx.sql', async () => {
    class SqlDbContext extends DbContext {
      protected onConfiguring(options: DbContextOptionsBuilder): void {
        options.useMock({
          tables: {
            logs: [
              { id: 1, message: 'First' },
              { id: 2, message: 'Second' },
            ],
          },
        });
      }
    }

    const ctx = new SqlDbContext();
    const idParam = 1;
    const result = await ctx.sql<LogItem>`SELECT * FROM logs WHERE id = ${idParam}`;
    expect(result.length).toBe(1);
    expect(result[0].message).toBe('First');
  });
});
