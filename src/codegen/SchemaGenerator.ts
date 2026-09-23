import * as fs from 'fs';
import * as path from 'path';
import { IDbAdapter } from '../adapters/IDbAdapter';
import { ModelMetadataRegistry, EntityMetadata } from '../model/EntityMetadata';
import { MigrationRunner, MigrationModule } from '../migrations/MigrationRunner';
import { MigrationBuilder } from '../migrations/MigrationBuilder';
import { entityToMigrationBuilder, sqlTypeToColumnType } from './EntityToMigrationBuilder';

export interface SchemaDiff {
  missingTables: string[];
  extraTables: string[];
  columnDiffs: Array<{
    table: string;
    missingColumns: string[];
    extraColumns: string[];
  }>;
}

export interface SchemaGeneratorOptions {
  /** Whether to use CREATE TABLE IF NOT EXISTS (default: true) */
  ifNotExists?: boolean;
}

/**
 * Code-First schema generation utilities.
 *
 * @example
 * const gen = new SchemaGenerator(ctx.adapter, [User, Order]);
 * await gen.ensureCreated();               // create all tables that don't exist
 * const file = gen.generateMigration('Init');  // get migration file content
 */
export class SchemaGenerator {
  private readonly registry = ModelMetadataRegistry.getInstance();
  private readonly entityClasses: Function[];

  constructor(
    private readonly adapter: IDbAdapter,
    entityClasses: Function[],
    private readonly options: SchemaGeneratorOptions = {}
  ) {
    this.entityClasses = entityClasses;
  }

  /** Returns the EntityMetadata objects for all registered entity classes. */
  private getMetadata(): EntityMetadata[] {
    return this.entityClasses
      .map(cls => this.registry.get(cls))
      .filter((m): m is EntityMetadata => m !== undefined);
  }

  /**
   * Creates all tables that do not yet exist in the database.
   * Uses CREATE TABLE IF NOT EXISTS semantics so it is safe to call repeatedly.
   */
  public async ensureCreated(): Promise<void> {
    for (const metadata of this.getMetadata()) {
      if (metadata.isView) continue; // Views are not created by NSP
      const migBuilder = entityToMigrationBuilder(metadata, this.adapter);
      if (!migBuilder) continue;
      const statements = migBuilder.getSqlStatements(this.adapter);

      // Rewrite CREATE TABLE -> CREATE TABLE IF NOT EXISTS
      for (const sql of statements) {
        const rewritten = sql.replace(
          /^CREATE TABLE\s+/i,
          'CREATE TABLE IF NOT EXISTS '
        );
        try {
          await this.adapter.executeNonQuery(rewritten);
        } catch (err: any) {
          // If the table already exists, ignore the error
          if (!err.message?.includes('already exists') && !err.message?.includes('table exists')) {
            throw err;
          }
        }
      }
    }
  }

  /**
   * Generates and returns the TypeScript source code for a migration file
   * that will create all entity tables.
   */
  public generateMigration(name: string): string {
    const timestamp = Date.now();
    const allStatements: string[] = [];

    for (const metadata of this.getMetadata()) {
      if (metadata.isView) continue;
      const migBuilder = entityToMigrationBuilder(metadata, this.adapter);
      if (!migBuilder) continue;
      const stmts = migBuilder.getSqlStatements(this.adapter);
      allStatements.push(...stmts);
    }

    const upLines = allStatements
      .map(s => `  await schema.executeSql(${JSON.stringify(s)});`)
      .join('\n');

    const downLines = this.getMetadata()
      .map(m => `  await schema.dropTableIfExists(${JSON.stringify(m.tableName)});`)
      .join('\n');

    return [
      `import { MigrationBuilder } from '@nsp/dbcontext';`,
      ``,
      `export const id = '${timestamp}';`,
      `export const name = '${name}';`,
      ``,
      `export async function up(schema: MigrationBuilder): Promise<void> {`,
      upLines,
      `}`,
      ``,
      `export async function down(schema: MigrationBuilder): Promise<void> {`,
      downLines,
      `}`,
    ].join('\n');
  }

  /**
   * Compares the live database schema against current entity metadata and generates
   * an incremental migration file with only the necessary up/down diff statements.
   */
  public async generateDiffMigration(name: string): Promise<string> {
    const timestamp = Date.now();
    const diffResult = await this.diff();
    const upStatements: string[] = [];
    const downStatements: string[] = [];

    // 1. Missing tables
    for (const tableName of diffResult.missingTables) {
      const meta = this.getMetadata().find(m => m.tableName.toLowerCase() === tableName.toLowerCase());
      if (!meta || meta.isView) continue;
      const migBuilder = entityToMigrationBuilder(meta, this.adapter);
      if (!migBuilder) continue;
      const stmts = migBuilder.getSqlStatements(this.adapter);
      for (const s of stmts) {
        upStatements.push(`  await schema.executeSql(${JSON.stringify(s)});`);
      }
      downStatements.push(`  await schema.dropTableIfExists(${JSON.stringify(meta.tableName)});`);
    }

    // 2. Missing columns in existing tables
    for (const { table, missingColumns } of diffResult.columnDiffs) {
      const meta = this.getMetadata().find(m => m.tableName.toLowerCase() === table.toLowerCase());
      if (!meta) continue;

      for (const colName of missingColumns) {
        const col = Array.from(meta.columns.values()).find(
          c => c.columnName.toLowerCase() === colName.toLowerCase()
        );
        if (!col) continue;

        const colType = sqlTypeToColumnType(col.sqlType, this.adapter, col.maxLength);
        upStatements.push(
          `  schema.addColumn(${JSON.stringify(meta.tableName)}, ${JSON.stringify(col.columnName)}, ${JSON.stringify(colType)});`
        );
        downStatements.push(
          `  schema.dropColumn(${JSON.stringify(meta.tableName)}, ${JSON.stringify(col.columnName)});`
        );
      }
    }

    const upBody = upStatements.length > 0 ? upStatements.join('\n') : '  // No schema additions detected';
    const downBody = downStatements.length > 0 ? downStatements.join('\n') : '  // No schema rollbacks required';

    return [
      `import { MigrationBuilder } from '@nsp/dbcontext';`,
      ``,
      `export const id = '${timestamp}';`,
      `export const name = '${name}';`,
      ``,
      `export async function up(schema: MigrationBuilder): Promise<void> {`,
      upBody,
      `}`,
      ``,
      `export async function down(schema: MigrationBuilder): Promise<void> {`,
      downBody,
      `}`,
    ].join('\n');
  }

  /**
   * Writes the generated diff migration to a file in the migrations directory.
   */
  public async writeDiffMigration(name: string, migrationsDir: string): Promise<string> {
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    const timestamp = Date.now();
    const fileName = `${timestamp}_${name}.ts`;
    const filePath = path.join(migrationsDir, fileName);
    const content = await this.generateDiffMigration(name);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * Writes the generated migration to a file in the given migrations directory.
   * Returns the file path that was written.
   */
  public writeMigration(name: string, migrationsDir: string): string {
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }
    const timestamp = Date.now();
    const fileName = `${timestamp}_${name}.ts`;
    const filePath = path.join(migrationsDir, fileName);
    fs.writeFileSync(filePath, this.generateMigration(name), 'utf-8');
    return filePath;
  }

  /**
   * Compares live DB schema against entity metadata and returns a diff.
   * Introspects using information_schema or sqlite_master depending on provider.
   */
  public async diff(): Promise<SchemaDiff> {
    const entityMeta = this.getMetadata();
    const entityTableNames = new Set(entityMeta.map(m => m.tableName.toLowerCase()));

    // Fetch live table names
    const liveTables = await this.fetchLiveTableNames();
    const liveTableSet = new Set(liveTables.map(t => t.toLowerCase()));

    const missingTables = entityMeta
      .filter(m => !m.isView && !liveTableSet.has(m.tableName.toLowerCase()))
      .map(m => m.tableName);


    const extraTables = liveTables.filter(t => !entityTableNames.has(t.toLowerCase()));

    const columnDiffs: SchemaDiff['columnDiffs'] = [];

    for (const meta of entityMeta) {
      if (!liveTableSet.has(meta.tableName.toLowerCase())) continue;
      const liveColumns = await this.fetchLiveColumnNames(meta.tableName);
      const liveColSet = new Set(liveColumns.map(c => c.toLowerCase()));

      const entityCols = Array.from(meta.columns.values())
        .filter(c => !meta.ignoredProperties.has(c.propertyName))
        .map(c => c.columnName.toLowerCase());
      const entityColSet = new Set(entityCols);

      const missing = entityCols.filter(c => !liveColSet.has(c));
      const extra = liveColumns.filter(c => !entityColSet.has(c.toLowerCase()));

      if (missing.length > 0 || extra.length > 0) {
        columnDiffs.push({ table: meta.tableName, missingColumns: missing, extraColumns: extra });
      }
    }

    return { missingTables, extraTables, columnDiffs };
  }

  /** Applies the diff (missing tables / columns) to the live database. */
  public async push(dryRun = false): Promise<string[]> {
    const diffResult = await this.diff();
    const appliedSql: string[] = [];

    // Create missing tables
    for (const tableName of diffResult.missingTables) {
      const meta = this.getMetadata().find(m => m.tableName === tableName);
      if (!meta || meta.isView) continue;
      const migBuilder = entityToMigrationBuilder(meta, this.adapter);
      if (!migBuilder) continue;
      const stmts = migBuilder.getSqlStatements(this.adapter);
      for (const sql of stmts) {
        appliedSql.push(sql);
        if (!dryRun) await this.adapter.executeNonQuery(sql);
      }
    }

    // Add missing columns
    for (const { table, missingColumns } of diffResult.columnDiffs) {
      const meta = this.getMetadata().find(m => m.tableName === table);
      if (!meta) continue;
      for (const colName of missingColumns) {
        const col = Array.from(meta.columns.values()).find(
          c => c.columnName.toLowerCase() === colName.toLowerCase()
        );
        if (!col) continue;
        const migBuilder = new MigrationBuilder();
        migBuilder.addColumn(table, col.columnName, 'VARCHAR(255)');
        const stmts = migBuilder.getSqlStatements(this.adapter);
        for (const sql of stmts) {
          appliedSql.push(sql);
          if (!dryRun) await this.adapter.executeNonQuery(sql);
        }
      }
    }

    return appliedSql;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async fetchLiveTableNames(): Promise<string[]> {
    const p = this.adapter.provider;
    if (p === 'sqlite' || p === 'turso' || p === 'd1') {
      const rows = await this.adapter.executeQuery<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`
      );
      return rows.map(r => r.name);
    }
    if (p === 'mssql') {
      const rows = await this.adapter.executeQuery<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE';`
      );
      return rows.map(r => r.TABLE_NAME);
    }
    // postgres / mysql / neon / planetscale / cockroachdb / supabase
    const rows = await this.adapter.executeQuery<{ table_name?: string; TABLE_NAME?: string; name?: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' OR table_schema = DATABASE();`
    );
    return rows.map(r => r.table_name || r.TABLE_NAME || r.name || '');
  }

  private async fetchLiveColumnNames(tableName: string): Promise<string[]> {
    const p = this.adapter.provider;
    if (p === 'sqlite' || p === 'turso' || p === 'd1') {
      const rows = await this.adapter.executeQuery<{ name: string }>(
        `PRAGMA table_info(${this.adapter.escapeIdentifier(tableName)});`
      );
      return rows.map(r => r.name);
    }
    if (p === 'mssql') {
      const rows = await this.adapter.executeQuery<{ COLUMN_NAME?: string; name?: string }>(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}';`
      );
      return rows.map(r => r.COLUMN_NAME || r.name || '');
    }
    const rows = await this.adapter.executeQuery<{ column_name?: string; COLUMN_NAME?: string; name?: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}';`
    );
    return rows.map(r => r.column_name || r.COLUMN_NAME || r.name || '');
  }
}
