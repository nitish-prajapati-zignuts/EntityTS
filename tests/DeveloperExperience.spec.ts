import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Entity,
  Table,
  PrimaryKey,
  Column,
  Default,
  Index,
  Computed,
  MockDbAdapter,
  SqlType,
  ModelMetadataRegistry,
  entityToMigrationBuilder,
  DbHealthResult,
} from '../src';

@Entity('dx_users')
@Table('dx_users')
@Index(['email'], { unique: true })
@Index(['firstName', 'lastName'])
class DxUser {
  @PrimaryKey()
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ type: SqlType.VarChar })
  email!: string;

  @Column({ type: SqlType.VarChar })
  firstName!: string;

  @Column({ type: SqlType.VarChar })
  lastName!: string;

  @Default('user')
  @Column({ type: SqlType.VarChar })
  role!: string;

  @Default(() => 100)
  @Column({ type: SqlType.Int })
  points!: number;

  @Column({ type: SqlType.Int })
  age!: number;

  @Computed('LOWER(email)')
  @Column({ type: SqlType.VarChar })
  emailLower!: string;
}

class TestDxDbContext extends DbContext {
  public readonly users = this.set(DxUser);
  public seededCount = 0;

  constructor(public readonly mockAdapter: MockDbAdapter) {
    super({ adapter: mockAdapter });
  }

  protected async onSeeding(): Promise<void> {
    this.seededCount = 5;
  }
}

describe('Developer Experience (DX) Features', () => {
  let mockAdapter: MockDbAdapter;
  let context: TestDxDbContext;

  beforeEach(() => {
    mockAdapter = new MockDbAdapter();
    context = new TestDxDbContext(mockAdapter);
  });

  describe('DbContext.withTransaction', () => {
    it('executes callback, commits, and returns the result', async () => {
      mockAdapter.beginTransaction = jest.fn().mockResolvedValue({
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
      });

      const result = await context.withTransaction(async tx => {
        expect(tx).toBeDefined();
        return 'success_val';
      });

      expect(result).toBe('success_val');
      const tx = await (mockAdapter.beginTransaction as jest.Mock).mock.results[0].value;
      expect(tx.commit).toHaveBeenCalled();
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it('rolls back and rethrows when callback throws an error', async () => {
      const mockTx = {
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
      };
      mockAdapter.beginTransaction = jest.fn().mockResolvedValue(mockTx);

      await expect(
        context.withTransaction(async () => {
          throw new Error('Database write conflict');
        }),
      ).rejects.toThrow('Database write conflict');

      expect(mockTx.rollback).toHaveBeenCalled();
      expect(mockTx.commit).not.toHaveBeenCalled();
    });
  });

  describe('@Default Decorator', () => {
    it('auto-populates literal and function defaults during DbSet.add()', async () => {
      let capturedSql = '';
      let capturedParams: any[] = [];
      mockAdapter.executeNonQuery = jest.fn().mockImplementation((sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        return Promise.resolve({ rowsAffected: 1, insertId: 101 });
      });

      const user = await context.users.add({
        firstName: 'Alice',
        lastName: 'Smith',
        email: 'alice@example.com',
        age: 30,
      });

      expect(user.role).toBe('user');
      expect(user.points).toBe(100);
      expect(user.id).toBe(101);
      // Both default values should be in insert parameters
      expect(capturedParams.some(p => p.value === 'user')).toBe(true);
      expect(capturedParams.some(p => p.value === 100)).toBe(true);
    });

    it('does not overwrite explicitly provided values', async () => {
      mockAdapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1, insertId: 102 });

      const user = await context.users.add({
        firstName: 'Bob',
        lastName: 'Jones',
        email: 'bob@example.com',
        role: 'admin',
        points: 500,
        age: 35,
      });

      expect(user.role).toBe('admin');
      expect(user.points).toBe(500);
    });
  });

  describe('@Computed Decorator', () => {
    it('omits computed columns from INSERT and UPDATE statements', async () => {
      let capturedSql = '';
      mockAdapter.executeNonQuery = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve({ rowsAffected: 1, insertId: 103 });
      });

      await context.users.add({
        firstName: 'Charlie',
        lastName: 'Brown',
        email: 'charlie@example.com',
        emailLower: 'SHOULD_NOT_INSERT',
        age: 25,
      });

      expect(capturedSql.toLowerCase()).not.toContain('emaillower');
      expect(capturedSql.toLowerCase()).not.toContain('email_lower');
    });
  });

  describe('@Index Decorator', () => {
    it('registers index metadata on entity and emits CREATE INDEX in DDL', () => {
      const meta = ModelMetadataRegistry.getInstance().get(DxUser);
      expect(meta).toBeDefined();
      expect(meta?.indexes).toBeDefined();
      expect(meta?.indexes?.length).toBe(2);

      const uniqueIdx = meta?.indexes?.find(i => i.unique);
      expect(uniqueIdx).toBeDefined();
      expect(uniqueIdx?.columns).toContain('email');

      const compositeIdx = meta?.indexes?.find(i => i.columns.length === 2);
      expect(compositeIdx).toBeDefined();
      expect(compositeIdx?.columns).toEqual(['firstName', 'lastName']);

      const migration = entityToMigrationBuilder(meta!, mockAdapter);
      const sqlStatements = migration.getSqlStatements(mockAdapter);

      expect(
        sqlStatements.some(s => s.includes('CREATE UNIQUE INDEX') && s.includes('email')),
      ).toBe(true);
      expect(
        sqlStatements.some(
          s => s.includes('CREATE INDEX') && s.includes('firstName') && s.includes('lastName'),
        ),
      ).toBe(true);
    });
  });

  describe('DbSet.upsertRange', () => {
    it('upserts multiple items in batch', async () => {
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([]); // not found -> insert
      mockAdapter.executeNonQuery = jest.fn().mockResolvedValue({ rowsAffected: 1, insertId: 1 });
      mockAdapter.beginTransaction = jest.fn().mockResolvedValue({
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
      });

      const items = [
        { email: 'u1@example.com', firstName: 'User', lastName: 'One', age: 20 },
        { email: 'u2@example.com', firstName: 'User', lastName: 'Two', age: 22 },
      ];

      const results = await context.users.upsertRange(items, ['email']);
      expect(results.length).toBe(2);
      expect(results[0].email).toBe('u1@example.com');
      expect(results[1].email).toBe('u2@example.com');
    });
  });

  describe('DbSet.count Inline Predicate Overloads', () => {
    it('counts matching records using object predicate directly', async () => {
      let capturedSql = '';
      mockAdapter.executeScalar = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve(42);
      });

      const count = await context.users.count({ role: 'admin' });
      expect(count).toBe(42);
      expect(capturedSql.toLowerCase()).toContain('count');
      expect(capturedSql.toLowerCase()).toContain('where');
    });

    it('counts matching records using WhereClause lambda directly', async () => {
      let capturedSql = '';
      mockAdapter.executeScalar = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve(15);
      });

      const count = await context.users.count(w => w.gt('age', 21));
      expect(count).toBe(15);
      expect(capturedSql.toLowerCase()).toContain('count');
      expect(capturedSql.toLowerCase()).toContain('where');
    });
  });

  describe('DbSet.toMap', () => {
    it('transforms query results into a Map keyed by selector', async () => {
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([
        {
          id: 1,
          email: 'one@example.com',
          firstName: 'One',
          lastName: 'User',
          role: 'user',
          points: 10,
          age: 20,
        },
        {
          id: 2,
          email: 'two@example.com',
          firstName: 'Two',
          lastName: 'User',
          role: 'user',
          points: 20,
          age: 25,
        },
      ]);

      const map = await context.users.toMap(u => u.id);
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(2);
      expect(map.get(1)?.email).toBe('one@example.com');
      expect(map.get(2)?.email).toBe('two@example.com');
    });
  });

  describe('DbSet.selectAs', () => {
    it('projects results into custom DTOs in a type-safe manner', async () => {
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([
        {
          id: 10,
          email: 'alice@test.com',
          firstName: 'Alice',
          lastName: 'Wonderland',
          role: 'admin',
          points: 100,
          age: 28,
        },
      ]);

      const dtos = await context.users.selectAs(u => ({
        userId: u.id,
        fullName: `${u.firstName} ${u.lastName}`,
      }));

      expect(dtos).toEqual([{ userId: 10, fullName: 'Alice Wonderland' }]);
    });
  });

  describe('DbSet.chunk', () => {
    it('processes records in sequential batches', async () => {
      let callCount = 0;
      mockAdapter.executeQuery = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve([
            {
              id: 1,
              email: 'e1@test.com',
              firstName: 'E1',
              lastName: 'L1',
              role: 'user',
              points: 0,
              age: 20,
            },
            {
              id: 2,
              email: 'e2@test.com',
              firstName: 'E2',
              lastName: 'L2',
              role: 'user',
              points: 0,
              age: 21,
            },
          ]);
        }
        if (callCount === 2) {
          return Promise.resolve([
            {
              id: 3,
              email: 'e3@test.com',
              firstName: 'E3',
              lastName: 'L3',
              role: 'user',
              points: 0,
              age: 22,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const receivedBatches: number[] = [];
      await context.users.chunk(2, async (batch, pageIndex) => {
        receivedBatches.push(batch.length);
      });

      expect(receivedBatches).toEqual([2, 1]);
    });
  });

  describe('DbSet.tap', () => {
    it('invokes callback and returns the same DbSet without breaking chain', async () => {
      let tapped = false;
      mockAdapter.executeQuery = jest.fn().mockResolvedValue([]);

      const result = await context.users
        .where({ role: 'user' })
        .tap(set => {
          expect(set.getTableName()).toBe('dx_users');
          tapped = true;
        })
        .toList();

      expect(tapped).toBe(true);
      expect(result).toEqual([]);
    });
  });

  describe('DbSet.whereBetween', () => {
    it('appends between condition to query builder', async () => {
      let capturedSql = '';
      mockAdapter.executeQuery = jest.fn().mockImplementation(sql => {
        capturedSql = sql;
        return Promise.resolve([]);
      });

      await context.users.whereBetween('age', [18, 65]).toList();
      expect(capturedSql.toUpperCase()).toContain('BETWEEN');
    });
  });

  describe('DbContext.seed', () => {
    it('invokes onSeeding hook', async () => {
      expect(context.seededCount).toBe(0);
      await context.seed();
      expect(context.seededCount).toBe(5);
    });
  });

  describe('DbContext.health', () => {
    it('returns rich health status object when connected', async () => {
      mockAdapter.executeScalar = jest.fn().mockResolvedValue('PostgreSQL 17.1 on x86_64');

      const health: DbHealthResult = await context.health();
      expect(health.connected).toBe(true);
      expect(typeof health.latencyMs).toBe('number');
      expect(health.provider).toBe(mockAdapter.provider);
      expect(health.serverVersion).toContain('PostgreSQL 17.1');
    });

    it('returns error details when connection fails', async () => {
      mockAdapter.executeScalar = jest.fn().mockRejectedValue(new Error('Connection timed out'));
      mockAdapter.ping = jest.fn().mockRejectedValue(new Error('Connection timed out'));

      const health = await context.health();
      expect(health.connected).toBe(false);
      expect(health.error).toContain('Connection timed out');
    });
  });
});
