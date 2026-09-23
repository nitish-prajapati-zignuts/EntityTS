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

// ─── 1. Entities for PostgreSQL Live Testing ────────────────────────────────

@Entity()
@Table('live_accounts')
class PgAccount {
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
class PgDept {
  @PrimaryKey()
  @Column()
  id!: number;

  @Column()
  name!: string;

  @Version()
  version!: number;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @HasMany(() => PgEmployee, 'deptId')
  employees?: PgEmployee[];
}

@Entity()
@Table('live_employees')
@SoftDelete({ column: 'deleted_at' })
class PgEmployee {
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

  @BelongsTo(() => PgDept, 'deptId')
  dept?: PgDept;
}

// ─── 2. PostgreSQL Live Context ─────────────────────────────────────────────

const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL_POSTGRES;
const describePg = postgresUrl ? describe : describe.skip;

class PgLiveContext extends DbContext {
  public accounts = this.set(PgAccount);
  public depts = this.set(PgDept);
  public employees = this.set(PgEmployee);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.usePostgres(postgresUrl!).withConnectionPool({
      minConnections: 2,
      maxConnections: 10,
      heartbeatIntervalMs: 0,
    });
  }
}

// ─── 3. Test Suite ─────────────────────────────────────────────────────────

describePg('PostgreSQL Live Integration & Feature Specs', () => {
  let ctx: PgLiveContext;

  beforeAll(async () => {
    ctx = new PgLiveContext();
    // Allow container readiness retry
    let connected = false;
    for (let i = 0; i < 15; i++) {
      try {
        await ctx.connect();
        connected = true;
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    if (!connected) await ctx.connect();

    await ctx.executeRaw(`
      CREATE TABLE IF NOT EXISTS live_accounts (
        id INT PRIMARY KEY,
        owner VARCHAR(100) NOT NULL,
        balance NUMERIC NOT NULL,
        version INT NOT NULL DEFAULT 1
      )
    `);
    await ctx.executeRaw(`
      CREATE TABLE IF NOT EXISTS live_depts (
        id INT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        version INT NOT NULL DEFAULT 1,
        deleted_at TIMESTAMP NULL
      )
    `);
    await ctx.executeRaw(`
      CREATE TABLE IF NOT EXISTS live_employees (
        id INT PRIMARY KEY,
        dept_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        version INT NOT NULL DEFAULT 1,
        deleted_at TIMESTAMP NULL
      )
    `);
  }, 30000);

  afterAll(async () => {
    try {
      await ctx.executeRaw('DROP TABLE IF EXISTS live_employees');
      await ctx.executeRaw('DROP TABLE IF EXISTS live_depts');
      await ctx.executeRaw('DROP TABLE IF EXISTS live_accounts');
      await ctx.disconnect();
    } catch {}
  });

  beforeEach(async () => {
    await ctx.executeRaw('DELETE FROM live_employees');
    await ctx.executeRaw('DELETE FROM live_depts');
    await ctx.executeRaw('DELETE FROM live_accounts');
  });

  it('verifies PostgreSQL connection pool health', async () => {
    expect(ctx.pool).toBeDefined();
    const health = await ctx.pool!.health();

    expect(health.isAlive).toBe(true);
    expect(health.status).toBe('healthy');
    expect(health.totalConnections).toBeGreaterThanOrEqual(1);
  });

  it('executes CRUD with optimistic concurrency control on PostgreSQL', async () => {
    // 1. Add
    const acc = await ctx.accounts.add({
      id: 1,
      owner: 'Alice',
      balance: 5000,
      version: 1,
    });
    expect(acc.id).toBe(1);

    // 2. Query
    const found = await ctx.accounts.find(1);
    expect(found?.owner).toBe('Alice');
    expect(found?.version).toBe(1);

    // 3. Update with optimistic lock
    const updated = await ctx.accounts.update(1, { balance: 6000 }, 1);
    expect(Number(updated.balance)).toBe(6000);
    expect(updated.version).toBe(2);

    // 4. Concurrency conflict throws exception
    await expect(
      ctx.accounts.update(1, { balance: 7000 }, 1), // stale version
    ).rejects.toThrow(DbUpdateConcurrencyException);

    // 5. Delete
    await ctx.accounts.remove(1, 2);
    expect(await ctx.accounts.find(1)).toBeNull();
  });

  it('updates tracked entities via ChangeTracker.saveChanges() with optimistic locking', async () => {
    await ctx.accounts.add({
      id: 10,
      owner: 'TrackerTest',
      balance: 2000,
      version: 1,
    });

    const tracked = await ctx.accounts.track(10);
    expect(tracked.version).toBe(1);

    tracked.balance = 2500;
    const affected = await ctx.saveChanges();
    expect(affected).toBe(1);

    const reloaded = await ctx.accounts.find(10);
    expect(Number(reloaded?.balance)).toBe(2500);
    expect(reloaded?.version).toBe(2);
  });

  it('executes UnitOfWork pattern with topological dependency resolution on PostgreSQL', async () => {
    const uow = ctx.createUnitOfWork();

    const dept = new PgDept();
    dept.id = 100;
    dept.name = 'Engineering';
    dept.version = 1;
    uow.registerNew(ctx.depts, dept);

    const emp = new PgEmployee();
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

  it('cascades soft deletes and restorations recursively on PostgreSQL', async () => {
    await ctx.depts.add({ id: 100, name: 'Engineering', version: 1 });
    await ctx.employees.add({ id: 501, deptId: 100, name: 'Grace', version: 1 });

    // Soft delete parent department
    await ctx.depts.remove(100);

    // Standard query filters out soft-deleted records
    expect(await ctx.depts.find(100)).toBeNull();
    expect(await ctx.employees.find(501)).toBeNull();

    // withDeleted() includes them
    const deletedDept = await ctx.depts.withDeleted().find(100);
    const deletedEmp = await ctx.employees.withDeleted().find(501);
    expect(deletedDept?.deletedAt).toBeDefined();
    expect(deletedEmp?.deletedAt).toBeDefined();

    // Restore un-deletes both
    await ctx.depts.restore(100);
    expect(await ctx.depts.find(100)).not.toBeNull();
    expect(await ctx.employees.find(501)).not.toBeNull();
  });

  it('rolls back PostgreSQL transactions on aborted operations', async () => {
    await expect(
      ctx.useTransaction(async tx => {
        const set = ctx.accounts.inTransaction(tx);
        await set.add({ id: 99, owner: 'Temp', balance: 100, version: 1 });
        throw new Error('Rollback test');
      }),
    ).rejects.toThrow('Rollback test');

    const found = await ctx.accounts.find(99);
    expect(found).toBeNull();
  });
});
