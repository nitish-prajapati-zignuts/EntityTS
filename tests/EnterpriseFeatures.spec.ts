import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Entity,
  Table,
  PrimaryKey,
  Column,
  TenantId,
  BeforeInsert,
  AfterInsert,
  BeforeUpdate,
  AfterUpdate,
  BeforeRemove,
  AfterRemove,
  HasMany,
  HasOne,
  MockDbAdapter,
  SqlType,
  SchemaGenerator,
  ModelMetadataRegistry,
} from '../src';

@Entity('tenant_customers')
@Table('tenant_customers')
class TenantCustomer {
  @PrimaryKey()
  @Column({ type: SqlType.Int })
  id!: number;

  @TenantId()
  @Column({ type: SqlType.VarChar })
  orgId!: string;

  @Column({ type: SqlType.VarChar })
  name!: string;

  @Column({ type: SqlType.VarChar })
  email!: string;

  public hookLog: string[] = [];

  @BeforeInsert()
  beforeInsertHook() {
    this.hookLog = this.hookLog || [];
    this.hookLog.push('beforeInsert');
    if (this.email) {
      this.email = this.email.trim().toLowerCase();
    }
  }

  @AfterInsert()
  afterInsertHook() {
    this.hookLog = this.hookLog || [];
    this.hookLog.push(`afterInsert:${this.id}`);
  }

  @BeforeUpdate()
  beforeUpdateHook() {
    this.hookLog = this.hookLog || [];
    this.hookLog.push('beforeUpdate');
  }

  @AfterUpdate()
  afterUpdateHook() {
    this.hookLog = this.hookLog || [];
    this.hookLog.push('afterUpdate');
  }

  @BeforeRemove()
  beforeRemoveHook() {
    this.hookLog = this.hookLog || [];
    this.hookLog.push('beforeRemove');
  }

  @AfterRemove()
  afterRemoveHook() {
    this.hookLog = this.hookLog || [];
    this.hookLog.push('afterRemove');
  }
}

@Entity('order_items')
@Table('order_items')
class OrderItem {
  @PrimaryKey()
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ type: SqlType.Int })
  orderId!: number;

  @Column({ type: SqlType.VarChar })
  productName!: string;

  @Column({ type: SqlType.Decimal })
  price!: number;
}

@Entity('orders_graph')
@Table('orders_graph')
class OrderGraph {
  @PrimaryKey()
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ type: SqlType.VarChar })
  orderNumber!: string;

  @HasMany(() => OrderItem, 'orderId')
  items?: OrderItem[];
}

class EnterpriseDbContext extends DbContext {
  public readonly customers = this.set(TenantCustomer);
  public readonly orders = this.set(OrderGraph);
  public readonly items = this.set(OrderItem);

  constructor(mockAdapter: MockDbAdapter, tenantId?: string) {
    super({ adapter: mockAdapter, tenantId });
  }
}

describe('Enterprise Features', () => {
  let mockAdapter: MockDbAdapter;
  let context: EnterpriseDbContext;

  beforeEach(() => {
    mockAdapter = new MockDbAdapter();
    context = new EnterpriseDbContext(mockAdapter, 'tenant-alpha');
  });

  describe('1. Entity Lifecycle Hooks', () => {
    it('executes @BeforeInsert and @AfterInsert during DbSet.add()', async () => {
      mockAdapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1, insertId: 777 });

      const customer = new TenantCustomer();
      customer.name = 'John Doe';
      customer.email = '  JOHN@EXAMPLE.COM  ';

      const saved = await context.customers.add(customer);

      expect(saved.email).toBe('john@example.com'); // normalized in @BeforeInsert
      expect(saved.id).toBe(777);
      expect(saved.hookLog).toContain('beforeInsert');
      expect(saved.hookLog).toContain('afterInsert:777');
    });

    it('executes @BeforeUpdate and @AfterUpdate during DbSet.update()', async () => {
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([
        { id: 777, orgId: 'tenant-alpha', name: 'John Smith', email: 'john@example.com' },
      ]);
      mockAdapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });

      const updated = await context.customers.update(777, { name: 'John Smith' });

      expect(updated.name).toBe('John Smith');
      expect(updated.hookLog).toContain('afterUpdate');
    });

    it('executes @BeforeRemove and @AfterRemove during DbSet.remove()', async () => {
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([
        { id: 777, orgId: 'tenant-alpha', name: 'John Doe', email: 'john@example.com' },
      ]);
      mockAdapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1 });

      await context.customers.remove(777);
      expect(mockAdapter.executeNonQuery).toHaveBeenCalled();
    });
  });

  describe('2. Built-in Multi-Tenancy (@TenantId)', () => {
    it('automatically partitions SELECT queries by the active tenant ID', async () => {
      let capturedSql = '';
      let capturedParams: any[] = [];
      mockAdapter.executeQuery = jest.fn().mockImplementation((sql, params) => {
        capturedSql = sql;
        capturedParams = params || [];
        return Promise.resolve([]);
      });

      await context.customers.toList();

      expect(capturedSql.toLowerCase()).toContain('orgid');
      expect(capturedParams.some(p => p.value === 'tenant-alpha')).toBe(true);
    });

    it('auto-populates tenant ID on INSERT if not supplied', async () => {
      let capturedParams: any[] = [];
      mockAdapter.executeNonQuery = jest.fn().mockImplementation((sql, params) => {
        capturedParams = params || [];
        return Promise.resolve({ rowsAffected: 1, insertId: 888 });
      });

      const customer = await context.customers.add({ name: 'Acme Corp', email: 'acme@test.com' });

      expect(customer.orgId).toBe('tenant-alpha');
      expect(capturedParams.some(p => p.value === 'tenant-alpha')).toBe(true);
    });

    it('allows bypassing tenant filter with .ignoreTenant()', async () => {
      let capturedSql = '';
      let capturedParams: any[] = [];
      mockAdapter.executeQuery = jest.fn().mockImplementation((sql, params) => {
        capturedSql = sql;
        capturedParams = params || [];
        return Promise.resolve([]);
      });

      await context.customers.ignoreTenant().toList();

      expect(capturedParams.some(p => p.value === 'tenant-alpha')).toBe(false);
    });

    it('allows changing tenant dynamically with ctx.forTenant(id)', async () => {
      let capturedParams: any[] = [];
      mockAdapter.executeQuery = jest.fn().mockImplementation((sql, params) => {
        capturedParams = params || [];
        return Promise.resolve([]);
      });

      const betaContext = context.forTenant('tenant-beta');
      await betaContext.customers.toList();

      expect(capturedParams.some(p => p.value === 'tenant-beta')).toBe(true);
    });
  });

  describe('3. Nested / Graph Mutations (Cascade Insert)', () => {
    it('cascade inserts child items in HasMany relation with linked foreign keys', async () => {
      let insertCount = 0;
      const insertedRows: Array<{ sql: string; params: any[] }> = [];

      mockAdapter.executeNonQuery = jest.fn().mockImplementation((sql, params) => {
        insertCount++;
        insertedRows.push({ sql, params });
        return Promise.resolve({ rowsAffected: 1, insertId: insertCount === 1 ? 501 : 900 + insertCount });
      });

      const order = await context.orders.add({
        orderNumber: 'ORD-2026-001',
        items: [
          { productName: 'Keyboard', price: 99.99 },
          { productName: 'Mouse', price: 49.99 },
        ] as any,
      });

      expect(order.id).toBe(501);
      expect(order.items).toBeDefined();
      expect(order.items?.length).toBe(2);
      expect(order.items?.[0].orderId).toBe(501);
      expect(order.items?.[1].orderId).toBe(501);
      expect(insertCount).toBe(3); // 1 parent + 2 children
    });
  });

  describe('4. Database Streaming (DbSet.stream)', () => {
    it('streams records row by row via AsyncIterable', async () => {
      let fetchOffset = 0;
      mockAdapter.executeQuery = jest.fn().mockImplementation((sql) => {
        if (sql.includes('OFFSET 0') || !sql.includes('OFFSET')) {
          fetchOffset += 2;
          return Promise.resolve([
            { id: 1, name: 'Row 1', email: 'r1@test.com', orgId: 'tenant-alpha' },
            { id: 2, name: 'Row 2', email: 'r2@test.com', orgId: 'tenant-alpha' },
          ]);
        }
        if (sql.includes('OFFSET 2')) {
          return Promise.resolve([
            { id: 3, name: 'Row 3', email: 'r3@test.com', orgId: 'tenant-alpha' },
          ]);
        }
        return Promise.resolve([]);
      });

      const items: any[] = [];
      for await (const row of context.customers.stream(2)) {
        items.push(row);
      }

      expect(items.length).toBe(3);
      expect(items.map(i => i.id)).toEqual([1, 2, 3]);
    });
  });

  describe('5. Fluent Query Shorthands on DbSet', () => {
    it('supports whereIn()', async () => {
      let capturedSql = '';
      mockAdapter.executeQuery = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve([]);
      });

      await context.customers.whereIn('name', ['Alice', 'Bob']).toList();
      expect(capturedSql.toUpperCase()).toContain('IN');
    });

    it('supports whereNotIn()', async () => {
      let capturedSql = '';
      mockAdapter.executeQuery = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve([]);
      });

      await context.customers.whereNotIn('name', ['BadActor']).toList();
      expect(capturedSql.toUpperCase()).toContain('NOT IN');
    });

    it('supports whereLike() and whereNotLike()', async () => {
      let capturedSql = '';
      mockAdapter.executeQuery = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve([]);
      });

      await context.customers.whereLike('email', '%@corp.com').whereNotLike('email', '%spam%').toList();
      expect(capturedSql.toUpperCase()).toContain('LIKE');
      expect(capturedSql.toUpperCase()).toContain('NOT LIKE');
    });

    it('supports whereNull() and whereNotNull()', async () => {
      let capturedSql = '';
      mockAdapter.executeQuery = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve([]);
      });

      await context.customers.whereNull('email').whereNotNull('name').toList();
      expect(capturedSql.toUpperCase()).toContain('IS NULL');
      expect(capturedSql.toUpperCase()).toContain('IS NOT NULL');
    });
  });

  describe('6. Auto-Diff Migration Generator', () => {
    it('generates an incremental migration from live database diff', async () => {
      mockAdapter.executeQuery = jest.fn().mockImplementation((sql: string) => {
        const lower = sql.toLowerCase();
        if (lower.includes('sqlite_master') || lower.includes('information_schema.tables')) {
          // Simulate database having only order_items, missing tenant_customers and orders_graph
          return Promise.resolve([{ name: 'order_items', table_name: 'order_items' }]);
        }
        if (lower.includes('pragma') || lower.includes('information_schema.columns')) {
          return Promise.resolve([
            { name: 'id', column_name: 'id' },
            { name: 'orderId', column_name: 'orderId' },
            // missing productName and price in order_items
          ]);
        }
        return Promise.resolve([]);
      });

      const generator = new SchemaGenerator(mockAdapter, [TenantCustomer, OrderItem, OrderGraph]);
      const diffContent = await generator.generateDiffMigration('AddMissingTablesAndCols');

      expect(diffContent).toContain('export async function up');
      expect(diffContent).toContain('export async function down');
      // Should add missing table
      expect(diffContent).toContain('tenant_customers');
      // Should add missing columns to order_items
      expect(diffContent).toContain('addColumn');
      expect(diffContent).toContain('productName');
      // Rollback should drop column
      expect(diffContent).toContain('dropColumn');
    });
  });
});
