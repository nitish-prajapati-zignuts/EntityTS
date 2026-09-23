export class DbException extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DbException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionException extends DbException {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ConnectionException';
  }
}

export class ProcedureException extends DbException {
  constructor(
    message: string,
    public readonly procedureName?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'ProcedureException';
  }
}

export class QueryException extends DbException {
  constructor(
    message: string,
    public readonly sql?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'QueryException';
  }
}

export class EntityNotFoundException extends DbException {
  constructor(entityName: string, criteria?: unknown) {
    const details = criteria ? ` with criteria: ${JSON.stringify(criteria)}` : '';
    super(`Entity '${entityName}' was not found${details}.`);
    this.name = 'EntityNotFoundException';
  }
}

export class DbUpdateConcurrencyException extends DbException {
  constructor(
    message = 'Database operation expected to affect 1 row, but affected 0 rows due to a concurrency conflict.',
    public readonly entityName?: string,
    public readonly entityKey?: unknown,
  ) {
    super(message);
    this.name = 'DbUpdateConcurrencyException';
  }
}

export class IdempotencyConflictException extends DbException {
  constructor(
    public readonly key: string,
    message = `Idempotency conflict: A request with key '${key}' is currently in progress or encountered a concurrent lock.`,
  ) {
    super(message);
    this.name = 'IdempotencyConflictException';
  }
}

export class UnbalancedLedgerException extends DbException {
  constructor(
    public readonly totalDebits: string,
    public readonly totalCredits: string,
    message = `Unbalanced ledger transaction: Total debits (${totalDebits}) must equal total credits (${totalCredits}).`,
  ) {
    super(message);
    this.name = 'UnbalancedLedgerException';
  }
}

export class EntityValidationException extends DbException {
  constructor(
    public readonly entityName: string,
    public readonly errors: Record<string, string[]>,
  ) {
    const summary = Object.entries(errors)
      .map(([field, msgs]) => `${field}: ${msgs.join(', ')}`)
      .join('; ');
    super(`Validation failed for entity '${entityName}': ${summary}`);
    this.name = 'EntityValidationException';
  }
}

export class UniqueConstraintViolationException extends QueryException {
  constructor(
    message: string,
    public readonly constraintName?: string,
    public readonly columnName?: string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'UniqueConstraintViolationException';
  }
}

export class ForeignKeyViolationException extends QueryException {
  constructor(
    message: string,
    public readonly constraintName?: string,
    public readonly foreignKey?: string,
    public readonly targetTable?: string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'ForeignKeyViolationException';
  }
}

export class CheckConstraintViolationException extends QueryException {
  constructor(
    message: string,
    public readonly constraintName?: string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'CheckConstraintViolationException';
  }
}

export class CannotNullConstraintViolationException extends QueryException {
  constructor(
    message: string,
    public readonly columnName?: string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'CannotNullConstraintViolationException';
  }
}

export class SqlSyntaxErrorException extends QueryException {
  constructor(
    message: string,
    public readonly position?: number | string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'SqlSyntaxErrorException';
  }
}

export class TableNotFoundException extends QueryException {
  constructor(
    message: string,
    public readonly tableName?: string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'TableNotFoundException';
  }
}

export class ColumnNotFoundException extends QueryException {
  constructor(
    message: string,
    public readonly columnName?: string,
    public readonly tableName?: string,
    sql?: string,
    cause?: unknown,
  ) {
    super(message, sql, cause);
    this.name = 'ColumnNotFoundException';
  }
}

export class ProcedureNotFoundException extends ProcedureException {
  constructor(
    message: string,
    public readonly procedureName: string,
    cause?: unknown,
  ) {
    super(message, procedureName, cause);
    this.name = 'ProcedureNotFoundException';
  }
}

export * from './DatabaseErrorTranslator';
