import 'reflect-metadata';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { ModelMetadataRegistry } from '../src/model/EntityMetadata';
import { Entity } from '../src/decorators/Table';
import { Table } from '../src/decorators/Table';
import { Column } from '../src/decorators/Column';
import { PrimaryKey } from '../src/decorators/PrimaryKey';
import { SoftDelete } from '../src/decorators/SoftDelete';
import { CreatedAt } from '../src/decorators/CreatedAt';
import { UpdatedAt } from '../src/decorators/UpdatedAt';
import { SqlType } from '../src/procedure/SqlType';
import { SchemaGenerator } from '../src/codegen/SchemaGenerator';
import {
  entityToMigrationBuilder,
  sqlTypeToColumnType,
} from '../src/codegen/EntityToMigrationBuilder';

// ─── Test entities ────────────────────────────────────────────────────────

@Entity()
@Table('products')
class Product {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'product_name', type: SqlType.VarChar, maxLength: 150 })
  name!: string;

  @Column({ type: SqlType.Decimal })
  price!: number;

  @Column({ type: SqlType.Bit, nullable: true })
  active?: boolean;
}

@Entity()
@Table('articles')
@SoftDelete('deleted_at')
class Article {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ type: SqlType.NVarChar, maxLength: 200 })
  title!: string;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeMock(provider: 'sqlite' | 'postgres' | 'mysql' | 'mssql' = 'sqlite') {
  const mock = new MockDbAdapter();
  // Override provider for dialect tests
  (mock as any).provider = provider;
  return mock;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('sqlTypeToColumnType', () => {
  test('maps Int to INTEGER', () => {
    const adapter = makeMock();
    expect(sqlTypeToColumnType(SqlType.Int, adapter)).toBe('INTEGER');
  });

  test('maps VarChar to VARCHAR(100)', () => {
    const adapter = makeMock();
    expect(sqlTypeToColumnType(SqlType.VarChar, adapter, 100)).toBe('VARCHAR(100)');
  });

  test('maps NVarChar to VARCHAR on mysql', () => {
    const adapter = makeMock('mysql');
    expect(sqlTypeToColumnType(SqlType.NVarChar, adapter, 80)).toBe('VARCHAR(80)');
  });

  test('maps NVarChar to NVARCHAR on mssql', () => {
    const adapter = makeMock('mssql');
    expect(sqlTypeToColumnType(SqlType.NVarChar, adapter, 80)).toBe('NVARCHAR(80)');
  });

  test('maps Bit to BOOLEAN on postgres', () => {
    const adapter = makeMock('postgres');
    expect(sqlTypeToColumnType(SqlType.Bit, adapter)).toBe('BOOLEAN');
  });

  test('maps Bit to BIT on mssql', () => {
    const adapter = makeMock('mssql');
    expect(sqlTypeToColumnType(SqlType.Bit, adapter)).toBe('BIT');
  });

  test('maps UniqueIdentifier to UUID on postgres', () => {
    const adapter = makeMock('postgres');
    expect(sqlTypeToColumnType(SqlType.UniqueIdentifier, adapter)).toBe('UUID');
  });

  test('defaults unknown type to VARCHAR(255)', () => {
    const adapter = makeMock();
    expect(sqlTypeToColumnType(undefined, adapter)).toBe('VARCHAR(255)');
  });
});

describe('entityToMigrationBuilder', () => {
  test('generates CREATE TABLE statement for Product', () => {
    const registry = ModelMetadataRegistry.getInstance();
    const meta = registry.get(Product);
    expect(meta).toBeDefined();

    const adapter = makeMock('sqlite');
    const builder = entityToMigrationBuilder(meta!, adapter);
    const stmts = builder.getSqlStatements(adapter);

    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/CREATE TABLE/i);
    expect(stmts[0]).toContain('"products"');
    expect(stmts[0]).toContain('"product_name"');
    expect(stmts[0]).toContain('DECIMAL');
  });

  test('auto-increment PK uses AUTOINCREMENT on sqlite', () => {
    const registry = ModelMetadataRegistry.getInstance();
    const meta = registry.get(Product)!;
    const adapter = makeMock('sqlite');
    const builder = entityToMigrationBuilder(meta, adapter);
    const sql = builder.getSqlStatements(adapter)[0];
    expect(sql).toMatch(/INTEGER PRIMARY KEY AUTOINCREMENT/i);
  });

  test('auto-increment PK uses IDENTITY on mssql', () => {
    const registry = ModelMetadataRegistry.getInstance();
    const meta = registry.get(Product)!;
    const adapter = makeMock('mssql');
    (adapter as any).escapeIdentifier = (n: string) => `[${n}]`;
    const builder = entityToMigrationBuilder(meta, adapter);
    const sql = builder.getSqlStatements(adapter)[0];
    expect(sql).toMatch(/INT IDENTITY\(1,1\)/i);
  });

  test('soft-delete column is included in Article DDL', () => {
    const registry = ModelMetadataRegistry.getInstance();
    const meta = registry.get(Article)!;
    const adapter = makeMock('sqlite');
    const builder = entityToMigrationBuilder(meta, adapter);
    const sql = builder.getSqlStatements(adapter)[0];
    expect(sql).toContain('"deleted_at"');
  });
});

describe('SchemaGenerator.generateMigration', () => {
  test('produces valid TypeScript migration file content', () => {
    const adapter = makeMock();
    const registry = ModelMetadataRegistry.getInstance();
    const meta = registry.get(Product)!;
    const generator = new SchemaGenerator(adapter, [Product]);
    const src = generator.generateMigration('CreateProducts');
    expect(src).toContain("export const name = 'CreateProducts'");
    expect(src).toContain('export async function up');
    expect(src).toContain('export async function down');
    expect(src).toContain('schema.executeSql');
    expect(src).toContain('schema.dropTableIfExists');
  });
});

describe('SchemaGenerator.ensureCreated', () => {
  test('executes CREATE TABLE IF NOT EXISTS statements', async () => {
    const adapter = makeMock();
    const executedSql: string[] = [];
    const origExec = adapter.executeNonQuery.bind(adapter);
    adapter.executeNonQuery = async (sql: string, ...args: any[]) => {
      executedSql.push(sql);
      return origExec(sql, ...args);
    };

    const generator = new SchemaGenerator(adapter, [Product]);
    await generator.ensureCreated();

    expect(executedSql.some(s => /CREATE TABLE IF NOT EXISTS/i.test(s))).toBe(true);
    expect(executedSql.some(s => s.includes('products'))).toBe(true);
  });
});

describe('SchemaGenerator.diff', () => {
  test('detects missing tables', async () => {
    const adapter = makeMock();

    // Stub fetchLiveTableNames to return empty
    adapter.executeQuery = async <T>(sql: string) => {
      if (sql.includes('sqlite_master') && sql.includes("type='table'")) return [] as T[];
      return [] as T[];
    };

    const generator = new SchemaGenerator(adapter, [Product]);
    const diff = await generator.diff();

    expect(diff.missingTables).toContain('products');
  });

  test('detects no diff when tables match', async () => {
    const adapter = makeMock();

    adapter.executeQuery = async <T>(sql: string) => {
      if (sql.includes('sqlite_master') && sql.includes("type='table'")) {
        return [{ name: 'products' }] as T[];
      }
      if (sql.includes('PRAGMA table_info')) {
        return [
          { name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1, cid: 0 },
          {
            name: 'product_name',
            type: 'VARCHAR(150)',
            notnull: 1,
            dflt_value: null,
            pk: 0,
            cid: 1,
          },
          { name: 'price', type: 'DECIMAL', notnull: 1, dflt_value: null, pk: 0, cid: 2 },
          { name: 'active', type: 'BOOLEAN', notnull: 0, dflt_value: null, pk: 0, cid: 3 },
        ] as T[];
      }
      return [] as T[];
    };

    const generator = new SchemaGenerator(adapter, [Product]);
    const diff = await generator.diff();
    expect(diff.missingTables).toHaveLength(0);
  });
});

describe('MigrationBuilder extensions', () => {
  test('renameColumn emits RENAME COLUMN on postgres', () => {
    const { MigrationBuilder } = require('../src/migrations/MigrationBuilder');
    const adapter = makeMock('postgres');
    (adapter as any).escapeIdentifier = (n: string) => `"${n}"`;

    const b = new MigrationBuilder();
    b.renameColumn('users', 'full_name', 'name');
    const sql = b.getSqlStatements(adapter)[0];
    expect(sql).toBe('ALTER TABLE "users" RENAME COLUMN "full_name" TO "name";');
  });

  test('renameColumn emits CHANGE COLUMN on mysql', () => {
    const { MigrationBuilder } = require('../src/migrations/MigrationBuilder');
    const adapter = makeMock('mysql');
    (adapter as any).escapeIdentifier = (n: string) => `\`${n}\``;

    const b = new MigrationBuilder();
    b.renameColumn('users', 'full_name', 'name', 'VARCHAR(100)');
    const sql = b.getSqlStatements(adapter)[0];
    expect(sql).toBe('ALTER TABLE `users` CHANGE COLUMN `full_name` `name` VARCHAR(100);');
  });

  test('addForeignKey emits CONSTRAINT FK on postgres', () => {
    const { MigrationBuilder } = require('../src/migrations/MigrationBuilder');
    const adapter = makeMock('postgres');
    (adapter as any).escapeIdentifier = (n: string) => `"${n}"`;

    const b = new MigrationBuilder();
    b.addForeignKey('orders', 'user_id', 'users', 'id', { onDelete: 'CASCADE' });
    const sql = b.getSqlStatements(adapter)[0];
    expect(sql).toContain('FOREIGN KEY');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).toContain('"users"');
  });

  test('addForeignKey emits a comment on sqlite', () => {
    const { MigrationBuilder } = require('../src/migrations/MigrationBuilder');
    const adapter = makeMock('sqlite');
    const b = new MigrationBuilder();
    b.addForeignKey('orders', 'user_id', 'users', 'id');
    const sql = b.getSqlStatements(adapter)[0];
    expect(sql).toMatch(/^--/);
  });

  test('TableBuilder has uuid, json, float, bigInteger methods', () => {
    const { TableBuilder } = require('../src/migrations/MigrationBuilder');
    const tb = new TableBuilder();
    expect(typeof tb.uuid).toBe('function');
    expect(typeof tb.json).toBe('function');
    expect(typeof tb.float).toBe('function');
    expect(typeof tb.bigInteger).toBe('function');
  });
});
