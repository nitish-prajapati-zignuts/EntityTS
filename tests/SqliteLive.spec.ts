import {
  DbContext,
  DbContextOptionsBuilder,
  Entity,
  Table,
  PrimaryKey,
  Column,
  Version,
  DbUpdateConcurrencyException,
  SoftDelete,
  HasMany,
  BelongsTo,
} from '../src';

// ─── 1. Entities for Live Testing ──────────────────────────────────────────

@Entity()
@Table('live_accounts')
class SqliteAccount {
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
@Table('live_depts')
@SoftDelete({ column: 'deleted_at', cascade: true })
class LiveDept {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  name!: string;

  @Version()
  version!: number;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @HasMany(() => LiveEmployee, 'deptId')
  employees?: LiveEmployee[];
}

@Entity()
@Table('live_employees')
@SoftDelete({ column: 'deleted_at' })
class LiveEmployee {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column({ name: 'dept_id' })
  deptId!: number;

  @Column()
  name!: string;

  @Version()
  version!: number;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @BelongsTo(() => LiveDept, 'deptId')
  dept?: LiveDept;
}

// ─── 2. SQLite Live Context ────────────────────────────────────────────────

class SqliteLiveContext extends DbContext {
  public accounts = this.set(SqliteAccount);
  public depts = this.set(LiveDept);
  public employees = this.set(LiveEmployee);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:').withConnectionPool({
      minConnections: 2,
      maxConnections: 10,
      heartbeatIntervalMs: 0,
    });
  }
}

// ─── 3. Test Suite ─────────────────────────────────────────────────────────

describe('SQLite Live Engine & Feature Specs', () => {
  let ctx: SqliteLiveContext;

  beforeAll(async () => {
    ctx = new SqliteLiveContext();
    await ctx.connect();

    await ctx.executeRaw(`
      CREATE TABLE live_accounts (
        id INTEGER PRIMARY KEY,
        owner TEXT NOT NULL,
        balance REAL NOT NULL,
        version INTEGER NOT NULL DEFAULT 1
      )
    `);
    await ctx.executeRaw(`
      CREATE TABLE live_depts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      )
    `);
    await ctx.executeRaw(`
      CREATE TABLE live_employees (
        id INTEGER PRIMARY KEY,
        dept_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        deleted_at TEXT
      )
    `);
  });

  afterAll(async () => {
    await ctx.disconnect();
  });

  it('reports healthy connection pool diagnostics on SQLite', async () => {
    expect(ctx.pool).toBeDefined();
    const health = await ctx.pool!.health();

    expect(health.isAlive).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.minConnections).toBe(2);
    expect(health.maxConnections).toBe(10);
  });

  it('performs CRUD operations with optimistic locking on SQLite', async () => {
    // 1. Add
    const acc = await ctx.accounts.add({
      id: 1,
      owner: 'Alice',
      balance: 1000,
      version: 1,
    });
    expect(acc.id).toBe(1);

    // 2. Query
    const found = await ctx.accounts.find(1);
    expect(found?.owner).toBe('Alice');
    expect(found?.balance).toBe(1000);
    expect(found?.version).toBe(1);

    // 3. Update with version increment
    const updated = await ctx.accounts.update(1, { balance: 1200 }, 1);
    expect(updated.balance).toBe(1200);
    expect(updated.version).toBe(2);

    // 4. Stale version throws concurrency conflict
    await expect(
      ctx.accounts.update(1, { balance: 1500 }, 1), // stale version 1
    ).rejects.toThrow(DbUpdateConcurrencyException);

    // 5. Delete
    await ctx.accounts.remove(1, 2);
    expect(await ctx.accounts.find(1)).toBeNull();
  });

  it('updates tracked entities via ChangeTracker.saveChanges() with optimistic locking', async () => {
    const acc = await ctx.accounts.add({
      id: 10,
      owner: 'TrackerTest',
      balance: 2000,
      version: 1,
    });
    expect(acc.id).toBe(10);

    const tracked = await ctx.accounts.track(10);
    expect(tracked.version).toBe(1);

    tracked.balance = 2500;
    const affected = await ctx.saveChanges();
    expect(affected).toBe(1);

    const reloaded = await ctx.accounts.find(10);
    expect(reloaded?.balance).toBe(2500);
    expect(reloaded?.version).toBe(2);
  });

  it('executes UnitOfWork pattern with topological dependency resolution', async () => {
    const uow = ctx.createUnitOfWork();

    const dept = new LiveDept();
    dept.id = 100;
    dept.name = 'Engineering';
    dept.version = 1;
    uow.registerNew(ctx.depts, dept);

    const emp = new LiveEmployee();
    emp.id = 501;
    emp.deptId = 100;
    emp.name = 'Grace Hopper';
    emp.version = 1;
    uow.registerNew(ctx.employees, emp);

    const result = await uow.commit();
    expect(result.insertedCount).toBe(2);
    expect(result.totalAffected).toBe(2);

    const savedDept = await ctx.depts.find(100);
    const savedEmp = await ctx.employees.find(501);
    expect(savedDept).toBeDefined();
    expect(savedDept?.name).toBe('Engineering');
    expect(savedEmp).toBeDefined();
    expect(savedEmp?.deptId).toBe(100);
  });

  it('cascades soft deletes and restorations recursively to child relations', async () => {
    // 1. Verify dept 100 and emp 501 exist and are active
    const deptBefore = await ctx.depts.find(100);
    const empBefore = await ctx.employees.find(501);
    expect(deptBefore).not.toBeNull();
    expect(empBefore).not.toBeNull();

    // 2. Soft delete the parent department
    await ctx.depts.remove(100);

    // 3. Normal query filters out soft-deleted records
    expect(await ctx.depts.find(100)).toBeNull();
    expect(await ctx.employees.find(501)).toBeNull();

    // 4. withDeleted() still sees them
    const deletedDept = await ctx.depts.withDeleted().find(100);
    const deletedEmp = await ctx.employees.withDeleted().find(501);
    expect(deletedDept?.deletedAt).toBeDefined();
    expect(deletedEmp?.deletedAt).toBeDefined();

    // 5. Restore department - recursively restores child employees
    await ctx.depts.restore(100);
    expect(await ctx.depts.find(100)).not.toBeNull();
    expect(await ctx.employees.find(501)).not.toBeNull();
  });

  it('commits and rolls back transactions atomically on SQLite', async () => {
    // Transaction commit
    await ctx.useTransaction(async tx => {
      const set = ctx.accounts.inTransaction(tx);
      await set.add({ id: 2, owner: 'Bob', balance: 500, version: 1 });
      await set.add({ id: 3, owner: 'Charlie', balance: 750, version: 1 });
    });

    expect(await ctx.accounts.find(2)).toBeDefined();
    expect(await ctx.accounts.find(3)).toBeDefined();

    // Transaction rollback on failure
    await expect(
      ctx.useTransaction(async tx => {
        const set = ctx.accounts.inTransaction(tx);
        await set.add({ id: 4, owner: 'Dave', balance: 900, version: 1 });
        throw new Error('Simulated abort');
      }),
    ).rejects.toThrow('Simulated abort');

    expect(await ctx.accounts.find(4)).toBeNull();
  });
});
