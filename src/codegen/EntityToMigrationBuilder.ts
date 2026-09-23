import { EntityMetadata } from '../model/EntityMetadata';
import { MigrationBuilder, TableBuilder } from '../migrations/MigrationBuilder';
import { IDbAdapter } from '../adapters/IDbAdapter';
import { SqlType } from '../procedure/SqlType';

/**
 * Maps a SqlType to a dialect-appropriate SQL column type string.
 */
export function sqlTypeToColumnType(
  sqlType: SqlType | undefined,
  adapter: IDbAdapter,
  maxLength?: number,
): string {
  const len = maxLength ?? 255;
  const p = adapter.provider;
  const isPostgresFamily =
    p === 'postgres' || p === 'neon' || p === 'cockroachdb' || p === 'supabase';
  const isSqliteFamily = p === 'sqlite' || p === 'turso' || p === 'd1';
  const isMysqlFamily = p === 'mysql' || p === 'planetscale';
  const isMssql = p === 'mssql';

  switch (sqlType) {
    case SqlType.Int:
      return 'INTEGER';
    case SqlType.BigInt:
      return 'BIGINT';
    case SqlType.SmallInt:
      return 'SMALLINT';
    case SqlType.TinyInt:
      return 'TINYINT';
    case SqlType.Float:
    case SqlType.Real:
      return 'FLOAT';
    case SqlType.Decimal:
    case SqlType.Numeric:
    case SqlType.Money:
      return 'DECIMAL(18, 4)';
    case SqlType.VarChar:
      return `VARCHAR(${len})`;
    case SqlType.NVarChar:
      return isMysqlFamily || isSqliteFamily ? `VARCHAR(${len})` : `NVARCHAR(${len})`;
    case SqlType.Char:
      return `CHAR(${len})`;
    case SqlType.NChar:
      return isMysqlFamily || isSqliteFamily ? `CHAR(${len})` : `NCHAR(${len})`;
    case SqlType.Text:
    case SqlType.NText:
      return 'TEXT';
    case SqlType.Bit:
      return isMssql ? 'BIT' : 'BOOLEAN';
    case SqlType.DateTime:
    case SqlType.DateTime2:
    case SqlType.SmallDateTime:
      return isMssql ? 'DATETIME2' : 'TIMESTAMP';
    case SqlType.Date:
      return 'DATE';
    case SqlType.Time:
      return 'TIME';
    case SqlType.DateTimeOffset:
      return isMssql ? 'DATETIMEOFFSET' : 'TIMESTAMP WITH TIME ZONE';
    case SqlType.UniqueIdentifier:
    case SqlType.Uuid:
      return isPostgresFamily ? 'UUID' : isMssql ? 'UNIQUEIDENTIFIER' : 'VARCHAR(36)';
    case SqlType.Binary:
    case SqlType.VarBinary:
    case SqlType.Image:
      return 'BLOB';
    case SqlType.Json:
      return 'JSON';
    case SqlType.Xml:
      return isMssql ? 'XML' : 'TEXT';
    default:
      return `VARCHAR(${len})`;
  }
}

/**
 * Converts an EntityMetadata object into a populated MigrationBuilder
 * that generates correct CREATE TABLE DDL for all supported adapters.
 * Returns `undefined` for view entities — DDL is skipped for views.
 */
export function entityToMigrationBuilder(
  metadata: EntityMetadata,
  adapter: IDbAdapter,
): MigrationBuilder {
  const builder = new MigrationBuilder();
  // Views have no DDL — the CREATE VIEW is managed outside NSP
  if (metadata.isView) return builder;

  const p = adapter.provider;
  const isMysqlFamily = p === 'mysql' || p === 'planetscale';
  const isSqliteFamily = p === 'sqlite' || p === 'turso' || p === 'd1';
  const isMssql = p === 'mssql';

  // Column names that are part of a @CompositeKey — they skip inline PRIMARY KEY
  const compositePkCols = new Set<string>();
  if (metadata.compositeKeys) {
    for (const keySet of metadata.compositeKeys) {
      for (const col of keySet) compositePkCols.add(col);
    }
  }

  builder.createTable(metadata.tableName, (table: TableBuilder) => {
    // Sort primary keys first so they appear at the top of the column list
    const cols = Array.from(metadata.columns.values())
      .filter(c => !metadata.ignoredProperties.has(c.propertyName))
      .sort((a, b) => (b.isPrimaryKey ? 1 : 0) - (a.isPrimaryKey ? 1 : 0));

    for (const col of cols) {
      // ── Enum columns ────────────────────────────────────────────────────────
      if (col.enumValues && col.enumValues.length > 0) {
        const quotedVals = col.enumValues.map(v => `'${v}'`).join(', ');
        // MySQL: native ENUM type; others: VARCHAR/TEXT + CHECK constraint
        const colBuilder = isMysqlFamily
          ? table.enum(col.columnName, col.enumValues)
          : isSqliteFamily
            ? table.text(col.columnName)
            : table.string(col.columnName, col.maxLength ?? 100);

        if (col.isNullable === false) colBuilder.notNullable();
        else if (col.isNullable) colBuilder.nullable();
        if (col.defaultValue !== undefined) {
          const val =
            typeof col.defaultValue === 'function'
              ? (col.defaultValue as Function)()
              : col.defaultValue;
          colBuilder.defaultTo(val);
        }

        // Store CHECK constraint to be emitted as post-create SQL
        (builder as any).__enumChecks = (builder as any).__enumChecks || [];
        (builder as any).__enumChecks.push({
          table: metadata.tableName,
          column: col.columnName,
          values: col.enumValues,
          isMysql: isMysqlFamily,
        });
        continue;
      }

      // ── Auto-increment PK ────────────────────────────────────────────────────
      const isCompositePkCol = compositePkCols.has(col.columnName);
      if (col.isPrimaryKey && col.isAutoIncrement && !isCompositePkCol) {
        table.increments(col.columnName);
        continue;
      }

      // ── Normal column ────────────────────────────────────────────────────────
      const colType = sqlTypeToColumnType(col.sqlType, adapter, col.maxLength);

      let colBuilder: ReturnType<typeof table.integer>;

      if (colType.startsWith('VARCHAR') || colType.startsWith('NVARCHAR')) {
        colBuilder = table.string(col.columnName, col.maxLength ?? 255);
      } else if (['INTEGER', 'SMALLINT', 'TINYINT'].includes(colType)) {
        colBuilder = table.integer(col.columnName);
      } else if (colType === 'BIGINT') {
        colBuilder = table.bigInteger(col.columnName);
      } else if (colType === 'TEXT' || colType === 'XML') {
        colBuilder = table.text(col.columnName);
      } else if (colType === 'BOOLEAN' || colType === 'BIT') {
        colBuilder = table.boolean(col.columnName);
      } else if (
        colType.startsWith('TIMESTAMP') ||
        colType === 'DATE' ||
        colType === 'DATETIME2' ||
        colType === 'TIME'
      ) {
        colBuilder = table.timestamp(col.columnName);
      } else if (colType.startsWith('DECIMAL') || colType.startsWith('FLOAT')) {
        colBuilder = table.decimal(col.columnName);
      } else if (
        colType === 'UUID' ||
        colType === 'UNIQUEIDENTIFIER' ||
        colType === 'VARCHAR(36)'
      ) {
        colBuilder = table.uuid(col.columnName);
      } else if (colType === 'JSON') {
        colBuilder = table.json(col.columnName);
      } else {
        colBuilder = table.string(col.columnName, col.maxLength ?? 255);
      }

      // Inline PRIMARY KEY only when NOT part of a composite key
      if (col.isPrimaryKey && !isCompositePkCol) colBuilder.primary();
      if (col.isNullable === false) colBuilder.notNullable();
      else if (col.isNullable) colBuilder.nullable();
      if (col.defaultValue !== undefined) {
        const val =
          typeof col.defaultValue === 'function'
            ? (col.defaultValue as Function)()
            : col.defaultValue;
        colBuilder.defaultTo(val);
      }
    }

    // Auto-append audit columns not already declared via @Column
    if (metadata.createdAtProperty && !metadata.columns.has(metadata.createdAtProperty)) {
      table.timestamp('created_at').notNullable().defaultToNow();
    }
    if (metadata.updatedAtProperty && !metadata.columns.has(metadata.updatedAtProperty)) {
      table.timestamp('updated_at').nullable();
    }
    if (metadata.softDelete) {
      const alreadyDeclared = Array.from(metadata.columns.values()).some(
        c => c.columnName === metadata.softDelete!.column,
      );
      if (!alreadyDeclared) {
        table.timestamp(metadata.softDelete.column).nullable();
      }
    }
  });

  // ── Indexes ────────────────────────────────────────────────────────────────
  if (metadata.indexes && metadata.indexes.length > 0) {
    for (const idx of metadata.indexes) {
      builder.createIndex(metadata.tableName, idx.columns, {
        name: idx.name,
        unique: idx.unique,
      });
    }
  }

  // ── Composite PKs — table-level ALTER TABLE ... ADD PRIMARY KEY ─────────────
  if (metadata.compositeKeys && metadata.compositeKeys.length > 0) {
    for (const keySet of metadata.compositeKeys) {
      const escapedCols = keySet.map(c => adapter.escapeIdentifier(c)).join(', ');
      const tbl = adapter.escapeIdentifier(metadata.tableName);
      // SQLite doesn't support ALTER TABLE ADD PRIMARY KEY; must be inline in CREATE TABLE
      // For SQLite we skip the ALTER and rely on the inline column definitions
      if (!isSqliteFamily) {
        builder.executeSql(`ALTER TABLE ${tbl} ADD PRIMARY KEY (${escapedCols});`);
      }
    }
  }

  // ── Enum CHECK constraints (non-MySQL) ──────────────────────────────────────
  const enumChecks: Array<{ table: string; column: string; values: string[]; isMysql: boolean }> =
    (builder as any).__enumChecks || [];
  for (const ec of enumChecks) {
    if (!ec.isMysql) {
      const quotedVals = ec.values.map((v: string) => `'${v}'`).join(', ');
      const tbl = adapter.escapeIdentifier(ec.table);
      const col = adapter.escapeIdentifier(ec.column);
      builder.executeSql(
        `ALTER TABLE ${tbl} ADD CONSTRAINT chk_${ec.column}_enum CHECK (${col} IN (${quotedVals}));`,
      );
    }
  }

  return builder;
}
