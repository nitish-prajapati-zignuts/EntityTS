import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  HasMany,
  HasOne,
  BelongsTo,
} from '../src';

@Entity()
@Table('profiles')
class Profile {
  @PrimaryKey()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @Column()
  bio!: string;
}

@Entity()
@Table('order_items')
class OrderItem {
  @PrimaryKey()
  id!: number;

  @Column({ name: 'order_id' })
  orderId!: number;

  @Column()
  product!: string;
}

@Entity()
@Table('orders')
class Order {
  @PrimaryKey()
  id!: number;

  @Column({ name: 'user_id' })
  userId!: number;

  @Column()
  amount!: number;

  @HasMany(() => OrderItem, { foreignKey: 'order_id' })
  items?: OrderItem[];

  @BelongsTo(() => User, { foreignKey: 'user_id' })
  user?: any;
}

@Entity()
@Table('users')
class User {
  @PrimaryKey()
  id!: number;

  @Column()
  name!: string;

  @HasMany(() => Order, { foreignKey: 'user_id' })
  orders?: Order[];

  @HasOne(() => Profile, { foreignKey: 'user_id' })
  profile?: Profile;
}

class StoreDbContext extends DbContext {
  public users!: DbSet<User>;
  public orders!: DbSet<Order>;
  public profiles!: DbSet<Profile>;
  public orderItems!: DbSet<OrderItem>;

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        orders: [
          { id: 101, user_id: 1, amount: 50 },
          { id: 102, user_id: 1, amount: 75 },
          { id: 103, user_id: 2, amount: 200 },
        ],
        profiles: [
          { id: 1, user_id: 1, bio: 'Alice bio' },
          { id: 2, user_id: 2, bio: 'Bob bio' },
        ],
        order_items: [
          { id: 1, order_id: 101, product: 'Book' },
          { id: 2, order_id: 101, product: 'Pen' },
          { id: 3, order_id: 102, product: 'Laptop' },
        ],
      },
    });
  }
}

describe('Relations and Eager Loading (.include)', () => {
  let ctx: StoreDbContext;

  beforeEach(() => {
    ctx = new StoreDbContext();
    ctx.users = ctx.set(User);
    ctx.orders = ctx.set(Order);
    ctx.profiles = ctx.set(Profile);
    ctx.orderItems = ctx.set(OrderItem);
  });

  it('eager loads HasMany relation using .include()', async () => {
    const users = await ctx.users.include('orders').toList();
    expect(users.length).toBe(2);

    const alice = users.find(u => u.name === 'Alice')!;
    expect(alice.orders).toBeDefined();
    expect(alice.orders!.length).toBe(2);
    expect(alice.orders!.map(o => o.id)).toEqual([101, 102]);

    const bob = users.find(u => u.name === 'Bob')!;
    expect(bob.orders).toBeDefined();
    expect(bob.orders!.length).toBe(1);
    expect(bob.orders![0].id).toBe(103);
  });

  it('eager loads HasOne relation using .include()', async () => {
    const users = await ctx.users.include('profile').toList();
    const alice = users.find(u => u.name === 'Alice')!;
    expect(alice.profile).toBeDefined();
    expect(alice.profile!.bio).toBe('Alice bio');
  });

  it('eager loads BelongsTo relation using .include()', async () => {
    const orders = await ctx.orders.include('user').toList();
    expect(orders.length).toBe(3);

    const order101 = orders.find(o => o.id === 101)!;
    expect(order101.user).toBeDefined();
    expect(order101.user?.name).toBe('Alice');
  });

  it('eager loads nested relations using .include("orders.items")', async () => {
    const users = await ctx.users.include('orders.items').toList();
    const alice = users.find(u => u.name === 'Alice')!;
    expect(alice.orders).toBeDefined();

    const order101 = alice.orders!.find(o => o.id === 101)!;
    expect(order101.items).toBeDefined();
    expect(order101.items!.length).toBe(2);
    expect(order101.items!.map(i => i.product)).toEqual(['Book', 'Pen']);
  });

  it('supports Prisma-style boolean object mapping in .include({ profile: true, orders: false })', async () => {
    const users = await ctx.users
      .include({
        profile: true,
        orders: false,
      })
      .toList();

    const alice = users.find(u => u.name === 'Alice')!;
    expect(alice.profile).toBeDefined();
    expect(alice.profile!.bio).toBe('Alice bio');
    expect(alice.orders).toBeUndefined();
  });

  it('supports conditional boolean flag in .include("profile", boolean)', async () => {
    const usersWithProfile = await ctx.users.include('profile', true).toList();
    expect(usersWithProfile[0].profile).toBeDefined();

    const usersWithoutProfile = await ctx.users.include('profile', false).toList();
    expect(usersWithoutProfile[0].profile).toBeUndefined();
  });
});
