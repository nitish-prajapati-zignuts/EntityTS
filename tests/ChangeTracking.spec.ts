import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  EntityState,
} from '../src';

@Entity()
@Table('customers')
class Customer {
  @PrimaryKey()
  id!: number;

  @Column()
  name!: string;

  @Column()
  email!: string;
}

class CustomerDbContext extends DbContext {
  public customers!: DbSet<Customer>;

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        customers: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
      },
    });
  }
}

describe('Change Tracking & saveChanges()', () => {
  let ctx: CustomerDbContext;

  beforeEach(() => {
    ctx = new CustomerDbContext();
    ctx.customers = ctx.set(Customer);
  });

  it('tracks an entity and detects property mutations via Proxy', async () => {
    const customer = await ctx.customers.track(1);
    expect(customer.name).toBe('Alice');

    const entry = ctx.changeTracker.entry(customer);
    expect(entry).toBeDefined();
    expect(entry!.state).toBe(EntityState.Unchanged);
    expect(ctx.changeTracker.hasChanges()).toBe(false);

    // Modify property on proxy
    customer.name = 'Alice Wonderland';

    expect(entry!.state).toBe(EntityState.Modified);
    expect(ctx.changeTracker.hasChanges()).toBe(true);
    expect(entry!.getChanges()).toEqual({ name: 'Alice Wonderland' });
  });

  it('saveChanges flushes all pending updates, additions, and deletions in a transaction', async () => {
    // 1. Modify existing customer
    const alice = await ctx.customers.track(1);
    alice.name = 'Alice Smith';

    // 2. Add new customer
    const charlie = new Customer();
    charlie.id = 3;
    charlie.name = 'Charlie';
    charlie.email = 'charlie@example.com';
    ctx.changeTracker.add(charlie);

    // 3. Remove existing customer
    const bob = await ctx.customers.find(2);
    ctx.changeTracker.remove(bob!);

    expect(ctx.changeTracker.hasChanges()).toBe(true);

    // Save changes
    const affected = await ctx.saveChanges();
    expect(affected).toBe(3);
    expect(ctx.changeTracker.hasChanges()).toBe(false);

    // Verify persisted state
    const updatedAlice = await ctx.customers.find(1);
    expect(updatedAlice!.name).toBe('Alice Smith');

    const createdCharlie = await ctx.customers.find(3);
    expect(createdCharlie).toBeDefined();
    expect(createdCharlie!.name).toBe('Charlie');

    const deletedBob = await ctx.customers.find(2);
    expect(deletedBob).toBeNull();
  });

  it('clears tracked entities on changeTracker.clear()', async () => {
    const customer = await ctx.customers.track(1);
    customer.name = 'New Name';
    expect(ctx.changeTracker.hasChanges()).toBe(true);

    ctx.changeTracker.clear();
    expect(ctx.changeTracker.hasChanges()).toBe(false);
    expect(ctx.changeTracker.entries().length).toBe(0);
  });
});
