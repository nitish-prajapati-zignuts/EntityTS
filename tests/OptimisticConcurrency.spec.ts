import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  PrimaryKey,
  Column,
  Version,
  RowVersion,
  ConcurrencyCheck,
  DbUpdateConcurrencyException,
  MockDbAdapter,
} from '../src';

@Entity()
@Table('accounts')
class Account {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  owner!: string;

  @Column()
  balance!: number;

  @Version()
  version!: number;
}

@Entity()
@Table('products')
class Product {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  name!: string;

  @ConcurrencyCheck()
  @Column()
  price!: number;

  @RowVersion()
  rowVersion!: number;
}

class AccountDbContext extends DbContext {
  public accounts = this.set(Account);
  public products = this.set(Product);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        accounts: [
          { id: 1, owner: 'Alice', balance: 1000, version: 1 },
          { id: 2, owner: 'Bob', balance: 500, version: 1 },
        ],
        products: [{ id: 1, name: 'Laptop', price: 999, rowVersion: 1 }],
      },
    });
  }
}

describe('Optimistic Concurrency Control (@Version / @RowVersion / @ConcurrencyCheck)', () => {
  let ctx: AccountDbContext;

  beforeEach(() => {
    ctx = new AccountDbContext();
  });

  describe('Entity Insertion with @Version', () => {
    it('automatically initializes version to 1 when inserted if not provided', async () => {
      const newAcc = await ctx.accounts.add({
        id: 3,
        owner: 'Charlie',
        balance: 750,
      });

      expect(newAcc.version).toBe(1);
    });
  });

  describe('Direct DbSet.update() with @Version', () => {
    it('appends version check to WHERE and increments version in SET', async () => {
      const updated = await ctx.accounts.update(1, {
        balance: 1200,
        version: 1,
      });

      expect(updated.balance).toBe(1200);
      expect(updated.version).toBe(2);
    });

    it('throws DbUpdateConcurrencyException when version does not match', async () => {
      // Trying to update with stale version 99 while db has version 1
      await expect(
        ctx.accounts.update(1, {
          balance: 1500,
          version: 99,
        }),
      ).rejects.toThrow(DbUpdateConcurrencyException);
    });

    it('throws DbUpdateConcurrencyException with entityName and entityKey metadata', async () => {
      try {
        await ctx.accounts.update(1, { balance: 9999 }, 5);
        fail('Should have thrown DbUpdateConcurrencyException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(DbUpdateConcurrencyException);
        expect(err.entityName).toBe('accounts');
        expect(err.entityKey).toBe(1);
      }
    });
  });

  describe('Direct DbSet.remove() with @Version', () => {
    it('removes successfully when expected version matches', async () => {
      await expect(ctx.accounts.remove(1, 1)).resolves.not.toThrow();
      const item = await ctx.accounts.find(1);
      expect(item).toBeNull();
    });

    it('throws DbUpdateConcurrencyException when removing with stale version', async () => {
      await expect(ctx.accounts.remove(2, 99)).rejects.toThrow(DbUpdateConcurrencyException);
    });
  });

  describe('ChangeTracker and saveChanges() Concurrency Control', () => {
    it('tracks original version and increments on saveChanges()', async () => {
      const acc = await ctx.accounts.track(1);
      expect(acc.version).toBe(1);

      acc.balance = 1100;
      const affected = await ctx.saveChanges();
      expect(affected).toBe(1);

      const refreshed = await ctx.accounts.find(1);
      expect(refreshed?.balance).toBe(1100);
      expect(refreshed?.version).toBe(2);
    });

    it('throws DbUpdateConcurrencyException during saveChanges() if database row changed concurrently', async () => {
      const sharedAdapter = new MockDbAdapter({
        tables: {
          accounts: [{ id: 1, owner: 'Alice', balance: 1000, version: 1 }],
        },
      });

      class SharedDbContext extends DbContext {
        public accounts = this.set(Account);
        protected onConfiguring(options: DbContextOptionsBuilder): void {
          options.useAdapter(sharedAdapter);
        }
      }

      // Client A tracks account 1 with version 1
      const clientAContext = new SharedDbContext();
      const accountA = await clientAContext.accounts.track(1);

      // Client B concurrently updates account 1 to version 2
      const clientBContext = new SharedDbContext();
      await clientBContext.accounts.update(1, { balance: 1050, version: 1 });

      // Client A attempts to save changes with stale original version 1
      accountA.balance = 2000;
      await expect(clientAContext.saveChanges()).rejects.toThrow(DbUpdateConcurrencyException);
    });

    it('supports @ConcurrencyCheck on specific properties', async () => {
      // Product has @ConcurrencyCheck on price
      const prod = await ctx.products.track(1);
      prod.name = 'Gaming Laptop';

      // Pass concurrent price check
      await ctx.products.update(1, { name: 'Gaming Laptop' }, 1, { price: 999 });
      const updated = await ctx.products.find(1);
      expect(updated?.name).toBe('Gaming Laptop');

      // Fail concurrent price check if price changed in db
      await expect(
        ctx.products.update(1, { name: 'Super Laptop' }, 2, { price: 500 }),
      ).rejects.toThrow(DbUpdateConcurrencyException);
    });
  });
});
