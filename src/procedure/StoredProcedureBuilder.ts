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
 * Simplified result returned by `.output().query()`, `.output().queryMultiple()`, and `.output().run()`.
 *
 * Encapsulates tabular record sets, strongly-typed output/INOUT parameters, integer return codes,
 * and affected row counts across all supported database engines.
 *
 * @typeParam TRecords - Type of records returned in tabular query results (e.g. `User[]` or `[OrderHeader[], OrderItem[]]`).
 * @typeParam TOut - Interface of typed output parameters populated by the procedure (e.g. `{ GeneratedId: number; Status: string }`).
 *
 * @example
 * ```ts
 * // MSSQL / MySQL / PostgreSQL / Oracle:
 * const { records, out, returnValue, rowsAffected } = await ctx
 *   .procedure('usp_ProcessOrder')
 *   .input({ CustomerId: 101, OrderTotal: 299.95 })
 *   .output<{ OrderId: number; TrackingNumber: string }>()
 *   .query<OrderSummary>();
 *
 * console.log('Rows:', records);               // OrderSummary[]
 * console.log('New ID:', out.OrderId);         // number
 * console.log('Tracking:', out.TrackingNumber); // string
 * console.log('Return Code:', returnValue);    // 0 = Success
 * ```
 */
export interface SprocResult<TRecords = void, TOut extends object = Record<string, unknown>> {
  /** Typed record set(s) returned by the procedure SELECT statements. */
  records: TRecords;
  /** Strongly-typed output and INOUT parameter values returned by the database. */
  out: TOut;
  /** Integer return value (SQL Server / MySQL RETURN statement). Defaults to 0. */
  returnValue: number;
  /** Number of rows modified or affected by DML commands executed within the procedure. */
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
 * Provides strongly-typed execution methods (`query`, `queryMultiple`, `reader`, `run`)
 * that return both tabular query results and strongly-typed output parameters.
 *
 * @typeParam TOut - Interface representing expected OUTPUT or INOUT parameters.
 */
export class SprocOutputBuilder<TOut extends object> {
  constructor(
    private readonly builder: StoredProcedureBuilder,
    private readonly outputNames: (keyof TOut)[],
  ) {}

  /**
   * Executes the stored procedure and returns a single tabular record set together with typed OUTPUT parameters.
   *
   * @usecase Ideal for search or report procedures that return matched rows alongside aggregated metrics (e.g. TotalCount, MaxScore).
   *
   * @typeParam TRecord - The type of each row in the returned tabular record set.
   * @returns A Promise resolving to `SprocResult` with `records: TRecord[]` and `out: TOut`.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const { records, out } = await context.procedure('usp_SearchUsers')
   *   .input({ SearchTerm: 'Alice', Page: 1, PageSize: 20 })
   *   .output<{ TotalCount: number }>()
   *   .query<User>();
   * ```
   *
   * **MySQL:**
   * ```ts
   * const { records, out } = await context.procedure('sp_search_users')
   *   .input({ p_search: 'Alice', p_limit: 20 })
   *   .output<{ p_total_count: number }>()
   *   .query<User>();
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * const { records, out } = await context.procedure('fn_search_users')
   *   .input({ search_term: 'Alice' })
   *   .output<{ out_total: number }>()
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
   * Executes the stored procedure and returns multiple tabular record sets alongside typed OUTPUT parameters.
   *
   * @usecase Fetching complex hierarchical or composite datasets (e.g. Order Header + Order Items + Shipping Info) in a single database round-trip.
   *
   * @typeParam T - Tuple defining the types of each returned record set, e.g. `[OrderHeader[], OrderItem[]]`.
   * @returns A Promise resolving to `SprocResult` with `records: T` and `out: TOut`.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const { records: [orders, items], out } = await context.procedure('usp_GetOrderDetails')
   *   .input({ OrderId: 1001 })
   *   .output<{ OrderStatus: string; TotalAmount: number }>()
   *   .queryMultiple<[OrderHeader[], OrderItem[]]>();
   * ```
   *
   * **MySQL:**
   * ```ts
   * const { records: [orders, items], out } = await context.procedure('sp_get_order_details')
   *   .input({ p_order_id: 1001 })
   *   .output<{ p_status: string }>()
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
   * Executes the stored procedure and returns a sequential `MultipleResultsReader` along with typed output parameters.
   *
   * @usecase Consuming multiple tables sequentially using a forward-only reader pattern (similar to Dapper GridReader).
   * @returns A Promise resolving to `MultipleResultsReader<TOut>`.
   *
   * @example
   * ```ts
   * const reader = await context.procedure('usp_GetAnalyticsReport')
   *   .input({ Year: 2026, Quarter: 1 })
   *   .output<{ ReportGeneratedAt: Date }>()
   *   .reader();
   *
   * const summary   = reader.readFirst<RevenueSummary>();
   * const monthly   = reader.read<MonthlyBreakdown>();
   * const topBuyers = reader.read<CustomerRanking>();
   * ```
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
   * Executes the stored procedure with no tabular result set, returning only typed output parameters and return values.
   *
   * @usecase Executing mutating business actions, generating sequential invoice codes, or performing transactional fund transfers.
   * @returns A Promise resolving to `SprocResult<void, TOut>`.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const { out, returnValue } = await context.procedure('usp_CreateInvoice')
   *   .input({ CustomerId: 42, SubTotal: 150.00 })
   *   .output<{ InvoiceNumber: string; GeneratedId: number }>()
   *   .run();
   *
   * console.log('Invoice:', out.InvoiceNumber); // e.g. "INV-2026-0042"
   * console.log('ID:', out.GeneratedId);
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * const { out } = await context.procedure('sp_create_invoice')
   *   .input({ p_customer_id: 42, p_subtotal: 150.00 })
   *   .output<{ p_invoice_no: string; p_new_id: number }>()
   *   .run();
   * ```
   *
   * **MySQL:**
   * ```ts
   * const { out } = await context.procedure('sp_create_invoice')
   *   .input({ customer_id: 42, amount: 150.00 })
   *   .output<{ out_invoice_no: string; out_id: number }>()
   *   .run();
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
 * Fluent builder for configuring and executing database stored procedures and routines across all supported database engines.
 *
 * Supports input/output/inout parameters, automatic SQL data type inference, multiple tabular result sets (GridReader),
 * execution timeouts, transaction binding, and error translation.
 *
 * ### Multi-Database Compatibility
 * - **Microsoft SQL Server (MSSQL)**: Full support for `EXEC`, `@Parameters`, `OUTPUT` params, `RETURN` codes, and multiple SELECT tables.
 * - **MySQL / MariaDB**: Full support for `CALL procedure_name(?, ?)`, `INOUT` and `OUT` parameters, and multiple result sets.
 * - **PostgreSQL**: Support for `CALL sp_name($1, $2)` procedures and `SELECT * FROM fn_name($1, $2)` functions.
 * - **Oracle Database**: Full support for `BEGIN procedure_name(:p1, :p2); END;` and PL/SQL cursors.
 * - **SQLite / LibSQL / Neon / Turso**: Supported via parameterized queries or emulated procedure handlers.
 */
export class StoredProcedureBuilder {
  private readonly params: Map<string, AdapterParam> = new Map();
  private timeoutMs?: number;
  private transaction?: DbTransaction;

  /**
   * Initializes a new instance of the `StoredProcedureBuilder`.
   *
   * @param adapter - The active database adapter.
   * @param procedureName - Name of the stored procedure or function in the database.
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
   * @usecase Fast, clean parameter definition without manual SQL type specification.
   * @param params - Object containing parameter names and values.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * await context.procedure('usp_GetCustomerOrders')
   *   .input({ CustomerId: 42, Status: 'SHIPPED', MinTotal: 50.00 })
   *   .query<Order>();
   * ```
   *
   * **MySQL:**
   * ```ts
   * await context.procedure('sp_get_customer_orders')
   *   .input({ p_customer_id: 42, p_status: 'SHIPPED' })
   *   .query<Order>();
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * await context.procedure('fn_get_customer_orders')
   *   .input({ p_customer_id: 42, p_status: 'SHIPPED' })
   *   .query<Order>();
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
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const { out } = await context.procedure('usp_RegisterAccount')
   *   .input({ Email: 'dev@entityts.org', PasswordHash: '...' })
   *   .output<{ AccountId: number; ActivationToken: string }>()
   *   .run();
   * console.log('Created ID:', out.AccountId);
   * ```
   *
   * **MySQL:**
   * ```ts
   * const { out } = await context.procedure('sp_register_account')
   *   .input({ p_email: 'dev@entityts.org', p_hash: '...' })
   *   .output<{ out_account_id: number; out_token: string }>()
   *   .run();
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * const { out } = await context.procedure('sp_register_account')
   *   .input({ in_email: 'dev@entityts.org', in_hash: '...' })
   *   .output<{ out_account_id: number }>()
   *   .run();
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
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const activeUsers = await context.procedure('usp_GetActiveUsers')
   *   .input({ MinimumPoints: 100 })
   *   .query<User>();
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * const activeUsers = await context.procedure('fn_get_active_users')
   *   .input({ min_points: 100 })
   *   .query<User>();
   * ```
   *
   * **MySQL:**
   * ```ts
   * const activeUsers = await context.procedure('sp_get_active_users')
   *   .input({ min_points: 100 })
   *   .query<User>();
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
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const [customers, orders, stats] = await context.procedure('usp_GetDashboard')
   *   .input({ CustomerId: 101 })
   *   .queryMultiple<[Customer[], Order[], Stat[]]>();
   * ```
   *
   * **MySQL:**
   * ```ts
   * const [customers, orders, stats] = await context.procedure('sp_get_dashboard')
   *   .input({ p_customer_id: 101 })
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
   *
   * @example
   * ```ts
   * const reader = await context.procedure('usp_GetComplexReport')
   *   .input({ CompanyId: 10 })
   *   .reader();
   *
   * const company = reader.readFirst<Company>(); // Table 1
   * const departments = reader.read<Department>(); // Table 2
   * const employees   = reader.read<Employee>();   // Table 3
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
   * @usecase Quick execution for procedures returning counts, IDs, or single computed values.
   * @returns A Promise resolving to the scalar value.
   *
   * @example
   * **SQL Server / MySQL / PostgreSQL:**
   * ```ts
   * const totalRevenue = await context.procedure('usp_CalculateRevenue')
   *   .input({ Year: 2026, Month: 9 })
   *   .scalar<number>();
   * ```
   */
  public async scalar<T = unknown>(): Promise<T> {
    return this.executeScalar<T>();
  }

  /**
   * Executes the stored procedure with no return set (fire-and-forget or DML mutation).
   *
   * @usecase Execute procedures performing maintenance, cleanup, partition rotations, or sending notifications.
   * @returns Object containing `rowsAffected` and `returnValue`.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const { rowsAffected, returnValue } = await context.procedure('usp_PurgeOldSessions')
   *   .input({ OlderThanDays: 30 })
   *   .run();
   * ```
   *
   * **PostgreSQL:**
   * ```ts
   * await context.procedure('sp_purge_old_sessions')
   *   .input({ older_than_days: 30 })
   *   .run();
   * ```
   *
   * **MySQL:**
   * ```ts
   * await context.procedure('sp_purge_old_sessions')
   *   .input({ older_than_days: 30 })
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
   *
   * @example
   * **MSSQL:**
   * ```ts
   * context.procedure('usp_SaveCustomer')
   *   .withParam('CustomerCode', 'CUST-100', SqlType.VarChar, { maxLength: 20 })
   *   .withParam('CreditLimit', 5000.50, SqlType.Decimal, { precision: 18, scale: 2 });
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
   *
   * @example
   * ```ts
   * context.procedure('usp_GenerateTrackingNumber')
   *   .withOutputParam('TrackingNumber', SqlType.NVarChar, { maxLength: 50 });
   * ```
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
   * @usecase Use for procedures that take an initial value and mutate it in place (e.g. inout counter, state flag, or token).
   * @param name - Parameter name.
   * @param value - Initial input value.
   * @param type - Explicit SQL type.
   * @param options - Optional sizing options.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **MySQL / MSSQL / PostgreSQL:**
   * ```ts
   * context.procedure('sp_increment_sequence')
   *   .withInputOutputParam('SequenceVal', 100, SqlType.Int);
   * ```
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
   * @usecase Capture status codes or error return codes returned via SQL Server / MySQL `RETURN` statements.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * **SQL Server (MSSQL):**
   * ```ts
   * const result = await context.procedure('usp_ValidateUser')
   *   .input({ UserId: 10 })
   *   .withReturnValue()
   *   .execute();
   *
   * if (result.returnValue === 0) {
   *   console.log('User is valid');
   * }
   * ```
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
   * @usecase Set higher timeouts for long-running batch or ETL stored procedures, or tight timeouts for interactive APIs.
   * @param ms - Timeout in milliseconds.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * await context.procedure('usp_HeavyMonthlyBatch')
   *   .withTimeout(30000) // 30 seconds
   *   .run();
   * ```
   */
  public withTimeout(ms: number): this {
    this.timeoutMs = ms;
    return this;
  }

  /**
   * Binds the execution of this stored procedure to an active database transaction.
   *
   * @usecase Execute stored procedures as part of a larger multi-step transaction or Unit of Work.
   * @param tx - The active `DbTransaction`.
   * @returns `this` builder instance for chaining.
   *
   * @example
   * ```ts
   * await context.beginBoundedTransaction(async (tx) => {
   *   await context.procedure('usp_DebitAccount')
   *     .input({ AccountId: fromId, Amount: 100 })
   *     .inTransaction(tx)
   *     .run();
   *
   *   await context.procedure('usp_CreditAccount')
   *     .input({ AccountId: toId, Amount: 100 })
   *     .inTransaction(tx)
   *     .run();
   * });
   * ```
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
