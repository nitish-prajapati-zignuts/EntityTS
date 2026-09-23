import { AdapterParam } from '../adapters/AdapterParam';
import { IDbAdapter } from '../adapters/IDbAdapter';
import { ParameterDirection } from './ParameterDirection';
import { SqlType } from './SqlType';
import { StoredProcedureResult } from './StoredProcedureResult';
import { DbTransaction } from '../transaction/DbTransaction';
import { ProcedureException, DatabaseErrorTranslator } from '../errors';
import { MultipleResultsReader } from './MultipleResultsReader';

export interface ParamOptions {
  maxLength?: number;
  precision?: number;
  scale?: number;
}

// ──────────────────────────────────────────────────────────────
//  Simplified result shape
// ──────────────────────────────────────────────────────────────

/**
 * Simplified result returned by the simplified `.call()` and `.callQuery()` helpers.
 *
 * @example
 * const { records, out, returnValue } = await ctx
 *   .procedure('usp_CreateOrder')
 *   .input({ CustomerId: 1, Total: 99.99 })
 *   .output<{ OrderId: number }>()
 *   .query<OrderRow>();
 *
 * console.log(records);         // OrderRow[]
 * console.log(out.OrderId);     // number (typed)
 */
export interface SprocResult<TRecords = void, TOut extends object = Record<string, unknown>> {
  /** Typed record set(s) returned by the procedure. */
  records: TRecords;
  /** Typed output / INOUT parameters. */
  out: TOut;
  /** Integer return value (SQL Server / MySQL RETURN statement). Defaults to 0. */
  returnValue: number;
  /** Rows affected by DML inside the procedure. */
  rowsAffected: number;
}

// ──────────────────────────────────────────────────────────────
//  Auto SQL-type inference from JS values
// ──────────────────────────────────────────────────────────────

function inferSqlType(value: unknown): SqlType | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return SqlType.NVarChar;
  if (typeof value === 'boolean') return SqlType.Bit;
  if (value instanceof Date) return SqlType.DateTime2;
  if (typeof value === 'bigint') return SqlType.BigInt;
  if (typeof value === 'number') {
    return Number.isInteger(value) ? SqlType.Int : SqlType.Decimal;
  }
  return undefined;
}

// ──────────────────────────────────────────────────────────────
//  Intermediate builder returned after .output<T>()
// ──────────────────────────────────────────────────────────────

/**
 * Intermediate execution builder returned after defining output parameters with `.output<TOut>()`.
 *
 * Provides typed execution methods (`query`, `queryMultiple`, `run`) that bundle both result records and strongly-typed output parameters.
 */
export class SprocOutputBuilder<TOut extends object> {
  constructor(
    private readonly builder: StoredProcedureBuilder,
    private readonly outputNames: (keyof TOut)[],
  ) {}

  /**
   * Executes the procedure and returns a single typed record set plus typed output parameters.
   *
   * @usecase Execute procedures that both return tabular query results and populate OUTPUT parameters.
   * @returns A Promise resolving to `SprocResult` with `records` and `out`.
   * @example
   * ```ts
   * const { records, out } = await context.procedure('usp_SearchUsers')
   *   .input({ Search: 'Alice' })
   *   .output<{ TotalCount: number }>()
   *   .query<User>();
   * ```
   */
  public async query<TRecord = unknown>(): Promise<SprocResult<TRecord[], TOut>> {
    const raw = await this.builder.executeQuery<TRecord>();
    return {
      records: raw.records,
      out: raw.outputParams as TOut,
      returnValue: raw.returnValue,
      rowsAffected: raw.rowsAffected,
    };
  }

  /**
   * Executes the procedure and returns multiple typed record sets plus typed output parameters.
   *
   * @usecase Execute complex procedures returning multiple SELECT results (e.g. Order header and Order items).
   * @returns A Promise resolving to `SprocResult` with tuple of record sets in `records` and `out`.
   * @example
   * ```ts
   * const { records, out } = await context.procedure('usp_GetOrderDetails')
   *   .input({ OrderId: 101 })
   *   .output<{ Status: string }>()
   *   .queryMultiple<[OrderHeader[], OrderItem[]]>();
   * ```
   */
  public async queryMultiple<T extends unknown[]>(): Promise<SprocResult<T, TOut>> {
    const raw = await this.builder.executeMultiple<T>();
    return {
      records: raw.records,
      out: raw.outputParams as TOut,
      returnValue: raw.returnValue,
      rowsAffected: raw.rowsAffected,
    };
  }

  /**
   * Executes the procedure and returns a sequential `MultipleResultsReader` along with typed output parameters.
   */
  public async reader(): Promise<MultipleResultsReader<TOut>> {
    const raw = await this.builder.executeMultiple();
    return new MultipleResultsReader<TOut>(
      (raw.records || []) as unknown[][],
      raw.outputParams as TOut,
      raw.returnValue,
      raw.rowsAffected,
    );
  }

  /**
   * Executes the procedure with no tabular result set, returning only typed output parameters and return values.
   *
   * @usecase Execute action procedures (e.g. creating records, generating sequential invoice numbers) where data is returned via OUTPUT parameters.
   * @returns A Promise resolving to `SprocResult` with `out`, `returnValue`, and `rowsAffected`.
   * @example
   * ```ts
   * const { out } = await context.procedure('usp_CreateInvoice')
   *   .input({ CustomerId: 42, Amount: 150.00 })
   *   .output<{ InvoiceNumber: string; GeneratedId: number }>()
   *   .run();
   * console.log('Created invoice:', out.InvoiceNumber);
   * ```
   */
  public async run(): Promise<SprocResult<void, TOut>> {
    const raw = await this.builder.execute();
    return {
      records: undefined as unknown as void,
      out: raw.outputParams as TOut,
      returnValue: raw.returnValue,
      rowsAffected: raw.rowsAffected,
    };
  }
}

// ──────────────────────────────────────────────────────────────
//  Main builder
// ──────────────────────────────────────────────────────────────

/**
 * Fluent builder for configuring and executing database stored procedures.
 *
 * Supports input/output/inout parameters, automatic SQL type inference, multi-result sets,
 * execution timeouts, and database transaction binding.
 */
export class StoredProcedureBuilder {
  private readonly params: Map<string, AdapterParam> = new Map();
  private timeoutMs?: number;
  private transaction?: DbTransaction;

  /**
   * Initializes a new instance of the `StoredProcedureBuilder`.
   *
   * @param adapter - The active database adapter.
   * @param procedureName - Name of the stored procedure in the database.
   */
  constructor(
    private readonly adapter: IDbAdapter,
    private readonly procedureName: string,
  ) {
    if (!procedureName || !procedureName.trim()) {
      throw new ProcedureException('Stored procedure name cannot be empty.');
    }
  }

  /**
   * Returns the configured name of the stored procedure.
   *
   * @usecase Useful for logging or diagnostic messages.
   */
  public getName(): string {
    return this.procedureName;
  }

  /**
   * Returns an array of configured adapter parameters.
   *
   * @usecase Useful for inspecting bound parameters before execution.
   */
  public getParams(): AdapterParam[] {
    return Array.from(this.params.values());
  }

  // ─────────────────────────────────────────────────────────────
  //  SIMPLIFIED INPUT / OUTPUT API
  // ─────────────────────────────────────────────────────────────

  /**
   * Sets all input parameters at once using a plain key-value object.
   * SQL data types are inferred automatically from JavaScript runtime values:
   * - `string`  → `NVarChar`
   * - `number`  → `Int` (whole) or `Decimal` (fractional)
   * - `boolean` → `Bit`
   * - `Date`    → `DateTime2`
   * - `bigint`  → `BigInt`
   *
   * @usecase Fast, clean parameter definition without manual type enumeration.
   * @param params - Object containing parameter names and values.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * context.procedure('usp_GetOrders').input({ CustomerId: 42, Status: 'active' });
   * ```
   */
  public input(params: Record<string, unknown>): this {
    for (const [key, value] of Object.entries(params)) {
      const cleanName = this.normalizeParamName(key);
      this.params.set(cleanName, {
        name: cleanName,
        value,
        type: inferSqlType(value),
        direction: ParameterDirection.Input,
      });
    }
    return this;
  }

  /**
   * Declares typed output parameters by name and returns an `SprocOutputBuilder`.
   *
   * @usecase Specify procedure OUTPUT parameters with complete TypeScript type safety on the returned `.out` property.
   * @param paramNames - Optional array of parameter names.
   * @returns An `SprocOutputBuilder<TOut>` for executing the query.
   * @example
   * ```ts
   * const { out } = await context.procedure('usp_CreateUser')
   *   .input({ Name: 'Alice', Email: 'alice@example.com' })
   *   .output<{ NewUserId: number; CreatedAt: Date }>()
   *   .run();
   * console.log(out.NewUserId);
   * ```
   */
  public output<TOut extends object = Record<string, unknown>>(
    paramNames?: (keyof TOut)[],
  ): SprocOutputBuilder<TOut> {
    if (paramNames) {
      for (const name of paramNames) {
        const cleanName = this.normalizeParamName(String(name));
        if (!this.params.has(cleanName)) {
          this.params.set(cleanName, {
            name: cleanName,
            type: SqlType.NVarChar,
            direction: ParameterDirection.Output,
          });
        } else {
          // Upgrade an existing param to Output
          const existing = this.params.get(cleanName)!;
          existing.direction = ParameterDirection.Output;
        }
      }
    }
    return new SprocOutputBuilder<TOut>(this, paramNames ?? []);
  }

  // ─────────────────────────────────────────────────────────────
  //  SIMPLE ONE-CALL SHORTCUTS  (no .output() needed)
  // ─────────────────────────────────────────────────────────────

  /**
   * Executes the stored procedure and returns typed records directly as an array.
   * Shorthand for `.executeQuery<T>()` when output parameters are not needed.
   *
   * @usecase Fetch tabular records from a stored procedure in a single clean call.
   * @returns A Promise resolving to an array of typed row objects.
   * @example
   * ```ts
   * const orders = await context.procedure('usp_GetOrders')
   *   .input({ CustomerId: 42 })
   *   .query<Order>();
   * ```
   */
  public async query<T = unknown>(): Promise<T[]> {
    const result = await this.executeQuery<T>();
    return result.records;
  }

  /**
   * Executes the stored procedure and returns multiple typed record sets (tables) directly as a tuple.
   *
   * @usecase Ideal for stored procedures returning multiple tables in a single round-trip without output params.
   * @returns A Promise resolving to a tuple of typed arrays, e.g. `[OrderHeader[], OrderItem[]]`.
   * @example
   * ```ts
   * const [customers, orders, stats] = await context.procedure('usp_GetDashboard')
   *   .input({ CustomerId: 101 })
   *   .queryMultiple<[Customer[], Order[], Stat[]]>();
   * ```
   */
  public async queryMultiple<T extends unknown[] = unknown[]>(): Promise<T> {
    const result = await this.executeMultiple<T>();
    return result.records;
  }

  /**
   * Executes the stored procedure and returns a sequential `MultipleResultsReader` (similar to Dapper's `GridReader`).
   * Allows reading result tables one-by-one with `.read<T>()`.
   *
   * @usecase Useful when consuming multiple tables sequentially or when tables vary by branch logic.
   * @example
   * ```ts
   * const reader = await context.procedure('usp_GetDashboard')
   *   .input({ CustomerId: 101 })
   *   .reader();
   *
   * const customers = reader.read<Customer>(); // Table 1
   * const orders    = reader.read<Order>();    // Table 2
   * const stats     = reader.read<Stat>();     // Table 3
   * ```
   */
  public async reader<TOut = Record<string, unknown>>(): Promise<MultipleResultsReader<TOut>> {
    const result = await this.executeMultiple();
    return new MultipleResultsReader<TOut>(
      (result.records || []) as unknown[][],
      result.outputParams as TOut,
      result.returnValue,
      result.rowsAffected,
    );
  }

  /**
   * Executes the stored procedure and returns a single scalar value from the first column of the first row.
   *
   * @usecase Quick execution for procedures returning counts, IDs, or single values.
   * @returns A Promise resolving to the scalar value.
   * @example
   * ```ts
   * const count = await context.procedure('usp_CountOrders')
   *   .input({ CustomerId: 5 })
   *   .scalar<number>();
   * ```
   */
  public async scalar<T = unknown>(): Promise<T> {
    return this.executeScalar<T>();
  }

  /**
   * Executes the stored procedure with no return set (fire-and-forget or DML mutation).
   *
   * @usecase Execute procedures performing maintenance, cleanup, or sending notifications.
   * @returns Object containing `rowsAffected` and `returnValue`.
   * @example
   * ```ts
   * await context.procedure('usp_PurgeOldSessions')
   *   .input({ OlderThanDays: 30 })
   *   .run();
   * ```
   */
  public async run(): Promise<{ rowsAffected: number; returnValue: number }> {
    const result = await this.execute();
    return { rowsAffected: result.rowsAffected, returnValue: result.returnValue };
  }

  // ─────────────────────────────────────────────────────────────
  //  ADVANCED INPUT/OUTPUT API  (kept for full control)
  // ─────────────────────────────────────────────────────────────

  /**
   * Adds a single input parameter with an explicit SQL type and optional size/precision constraints.
   *
   * @usecase Use this when fine-grained SQL type control (e.g. `VarChar(50)` vs `NVarChar(MAX)`) is required.
   * @param name - Parameter name (leading `@` is automatically handled).
   * @param value - Parameter value.
   * @param type - Optional explicit `SqlType`.
   * @param options - Optional length, precision, or scale options.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * context.procedure('usp_Save')
   *   .withParam('Code', 'ABC', SqlType.VarChar, { maxLength: 10 });
   * ```
   */
  public withParam(name: string, value: unknown, type?: SqlType, options?: ParamOptions): this {
    const cleanName = this.normalizeParamName(name);
    this.params.set(cleanName, {
      name: cleanName,
      value,
      type,
      direction: ParameterDirection.Input,
      ...options,
    });
    return this;
  }

  /**
   * Adds multiple input parameters from a key-value object with auto-inferred types.
   *
   * @deprecated Prefer `.input({ ... })` for simplicity.
   */
  public withParams(params: Record<string, unknown>): this {
    return this.input(params);
  }

  /**
   * Adds an output parameter with an explicit SQL type and sizing options.
   *
   * @usecase Configure output parameters when using the advanced `.execute()` API.
   * @param name - Parameter name.
   * @param type - Explicit SQL type (defaults to `SqlType.VarChar`).
   * @param options - Optional length, precision, or scale.
   * @returns `this` builder instance for chaining.
   */
  public withOutputParam(
    name: string,
    type: SqlType = SqlType.VarChar,
    options?: ParamOptions,
  ): this {
    const cleanName = this.normalizeParamName(name);
    this.params.set(cleanName, {
      name: cleanName,
      type,
      direction: ParameterDirection.Output,
      ...options,
    });
    return this;
  }

  /**
   * Adds a bidirectional input/output (INOUT) parameter.
   *
   * @usecase Use for procedures that take an initial value and mutate it in place (e.g. inout counter or token).
   * @param name - Parameter name.
   * @param value - Initial input value.
   * @param type - Explicit SQL type.
   * @param options - Optional sizing options.
   * @returns `this` builder instance for chaining.
   */
  public withInputOutputParam(
    name: string,
    value: unknown,
    type: SqlType = SqlType.VarChar,
    options?: ParamOptions,
  ): this {
    const cleanName = this.normalizeParamName(name);
    this.params.set(cleanName, {
      name: cleanName,
      value,
      type,
      direction: ParameterDirection.InputOutput,
      ...options,
    });
    return this;
  }

  /**
   * Configures capturing of the procedure's integer return value (`RETURN 0` or `RETURN 1`).
   *
   * @usecase Capture status codes or error return codes returned via SQL Server `RETURN` statements.
   * @returns `this` builder instance for chaining.
   */
  public withReturnValue(): this {
    const returnParamName = '__returnValue';
    this.params.set(returnParamName, {
      name: returnParamName,
      type: SqlType.Int,
      direction: ParameterDirection.ReturnValue,
    });
    return this;
  }

  /**
   * Sets command execution timeout for this stored procedure execution in milliseconds.
   *
   * @usecase Set higher timeouts for long-running batch or ETL stored procedures.
   * @param ms - Timeout in milliseconds.
   * @returns `this` builder instance for chaining.
   */
  public withTimeout(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  /**
   * Binds the execution of this stored procedure to an active database transaction.
   *
   * @usecase Execute stored procedures as part of a larger multi-step transaction.
   * @param tx - The active `DbTransaction`.
   * @returns `this` builder instance for chaining.
   */
  public inTransaction(tx: DbTransaction): this {
    this.transaction = tx;
    return this;
  }

  // ─────────────────────────────────────────────────────────────
  //  CORE EXECUTION METHODS
  // ─────────────────────────────────────────────────────────────

  /**
   * Executes the procedure with no expected record set, returning output params and return value.
   *
   * @usecase Core execution method for action procedures returning output parameters.
   * @returns A Promise resolving to `StoredProcedureResult<void>`.
   */
  public async execute(): Promise<StoredProcedureResult<void>> {
    try {
      const result = await this.adapter.executeProcedure<void>(
        this.procedureName,
        this.getParams(),
        this.timeoutMs,
        this.transaction,
      );
      return {
        records: undefined as unknown as void,
        outputParams: result.outputParams,
        returnValue: result.returnValue,
        rowsAffected: result.rowsAffected,
      };
    } catch (err) {
      throw DatabaseErrorTranslator.translateProcedure(
        err,
        this.procedureName,
        this.adapter.provider,
      );
    }
  }

  /**
   * Executes the procedure and returns a typed list of records along with output parameters and metadata.
   *
   * @usecase Core execution method for procedures returning a single tabular record set.
   * @returns A Promise resolving to `StoredProcedureResult<T[]>`.
   */
  public async executeQuery<T = unknown>(): Promise<StoredProcedureResult<T[]>> {
    try {
      return await this.adapter.executeProcedure<T>(
        this.procedureName,
        this.getParams(),
        this.timeoutMs,
        this.transaction,
      );
    } catch (err) {
      throw DatabaseErrorTranslator.translateProcedure(
        err,
        this.procedureName,
        this.adapter.provider,
      );
    }
  }

  /**
   * Executes the procedure and returns the first column of the first row.
   *
   * @usecase Core execution method for procedures returning a single scalar value.
   * @returns A Promise resolving to the scalar value.
   */
  public async executeScalar<T = unknown>(): Promise<T> {
    const result = await this.executeQuery<Record<string, unknown>>();
    if (!result.records || result.records.length === 0) {
      return null as unknown as T;
    }
    const firstRow = result.records[0];
    const keys = Object.keys(firstRow);
    if (keys.length === 0) {
      return null as unknown as T;
    }
    return firstRow[keys[0]] as T;
  }

  /**
   * Executes the procedure and returns multiple typed record sets.
   *
   * @usecase Core execution method for procedures returning multiple tables in a single call.
   * @returns A Promise resolving to `StoredProcedureResult<T>`.
   */
  public async executeMultiple<T extends unknown[] = unknown[]>(): Promise<
    StoredProcedureResult<T>
  > {
    try {
      return await this.adapter.executeProcedureMultiple<T>(
        this.procedureName,
        this.getParams(),
        this.timeoutMs,
        this.transaction,
      );
    } catch (err) {
      throw DatabaseErrorTranslator.translateProcedure(
        err,
        this.procedureName,
        this.adapter.provider,
      );
    }
  }

  private normalizeParamName(name: string): string {
    return name.startsWith('@') ? name.substring(1) : name;
  }
}
