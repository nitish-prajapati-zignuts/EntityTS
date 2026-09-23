import { IsolationLevel } from './IsolationLevel';
import { DbException } from '../errors';

export interface IDbTransactionDriver {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint?(name: string): Promise<void>;
  rollbackTo?(name: string): Promise<void>;
  [key: string]: any;
}

/**
 * Encapsulates an active database transaction.
 *
 * Provides methods to commit, rollback, and manage nested savepoints across different database providers.
 */
export class DbTransaction {
  private _isCompleted = false;

  /**
   * Initializes a new transaction instance wrapping a database driver transaction.
   *
   * @param driver - Low-level transaction driver (e.g. SQLite, PostgreSQL client, MSSQL transaction).
   * @param isolationLevel - Isolation level for this transaction.
   */
  constructor(
    private readonly driver: IDbTransactionDriver,
    public readonly isolationLevel: IsolationLevel = IsolationLevel.ReadCommitted
  ) {}

  /**
   * Indicates whether this transaction has already been committed or rolled back.
   *
   * @usecase Check if transaction is still active before attempting further operations.
   */
  public get isCompleted(): boolean {
    return this._isCompleted;
  }

  /**
   * Commits all database changes made during this transaction permanently.
   *
   * @usecase Finalize a successful unit-of-work batch of mutations.
   * @throws `DbException` if the transaction is already finalized.
   * @example
   * ```ts
   * await tx.commit();
   * ```
   */
  public async commit(): Promise<void> {
    if (this._isCompleted) {
      throw new DbException('Transaction has already been committed or rolled back.');
    }
    await this.driver.commit();
    this._isCompleted = true;
  }

  /**
   * Rolls back and discards all changes made during this transaction.
   *
   * @usecase Revert partial mutations when an error or validation failure occurs.
   * @example
   * ```ts
   * await tx.rollback();
   * ```
   */
  public async rollback(): Promise<void> {
    if (this._isCompleted) {
      return; // Idempotent or already finalized
    }
    await this.driver.rollback();
    this._isCompleted = true;
  }

  /**
   * Creates a named transaction savepoint within the active transaction.
   *
   * @usecase Create intermediate checkpoints to roll back partial operations without aborting the entire transaction.
   * @param name - Identifier for the savepoint.
   * @example
   * ```ts
   * await tx.savepoint('step1');
   * ```
   */
  public async savepoint(name: string): Promise<void> {
    if (this._isCompleted) {
      throw new DbException('Cannot create savepoint on a completed transaction.');
    }
    if (this.driver.savepoint) {
      await this.driver.savepoint(name);
    } else {
      throw new DbException('Savepoints are not supported by the underlying database provider.');
    }
  }

  /**
   * Rolls back transaction state to a previously created named savepoint.
   *
   * @usecase Revert operations performed after a specific savepoint while keeping earlier operations intact.
   * @param name - Identifier of the savepoint to restore.
   * @example
   * ```ts
   * await tx.rollbackTo('step1');
   * ```
   */
  public async rollbackTo(name: string): Promise<void> {
    if (this._isCompleted) {
      throw new DbException('Cannot rollback to savepoint on a completed transaction.');
    }
    if (this.driver.rollbackTo) {
      await this.driver.rollbackTo(name);
    } else {
      throw new DbException('Savepoints are not supported by the underlying database provider.');
    }
  }

  /**
   * Returns the underlying driver transaction instance (e.g. pg.PoolClient, mssql.Transaction).
   *
   * @usecase Access provider-specific raw transaction objects when needed.
   * @returns The underlying driver instance.
   */
  public getDriver<T = IDbTransactionDriver>(): T {
    return this.driver as T;
  }
}
