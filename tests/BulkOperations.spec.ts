import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  CreatedAt,
  UpdatedAt,
  SoftDelete,
} from '../src';

@Entity()
@Table('products')
@SoftDelete('deleted_at')
class Product {
  @PrimaryKey()
  id!: number;

  @Column()
  sku!: string;

  @Column()
  name!: string;

  @Column()
  price!: number;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}

class ProductDbContext extends DbContext {
  public products!: DbSet<Product>;

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        products: [
          { id: 1, sku: 'SKU-001', name: 'Item 1', price: 10, deleted_at: null },
          { id: 2, sku: 'SKU-002', name: 'Item 2', price: 20, deleted_at: null },
        ],
      },
    });
  }
}

describe('Bulk Operations', () => {
  let ctx: ProductDbContext;

  beforeEach(() => {
    ctx = new ProductDbContext();
    ctx.products = ctx.set(Product);
  });

  it('bulkInsert inserts a batch of items and auto-populates audit fields', async () => {
    const newItems = [
      { id: 3, sku: 'SKU-003', name: 'Item 3', price: 30 },
      { id: 4, sku: 'SKU-004', name: 'Item 4', price: 40 },
      { id: 5, sku: 'SKU-005', name: 'Item 5', price: 50 },
    ];

    const count = await ctx.products.bulkInsert(newItems, { batchSize: 2 });
    expect(count).toBe(3);

    const total = await ctx.products.count();
    expect(total).toBe(5);

    const item3 = await ctx.products.find(3);
    expect(item3).toBeDefined();
    expect(item3!.createdAt).toBeInstanceOf(Date);
    expect(item3!.updatedAt).toBeInstanceOf(Date);
  });

  it('bulkUpdate updates matching items by keys', async () => {
    const updates = [
      { id: 1, price: 99 },
      { id: 2, price: 199 },
    ];

    const affected = await ctx.products.bulkUpdate(updates, {
      keys: ['id'],
      update: ['price'],
    });
    expect(affected).toBe(2);

    const p1 = await ctx.products.find(1);
    const p2 = await ctx.products.find(2);
    expect(p1!.price).toBe(99);
    expect(p2!.price).toBe(199);
  });

  it('bulkUpsert updates existing and inserts new items', async () => {
    const items = [
      { id: 1, sku: 'SKU-001', name: 'Item 1 Updated', price: 15 },
      { id: 10, sku: 'SKU-010', name: 'Brand New Item', price: 500 },
    ];

    const processed = await ctx.products.bulkUpsert(items, {
      conflictKeys: ['id'],
      update: ['name', 'price'],
    });
    expect(processed).toBe(2);

    const p1 = await ctx.products.find(1);
    expect(p1!.name).toBe('Item 1 Updated');
    expect(p1!.price).toBe(15);

    const p10 = await ctx.products.find(10);
    expect(p10).toBeDefined();
    expect(p10!.name).toBe('Brand New Item');
  });

  it('bulkDelete marks as soft-deleted when entity has soft delete enabled', async () => {
    const deletedCount = await ctx.products.bulkDelete({ id: 1 });
    expect(deletedCount).toBe(1);

    // Active query ignores it
    const active = await ctx.products.toList();
    expect(active.find(p => p.id === 1)).toBeUndefined();

    // withDeleted finds it
    const post1 = await ctx.products.withDeleted().find(1);
    expect(post1).toBeDefined();
    expect(post1!.deletedAt).toBeDefined();
  });
});
