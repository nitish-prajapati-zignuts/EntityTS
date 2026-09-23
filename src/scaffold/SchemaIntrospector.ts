import { IDbAdapter, DbProvider } from '../adapters/IDbAdapter';

export interface IntrospectedColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  maxLength?: number;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  defaultValue?: string;
}

export interface IntrospectedForeignKey {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  constraintName: string;
}

export interface IntrospectedTable {
  name: string;
  schema?: string;
  columns: IntrospectedColumn[];
  primaryKeys: string[];
  foreignKeys: IntrospectedForeignKey[];
  isView?: boolean;
}

/**
 * Queries the live database to produce an array of IntrospectedTable descriptors.
 * Supports PostgreSQL, MySQL, SQL Server, and SQLite.
 */
export class SchemaIntrospector {
  constructor(private readonly adapter: IDbAdapter) {}

  public async introspect(
    filterTables?: string[],
    includeViews = false,
  ): Promise<IntrospectedTable[]> {
    const provider = this.adapter.provider;
    let tables: string[] = await this.fetchTableNames();

    if (filterTables && filterTables.length > 0) {
      const lower = filterTables.map(t => t.toLowerCase());
      tables = tables.filter(t => lower.includes(t.toLowerCase()));
    }

    const result: IntrospectedTable[] = [];
    for (const tableName of tables) {
      const columns = await this.fetchColumns(tableName, provider);
      const primaryKeys = columns.filter(c => c.isPrimary).map(c => c.name);
      const foreignKeys = await this.fetchForeignKeys(tableName, provider);
      result.push({ name: tableName, columns, primaryKeys, foreignKeys, isView: false });
    }

    if (includeViews) {
      const views = await this.introspectViews();
      for (const viewName of views) {
        if (filterTables && filterTables.length > 0) {
          const lower = filterTables.map(t => t.toLowerCase());
          if (!lower.includes(viewName.toLowerCase())) continue;
        }
        const columns = await this.fetchColumns(viewName, provider);
        result.push({
          name: viewName,
          columns,
          primaryKeys: [],
          foreignKeys: [],
          isView: true,
        });
      }
    }

    return result;
  }

  /**
   * Queries the database for all view names.
   */
  public async introspectViews(): Promise<string[]> {
    const p = this.adapter.provider;
    if (p === 'sqlite' || p === 'turso' || p === 'd1') {
      const rows = await this.adapter.executeQuery<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='view' AND name NOT LIKE 'sqlite_%';`,
      );
      return rows.map(r => r.name);
    }
    if (p === 'mssql') {
      const rows = await this.adapter.executeQuery<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS;`,
      );
      return rows.map(r => r.TABLE_NAME);
    }
    if (p === 'mysql' || p === 'planetscale') {
      const rows = await this.adapter.executeQuery<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM information_schema.views WHERE TABLE_SCHEMA = DATABASE();`,
      );
      return rows.map(r => r.TABLE_NAME);
    }
    // postgres, neon, cockroachdb, supabase
    const rows = await this.adapter.executeQuery<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public';`,
    );
    return rows.map(r => r.table_name);
  }

  // ─── Table names ────────────────────────────────────────────────────────

  private async fetchTableNames(): Promise<string[]> {
    const p = this.adapter.provider;
    if (p === 'sqlite' || p === 'turso' || p === 'd1') {
      const rows = await this.adapter.executeQuery<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__nsp_migrations';`,
      );
      return rows.map(r => r.name);
    }
    if (p === 'mssql') {
      const rows = await this.adapter.executeQuery<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME != '__nsp_migrations';`,
      );
      return rows.map(r => r.TABLE_NAME);
    }
    if (p === 'mysql' || p === 'planetscale') {
      const rows = await this.adapter.executeQuery<{ TABLE_NAME: string }>(
        `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND TABLE_NAME != '__nsp_migrations';`,
      );
      return rows.map(r => r.TABLE_NAME);
    }
    // postgres, neon, cockroachdb, supabase
    const rows = await this.adapter.executeQuery<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name != '__nsp_migrations';`,
    );
    return rows.map(r => r.table_name);
  }

  // ─── Columns ────────────────────────────────────────────────────────────

  private async fetchColumns(
    tableName: string,
    provider: DbProvider,
  ): Promise<IntrospectedColumn[]> {
    if (provider === 'sqlite' || provider === 'turso' || provider === 'd1') {
      return this.fetchSqliteColumns(tableName);
    }
    if (provider === 'mssql') {
      return this.fetchMssqlColumns(tableName);
    }
    // postgres + mysql both use information_schema
    return this.fetchInfoSchemaColumns(tableName, provider);
  }

  private async fetchSqliteColumns(tableName: string): Promise<IntrospectedColumn[]> {
    const rows = await this.adapter.executeQuery<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(`PRAGMA table_info(${this.adapter.escapeIdentifier(tableName)});`);

    return rows.map(r => ({
      name: r.name,
      dataType: r.type || 'TEXT',
      isNullable: r.notnull === 0,
      isPrimary: r.pk > 0,
      isAutoIncrement: r.pk > 0 && (r.type || '').toUpperCase().includes('INTEGER'),
      defaultValue: r.dflt_value ?? undefined,
    }));
  }

  private async fetchMssqlColumns(tableName: string): Promise<IntrospectedColumn[]> {
    const rows = await this.adapter.executeQuery<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      CHARACTER_MAXIMUM_LENGTH: number | null;
      COLUMN_DEFAULT: string | null;
      is_primary: number;
      is_identity: number;
    }>(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.CHARACTER_MAXIMUM_LENGTH,
        c.COLUMN_DEFAULT,
        CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary,
        COLUMNPROPERTY(OBJECT_ID(c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') AS is_identity
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.TABLE_NAME, ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
          ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
      WHERE c.TABLE_NAME = '${tableName}';
    `);

    return rows.map(r => ({
      name: r.COLUMN_NAME,
      dataType: r.DATA_TYPE,
      isNullable: r.IS_NULLABLE === 'YES',
      maxLength: r.CHARACTER_MAXIMUM_LENGTH ?? undefined,
      isPrimary: r.is_primary === 1,
      isAutoIncrement: r.is_identity === 1,
      defaultValue: r.COLUMN_DEFAULT ?? undefined,
    }));
  }

  private async fetchInfoSchemaColumns(
    tableName: string,
    provider: DbProvider,
  ): Promise<IntrospectedColumn[]> {
    const isPostgresFamily =
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'cockroachdb' ||
      provider === 'supabase';
    const isMysqlFamily = provider === 'mysql' || provider === 'planetscale';
    const schemaFilter = isPostgresFamily ? `table_schema = 'public'` : `table_schema = DATABASE()`;

    const rows = await this.adapter.executeQuery<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      character_maximum_length: number | null;
      column_default: string | null;
      is_primary: number;
      extra?: string;
    }>(`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.character_maximum_length,
        c.column_default,
        CASE WHEN kcu.column_name IS NOT NULL THEN 1 ELSE 0 END AS is_primary
        ${isMysqlFamily ? ', c.extra' : ''}
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_name = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = '${tableName}'
        ${isPostgresFamily ? "AND tc.table_schema = 'public'" : ''}
      ) kcu ON kcu.column_name = c.column_name
      WHERE c.table_name = '${tableName}' AND ${schemaFilter}
      ORDER BY c.ordinal_position;
    `);

    return rows.map(r => ({
      name: r.column_name,
      dataType: r.data_type,
      isNullable: r.is_nullable === 'YES',
      maxLength: r.character_maximum_length ?? undefined,
      isPrimary: Number(r.is_primary) === 1,
      isAutoIncrement:
        (isMysqlFamily && (r.extra ?? '').toLowerCase().includes('auto_increment')) ||
        (isPostgresFamily && (r.column_default ?? '').toLowerCase().startsWith('nextval')),
      defaultValue: r.column_default ?? undefined,
    }));
  }

  // ─── Foreign keys ────────────────────────────────────────────────────────

  private async fetchForeignKeys(
    tableName: string,
    provider: DbProvider,
  ): Promise<IntrospectedForeignKey[]> {
    if (provider === 'sqlite' || provider === 'turso' || provider === 'd1') {
      return this.fetchSqliteForeignKeys(tableName);
    }
    if (provider === 'mssql') {
      return this.fetchMssqlForeignKeys(tableName);
    }
    if (provider === 'mysql' || provider === 'planetscale') {
      return this.fetchMysqlForeignKeys(tableName);
    }
    return this.fetchPostgresForeignKeys(tableName);
  }

  private async fetchSqliteForeignKeys(tableName: string): Promise<IntrospectedForeignKey[]> {
    const rows = await this.adapter.executeQuery<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
    }>(`PRAGMA foreign_key_list(${this.adapter.escapeIdentifier(tableName)});`);

    return rows.map(r => ({
      columnName: r.from,
      referencedTable: r.table,
      referencedColumn: r.to,
      constraintName: `fk_${tableName}_${r.from}`,
    }));
  }

  private async fetchMssqlForeignKeys(tableName: string): Promise<IntrospectedForeignKey[]> {
    const rows = await this.adapter.executeQuery<{
      constraint_name: string;
      column_name: string;
      referenced_table: string;
      referenced_column: string;
    }>(`
      SELECT
        fk.name AS constraint_name,
        cpa.name AS column_name,
        rt.name AS referenced_table,
        crf.name AS referenced_column
      FROM sys.foreign_keys fk
      JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
      JOIN sys.columns cpa ON fkc.parent_object_id = cpa.object_id AND fkc.parent_column_id = cpa.column_id
      JOIN sys.tables rt ON fkc.referenced_object_id = rt.object_id
      JOIN sys.columns crf ON fkc.referenced_object_id = crf.object_id AND fkc.referenced_column_id = crf.column_id
      WHERE OBJECT_NAME(fk.parent_object_id) = '${tableName}';
    `);

    return rows.map(r => ({
      constraintName: r.constraint_name,
      columnName: r.column_name,
      referencedTable: r.referenced_table,
      referencedColumn: r.referenced_column,
    }));
  }

  private async fetchMysqlForeignKeys(tableName: string): Promise<IntrospectedForeignKey[]> {
    const rows = await this.adapter.executeQuery<{
      constraint_name: string;
      column_name: string;
      referenced_table_name: string;
      referenced_column_name: string;
    }>(`
      SELECT
        CONSTRAINT_NAME AS constraint_name,
        COLUMN_NAME AS column_name,
        REFERENCED_TABLE_NAME AS referenced_table_name,
        REFERENCED_COLUMN_NAME AS referenced_column_name
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = '${tableName}'
        AND REFERENCED_TABLE_NAME IS NOT NULL;
    `);

    return rows.map(r => ({
      constraintName: r.constraint_name,
      columnName: r.column_name,
      referencedTable: r.referenced_table_name,
      referencedColumn: r.referenced_column_name,
    }));
  }

  private async fetchPostgresForeignKeys(tableName: string): Promise<IntrospectedForeignKey[]> {
    const rows = await this.adapter.executeQuery<{
      constraint_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(`
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = '${tableName}'
        AND tc.table_schema = 'public';
    `);

    return rows.map(r => ({
      constraintName: r.constraint_name,
      columnName: r.column_name,
      referencedTable: r.foreign_table_name,
      referencedColumn: r.foreign_column_name,
    }));
  }
}
