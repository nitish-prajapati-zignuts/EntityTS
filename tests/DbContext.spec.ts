import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';
import { ModelBuilder } from '../src/model/ModelBuilder';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { Entity, Table, Column, PrimaryKey, Ignore } from '../src/decorators';
import { SqlType } from '../src/procedure/SqlType';
import { dbContextMiddleware } from '../src/di/express';
import { DbContextModule } from '../src/di/nestjs/DbContextModule';
import { getDbContextToken } from '../src/di/nestjs/InjectDbContext';

// Sample Entity with decorators
@Entity()
@Table('tbl_accounts')
class Account {
  @PrimaryKey({ autoIncrement: true })
  @Column({ name: 'account_id', type: SqlType.Int })
  id!: number;

  @Column({ name: 'holder_name', type: SqlType.VarChar, maxLength: 100 })
  holderName!: string;

  @Column({ name: 'balance_usd', type: SqlType.Decimal })
  balance!: number;

  @Ignore()
  cachedScore?: number;
}

// Custom AppDbContext
class TestDbContext extends DbContext {
  public accounts = this.set(Account);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    // If not supplied via constructor, configure mock
    options.useMock({
      tables: {
        tbl_accounts: [
          { account_id: 1, holder_name: 'Alice', balance_usd: 1500 },
          { account_id: 2, holder_name: 'Bob', balance_usd: 2500 },
        ],
      },
      procedures: {
        usp_TransferFunds: {
          outputParams: { Status: 'SUCCESS' },
          returnValue: 0,
          rowsAffected: 2,
        },
      },
    });
  }

  protected onModelCreating(modelBuilder: ModelBuilder): void {
    // Fluent model configuration override
    modelBuilder.entity(Account, e => {
      e.toTable('tbl_accounts');
      e.hasKey(a => a.id);
      e.property(a => a.holderName).hasColumnName('holder_name');
    });
  }
}

describe('DbContext and EF Core-like features', () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = new TestDbContext();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  it('instantiates DbContext and resolves provider', () => {
    expect(ctx.provider).toBe('mock');
  });

  it('reads entities using decorated and fluent mapped DbSet', async () => {
    const accounts = await ctx.accounts.toList();
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toBeInstanceOf(Account);
    expect(accounts[0].id).toBe(1);
    expect(accounts[0].holderName).toBe('Alice');
    expect(accounts[0].balance).toBe(1500);
  });

  it('executes stored procedures with typed output parameters', async () => {
    const result = await ctx
      .procedure('usp_TransferFunds')
      .withParam('FromAccount', 1)
      .withParam('ToAccount', 2)
      .withParam('Amount', 500)
      .withOutputParam('Status', SqlType.VarChar)
      .execute();

    expect(result.outputParams['Status']).toBe('SUCCESS');
    expect(result.returnValue).toBe(0);
    expect(result.rowsAffected).toBe(2);
  });

  it('executes useTransaction and commits on success', async () => {
    let executedInTx = false;

    await ctx.useTransaction(async tx => {
      const txAccounts = ctx.accounts.inTransaction(tx);
      await txAccounts.toList();
      executedInTx = true;
    });

    expect(executedInTx).toBe(true);
  });

  it('executes useTransaction and rolls back on failure', async () => {
    await expect(
      ctx.useTransaction(async tx => {
        await ctx.accounts.inTransaction(tx).toList();
        throw new Error('Simulated failure');
      }),
    ).rejects.toThrow('Simulated failure');
  });

  it('integrates with Express middleware correctly', done => {
    const middleware = dbContextMiddleware(TestDbContext);
    const req: any = {};
    const res: any = {
      on: (_event: string, _callback: () => void) => {},
    };

    middleware(req, res, () => {
      expect(req.dbContext).toBeDefined();
      expect(req.dbContext).toBeInstanceOf(TestDbContext);
      done();
    });
  });

  it('creates NestJS dynamic module providers and tokens', () => {
    const dynamicModule = DbContextModule.forRoot({
      context: TestDbContext,
    });

    expect(dynamicModule.module).toBe(DbContextModule);
    expect(dynamicModule.providers).toHaveLength(2);
    expect(dynamicModule.exports).toContain(getDbContextToken(TestDbContext));
  });
});
