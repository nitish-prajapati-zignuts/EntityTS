import { DbSet } from '../src/set/DbSet';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { EntityNotFoundException, DbException } from '../src/errors';

interface User {
  id: number;
  name: string;
  role: string;
  score: number;
  [key: string]: unknown;
}

describe('DbSet', () => {
  let adapter: MockDbAdapter;
  let userSet: DbSet<User>;

  const initialUsers: User[] = [
    { id: 1, name: 'Alice', role: 'admin', score: 100 },
    { id: 2, name: 'Bob', role: 'user', score: 75 },
    { id: 3, name: 'Charlie', role: 'user', score: 85 },
  ];

  beforeEach(() => {
    adapter = new MockDbAdapter({
      tables: {
        users: initialUsers,
      },
    });
    userSet = new DbSet<User>(adapter, 'users');
  });

  it('toList returns all items', async () => {
    const users = await userSet.toList();
    expect(users).toHaveLength(3);
    expect(users[0].name).toBe('Alice');
  });

  it('where with object predicate builds filter', async () => {
    const query = userSet.where({ role: 'admin' });
    const users = await query.toList();
    expect(adapter.executedQueries).toHaveLength(1);
    expect(adapter.executedQueries[0].sql).toContain('"role" = @p0');
  });

  it('where with fluent function builds advanced filter', async () => {
    const query = userSet.where(q => q.gt('score', 80).and().eq('role', 'user'));
    await query.toList();
    expect(adapter.executedQueries[0].sql).toContain('"score" > @p0 AND "role" = @p1');
  });

  it('orderBy, skip, and take compile correct query', async () => {
    const query = userSet.orderBy('score', 'desc').skip(10).take(5);
    await query.toList();
    const lastSql = adapter.executedQueries[0].sql;
    expect(lastSql).toContain('ORDER BY "score" DESC');
    expect(lastSql).toContain('LIMIT 5 OFFSET 10');
  });

  it('first returns first matching element or null', async () => {
    const first = await userSet.first();
    expect(first).not.toBeNull();
    expect(first?.name).toBe('Alice');
  });

  it('firstOrThrow throws EntityNotFoundException when no rows exist', async () => {
    const emptyAdapter = new MockDbAdapter({ tables: { users: [] } });
    const emptySet = new DbSet<User>(emptyAdapter, 'users');
    await expect(emptySet.firstOrThrow()).rejects.toThrow(EntityNotFoundException);
  });

  it('single throws if more than one row matches', async () => {
    await expect(userSet.single()).rejects.toThrow(DbException);
  });

  it('add inserts a new record and returns it', async () => {
    const newUser = await userSet.add({ name: 'David', role: 'guest', score: 50 });
    expect(newUser.id).toBeDefined();
    expect(newUser.name).toBe('David');

    const tableData = adapter.getTableData('users');
    expect(tableData).toHaveLength(4);
  });

  it('addRange inserts multiple records', async () => {
    const added = await userSet.addRange([
      { name: 'Eve', role: 'guest', score: 60 },
      { name: 'Frank', role: 'guest', score: 70 },
    ]);
    expect(added).toHaveLength(2);
    expect(adapter.getTableData('users')).toHaveLength(5);
  });

  it('update modifies an existing record by id', async () => {
    const updated = await userSet.update(1, { name: 'Alice Smith' });
    expect(adapter.executedQueries.some(q => q.sql.includes('UPDATE "users"'))).toBe(true);
  });

  it('remove deletes a record by id', async () => {
    await userSet.remove(2);
    expect(adapter.executedQueries.some(q => q.sql.includes('DELETE FROM "users" WHERE "id" = @p0'))).toBe(
      true
    );
  });

  it('fromSql executes custom raw SQL and maps results', async () => {
    const users = await userSet.fromSql('SELECT * FROM users WHERE score > @p0', [80]);
    expect(users).toHaveLength(3);
    expect(adapter.executedQueries[0].sql).toBe('SELECT * FROM users WHERE score > @p0');
  });

  it('inTransaction creates scoped DbSet bound to transaction', async () => {
    const tx = await adapter.beginTransaction();
    const txSet = userSet.inTransaction(tx);
    expect(txSet).not.toBe(userSet);
    await txSet.toList();
  });
});
