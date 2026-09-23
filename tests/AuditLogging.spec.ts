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
  HasMany,
  ModelMetadataRegistry,
} from '../src';
import { Auditable, AuditMetadataRegistry, AuditEngine } from '../src/audit';

// ─── Entities ───────────────────────────────────────────────────────────────

@Auditable({ changelog: true, tableName: '_audit_log' })
@Entity()
@Table('accounts')
class AuditedAccount {
  @PrimaryKey()
  id!: number;

  @Column()
  owner!: string;

  @Column()
  balance!: number;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;
}

@Entity()
@Table('invoices')
class PlainInvoice {
  @PrimaryKey()
  id!: number;

  @Column()
  amount!: number;
}

// ─── DbContext ───────────────────────────────────────────────────────────────

class AuditTestContext extends DbContext {
  public accounts!: DbSet<AuditedAccount>;
  public invoices!: DbSet<PlainInvoice>;

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        accounts: [
          { id: 1, owner: 'Alice', balance: 1000 },
          { id: 2, owner: 'Bob', balance: 2500 },
        ],
        invoices: [
          { id: 1, amount: 500 },
        ],
        _audit_log: [],
      },
    });
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Audit Logging (@Auditable)', () => {
  let ctx: AuditTestContext;

  beforeEach(() => {
    ctx = new AuditTestContext();
    ctx.accounts = ctx.set(AuditedAccount);
    ctx.invoices = ctx.set(PlainInvoice);
    ctx.currentUser = 'system_test';
  });

  afterEach(() => {
    AuditMetadataRegistry.getInstance().clear();
    ModelMetadataRegistry.getInstance().clear();
  });

  describe('AuditMetadataRegistry', () => {
    it('registers @Auditable entities correctly', () => {
      // Re-register for this test since afterEach clears
      AuditMetadataRegistry.getInstance().register(AuditedAccount, {
        changelog: true,
        tableName: '_audit_log',
        includeOld: true,
      });
      expect(AuditMetadataRegistry.getInstance().isAuditable(AuditedAccount)).toBe(true);
      expect(AuditMetadataRegistry.getInstance().isAuditable(PlainInvoice)).toBe(false);
    });

    it('returns correct audit options for registered entity', () => {
      AuditMetadataRegistry.getInstance().register(AuditedAccount, {
        changelog: true,
        tableName: '_audit_log',
        includeOld: true,
      });
      const opts = AuditMetadataRegistry.getInstance().get(AuditedAccount);
      expect(opts?.changelog).toBe(true);
      expect(opts?.tableName).toBe('_audit_log');
    });
  });

  describe('AuditEngine.buildEntry', () => {
    it('builds INSERT entry with newValues and no oldValues', () => {
      const entry = AuditEngine.buildEntry(
        'INSERT',
        'accounts',
        42,
        { id: 42, owner: 'Charlie', balance: 300 },
        undefined,
        'admin'
      );
      expect(entry.operation).toBe('INSERT');
      expect(entry.entity_key).toBe('42');
      expect(entry.new_values).toContain('Charlie');
      expect(entry.old_values).toBeUndefined();
      expect(entry.changed_by).toBe('admin');
      expect(entry.changed_at).toBeInstanceOf(Date);
    });

    it('builds UPDATE entry with both oldValues and newValues', () => {
      const entry = AuditEngine.buildEntry(
        'UPDATE',
        'accounts',
        1,
        { id: 1, owner: 'Alice', balance: 2000 },
        { id: 1, owner: 'Alice', balance: 1000 },
        'admin'
      );
      expect(entry.operation).toBe('UPDATE');
      expect(entry.old_values).toContain('1000');
      expect(entry.new_values).toContain('2000');
    });

    it('builds DELETE entry with oldValues and no newValues', () => {
      const entry = AuditEngine.buildEntry(
        'DELETE',
        'accounts',
        2,
        undefined,
        { id: 2, owner: 'Bob', balance: 2500 },
        'admin'
      );
      expect(entry.operation).toBe('DELETE');
      expect(entry.old_values).toContain('Bob');
      expect(entry.new_values).toBeUndefined();
    });

    it('serializes entity_key as JSON', () => {
      const entry = AuditEngine.buildEntry('INSERT', 'accounts', { id: 1 }, {}, undefined, 'admin');
      expect(entry.entity_key).toBe(JSON.stringify({ id: 1 }));
    });
  });

  describe('AuditEngine.snapshot', () => {
    it('captures primitive and Date properties, excludes arrays and nested objects', () => {
      const entity = {
        id: 1,
        name: 'Alice',
        createdAt: new Date('2026-01-01'),
        tags: ['a', 'b'],
        address: { city: 'NYC' },
        greet: () => 'hi',
      };
      const snap = AuditEngine.snapshot(entity);
      expect(snap.id).toBe(1);
      expect(snap.name).toBe('Alice');
      expect(snap.createdAt).toBeInstanceOf(Date);
      expect(snap.tags).toBeUndefined();
      expect(snap.address).toBeUndefined();
      expect(snap.greet).toBeUndefined();
    });
  });

  describe('AuditEngine.shouldLog', () => {
    it('returns true only for entities with changelog:true', () => {
      AuditMetadataRegistry.getInstance().register(AuditedAccount, { changelog: true });
      AuditMetadataRegistry.getInstance().register(PlainInvoice, { changelog: false });
      expect(AuditEngine.shouldLog(AuditedAccount)).toBe(true);
      expect(AuditEngine.shouldLog(PlainInvoice)).toBe(false);
      expect(AuditEngine.shouldLog(class Unknown {})).toBe(false);
    });
  });

  describe('@Auditable decorator integration', () => {
    it('registers entity via decorator automatically', () => {
      @Auditable({ changelog: true, tableName: 'my_log' })
      class MyEntity {}
      expect(AuditMetadataRegistry.getInstance().isAuditable(MyEntity)).toBe(true);
      expect(AuditMetadataRegistry.getInstance().get(MyEntity)?.tableName).toBe('my_log');
    });

    it('defaults changelog to false when no options provided', () => {
      @Auditable()
      class DefaultEntity {}
      const opts = AuditMetadataRegistry.getInstance().get(DefaultEntity);
      expect(opts?.changelog).toBe(false);
    });

    it('defaults includeOld to true', () => {
      @Auditable({ changelog: true })
      class AuditableEntity {}
      const opts = AuditMetadataRegistry.getInstance().get(AuditableEntity);
      expect(opts?.includeOld).toBe(true);
    });
  });

  describe('AuditEngine.write', () => {
    it('calls adapter.executeNonQuery with a parameterized INSERT INTO _audit_log', async () => {
      const mockAdapter: any = {
        provider: 'postgres',
        escapeIdentifier: (s: string) => `"${s}"`,
        formatParameterPlaceholder: (_: string, idx: number) => `$${idx}`,
        executeNonQuery: jest.fn().mockResolvedValue({ rowsAffected: 1 }),
      };

      const entry = AuditEngine.buildEntry(
        'INSERT', 'accounts', 1, { id: 1, owner: 'Alice' }, undefined, 'admin'
      );
      await AuditEngine.write(entry, mockAdapter, '_audit_log');

      expect(mockAdapter.executeNonQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockAdapter.executeNonQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO "_audit_log"');
      expect(sql).toContain('"entity_name"');
      expect(sql).toContain('"operation"');
    });

    it('silently swallows adapter errors to prevent blocking the main operation', async () => {
      const mockAdapter: any = {
        provider: 'postgres',
        escapeIdentifier: (s: string) => `"${s}"`,
        formatParameterPlaceholder: (_: string, idx: number) => `$${idx}`,
        executeNonQuery: jest.fn().mockRejectedValue(new Error('audit table missing')),
      };

      const entry = AuditEngine.buildEntry('INSERT', 'accounts', 1, {}, undefined, 'admin');
      await expect(AuditEngine.write(entry, mockAdapter)).resolves.not.toThrow();
    });
  });
});
