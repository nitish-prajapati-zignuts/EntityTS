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

describe('LINQ Querying & Multi-Table Stored Procedures', () => {
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

  describe('LINQ Method Chaining on DbSet', () => {
    it('where + firstOrDefault: finds a single record matching predicate', async () => {
      const member = await db.members.where('email', '=', 'alice@example.com').firstOrDefault();
      expect(member).not.toBeNull();
      expect(member?.name).toBe('Alice Smith');
      expect(member?.age).toBe(30);
    });

    it('select: applies typed field selection in LINQ query', async () => {
      const member = await db.members
        .where('email', '=', 'bob@example.com')
        .select('name', 'email')
        .firstOrDefault();
      expect(member).not.toBeNull();
      expect(member?.name).toBe('Bob Jones');
      expect((member as any).age).toBeUndefined();
    });

    it('where + orderBy + firstOrDefault: returns first match with ordering', async () => {
      const oldestUser = await db.members
        .where('role', '=', 'user')
        .orderBy(m => m.age, 'desc')
        .firstOrDefault();
      expect(oldestUser).not.toBeNull();
      expect(oldestUser?.name).toBe('Charlie Brown');
      expect(oldestUser?.age).toBe(35);
    });

    it('where + skip + take + toList: supports LINQ pagination and sorting', async () => {
      const users = await db.members
        .where('role', '=', 'user')
        .orderBy(m => m.age, 'asc')
        .skip(1)
        .take(1)
        .toList();
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe('Charlie Brown');
    });

    it('add: creates a new record and returns it', async () => {
      const newMember = await db.members.add({
        name: 'Eve White',
        email: 'eve@example.com',
        role: 'user',
        age: 28,
      });
      expect(newMember).toBeDefined();
      expect(newMember.id).toBeGreaterThan(0);
      expect(newMember.name).toBe('Eve White');

      const found = await db.members.where('id', '=', newMember.id).firstOrDefault();
      expect(found?.email).toBe('eve@example.com');
    });

    it('addRange: inserts multiple records in batch', async () => {
      await db.members.addRange([
        { name: 'Frank Black', email: 'frank@example.com', role: 'guest', age: 40 },
        { name: 'Grace Hopper', email: 'grace@example.com', role: 'admin', age: 50 },
      ]);

      const count = await db.members.count();
      expect(count).toBe(6);
    });

    it('update: updates record by id', async () => {
      const bob = await db.members.where('email', '=', 'bob@example.com').firstOrDefault();
      expect(bob).not.toBeNull();

      const updated = await db.members.update(bob!.id, { age: 26, name: 'Robert Jones' });
      expect(updated.age).toBe(26);
      expect(updated.name).toBe('Robert Jones');

      const refreshed = await db.members.where('email', '=', 'bob@example.com').firstOrDefault();
      expect(refreshed?.name).toBe('Robert Jones');
      expect(refreshed?.age).toBe(26);
    });

    it('remove: deletes single record by ID', async () => {
      const diana = await db.members.where('email', '=', 'diana@example.com').firstOrDefault();
      expect(diana).not.toBeNull();

      await db.members.remove(diana!.id);

      const exists = await db.members.where('email', '=', 'diana@example.com').firstOrDefault();
      expect(exists).toBeNull();
    });

    it('LINQ aggregations: computes count, sum, avg, min, max', async () => {
      const totalCount = await db.members.count();
      const totalAge = await db.members.sum(m => m.age);
      const avgAge = await db.members.avg(m => m.age);
      const minAge = await db.members.min(m => m.age);
      const maxAge = await db.members.max(m => m.age);

      expect(totalCount).toBe(4);
      expect(totalAge).toBe(30 + 25 + 35 + 22); // 112
      expect(avgAge).toBe(112 / 4); // 28
      expect(minAge).toBe(22);
      expect(maxAge).toBe(35);
    });
  });

  describe('Database-Level Transaction APIs on DbContext', () => {
    it('fromSql: executes parameterized query string', async () => {
      const rows = await db.fromSql<Member>(
        'SELECT * FROM test_members WHERE role = @p0 ORDER BY name ASC',
        ['user'],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].name).toBe('Bob Jones');
    });

    it('executeSql: executes SQL command and returns rowsAffected', async () => {
      const result = await db.executeSql('DELETE FROM test_members WHERE role = @p0', ['guest']);
      expect(result.rowsAffected).toBe(1);

      const count = await db.members.count();
      expect(count).toBe(3);
    });

    it('useTransaction: executes interactive callback with auto-commit', async () => {
      const created = await db.useTransaction(async tx => {
        const txDb = db.inTransaction(tx);
        const user = await txDb.members.add({
          name: 'InteractiveTx',
          email: 'itx@test.com',
          role: 'admin',
          age: 45,
        });
        await txDb.members.update(user.id, { age: 46 });
        return user;
      });

      expect(created.name).toBe('InteractiveTx');
      const refreshed = await db.members.where('email', '=', 'itx@test.com').firstOrDefault();
      expect(refreshed?.age).toBe(46);
    });

    it('useTransaction: rolls back when interactive callback throws error', async () => {
      await expect(
        db.useTransaction(async tx => {
          const txDb = db.inTransaction(tx);
          await txDb.members.add({
            name: 'RollbackUser',
            email: 'rb@test.com',
            role: 'user',
            age: 99,
          });
          throw new Error('Forced rollback error');
        }),
      ).rejects.toThrow('Forced rollback error');

      const found = await db.members.where('email', '=', 'rb@test.com').firstOrDefault();
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
