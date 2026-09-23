import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  Column,
  PrimaryKey,
  SqlType,
  fn,
  rdbms,
  MockDbAdapter,
  StoredProcedureBuilder,
} from '../src';

@Entity()
@Table('test_members')
class Member {
  @PrimaryKey({ autoIncrement: true })
  @Column()
  public id!: number;

  @Column()
  public name!: string;

  @Column()
  public email!: string;

  @Column()
  public role!: string;

  @Column({ type: SqlType.Int })
  public age!: number;
}

class TestDbContext extends DbContext {
  public readonly members = this.set(Member);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:');
  }
}

interface CustomerRow {
  id: number;
  name: string;
}

interface OrderRow {
  orderId: number;
  amount: number;
}

interface SummaryRow {
  totalSpent: number;
}

describe('Prisma APIs & Multi-Table Stored Procedures', () => {
  let db: TestDbContext;

  beforeEach(async () => {
    db = new TestDbContext();
    await db.ensureCreated();

    // Seed initial test data
    await db.members.addRange([
      { name: 'Alice Smith', email: 'alice@example.com', role: 'admin', age: 30 },
      { name: 'Bob Jones', email: 'bob@example.com', role: 'user', age: 25 },
      { name: 'Charlie Brown', email: 'charlie@example.com', role: 'user', age: 35 },
      { name: 'Diana Prince', email: 'diana@example.com', role: 'guest', age: 22 },
    ]);
  });

  afterEach(async () => {
    await db.dispose();
  });

  describe('Prisma-Style Model Methods on DbSet', () => {
    it('findUnique: finds a single record matching unique where criteria', async () => {
      const member = await db.members.findUnique({
        where: { email: 'alice@example.com' },
      });
      expect(member).not.toBeNull();
      expect(member?.name).toBe('Alice Smith');
      expect(member?.age).toBe(30);
    });

    it('findUnique: applies field selection with select option', async () => {
      const member = await db.members.findUnique({
        where: { email: 'bob@example.com' },
        select: ['name', 'email'],
      });
      expect(member).not.toBeNull();
      expect(member?.name).toBe('Bob Jones');
      expect((member as any).age).toBeUndefined();
    });

    it('findFirst: returns first match with where, orderBy, skip, and take', async () => {
      const oldestUser = await db.members.findFirst({
        where: { role: 'user' },
        orderBy: { age: 'desc' },
      });
      expect(oldestUser).not.toBeNull();
      expect(oldestUser?.name).toBe('Charlie Brown');
      expect(oldestUser?.age).toBe(35);
    });

    it('findMany: supports filtering, pagination, and sorting', async () => {
      const users = await db.members.findMany({
        where: { role: 'user' },
        orderBy: { age: 'asc' },
        take: 1,
        skip: 1,
      });
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Charlie Brown');
    });

    it('create: creates a new record and returns it', async () => {
      const newMember = await db.members.create({
        data: {
          name: 'Eve White',
          email: 'eve@example.com',
          role: 'user',
          age: 28,
        },
      });
      expect(newMember).toBeDefined();
      expect(newMember.id).toBeGreaterThan(0);
      expect(newMember.name).toBe('Eve White');

      const found = await db.members.findUnique({ where: { id: newMember.id } });
      expect(found?.email).toBe('eve@example.com');
    });

    it('createMany: inserts multiple records in batch', async () => {
      const result = await db.members.createMany({
        data: [
          { name: 'Frank Black', email: 'frank@example.com', role: 'guest', age: 40 },
          { name: 'Grace Hopper', email: 'grace@example.com', role: 'admin', age: 50 },
        ],
      });
      expect(result.count).toBe(2);

      const count = await db.members.count();
      expect(count).toBe(6);
    });

    it('update: updates record matching where and returns updated object', async () => {
      const updated = await db.members.update({
        where: { email: 'bob@example.com' },
        data: { age: 26, name: 'Robert Jones' },
      });
      expect(updated.age).toBe(26);
      expect(updated.name).toBe('Robert Jones');

      const refreshed = await db.members.findUnique({ where: { email: 'bob@example.com' } });
      expect(refreshed?.name).toBe('Robert Jones');
      expect(refreshed?.age).toBe(26);
    });

    it('updateMany: updates multiple matching rows and returns count', async () => {
      const result = await db.members.updateMany({
        where: { role: 'user' },
        data: { role: 'member' },
      });
      expect(result.count).toBe(2);

      const members = await db.members.findMany({ where: { role: 'member' } });
      expect(members).toHaveLength(2);
    });

    it('delete: deletes single record matching where and returns it', async () => {
      const deleted = await db.members.delete({
        where: { email: 'diana@example.com' },
      });
      expect(deleted.name).toBe('Diana Prince');

      const exists = await db.members.findUnique({ where: { email: 'diana@example.com' } });
      expect(exists).toBeNull();
    });

    it('deleteMany: deletes multiple records matching where and returns count', async () => {
      const result = await db.members.deleteMany({
        where: { role: 'user' },
      });
      expect(result.count).toBe(2);

      const remaining = await db.members.findMany();
      expect(remaining).toHaveLength(2);
    });

    it('upsert: updates if exists, or inserts if not', async () => {
      // 1. Existing record -> updates
      const updated = await db.members.upsert({
        where: { email: 'alice@example.com' },
        update: { age: 31 },
        create: { name: 'Alice Smith', email: 'alice@example.com', role: 'admin', age: 31 },
      });
      expect(updated.age).toBe(31);

      // 2. Non-existing record -> creates
      const created = await db.members.upsert({
        where: { email: 'newbie@example.com' },
        update: { age: 99 },
        create: { name: 'Newbie', email: 'newbie@example.com', role: 'guest', age: 19 },
      });
      expect(created.name).toBe('Newbie');
      expect(created.age).toBe(19);

      const found = await db.members.findUnique({ where: { email: 'newbie@example.com' } });
      expect(found).not.toBeNull();
    });

    it('aggregate: computes _count, _sum, _avg, _min, _max', async () => {
      const agg = await db.members.aggregate({
        _count: true,
        _sum: { age: true },
        _avg: { age: true },
        _min: { age: true },
        _max: { age: true },
      });

      expect(agg._count).toBe(4);
      expect(agg._sum.age).toBe(30 + 25 + 35 + 22); // 112
      expect(agg._avg.age).toBe(112 / 4); // 28
      expect(agg._min.age).toBe(22);
      expect(agg._max.age).toBe(35);
    });
  });

  describe('Prisma-Style Database-Level APIs on DbContext', () => {
    it('$queryRaw: executes tagged template query safely', async () => {
      const minAge = 28;
      const rows = await db.$queryRaw<{ name: string; age: number }>`
        SELECT name, age FROM test_members WHERE age >= ${minAge} ORDER BY age ASC
      `;
      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('Alice Smith');
      expect(rows[1].name).toBe('Charlie Brown');
    });

    it('$queryRaw: supports parameterized string query', async () => {
      const rows = await db.$queryRaw<Member>(
        'SELECT * FROM test_members WHERE role = @p0 ORDER BY name ASC',
        'user',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('Bob Jones');
    });

    it('$executeRaw: executes tagged template command and returns rowsAffected', async () => {
      const targetRole = 'guest';
      const affected = await db.$executeRaw`
        DELETE FROM test_members WHERE role = ${targetRole}
      `;
      expect(affected).toBe(1);

      const count = await db.members.count();
      expect(count).toBe(3);
    });

    it('$transaction: executes sequential operations in atomic transaction', async () => {
      const results = await db.$transaction([
        db.members.create({
          data: { name: 'TxUser1', email: 'tx1@test.com', role: 'user', age: 20 },
        }),
        db.members.create({
          data: { name: 'TxUser2', email: 'tx2@test.com', role: 'user', age: 21 },
        }),
      ]);
      expect(results).toHaveLength(2);
      expect((results[0] as Member).name).toBe('TxUser1');
      expect((results[1] as Member).name).toBe('TxUser2');

      const count = await db.members.count();
      expect(count).toBe(6);
    });

    it('$transaction: executes interactive callback and auto-commits', async () => {
      const created = await db.$transaction(async tx => {
        const user = await tx.members.create({
          data: { name: 'InteractiveTx', email: 'itx@test.com', role: 'admin', age: 45 },
        });
        await tx.members.update({
          where: { id: user.id },
          data: { age: 46 },
        });
        return user;
      });

      expect(created.name).toBe('InteractiveTx');
      const refreshed = await db.members.findUnique({ where: { email: 'itx@test.com' } });
      expect(refreshed?.age).toBe(46);
    });

    it('$transaction: rolls back when interactive callback throws error', async () => {
      await expect(
        db.$transaction(async tx => {
          await tx.members.create({
            data: { name: 'RollbackUser', email: 'rb@test.com', role: 'user', age: 99 },
          });
          throw new Error('Forced rollback error');
        }),
      ).rejects.toThrow('Forced rollback error');

      const found = await db.members.findUnique({ where: { email: 'rb@test.com' } });
      expect(found).toBeNull();
    });
  });

  describe('Dialect-Aware RDBMS Functions', () => {
    it('fn.lower / fn.upper / fn.concat / fn.coalesce / fn.now', () => {
      expect(fn.lower('name').toString()).toBe('LOWER("name")');
      expect(fn.upper('name').toString()).toBe('UPPER("name")');
      expect(fn.concat('first', 'last').toString()).toBe('CONCAT("first", "last")');
      expect(fn.coalesce('nickname', 'name').toString()).toBe('COALESCE("nickname", "name")');
      expect(fn.now().toString()).toBe('NOW()');
    });
  });

  describe('Stored Procedures Returning Multiple Tables', () => {
    let mockAdapter: MockDbAdapter;

    beforeEach(() => {
      mockAdapter = new MockDbAdapter();

      // Configure a mock stored procedure that returns 3 separate tables
      mockAdapter.registerProcedure('usp_GetCustomerDashboard', {
        handler: () => ({
          records: [
            // Table 1: Customers
            [{ id: 101, name: 'Acme Corp' }],
            // Table 2: Orders
            [
              { orderId: 1001, amount: 250.0 },
              { orderId: 1002, amount: 150.0 },
            ],
            // Table 3: Summary / Aggregates
            [{ totalSpent: 400.0 }],
          ],
          outputParams: { Status: 'SUCCESS', ServerExecutionTimeMs: 12 },
          returnValue: 0,
          rowsAffected: 3,
        }),
      });
    });

    const createSproc = () => new StoredProcedureBuilder(mockAdapter, 'usp_GetCustomerDashboard');

    it('Option 1 (Tuple Destructuring): .queryMultiple<[T1, T2, T3]>() returns tables directly as a tuple', async () => {
      const [customers, orders, summary] = await createSproc()
        .input({ CustomerId: 101 })
        .queryMultiple<[CustomerRow[], OrderRow[], SummaryRow[]]>();

      // Table 1
      expect(customers).toHaveLength(1);
      expect(customers[0].name).toBe('Acme Corp');

      // Table 2
      expect(orders).toHaveLength(2);
      expect(orders[0].amount).toBe(250.0);
      expect(orders[1].amount).toBe(150.0);

      // Table 3
      expect(summary).toHaveLength(1);
      expect(summary[0].totalSpent).toBe(400.0);
    });

    it('Option 2 (Sequential Reader): .reader() consumes tables one-by-one with .read<T>() and .readFirst<T>()', async () => {
      const reader = await createSproc().input({ CustomerId: 101 }).reader();

      expect(reader.tableCount).toBe(3);
      expect(reader.hasMore).toBe(true);

      // Read Table 1 as single record
      const customer = reader.readFirst<CustomerRow>();
      expect(customer?.id).toBe(101);
      expect(customer?.name).toBe('Acme Corp');

      // Read Table 2 as array of orders
      const orders = reader.read<OrderRow>();
      expect(orders).toHaveLength(2);

      // Read Table 3 as summary
      const summary = reader.read<SummaryRow>();
      expect(summary).toHaveLength(1);
      expect(summary[0].totalSpent).toBe(400.0);

      // No more tables left
      expect(reader.hasMore).toBe(false);
      expect(reader.read()).toEqual([]);
    });

    it('Option 3 (With Output Params): .output<T>().queryMultiple<[T1, T2]>() captures multiple tables + output params', async () => {
      const { records, out, rowsAffected } = await createSproc()
        .input({ CustomerId: 101 })
        .output<{ Status: string; ServerExecutionTimeMs: number }>()
        .queryMultiple<[CustomerRow[], OrderRow[], SummaryRow[]]>();

      const [customers, orders] = records;
      expect(customers).toHaveLength(1);
      expect(orders).toHaveLength(2);

      expect(out.Status).toBe('SUCCESS');
      expect(out.ServerExecutionTimeMs).toBe(12);
      expect(rowsAffected).toBe(3);
    });

    it('Option 4 (With Output Params & Reader): .output<T>().reader() provides reader + output params', async () => {
      const reader = await createSproc()
        .input({ CustomerId: 101 })
        .output<{ Status: string }>()
        .reader();

      const customers = reader.read<CustomerRow>();
      expect(customers).toHaveLength(1);

      expect(reader.outputParams.Status).toBe('SUCCESS');
    });

    it('Option 5: .readAll() returns all tables without sequential cursor incrementing', async () => {
      const reader = await createSproc().reader();

      const allTables = reader.readAll<[CustomerRow[], OrderRow[], SummaryRow[]]>();
      expect(allTables).toHaveLength(3);
      expect(allTables[0][0].name).toBe('Acme Corp');
    });
  });
});
