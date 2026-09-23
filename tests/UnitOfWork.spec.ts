import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  PrimaryKey,
  Column,
  HasMany,
  BelongsTo,
  MockDbAdapter,
  UnitOfWork,
} from '../src';

@Entity()
@Table('uow_orders')
class UowOrder {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  orderNumber!: string;

  @Column()
  status!: string;

  @HasMany(() => UowOrderItem, 'orderId')
  items?: UowOrderItem[];
}

@Entity()
@Table('uow_order_items')
class UowOrderItem {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  orderId!: number;

  @Column()
  product!: string;

  @Column()
  price!: number;

  @BelongsTo(() => UowOrder, 'orderId')
  order?: UowOrder;
}

function createUowContext() {
  const adapter = new MockDbAdapter({
    tables: {
      uow_orders: [{ id: 1, orderNumber: 'ORD-001', status: 'pending' }],
      uow_order_items: [{ id: 10, orderId: 1, product: 'Keyboard', price: 79 }],
    },
  });

  class CommerceDbContext extends DbContext {
    public orders = this.set(UowOrder);
    public items = this.set(UowOrderItem);

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.useAdapter(adapter);
    }
  }

  return { ctx: new CommerceDbContext(), adapter };
}

describe('UnitOfWork & Aggregate Root Pattern', () => {
  it('instantiates UnitOfWork via context.createUnitOfWork()', () => {
    const { ctx } = createUowContext();
    const uow = ctx.createUnitOfWork();

    expect(uow).toBeInstanceOf(UnitOfWork);
    expect(uow.pendingCount).toBe(0);
    expect(uow.hasChanges()).toBe(false);
  });

  it('flushes multi-entity insert, update, and delete in a single atomic commit', async () => {
    const { ctx } = createUowContext();
    const uow = ctx.createUnitOfWork();

    // 1. Insert new order
    const newOrder = new UowOrder();
    newOrder.id = 2;
    newOrder.orderNumber = 'ORD-002';
    newOrder.status = 'created';
    uow.registerNew(ctx.orders, newOrder);

    // 2. Update existing order
    const existingOrder = await ctx.orders.find(1);
    existingOrder!.status = 'processing';
    uow.registerDirty(ctx.orders, existingOrder!);

    // 3. Delete existing item
    const existingItem = await ctx.items.find(10);
    uow.registerDeleted(ctx.items, existingItem!);

    expect(uow.pendingCount).toBe(3);
    expect(uow.hasChanges()).toBe(true);

    const result = await uow.commit();
    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.totalAffected).toBe(3);
    expect(uow.pendingCount).toBe(0);

    // Verify DB state
    const order2 = await ctx.orders.find(2);
    expect(order2).toBeDefined();
    expect(order2?.orderNumber).toBe('ORD-002');

    const order1 = await ctx.orders.find(1);
    expect(order1?.status).toBe('processing');

    const item10 = await ctx.items.find(10);
    expect(item10).toBeNull();
  });

  it('inserts parent entity before child entity even when registered in child-first order', async () => {
    const { ctx, adapter } = createUowContext();
    const uow = ctx.createUnitOfWork();

    const executionLog: string[] = [];
    const origNonQuery = adapter.executeNonQuery.bind(adapter);
    adapter.executeNonQuery = async (sql, params, tx) => {
      if (sql.includes('INSERT') && sql.includes('uow_orders')) executionLog.push('parent_order');
      if (sql.includes('INSERT') && sql.includes('uow_order_items'))
        executionLog.push('child_item');
      return origNonQuery(sql, params, tx);
    };

    // Intentionally register CHILD first
    const newItem = new UowOrderItem();
    newItem.id = 20;
    newItem.product = 'Mouse';
    newItem.price = 49;
    uow.registerNew(ctx.items, newItem);

    // Register PARENT second
    const newOrder = new UowOrder();
    newOrder.id = 3;
    newOrder.orderNumber = 'ORD-003';
    newOrder.status = 'new';
    uow.registerNew(ctx.orders, newOrder);

    await uow.commit();

    // Verify parent was inserted before child in the transaction
    expect(executionLog).toEqual(['parent_order', 'child_item']);

    // Verify foreign key propagation
    expect(newItem.orderId).toBe(3);
  });

  it('deletes child entity before parent entity during commit', async () => {
    const { ctx, adapter } = createUowContext();
    const uow = ctx.createUnitOfWork();

    const executionLog: string[] = [];
    const origNonQuery = adapter.executeNonQuery.bind(adapter);
    adapter.executeNonQuery = async (sql, params, tx) => {
      if (sql.includes('DELETE') && sql.includes('uow_orders')) executionLog.push('delete_parent');
      if (sql.includes('DELETE') && sql.includes('uow_order_items'))
        executionLog.push('delete_child');
      return origNonQuery(sql, params, tx);
    };

    // Register parent to delete first
    const parentOrder = await ctx.orders.find(1);
    uow.registerDeleted(ctx.orders, parentOrder!);

    // Register child to delete second
    const childItem = await ctx.items.find(10);
    uow.registerDeleted(ctx.items, childItem!);

    await uow.commit();

    // Verify child was deleted before parent
    expect(executionLog).toEqual(['delete_child', 'delete_parent']);
  });

  it('discards all operations when rollback() is invoked', () => {
    const { ctx } = createUowContext();
    const uow = ctx.createUnitOfWork();

    uow.registerNew(ctx.orders, { id: 99, orderNumber: 'ORD-099', status: 'x' });
    expect(uow.pendingCount).toBe(1);

    uow.rollback();
    expect(uow.pendingCount).toBe(0);
    expect(uow.hasChanges()).toBe(false);
  });

  it('rolls back atomic database transaction if any operation fails', async () => {
    const { ctx, adapter } = createUowContext();
    const uow = ctx.createUnitOfWork();

    // Register a valid order
    uow.registerNew(ctx.orders, { id: 50, orderNumber: 'ORD-050', status: 'ok' });

    // Make the adapter fail on the second operation
    const origNonQuery = adapter.executeNonQuery.bind(adapter);
    let count = 0;
    adapter.executeNonQuery = async (sql, params, tx) => {
      count++;
      if (count === 2) {
        throw new Error('Database disk error');
      }
      return origNonQuery(sql, params, tx);
    };

    uow.registerNew(ctx.items, { id: 500, orderId: 50, product: 'Failed Item', price: 10 });

    await expect(uow.commit()).rejects.toThrow('Database disk error');

    // The first insert must NOT be visible since transaction rolled back
    const order50 = await ctx.orders.find(50);
    expect(order50).toBeNull();
  });
});
