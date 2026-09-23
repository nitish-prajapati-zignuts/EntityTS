import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  PrimaryKey,
  Column,
  Version,
  DbUpdateConcurrencyException,
  MockDbAdapter,
} from '../src';

@Entity()
@Table('e2e_wallets')
class E2EWallet {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  holder!: string;

  @Column()
  balance!: number;

  @Version()
  version!: number;
}

function createWalletContext(
  initialWallets: Array<{ id: number; holder: string; balance: number; version: number }>,
) {
  const adapter = new MockDbAdapter({
    tables: {
      e2e_wallets: [...initialWallets],
    },
  });

  class WalletDbContext extends DbContext {
    public wallets = this.set(E2EWallet);

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.useAdapter(adapter);
    }
  }

  return { ctx: new WalletDbContext(), adapter };
}

describe('Optimistic Locking on saveChanges() E2E', () => {
  it('increments version and updates entity when saveChanges() executes', async () => {
    const { ctx } = createWalletContext([{ id: 1, holder: 'Alice', balance: 500, version: 1 }]);

    const wallet = await ctx.wallets.track(1);
    expect(wallet.version).toBe(1);

    wallet.balance = 600;
    const affected = await ctx.saveChanges();

    expect(affected).toBe(1);
    expect(wallet.version).toBe(2);

    const refreshed = await ctx.wallets.find(1);
    expect(refreshed?.balance).toBe(600);
    expect(refreshed?.version).toBe(2);
  });

  it('aborts saveChanges() and throws DbUpdateConcurrencyException when database version changed concurrently', async () => {
    const { ctx, adapter } = createWalletContext([
      { id: 1, holder: 'Alice', balance: 500, version: 1 },
    ]);

    const wallet = await ctx.wallets.track(1);
    expect(wallet.version).toBe(1);

    // Simulate another client updating the database behind our back
    const tableRows = adapter.getTableData('e2e_wallets');
    const dbRow = tableRows.find((r: any) => r.id === 1)!;
    dbRow.version = 2;
    dbRow.balance = 700;

    wallet.balance = 550;

    await expect(ctx.saveChanges()).rejects.toThrow(DbUpdateConcurrencyException);
  });

  it('updateUnique with version where criteria checks version and increments', async () => {
    const { ctx } = createWalletContext([{ id: 1, holder: 'Alice', balance: 500, version: 1 }]);

    const updated = await ctx.wallets.updateUnique({
      where: { id: 1, version: 1 },
      data: { balance: 900 },
    });

    expect(updated.balance).toBe(900);
    expect(updated.version).toBe(2);
  });

  it('updateUnique throws DbUpdateConcurrencyException when version is stale', async () => {
    const { ctx } = createWalletContext([{ id: 1, holder: 'Alice', balance: 500, version: 2 }]);

    await expect(
      ctx.wallets.updateUnique({
        where: { id: 1, version: 1 }, // stale version
        data: { balance: 900 },
      }),
    ).rejects.toThrow(DbUpdateConcurrencyException);
  });

  it('handles multiple tracked entities with @Version concurrently in one saveChanges() batch', async () => {
    const { ctx } = createWalletContext([
      { id: 1, holder: 'Alice', balance: 500, version: 1 },
      { id: 2, holder: 'Bob', balance: 300, version: 3 },
    ]);

    const w1 = await ctx.wallets.track(1);
    const w2 = await ctx.wallets.track(2);

    w1.balance = 550;
    w2.balance = 350;

    const affected = await ctx.saveChanges();
    expect(affected).toBe(2);

    expect(w1.version).toBe(2);
    expect(w2.version).toBe(4);

    const ref1 = await ctx.wallets.find(1);
    const ref2 = await ctx.wallets.find(2);

    expect(ref1?.version).toBe(2);
    expect(ref2?.version).toBe(4);
  });
});
