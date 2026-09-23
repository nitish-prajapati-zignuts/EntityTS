import 'reflect-metadata';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { SchemaIntrospector, IntrospectedTable } from '../src/scaffold/SchemaIntrospector';
import { EntityScaffolder } from '../src/scaffold/EntityScaffolder';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Mock introspection helper ────────────────────────────────────────────

function makeIntrospectedTable(overrides: Partial<IntrospectedTable> = {}): IntrospectedTable {
  return {
    name: 'users',
    columns: [
      {
        name: 'id',
        dataType: 'integer',
        isNullable: false,
        isPrimary: true,
        isAutoIncrement: true,
      },
      {
        name: 'full_name',
        dataType: 'varchar',
        isNullable: false,
        maxLength: 100,
        isPrimary: false,
        isAutoIncrement: false,
      },
      {
        name: 'email',
        dataType: 'varchar',
        isNullable: true,
        maxLength: 255,
        isPrimary: false,
        isAutoIncrement: false,
      },
      {
        name: 'created_at',
        dataType: 'timestamp',
        isNullable: false,
        isPrimary: false,
        isAutoIncrement: false,
      },
    ],
    primaryKeys: ['id'],
    foreignKeys: [],
    ...overrides,
  };
}

// ─── SchemaIntrospector ───────────────────────────────────────────────────

describe('SchemaIntrospector (SQLite)', () => {
  test('introspect() returns table list from sqlite_master', async () => {
    const adapter = new MockDbAdapter();
    (adapter as any).provider = 'sqlite';

    adapter.executeQuery = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('sqlite_master')) {
        return [{ name: 'users' }, { name: 'orders' }] as T[];
      }
      if (sql.includes('PRAGMA table_info')) {
        return [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
          { cid: 1, name: 'name', type: 'VARCHAR(100)', notnull: 1, dflt_value: null, pk: 0 },
        ] as T[];
      }
      if (sql.includes('PRAGMA foreign_key_list')) {
        return [] as T[];
      }
      return [] as T[];
    };

    const introspector = new SchemaIntrospector(adapter);
    const tables = await introspector.introspect();

    expect(tables).toHaveLength(2);
    expect(tables[0].name).toBe('users');
    expect(tables[0].columns).toHaveLength(2);
    expect(tables[0].primaryKeys).toContain('id');
    expect(tables[0].foreignKeys).toHaveLength(0);
  });

  test('introspect() filters by table list when provided', async () => {
    const adapter = new MockDbAdapter();
    (adapter as any).provider = 'sqlite';

    adapter.executeQuery = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('sqlite_master')) {
        return [{ name: 'users' }, { name: 'orders' }, { name: 'products' }] as T[];
      }
      if (sql.includes('PRAGMA table_info'))
        return [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
        ] as T[];
      if (sql.includes('PRAGMA foreign_key_list')) return [] as T[];
      return [] as T[];
    };

    const introspector = new SchemaIntrospector(adapter);
    const tables = await introspector.introspect(['users', 'products']);

    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['users', 'products']));
    expect(tables.find(t => t.name === 'orders')).toBeUndefined();
  });

  test('introspect() detects foreign keys via PRAGMA', async () => {
    const adapter = new MockDbAdapter();
    (adapter as any).provider = 'sqlite';

    adapter.executeQuery = async <T>(sql: string): Promise<T[]> => {
      if (sql.includes('sqlite_master')) {
        return [{ name: 'orders' }] as T[];
      }
      if (sql.includes('PRAGMA table_info')) {
        return [
          { cid: 0, name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
          { cid: 1, name: 'user_id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
        ] as T[];
      }
      if (sql.includes('PRAGMA foreign_key_list')) {
        return [{ id: 0, seq: 0, table: 'users', from: 'user_id', to: 'id' }] as T[];
      }
      return [] as T[];
    };

    const introspector = new SchemaIntrospector(adapter);
    const [ordersTable] = await introspector.introspect();

    expect(ordersTable.foreignKeys).toHaveLength(1);
    expect(ordersTable.foreignKeys[0].columnName).toBe('user_id');
    expect(ordersTable.foreignKeys[0].referencedTable).toBe('users');
  });
});

// ─── EntityScaffolder ─────────────────────────────────────────────────────

describe('EntityScaffolder.previewEntity', () => {
  const scaffolder = new EntityScaffolder();

  test('generates @Entity, @Table, @Column decorators', () => {
    const table = makeIntrospectedTable();
    const src = scaffolder.previewEntity(table, [table]);
    expect(src).toContain('@Entity()');
    expect(src).toContain("@Table('users')");
    expect(src).toContain('@Column(');
    expect(src).toContain('@PrimaryKey(');
    expect(src).toContain('export class User');
  });

  test('marks nullable column as optional property', () => {
    const table = makeIntrospectedTable();
    const src = scaffolder.previewEntity(table, [table]);
    // email is nullable
    expect(src).toMatch(/email\?:/);
  });

  test('uses non-null assertion for required columns', () => {
    const table = makeIntrospectedTable();
    const src = scaffolder.previewEntity(table, [table]);
    // full_name is not nullable
    expect(src).toMatch(/fullName!:/);
  });

  test('emits @HasMany for incoming foreign keys', () => {
    const usersTable = makeIntrospectedTable();
    const ordersTable: IntrospectedTable = {
      name: 'orders',
      columns: [
        {
          name: 'id',
          dataType: 'integer',
          isNullable: false,
          isPrimary: true,
          isAutoIncrement: true,
        },
        {
          name: 'user_id',
          dataType: 'integer',
          isNullable: false,
          isPrimary: false,
          isAutoIncrement: false,
        },
      ],
      primaryKeys: ['id'],
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_orders_user_id',
        },
      ],
    };

    const src = scaffolder.previewEntity(usersTable, [usersTable, ordersTable]);
    expect(src).toContain('@HasMany');
    expect(src).toContain('Order');
  });

  test('emits @BelongsTo for outgoing foreign keys', () => {
    const usersTable = makeIntrospectedTable();
    const ordersTable: IntrospectedTable = {
      name: 'orders',
      columns: [
        {
          name: 'id',
          dataType: 'integer',
          isNullable: false,
          isPrimary: true,
          isAutoIncrement: true,
        },
        {
          name: 'user_id',
          dataType: 'integer',
          isNullable: false,
          isPrimary: false,
          isAutoIncrement: false,
        },
      ],
      primaryKeys: ['id'],
      foreignKeys: [
        {
          columnName: 'user_id',
          referencedTable: 'users',
          referencedColumn: 'id',
          constraintName: 'fk_orders_user_id',
        },
      ],
    };

    const src = scaffolder.previewEntity(ordersTable, [usersTable, ordersTable]);
    expect(src).toContain('@BelongsTo');
    expect(src).toContain('User');
  });
});

describe('EntityScaffolder.previewContext', () => {
  test('generates DbContext subclass with one set per table', () => {
    const scaffolder = new EntityScaffolder({ contextName: 'TestDbContext' });
    const tables = [makeIntrospectedTable(), makeIntrospectedTable({ name: 'orders' })];
    const src = scaffolder.previewContext(tables);
    expect(src).toContain('export class TestDbContext extends DbContext');
    expect(src).toContain('this.set(Users)');
    expect(src).toContain('this.set(Orders)');
  });
});

describe('EntityScaffolder.scaffold (file I/O)', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entityts-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes entity file and context file to output directory', () => {
    const scaffolder = new EntityScaffolder({ outputDir: tmpDir, force: false });
    const result = scaffolder.scaffold([makeIntrospectedTable()]);
    expect(result.written.some(f => f.includes('Users.ts'))).toBe(true);
    expect(result.written.some(f => f.includes('AppDbContext.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'Users.ts'))).toBe(true);
  });

  test('skips existing files when force=false', () => {
    const scaffolder = new EntityScaffolder({ outputDir: tmpDir, force: false });
    scaffolder.scaffold([makeIntrospectedTable()]);
    const result2 = scaffolder.scaffold([makeIntrospectedTable()]);
    expect(result2.skipped.length).toBeGreaterThan(0);
    expect(result2.written.length).toBe(0);
  });

  test('overwrites existing files when force=true', () => {
    const scaffolder = new EntityScaffolder({ outputDir: tmpDir, force: false });
    scaffolder.scaffold([makeIntrospectedTable()]);
    const scaffolderForce = new EntityScaffolder({ outputDir: tmpDir, force: true });
    const result2 = scaffolderForce.scaffold([makeIntrospectedTable()]);
    expect(result2.written.length).toBeGreaterThan(0);
    expect(result2.skipped.length).toBe(0);
  });
});
