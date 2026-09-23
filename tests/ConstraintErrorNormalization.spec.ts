import {
  DbContext,
  DbContextOptionsBuilder,
  Table,
  PrimaryKey,
  Column,
  Unique,
  UniqueConstraintViolationException,
  ForeignKeyViolationException,
  CheckConstraintViolationException,
  CannotNullConstraintViolationException,
  DatabaseErrorTranslator,
  QueryException,
  DbException,
} from '../src';

@Table('unique_items')
class UniqueItem {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Unique()
  @Column()
  code!: string;
}

class TestConstraintDbContext extends DbContext {
  public readonly items = this.set(UniqueItem);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:');
  }
}

describe('Cross-Dialect Constraint Error Normalization', () => {
  describe('DatabaseErrorTranslator Unit Translation', () => {
    it('translates PostgreSQL constraint errors (codes 23505, 23503, 23514, 23502)', () => {
      // 23505 - unique_violation
      const pgUnique = {
        code: '23505',
        detail: 'Key (email)=(test@test.com) already exists.',
        constraint: 'users_email_unique',
      };
      const uniqueEx = DatabaseErrorTranslator.translate(pgUnique, 'INSERT ...', 'postgres');
      expect(uniqueEx).toBeInstanceOf(UniqueConstraintViolationException);
      expect(uniqueEx).toBeInstanceOf(QueryException);
      expect(uniqueEx).toBeInstanceOf(DbException);
      expect(uniqueEx.name).toBe('UniqueConstraintViolationException');
      expect((uniqueEx as UniqueConstraintViolationException).constraintName).toBe(
        'users_email_unique',
      );

      // 23503 - foreign_key_violation
      const pgFk = {
        code: '23503',
        detail: 'Key (user_id)=(999) is not present in table "users".',
        constraint: 'fk_orders_user',
      };
      const fkEx = DatabaseErrorTranslator.translate(pgFk, 'INSERT ...', 'postgres');
      expect(fkEx).toBeInstanceOf(ForeignKeyViolationException);
      expect(fkEx.name).toBe('ForeignKeyViolationException');
      expect((fkEx as ForeignKeyViolationException).constraintName).toBe('fk_orders_user');

      // 23514 - check_violation
      const pgCheck = { code: '23514', constraint: 'chk_positive_balance' };
      const checkEx = DatabaseErrorTranslator.translate(pgCheck, 'UPDATE ...', 'postgres');
      expect(checkEx).toBeInstanceOf(CheckConstraintViolationException);
      expect(checkEx.name).toBe('CheckConstraintViolationException');

      // 23502 - not_null_violation
      const pgNull = { code: '23502', column: 'username' };
      const nullEx = DatabaseErrorTranslator.translate(pgNull, 'INSERT ...', 'postgres');
      expect(nullEx).toBeInstanceOf(CannotNullConstraintViolationException);
      expect(nullEx.name).toBe('CannotNullConstraintViolationException');
      expect((nullEx as CannotNullConstraintViolationException).columnName).toBe('username');
    });

    it('translates MySQL constraint errors (errno 1062, 1451/1452, 3819, 1048)', () => {
      // 1062 - ER_DUP_ENTRY
      const myUnique = {
        errno: 1062,
        message: "Duplicate entry 'admin' for key 'users.username_idx'",
      };
      const uniqueEx = DatabaseErrorTranslator.translate(myUnique, 'INSERT ...', 'mysql');
      expect(uniqueEx).toBeInstanceOf(UniqueConstraintViolationException);

      // 1452 - ER_NO_REFERENCED_ROW_2
      const myFk = {
        errno: 1452,
        message: 'Cannot add or update a child row: a foreign key constraint fails',
      };
      const fkEx = DatabaseErrorTranslator.translate(myFk, 'INSERT ...', 'mysql');
      expect(fkEx).toBeInstanceOf(ForeignKeyViolationException);

      // 3819 - ER_CHECK_CONSTRAINT_VIOLATED
      const myCheck = { errno: 3819, message: "Check constraint 'chk_age' is violated." };
      const checkEx = DatabaseErrorTranslator.translate(myCheck, 'INSERT ...', 'mysql');
      expect(checkEx).toBeInstanceOf(CheckConstraintViolationException);

      // 1048 - ER_BAD_NULL_ERROR
      const myNull = { errno: 1048, message: "Column 'email' cannot be null" };
      const nullEx = DatabaseErrorTranslator.translate(myNull, 'INSERT ...', 'mysql');
      expect(nullEx).toBeInstanceOf(CannotNullConstraintViolationException);
    });

    it('translates SQLite constraint errors (SQLITE_CONSTRAINT_*)', () => {
      const sqliteUnique = {
        code: 'SQLITE_CONSTRAINT_UNIQUE',
        message: 'UNIQUE constraint failed: users.email',
      };
      const uniqueEx = DatabaseErrorTranslator.translate(sqliteUnique, 'INSERT ...', 'sqlite');
      expect(uniqueEx).toBeInstanceOf(UniqueConstraintViolationException);

      const sqliteFk = {
        code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
        message: 'FOREIGN KEY constraint failed',
      };
      const fkEx = DatabaseErrorTranslator.translate(sqliteFk, 'INSERT ...', 'sqlite');
      expect(fkEx).toBeInstanceOf(ForeignKeyViolationException);

      const sqliteCheck = { code: 'SQLITE_CONSTRAINT_CHECK', message: 'CHECK constraint failed' };
      const checkEx = DatabaseErrorTranslator.translate(sqliteCheck, 'INSERT ...', 'sqlite');
      expect(checkEx).toBeInstanceOf(CheckConstraintViolationException);

      const sqliteNull = {
        code: 'SQLITE_CONSTRAINT_NOTNULL',
        message: 'NOT NULL constraint failed: users.name',
      };
      const nullEx = DatabaseErrorTranslator.translate(sqliteNull, 'INSERT ...', 'sqlite');
      expect(nullEx).toBeInstanceOf(CannotNullConstraintViolationException);
    });

    it('translates MSSQL constraint errors (numbers 2601/2627, 547, 515)', () => {
      const msUnique = { number: 2627, message: 'Violation of PRIMARY KEY constraint...' };
      const uniqueEx = DatabaseErrorTranslator.translate(msUnique, 'INSERT ...', 'mssql');
      expect(uniqueEx).toBeInstanceOf(UniqueConstraintViolationException);

      const msFk = {
        number: 547,
        message: 'The INSERT statement conflicted with the FOREIGN KEY constraint...',
      };
      const fkEx = DatabaseErrorTranslator.translate(msFk, 'INSERT ...', 'mssql');
      expect(fkEx).toBeInstanceOf(ForeignKeyViolationException);

      const msNull = { number: 515, message: 'Cannot insert the value NULL into column...' };
      const nullEx = DatabaseErrorTranslator.translate(msNull, 'INSERT ...', 'mssql');
      expect(nullEx).toBeInstanceOf(CannotNullConstraintViolationException);
    });

    it('translates Oracle constraint errors (ORA-00001, ORA-02291, ORA-02290, ORA-01400)', () => {
      const oraUnique = new Error('ORA-00001: unique constraint (HR.EMP_EMAIL_UK) violated');
      const uniqueEx = DatabaseErrorTranslator.translate(oraUnique, 'INSERT ...', 'oracle' as any);
      expect(uniqueEx).toBeInstanceOf(UniqueConstraintViolationException);

      const oraFk = new Error(
        'ORA-02291: integrity constraint (HR.EMP_DEPT_FK) violated - parent key not found',
      );
      const fkEx = DatabaseErrorTranslator.translate(oraFk, 'INSERT ...', 'oracle' as any);
      expect(fkEx).toBeInstanceOf(ForeignKeyViolationException);

      const oraCheck = new Error('ORA-02290: check constraint (HR.MIN_SALARY) violated');
      const checkEx = DatabaseErrorTranslator.translate(oraCheck, 'INSERT ...', 'oracle' as any);
      expect(checkEx).toBeInstanceOf(CheckConstraintViolationException);

      const oraNull = new Error(
        'ORA-01400: cannot insert NULL into ("HR"."EMPLOYEES"."LAST_NAME")',
      );
      const nullEx = DatabaseErrorTranslator.translate(oraNull, 'INSERT ...', 'oracle' as any);
      expect(nullEx).toBeInstanceOf(CannotNullConstraintViolationException);
    });

    it('returns generic QueryException for unrecognized database errors', () => {
      const unknownErr = new Error('Some internal unhandled engine fault');
      const res = DatabaseErrorTranslator.translate(unknownErr, 'SELECT * FROM ...', 'postgres');
      expect(res).toBeInstanceOf(QueryException);
      expect(res).not.toBeInstanceOf(UniqueConstraintViolationException);
    });
  });

  describe('Live Database Execution Error Normalization', () => {
    let ctx: TestConstraintDbContext;

    beforeAll(async () => {
      ctx = new TestConstraintDbContext();
      await ctx.ensureCreated();
    });

    afterAll(async () => {
      await ctx.dispose();
    });

    it('translates unique constraint violation on add() into UniqueConstraintViolationException', async () => {
      await ctx.items.add({ code: 'CODE-ALPHA' });

      // Attempting to add duplicate unique code
      await expect(ctx.items.add({ code: 'CODE-ALPHA' })).rejects.toThrow(
        UniqueConstraintViolationException,
      );

      // Confirm catch (e: QueryException) also works due to inheritance
      try {
        await ctx.items.add({ code: 'CODE-ALPHA' });
        fail('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(UniqueConstraintViolationException);
        expect(err).toBeInstanceOf(QueryException);
        expect(err).toBeInstanceOf(DbException);
      }
    });

    it('translates unique constraint violation on update() into UniqueConstraintViolationException', async () => {
      const item2 = await ctx.items.add({ code: 'CODE-BETA' });

      // Attempting to update item2's code to duplicate CODE-ALPHA
      await expect(ctx.items.update(item2.id, { code: 'CODE-ALPHA' })).rejects.toThrow(
        UniqueConstraintViolationException,
      );
    });
  });
});
