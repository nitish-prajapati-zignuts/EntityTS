import {
  DbContext,
  DbContextOptionsBuilder,
  Table,
  PrimaryKey,
  Column,
  SqlSyntaxErrorException,
  TableNotFoundException,
  ColumnNotFoundException,
  ProcedureNotFoundException,
  ProcedureException,
  QueryException,
  DatabaseErrorTranslator,
  MockDbAdapter,
} from '../src';

@Table('error_test_users')
class ErrorTestUser {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column()
  username!: string;

  @Column()
  email!: string;
}

class ErrorHandlingDbContext extends DbContext {
  public readonly users = this.set(ErrorTestUser);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:');
  }
}

describe('Query and Stored Procedure Error Handling Edge Cases', () => {
  describe('DatabaseErrorTranslator Unit Translation', () => {
    describe('SQL Syntax Errors (SqlSyntaxErrorException)', () => {
      it('translates PostgreSQL syntax error (code 42601)', () => {
        const pgErr = {
          code: '42601',
          message: 'syntax error at or near "FROM"',
          position: '8',
        };
        const err = DatabaseErrorTranslator.translate(pgErr, 'SELECT FROM users', 'postgres');
        expect(err).toBeInstanceOf(SqlSyntaxErrorException);
        expect(err).toBeInstanceOf(QueryException);
        expect((err as SqlSyntaxErrorException).position).toBe('8');
        expect(err.message).toContain('syntax error');
      });

      it('translates MySQL syntax error (errno 1064 / ER_PARSE_ERROR)', () => {
        const myErr = {
          errno: 1064,
          code: 'ER_PARSE_ERROR',
          message: "You have an error in your SQL syntax; check the manual near 'WHERE' at line 1",
        };
        const err = DatabaseErrorTranslator.translate(myErr, 'SELECT * WHERE', 'mysql');
        expect(err).toBeInstanceOf(SqlSyntaxErrorException);
      });

      it('translates SQLite syntax error', () => {
        const sqliteErr = new Error('near "FRM": syntax error');
        const err = DatabaseErrorTranslator.translate(sqliteErr, 'SELECT * FRM users', 'sqlite');
        expect(err).toBeInstanceOf(SqlSyntaxErrorException);
        expect(err.sql).toBe('SELECT * FRM users');
      });

      it('translates MSSQL syntax error (errno 102)', () => {
        const msErr = {
          number: 102,
          message: "Incorrect syntax near 'ORDER'.",
        };
        const err = DatabaseErrorTranslator.translate(msErr, 'SELECT ORDER BY', 'mssql');
        expect(err).toBeInstanceOf(SqlSyntaxErrorException);
      });
    });

    describe('Table Not Found (TableNotFoundException)', () => {
      it('translates PostgreSQL undefined table (code 42P01)', () => {
        const pgErr = {
          code: '42P01',
          message: 'relation "non_existent_orders" does not exist',
        };
        const err = DatabaseErrorTranslator.translate(
          pgErr,
          'SELECT * FROM non_existent_orders',
          'postgres',
        );
        expect(err).toBeInstanceOf(TableNotFoundException);
        expect((err as TableNotFoundException).tableName).toBe('non_existent_orders');
      });

      it('translates MySQL missing table (errno 1146 / ER_NO_SUCH_TABLE)', () => {
        const myErr = {
          errno: 1146,
          code: 'ER_NO_SUCH_TABLE',
          message: "Table 'my_db.missing_table' doesn't exist",
        };
        const err = DatabaseErrorTranslator.translate(
          myErr,
          'SELECT * FROM missing_table',
          'mysql',
        );
        expect(err).toBeInstanceOf(TableNotFoundException);
        expect((err as TableNotFoundException).tableName).toBe('missing_table');
      });

      it('translates SQLite no such table error', () => {
        const sqliteErr = new Error('no such table: archive_logs');
        const err = DatabaseErrorTranslator.translate(
          sqliteErr,
          'SELECT * FROM archive_logs',
          'sqlite',
        );
        expect(err).toBeInstanceOf(TableNotFoundException);
        expect((err as TableNotFoundException).tableName).toBe('archive_logs');
      });

      it('translates MSSQL invalid object name (errno 208)', () => {
        const msErr = {
          number: 208,
          message: "Invalid object name 'dbo.audit_events'.",
        };
        const err = DatabaseErrorTranslator.translate(msErr, 'SELECT * FROM audit_events', 'mssql');
        expect(err).toBeInstanceOf(TableNotFoundException);
        expect((err as TableNotFoundException).tableName).toBe('audit_events');
      });
    });

    describe('Column Not Found (ColumnNotFoundException)', () => {
      it('translates PostgreSQL undefined column (code 42703)', () => {
        const pgErr = {
          code: '42703',
          message: 'column "non_existent_field" of relation "users" does not exist',
        };
        const err = DatabaseErrorTranslator.translate(
          pgErr,
          'SELECT non_existent_field FROM users',
          'postgres',
        );
        expect(err).toBeInstanceOf(ColumnNotFoundException);
        expect((err as ColumnNotFoundException).columnName).toBe('non_existent_field');
        expect((err as ColumnNotFoundException).tableName).toBe('users');
      });

      it('translates MySQL unknown column (errno 1054 / ER_BAD_FIELD_ERROR)', () => {
        const myErr = {
          errno: 1054,
          code: 'ER_BAD_FIELD_ERROR',
          message: "Unknown column 'deleted_flag' in 'field list'",
        };
        const err = DatabaseErrorTranslator.translate(
          myErr,
          'SELECT deleted_flag FROM users',
          'mysql',
        );
        expect(err).toBeInstanceOf(ColumnNotFoundException);
        expect((err as ColumnNotFoundException).columnName).toBe('deleted_flag');
      });

      it('translates SQLite no such column error', () => {
        const sqliteErr = new Error('no such column: user_score');
        const err = DatabaseErrorTranslator.translate(
          sqliteErr,
          'SELECT user_score FROM users',
          'sqlite',
        );
        expect(err).toBeInstanceOf(ColumnNotFoundException);
        expect((err as ColumnNotFoundException).columnName).toBe('user_score');
      });

      it('translates MSSQL invalid column name (errno 207)', () => {
        const msErr = {
          number: 207,
          message: "Invalid column name 'avatar_url'.",
        };
        const err = DatabaseErrorTranslator.translate(
          msErr,
          'SELECT avatar_url FROM users',
          'mssql',
        );
        expect(err).toBeInstanceOf(ColumnNotFoundException);
        expect((err as ColumnNotFoundException).columnName).toBe('avatar_url');
      });
    });

    describe('Stored Procedure Not Found (ProcedureNotFoundException)', () => {
      it('translates PostgreSQL missing procedure (code 42883)', () => {
        const pgErr = {
          code: '42883',
          message: 'procedure usp_calculate_rebates(integer) does not exist',
        };
        const err = DatabaseErrorTranslator.translateProcedure(
          pgErr,
          'usp_calculate_rebates',
          'postgres',
        );
        expect(err).toBeInstanceOf(ProcedureNotFoundException);
        expect(err).toBeInstanceOf(ProcedureException);
        expect((err as ProcedureNotFoundException).procedureName).toBe('usp_calculate_rebates');
      });

      it('translates MySQL procedure does not exist (errno 1305 / ER_SP_DOES_NOT_EXIST)', () => {
        const myErr = {
          errno: 1305,
          code: 'ER_SP_DOES_NOT_EXIST',
          message: 'PROCEDURE my_db.usp_sync_customers does not exist',
        };
        const err = DatabaseErrorTranslator.translateProcedure(
          myErr,
          'usp_sync_customers',
          'mysql',
        );
        expect(err).toBeInstanceOf(ProcedureNotFoundException);
        expect((err as ProcedureNotFoundException).procedureName).toBe('usp_sync_customers');
      });

      it('translates MSSQL could not find stored procedure (errno 2812)', () => {
        const msErr = {
          number: 2812,
          message: "Could not find stored procedure 'usp_archive_orders'.",
        };
        const err = DatabaseErrorTranslator.translateProcedure(
          msErr,
          'usp_archive_orders',
          'mssql',
        );
        expect(err).toBeInstanceOf(ProcedureNotFoundException);
        expect((err as ProcedureNotFoundException).procedureName).toBe('usp_archive_orders');
      });

      it('translates SQLite unsupported / missing procedure error', () => {
        const sqliteErr = new Error(
          "SQLite does not natively support stored procedures ('usp_test')",
        );
        const err = DatabaseErrorTranslator.translateProcedure(sqliteErr, 'usp_test', 'sqlite');
        expect(err).toBeInstanceOf(ProcedureNotFoundException);
      });
    });
  });

  describe('Live Database Execution Error Handling with SQLite and MockAdapter', () => {
    let ctx: ErrorHandlingDbContext;

    beforeAll(async () => {
      ctx = new ErrorHandlingDbContext();
      await ctx.ensureCreated();
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('throws SqlSyntaxErrorException when raw query has invalid SQL syntax', async () => {
      await expect(ctx.queryRaw('SELECT FROM WHERE invalid syntax')).rejects.toThrow(
        SqlSyntaxErrorException,
      );

      await expect(ctx.sql`SELECT FROM ${'some_val'} WHERE`).rejects.toThrow(
        SqlSyntaxErrorException,
      );
    });

    it('throws TableNotFoundException when querying non-existent table', async () => {
      try {
        await ctx.queryRaw('SELECT * FROM completely_missing_table');
        fail('Should have thrown TableNotFoundException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TableNotFoundException);
        expect(err.tableName).toBe('completely_missing_table');
      }
    });

    it('throws ColumnNotFoundException when querying non-existent column in existing table', async () => {
      try {
        await ctx.queryRaw('SELECT non_existent_column_xyz FROM error_test_users');
        fail('Should have thrown ColumnNotFoundException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ColumnNotFoundException);
        expect(err.columnName).toBe('non_existent_column_xyz');
      }
    });

    it('throws ProcedureNotFoundException when calling non-existent procedure via procedure() builder', async () => {
      await expect(ctx.procedure('usp_NonExistentProcedure').execute()).rejects.toThrow(
        ProcedureNotFoundException,
      );
    });

    it('throws ProcedureNotFoundException in MockDbAdapter when executing unregistered procedure', async () => {
      const mock = new MockDbAdapter();
      await expect(mock.executeProcedure('usp_UnregisteredMockProc', [])).rejects.toThrow(
        ProcedureNotFoundException,
      );
    });
  });
});
