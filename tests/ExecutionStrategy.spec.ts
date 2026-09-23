import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';
import { DefaultExecutionStrategy, isTransientError } from '../src/resilience';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { Entity, PrimaryKey, Column } from '../src/decorators';
import { DbSet } from '../src/set/DbSet';

@Entity('accounts')
class Account {
  @PrimaryKey()
  id!: number;

  @Column()
  balance!: number;
}

class TestDbContext extends DbContext {
  public accounts!: DbSet<Account>;
}

describe('Resilient Connection & Execution Strategy', () => {
  describe('isTransientError()', () => {
    it('detects Postgres/Neon deadlock and serialization errors', () => {
      expect(isTransientError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
      expect(isTransientError({ code: '40001', message: 'serialization failure' })).toBe(true);
      expect(isTransientError({ code: '57P01', message: 'admin shutdown' })).toBe(true);
    });

    it('detects MySQL deadlock and connection lost errors', () => {
      expect(isTransientError({ errno: 1205, message: 'Lock wait timeout exceeded' })).toBe(true);
      expect(isTransientError({ errno: 1213, message: 'Deadlock found when trying to get lock' })).toBe(true);
      expect(isTransientError({ errno: 2006, message: 'MySQL server has gone away' })).toBe(true);
    });

    it('detects network drops and socket timeouts', () => {
      expect(isTransientError({ code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe(true);
      expect(isTransientError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' })).toBe(true);
      expect(isTransientError({ message: 'connection reset by peer' })).toBe(true);
    });

    it('detects SQLite busy/locked errors', () => {
      expect(isTransientError({ code: 'SQLITE_BUSY', message: 'database is locked' })).toBe(true);
    });

    it('does NOT treat business/syntax errors as transient', () => {
      expect(isTransientError({ code: '42P01', message: 'relation does not exist' })).toBe(false);
      expect(isTransientError({ code: '23505', message: 'unique constraint violation' })).toBe(false);
      expect(isTransientError(new Error('Validation error: invalid amount'))).toBe(false);
    });
  });

  describe('DefaultExecutionStrategy', () => {
    it('succeeds immediately when no error occurs', async () => {
      const strategy = new DefaultExecutionStrategy({ maxRetryCount: 3 });
      const result = await strategy.execute(async () => 42);
      expect(result).toBe(42);
    });

    it('retries on transient error and succeeds on subsequent attempt', async () => {
      let attempts = 0;
      const retryLog: number[] = [];

      const strategy = new DefaultExecutionStrategy({
        maxRetryCount: 3,
        initialDelayMs: 10,
        maxDelayMs: 50,
        jitter: false,
        onRetry: (_err, attempt) => retryLog.push(attempt),
      });

      const result = await strategy.execute(async () => {
        attempts++;
        if (attempts < 3) {
          const err: any = new Error('deadlock detected');
          err.code = '40P01';
          throw err;
        }
        return 'success';
      });

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(retryLog).toEqual([1, 2]);
    });

    it('throws immediately on non-transient error without retrying', async () => {
      let attempts = 0;
      const strategy = new DefaultExecutionStrategy({
        maxRetryCount: 3,
        initialDelayMs: 10,
      });

      await expect(
        strategy.execute(async () => {
          attempts++;
          const err: any = new Error('Syntax error');
          err.code = '42601';
          throw err;
        })
      ).rejects.toThrow('Syntax error');

      expect(attempts).toBe(1);
    });

    it('exhausts retry attempts and throws if error persists', async () => {
      let attempts = 0;
      const strategy = new DefaultExecutionStrategy({
        maxRetryCount: 2,
        initialDelayMs: 5,
        maxDelayMs: 10,
        jitter: false,
      });

      await expect(
        strategy.execute(async () => {
          attempts++;
          const err: any = new Error('Deadlock');
          err.code = '40P01';
          throw err;
        })
      ).rejects.toThrow('Deadlock');

      expect(attempts).toBe(3); // 1 initial + 2 retries
    });
  });

  describe('DbContext Integration', () => {
    it('configures execution strategy via DbContextOptionsBuilder.withExecutionStrategy', () => {
      const options = new DbContextOptionsBuilder()
        .useMock()
        .withExecutionStrategy({
          maxRetryCount: 4,
          maxDelayMs: 1000,
        })
        .build();

      expect(options.executionStrategy).toBeDefined();
    });

    it('configures retry via DbContextOptionsBuilder.enableRetryOnFailure', () => {
      const options = new DbContextOptionsBuilder()
        .useMock()
        .enableRetryOnFailure(5, 3000)
        .build();

      expect(options.executionStrategy).toBeDefined();
    });

    it('executeResilientTransaction executes transaction with automatic retry on deadlock', async () => {
      const adapter = new MockDbAdapter({
        tables: {
          accounts: [{ id: 1, balance: 1000 }],
        },
      });

      let attempts = 0;
      const options = new DbContextOptionsBuilder()
        .useAdapter(adapter)
        .withExecutionStrategy({
          maxRetryCount: 3,
          initialDelayMs: 5,
          jitter: false,
        })
        .build();

      const ctx = new TestDbContext(options);
      ctx.accounts = new DbSet<Account>(adapter, Account);

      const result = await ctx.executeResilientTransaction(async (_tx) => {
        attempts++;
        if (attempts === 1) {
          const deadlockErr: any = new Error('deadlock victim');
          deadlockErr.code = '40P01';
          throw deadlockErr;
        }
        return 'transaction committed';
      });

      expect(result).toBe('transaction committed');
      expect(attempts).toBe(2);
    });

    it('executeResilient executes general operation with retry', async () => {
      const adapter = new MockDbAdapter();
      let attempts = 0;
      const options = new DbContextOptionsBuilder()
        .useAdapter(adapter)
        .enableRetryOnFailure(3, 50)
        .build();

      const ctx = new TestDbContext(options);
      const res = await ctx.executeResilient(async () => {
        attempts++;
        if (attempts === 1) {
          const netErr: any = new Error('Connection reset');
          netErr.code = 'ECONNRESET';
          throw netErr;
        }
        return 999;
      });

      expect(res).toBe(999);
      expect(attempts).toBe(2);
    });
  });
});
