import {
  QueryException,
  ProcedureException,
  UniqueConstraintViolationException,
  ForeignKeyViolationException,
  CheckConstraintViolationException,
  CannotNullConstraintViolationException,
  SqlSyntaxErrorException,
  TableNotFoundException,
  ColumnNotFoundException,
  ProcedureNotFoundException,
} from './index';

export class DatabaseErrorTranslator {
  /**
   * Inspects a database driver error and converts it to a strongly typed exception:
   * - SqlSyntaxErrorException (syntax / parse errors)
   * - ColumnNotFoundException (column does not exist in table)
   * - TableNotFoundException (table does not exist in database)
   * - UniqueConstraintViolationException
   * - ForeignKeyViolationException
   * - CheckConstraintViolationException
   * - CannotNullConstraintViolationException
   * - Or standard QueryException fallback
   */
  public static translate(rawError: unknown, sql?: string, provider?: string): QueryException {
    if (
      rawError instanceof SqlSyntaxErrorException ||
      rawError instanceof ColumnNotFoundException ||
      rawError instanceof TableNotFoundException ||
      rawError instanceof UniqueConstraintViolationException ||
      rawError instanceof ForeignKeyViolationException ||
      rawError instanceof CheckConstraintViolationException ||
      rawError instanceof CannotNullConstraintViolationException
    ) {
      return rawError;
    }

    const err = (rawError || {}) as any;
    const cause =
      rawError instanceof QueryException && rawError.cause ? (rawError.cause as any) : {};
    const msg = String(err.message || err.sqlMessage || cause.message || cause.sqlMessage || err);
    const code = String(err.code || cause.code || (err.cause as any)?.code || '');
    const errno = Number(
      err.errno || err.number || cause.errno || cause.number || (err.cause as any)?.errno || 0,
    );

    // ── 1. SQL SYNTAX ERROR ───────────────────────────────────────────────
    // Postgres: 42601 (syntax_error)
    // MySQL: 1064, ER_PARSE_ERROR
    // SQLite: "syntax error", "near ...: syntax error", "unrecognized token"
    // MSSQL: 102, 156
    // Oracle: ORA-00933, ORA-00900
    if (
      code === '42601' ||
      errno === 1064 ||
      code === 'ER_PARSE_ERROR' ||
      errno === 102 ||
      errno === 156 ||
      msg.includes('syntax error') ||
      /near\s+["'].*["']:\s+syntax\s+error/i.test(msg) ||
      msg.includes('unrecognized token') ||
      msg.includes('Incorrect syntax near') ||
      msg.includes('You have an error in your SQL syntax') ||
      msg.includes('ORA-00933') ||
      msg.includes('ORA-00900')
    ) {
      let position: string | number | undefined = err.position;
      if (!position) {
        const nearMatch = /(?:near|at or near)\s+["']([^"']+)["']/i.exec(msg);
        if (nearMatch) {
          position = nearMatch[1];
        }
      }
      return new SqlSyntaxErrorException(`SQL syntax error: ${msg}`, position, sql, rawError);
    }

    // ── 2. COLUMN NOT FOUND (Check BEFORE Table Not Found) ────────────────
    // Postgres: 42703 (undefined_column)
    // MySQL: 1054, ER_BAD_FIELD_ERROR
    // SQLite: "no such column: ...", "has no column named ..."
    // MSSQL: 207 (Invalid column name)
    // Oracle: ORA-00904
    if (
      code === '42703' ||
      errno === 1054 ||
      code === 'ER_BAD_FIELD_ERROR' ||
      errno === 207 ||
      msg.includes('no such column:') ||
      msg.includes('has no column named') ||
      /column\s+["'].*["'](?:\s+of\s+relation\s+["'].*["'])?\s+does\s+not\s+exist/i.test(msg) ||
      /Unknown\s+column\s+['"].*['"]\s+in/i.test(msg) ||
      msg.includes('Invalid column name') ||
      msg.includes('ORA-00904')
    ) {
      let columnName: string | undefined;
      let targetTable: string | undefined;

      const pgColMatch =
        /column\s+["']([^"']+)["'](?:\s+of\s+relation\s+["']([^"']+)["'])?\s+does\s+not\s+exist/i.exec(
          msg,
        );
      if (pgColMatch) {
        columnName = pgColMatch[1];
        targetTable = pgColMatch[2];
      }
      const myColMatch = /Unknown\s+column\s+['"]([^'"]+)['"]/i.exec(msg);
      if (myColMatch) {
        const parts = myColMatch[1].split('.');
        columnName = parts.pop();
        if (parts.length > 0) targetTable = parts.pop();
      }
      const sqliteColMatch =
        /(?:no\s+such\s+column:\s*|has\s+no\s+column\s+named\s+)([`"[\]\w.]+)/i.exec(msg);
      if (sqliteColMatch) {
        const parts = sqliteColMatch[1].replace(/[`"[\]]/g, '').split('.');
        columnName = parts.pop();
        if (parts.length > 0) targetTable = parts.pop();
      }
      const msColMatch = /Invalid\s+column\s+name\s+['"]([^'"]+)['"]/i.exec(msg);
      if (msColMatch) {
        columnName = msColMatch[1].replace(/[`"[\]]/g, '');
      }

      return new ColumnNotFoundException(
        `Column not found: ${msg}`,
        columnName,
        targetTable,
        sql,
        rawError,
      );
    }

    // ── 3. TABLE NOT FOUND ────────────────────────────────────────────────
    // Postgres: 42P01 (undefined_table)
    // MySQL: 1146, ER_NO_SUCH_TABLE
    // SQLite: "no such table: ..."
    // MSSQL: 208 (Invalid object name)
    // Oracle: ORA-00942
    if (
      code === '42P01' ||
      errno === 1146 ||
      code === 'ER_NO_SUCH_TABLE' ||
      errno === 208 ||
      msg.includes('no such table:') ||
      (!msg.includes('column') && /relation\s+["'].*["']\s+does\s+not\s+exist/i.test(msg)) ||
      /Table\s+['"].*['"]\s+doesn't\s+exist/i.test(msg) ||
      msg.includes('Invalid object name') ||
      msg.includes('ORA-00942')
    ) {
      let tableName: string | undefined;
      const pgTableMatch = /relation\s+["']([^"']+)["']\s+does\s+not\s+exist/i.exec(msg);
      if (pgTableMatch) {
        tableName = pgTableMatch[1].split('.').pop();
      }
      const myTableMatch = /Table\s+['"]([^'"]+)['"]\s+doesn't\s+exist/i.exec(msg);
      if (myTableMatch) {
        tableName = myTableMatch[1].split('.').pop();
      }
      const sqliteTableMatch = /no\s+such\s+table:\s*([^\s,;]+)/i.exec(msg);
      if (sqliteTableMatch) {
        tableName = sqliteTableMatch[1].replace(/[`"[\]]/g, '');
      }
      const msTableMatch = /Invalid\s+object\s+name\s+['"]([^'"]+)['"]/i.exec(msg);
      if (msTableMatch) {
        tableName = msTableMatch[1]
          .split('.')
          .pop()
          ?.replace(/[`"[\]]/g, '');
      }

      return new TableNotFoundException(`Table not found: ${msg}`, tableName, sql, rawError);
    }

    // ── 4. UNIQUE CONSTRAINT ───────────────────────────────────────────────
    // Postgres / CockroachDB: 23505
    // MySQL: 1062, ER_DUP_ENTRY
    // SQLite: SQLITE_CONSTRAINT_UNIQUE, message includes "UNIQUE constraint failed"
    // MSSQL: 2601, 2627
    // Oracle: ORA-00001
    if (
      code === '23505' ||
      errno === 1062 ||
      code === 'ER_DUP_ENTRY' ||
      msg.includes('UNIQUE constraint failed') ||
      msg.includes('duplicate key') ||
      code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      errno === 2601 ||
      errno === 2627 ||
      msg.includes('ORA-00001')
    ) {
      let constraintName: string | undefined = err.constraint;
      let columnName: string | undefined;

      const sqliteColMatch = /UNIQUE constraint failed:\s*([^\s,]+)/.exec(msg);
      if (sqliteColMatch) {
        columnName = sqliteColMatch[1].split('.').pop();
      }

      const pgColMatch = /Key \(([^)]+)\)=/.exec(err.detail || msg);
      if (pgColMatch) {
        columnName = pgColMatch[1];
      }

      const mysqlKeyMatch = /for key '([^']+)'/.exec(msg);
      if (mysqlKeyMatch) {
        constraintName = mysqlKeyMatch[1];
        columnName = mysqlKeyMatch[1].split('.').pop();
      }

      return new UniqueConstraintViolationException(
        `Unique constraint violation: ${msg}`,
        constraintName,
        columnName,
        sql,
        rawError,
      );
    }

    // ── 5. FOREIGN KEY CONSTRAINT ──────────────────────────────────────────
    // Postgres / CockroachDB: 23503
    // MySQL: 1451, 1452, ER_NO_REFERENCED_ROW_2
    // SQLite: SQLITE_CONSTRAINT_FOREIGNKEY, "FOREIGN KEY constraint failed"
    // MSSQL: 547 (FOREIGN KEY)
    // Oracle: ORA-02291, ORA-02292
    if (
      code === '23503' ||
      errno === 1451 ||
      errno === 1452 ||
      code === 'ER_NO_REFERENCED_ROW_2' ||
      code === 'ER_ROW_IS_REFERENCED_2' ||
      msg.includes('FOREIGN KEY constraint failed') ||
      code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
      (errno === 547 && msg.toUpperCase().includes('FOREIGN KEY')) ||
      msg.includes('ORA-02291') ||
      msg.includes('ORA-02292')
    ) {
      return new ForeignKeyViolationException(
        `Foreign key constraint violation: ${msg}`,
        err.constraint,
        undefined,
        err.table,
        sql,
        rawError,
      );
    }

    // ── 6. CHECK CONSTRAINT ────────────────────────────────────────────────
    // Postgres: 23514
    // MySQL: 3819, ER_CHECK_CONSTRAINT_VIOLATED
    // SQLite: "CHECK constraint failed"
    // MSSQL: 547 (CHECK)
    // Oracle: ORA-02290
    if (
      code === '23514' ||
      errno === 3819 ||
      code === 'ER_CHECK_CONSTRAINT_VIOLATED' ||
      msg.includes('CHECK constraint failed') ||
      code === 'SQLITE_CONSTRAINT_CHECK' ||
      (errno === 547 && msg.toUpperCase().includes('CHECK')) ||
      msg.includes('ORA-02290')
    ) {
      return new CheckConstraintViolationException(
        `Check constraint violation: ${msg}`,
        err.constraint,
        sql,
        rawError,
      );
    }

    // ── 7. CANNOT NULL CONSTRAINT ──────────────────────────────────────────
    // Postgres: 23502
    // MySQL: 1048, ER_BAD_NULL_ERROR
    // SQLite: "NOT NULL constraint failed"
    // MSSQL: 515
    // Oracle: ORA-01400
    if (
      code === '23502' ||
      errno === 1048 ||
      code === 'ER_BAD_NULL_ERROR' ||
      msg.includes('NOT NULL constraint failed') ||
      code === 'SQLITE_CONSTRAINT_NOTNULL' ||
      errno === 515 ||
      msg.includes('ORA-01400')
    ) {
      const sqliteNullMatch = /NOT NULL constraint failed:\s*([^\s,]+)/.exec(msg);
      const col = err.column || (sqliteNullMatch ? sqliteNullMatch[1].split('.').pop() : undefined);
      return new CannotNullConstraintViolationException(
        `Cannot null constraint violation: ${msg}`,
        col,
        sql,
        rawError,
      );
    }

    // Default fallback
    return new QueryException(`Failed to execute query: ${msg}`, sql, rawError);
  }

  /**
   * Inspects a stored procedure execution error and converts it into a strongly typed exception:
   * - ProcedureNotFoundException (if the stored procedure does not exist in the database)
   * - Or standard ProcedureException
   */
  public static translateProcedure(
    rawError: unknown,
    procedureName: string,
    provider?: string,
  ): ProcedureException {
    if (rawError instanceof ProcedureNotFoundException) {
      return rawError;
    }

    const err = (rawError || {}) as any;
    const cause =
      rawError instanceof ProcedureException && rawError.cause
        ? (rawError.cause as any)
        : (rawError as any).cause || {};
    const msg = String(err.message || err.sqlMessage || cause.message || cause.sqlMessage || err);
    const code = String(err.code || cause.code || (err.cause as any)?.code || '');
    const errno = Number(
      err.errno || err.number || cause.errno || cause.number || (err.cause as any)?.errno || 0,
    );

    // Postgres: 42883 (undefined_function / undefined_procedure)
    // MySQL: 1305, ER_SP_DOES_NOT_EXIST
    // MSSQL: 2812 (Could not find stored procedure)
    // Oracle: ORA-06550, PLS-00201 (identifier ... must be declared)
    // SQLite / Mock: does not natively support, does not exist, not registered, syntax error on proc name
    if (
      code === '42883' ||
      errno === 1305 ||
      code === 'ER_SP_DOES_NOT_EXIST' ||
      errno === 2812 ||
      /(?:procedure|function)\s+.*does\s+not\s+exist/i.test(msg) ||
      /could\s+not\s+find\s+stored\s+procedure/i.test(msg) ||
      msg.includes('does not natively support stored procedures') ||
      msg.includes('does not exist in the database') ||
      msg.includes('not registered') ||
      msg.includes('PLS-00201') ||
      msg.includes('ORA-06550') ||
      (msg.includes(procedureName) && (msg.includes('syntax error') || msg.includes('near'))) ||
      (code === 'SQLITE_ERROR' && msg.includes(procedureName))
    ) {
      return new ProcedureNotFoundException(
        `Stored procedure '${procedureName}' does not exist in the database: ${msg}`,
        procedureName,
        rawError,
      );
    }

    if (rawError instanceof ProcedureException) {
      return rawError;
    }

    return new ProcedureException(
      `Failed to execute procedure '${procedureName}': ${msg}`,
      procedureName,
      rawError,
    );
  }
}
