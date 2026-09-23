import { IDbAdapter } from '../adapters/IDbAdapter';

export interface ColumnDefinition {
  name: string;
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  isPrimary?: boolean;
  isAutoIncrement?: boolean;
  isNullable?: boolean;
  isUnique?: boolean;
  defaultValue?: unknown;
}

export class ColumnBuilder {
  constructor(public readonly def: ColumnDefinition) {}

  public primary(): this { this.def.isPrimary = true; return this; }
  public notNullable(): this { this.def.isNullable = false; return this; }
  public nullable(): this { this.def.isNullable = true; return this; }
  public unique(): this { this.def.isUnique = true; return this; }
  public defaultTo(val: unknown): this { this.def.defaultValue = val; return this; }
  public defaultToNow(): this { this.def.defaultValue = 'CURRENT_TIMESTAMP'; return this; }
}

export class TableBuilder {
  public readonly columns: ColumnDefinition[] = [];

  private col(
    name: string,
    type: string,
    isNullable = false,
    isPrimary = false,
    isAutoIncrement = false
  ): ColumnBuilder {
    const def: ColumnDefinition = { name, type, isNullable, isPrimary, isAutoIncrement };
    this.columns.push(def);
    return new ColumnBuilder(def);
  }

  public increments(name = 'id'): ColumnBuilder { return this.col(name, 'INTEGER', false, true, true); }
  public string(name: string, length = 255): ColumnBuilder { return this.col(name, `VARCHAR(${length})`); }
  public integer(name: string): ColumnBuilder { return this.col(name, 'INTEGER'); }
  public decimal(name: string, precision = 10, scale = 2): ColumnBuilder { return this.col(name, `DECIMAL(${precision}, ${scale})`); }
  public boolean(name: string): ColumnBuilder { return this.col(name, 'BOOLEAN'); }
  public text(name: string): ColumnBuilder { return this.col(name, 'TEXT', true); }
  public timestamp(name: string): ColumnBuilder { return this.col(name, 'TIMESTAMP', true); }
  public uuid(name: string): ColumnBuilder { return this.col(name, 'UUID'); }
  public json(name: string): ColumnBuilder { return this.col(name, 'JSON', true); }
  public float(name: string, precision = 8, scale = 2): ColumnBuilder { return this.col(name, `FLOAT(${precision}, ${scale})`); }
  public bigInteger(name: string): ColumnBuilder { return this.col(name, 'BIGINT'); }
  public enum(name: string, values: string[]): ColumnBuilder {
    return this.col(name, `ENUM(${values.map(v => `'${v}'`).join(', ')})`, true);
  }
}

// ── Dialect Helpers ─────────────────────────────────────────────────────────

const isPg = (p: string) => p === 'postgres' || p === 'neon' || p === 'cockroachdb' || p === 'supabase';
const isSqlite = (p: string) => p === 'sqlite' || p === 'turso' || p === 'd1';
const isMysql = (p: string) => p === 'mysql' || p === 'planetscale';

export class MigrationBuilder {
  private readonly operations: ((adapter: IDbAdapter) => string)[] = [];

  public createTable(tableName: string, fn: (table: TableBuilder) => void): this {
    const table = new TableBuilder();
    fn(table);

    this.operations.push(adapter => {
      const p = adapter.provider;
      const escapedTable = adapter.escapeIdentifier(tableName);
      const isPostgresFamily = isPg(p);
      const isSqliteFamily = isSqlite(p);
      const isMysqlFamily = isMysql(p);

      const colDefs = table.columns.map(c => {
        const escapedCol = adapter.escapeIdentifier(c.name);
        let def = `${escapedCol} ${c.type}`;

        if (c.isAutoIncrement) {
          if (isPostgresFamily) def = `${escapedCol} SERIAL`;
          else if (isSqliteFamily) def = `${escapedCol} INTEGER PRIMARY KEY AUTOINCREMENT`;
          else if (isMysqlFamily) def = `${escapedCol} INT AUTO_INCREMENT`;
          else if (p === 'mssql') def = `${escapedCol} INT IDENTITY(1,1)`;
        }

        if (c.isPrimary && !isSqliteFamily) def += ' PRIMARY KEY';
        if (c.isNullable === false && !def.includes('PRIMARY KEY')) def += ' NOT NULL';
        if (c.isUnique) def += ' UNIQUE';
        if (c.defaultValue !== undefined) {
          def += c.defaultValue === 'CURRENT_TIMESTAMP'
            ? ' DEFAULT CURRENT_TIMESTAMP'
            : typeof c.defaultValue === 'string'
              ? ` DEFAULT '${c.defaultValue}'`
              : ` DEFAULT ${c.defaultValue}`;
        }
        return def;
      });

      return `CREATE TABLE ${escapedTable} (\n  ${colDefs.join(',\n  ')}\n);`;
    });

    return this;
  }

  public dropTable(tableName: string): this {
    this.operations.push(adapter => `DROP TABLE ${adapter.escapeIdentifier(tableName)};`);
    return this;
  }

  public dropTableIfExists(tableName: string): this {
    this.operations.push(adapter => `DROP TABLE IF EXISTS ${adapter.escapeIdentifier(tableName)};`);
    return this;
  }

  public addColumn(
    tableName: string,
    columnName: string,
    type: string,
    fn?: (col: ColumnBuilder) => void
  ): this {
    const colDef: ColumnDefinition = { name: columnName, type };
    if (fn) fn(new ColumnBuilder(colDef));

    this.operations.push(adapter => {
      const table = adapter.escapeIdentifier(tableName);
      const col = adapter.escapeIdentifier(colDef.name);
      let sql = `ALTER TABLE ${table} ADD COLUMN ${col} ${colDef.type}`;
      if (colDef.isNullable === false) sql += ' NOT NULL';
      if (colDef.defaultValue !== undefined) sql += ` DEFAULT ${colDef.defaultValue}`;
      return `${sql};`;
    });
    return this;
  }

  public dropColumn(tableName: string, columnName: string): this {
    this.operations.push(
      adapter =>
        `ALTER TABLE ${adapter.escapeIdentifier(tableName)} DROP COLUMN ${adapter.escapeIdentifier(
          columnName
        )};`
    );
    return this;
  }

  public createIndex(
    tableName: string,
    columns: string[],
    options?: { unique?: boolean; name?: string }
  ): this {
    this.operations.push(adapter => {
      const idxName = options?.name || `idx_${tableName}_${columns.join('_')}`;
      const uniqueStr = options?.unique ? 'UNIQUE ' : '';
      const cols = columns.map(c => adapter.escapeIdentifier(c)).join(', ');
      return `CREATE ${uniqueStr}INDEX ${adapter.escapeIdentifier(
        idxName
      )} ON ${adapter.escapeIdentifier(tableName)} (${cols});`;
    });
    return this;
  }

  public dropIndex(tableName: string, indexName: string): this {
    this.operations.push(adapter => `DROP INDEX ${adapter.escapeIdentifier(indexName)};`);
    return this;
  }

  public executeSql(sql: string): this {
    this.operations.push(() => sql);
    return this;
  }

  public renameColumn(tableName: string, oldName: string, newName: string, columnType?: string): this {
    this.operations.push(adapter => {
      const table = adapter.escapeIdentifier(tableName);
      const oldCol = adapter.escapeIdentifier(oldName);
      const newCol = adapter.escapeIdentifier(newName);
      if (isMysql(adapter.provider)) {
        return `ALTER TABLE ${table} CHANGE COLUMN ${oldCol} ${newCol} ${columnType || 'VARCHAR(255)'};`;
      }
      return `ALTER TABLE ${table} RENAME COLUMN ${oldCol} TO ${newCol};`;
    });
    return this;
  }

  public alterColumn(
    tableName: string,
    columnName: string,
    type: string,
    fn?: (col: ColumnBuilder) => void
  ): this {
    const colDef: ColumnDefinition = { name: columnName, type };
    if (fn) fn(new ColumnBuilder(colDef));

    this.operations.push(adapter => {
      const p = adapter.provider;
      const table = adapter.escapeIdentifier(tableName);
      const col = adapter.escapeIdentifier(columnName);

      if (isPg(p)) return `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE ${type};`;
      if (isMysql(p)) return `ALTER TABLE ${table} MODIFY COLUMN ${col} ${type};`;
      if (p === 'mssql') return `ALTER TABLE ${table} ALTER COLUMN ${col} ${type};`;
      return `-- SQLite: recreate table to alter column ${columnName} on ${tableName}`;
    });
    return this;
  }

  public addForeignKey(
    tableName: string,
    columnName: string,
    referencedTable: string,
    referencedColumn: string,
    options?: { constraintName?: string; onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' }
  ): this {
    this.operations.push(adapter => {
      if (isSqlite(adapter.provider)) {
        return `-- SQLite: foreign key for ${tableName}.${columnName} -> ${referencedTable}(${referencedColumn}) (add PRAGMA foreign_keys=ON at connect time)`;
      }
      const table = adapter.escapeIdentifier(tableName);
      const col = adapter.escapeIdentifier(columnName);
      const refTable = adapter.escapeIdentifier(referencedTable);
      const refCol = adapter.escapeIdentifier(referencedColumn);
      const constraintName = adapter.escapeIdentifier(
        options?.constraintName || `fk_${tableName}_${columnName}`
      );
      const onDelete = options?.onDelete ? ` ON DELETE ${options.onDelete}` : '';
      return `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${col}) REFERENCES ${refTable} (${refCol})${onDelete};`;
    });
    return this;
  }

  public getSqlStatements(adapter: IDbAdapter): string[] {
    return this.operations.map(op => op(adapter));
  }
}
