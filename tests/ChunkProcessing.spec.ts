import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';
import { Entity, Table, PrimaryKey, Column } from '../src/decorators';

@Table('users')
class User {
  @PrimaryKey()
  id!: number;

  @Column()
  name!: string;

  @Column()
  active!: boolean;
}

class TestDbContext extends DbContext {
  public users = this.set(User);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock();
  }
}

describe('Batch / Chunk Processing (DbSet.chunk)', () => {
  let db: TestDbContext;

  beforeEach(async () => {
    db = new TestDbContext();
    // Seed 1200 users: 800 active, 400 inactive
    const seed: Partial<User>[] = [];
    for (let i = 1; i <= 1200; i++) {
      seed.push({
        id: i,
        name: `User ${i}`,
        active: i <= 800,
      });
    }
    await db.users.bulkInsert(seed);
  });

  afterEach(async () => {
    await db.dispose();
  });

  it('processes all records in batches of specified chunk size', async () => {
    const batches: User[][] = [];
    const pageIndices: number[] = [];

    const total = await db.users.chunk(500, async (batch, pageIndex) => {
      batches.push([...batch]);
      pageIndices.push(pageIndex);
    });

    expect(total).toBe(1200);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(500);
    expect(batches[2]).toHaveLength(200);
    expect(pageIndices).toEqual([0, 1, 2]);
  });

  it('respects chained .where() filters during chunk processing', async () => {
    const activeBatches: User[][] = [];

    const processed = await db.users.where('active', '=', true).chunk(500, async batch => {
      activeBatches.push(batch);
    });

    expect(processed).toBe(800);
    expect(activeBatches).toHaveLength(2);
    expect(activeBatches[0]).toHaveLength(500);
    expect(activeBatches[1]).toHaveLength(300);
    expect(activeBatches.flat().every(u => u.active)).toBe(true);
  });

  it('stops processing early when callback returns false', async () => {
    let callCount = 0;

    const processed = await db.users.chunk(500, async batch => {
      callCount++;
      return false; // abort early
    });

    expect(callCount).toBe(1);
    expect(processed).toBe(500);
  });

  it('handles empty datasets cleanly without executing callback', async () => {
    let called = false;

    const processed = await db.users.where('name', '=', 'NonExistent').chunk(500, async () => {
      called = true;
    });

    expect(called).toBe(false);
    expect(processed).toBe(0);
  });

  it('throws an error if chunk size is <= 0', async () => {
    await expect(db.users.chunk(0, async () => {})).rejects.toThrow(
      'Chunk size must be greater than 0',
    );
    await expect(db.users.chunk(-10, async () => {})).rejects.toThrow(
      'Chunk size must be greater than 0',
    );
  });

  it('supports asynchronous processing inside the callback', async () => {
    const processedIds: number[] = [];

    await db.users
      .where('active', '=', false)
      .take(15)
      .chunk(5, async batch => {
        // simulate async ETL delay
        await new Promise(r => setTimeout(r, 10));
        for (const user of batch) {
          processedIds.push(user.id);
        }
      });

    expect(processedIds).toHaveLength(15);
  });
});
