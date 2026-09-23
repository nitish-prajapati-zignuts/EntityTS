/**
 * Forward-only reader for stored procedures that return multiple tabular result sets (tables).
 * Modeled after Dapper's `GridReader` and ADO.NET `SqlDataReader.NextResult()`.
 *
 * @usecase Sequentially consume multiple result tables returned by a single stored procedure execution.
 * @example
 * ```ts
 * const reader = await context.procedure('usp_GetCustomerDashboard')
 *   .input({ CustomerId: 101 })
 *   .reader();
 *
 * const customer = reader.readFirst<Customer>(); // First row of Table 1
 * const orders   = reader.read<Order>();         // All rows of Table 2
 * const stats    = reader.read<Stat>();          // All rows of Table 3
 * ```
 */
export class MultipleResultsReader<TOut = Record<string, unknown>> {
  private currentIndex = 0;

  constructor(
    private readonly resultSets: unknown[][],
    public readonly outputParams: TOut = {} as TOut,
    public readonly returnValue: number = 0,
    public readonly rowsAffected: number = 0,
  ) {}

  /**
   * Reads the next table / record set as typed records.
   * If no more tables exist, returns an empty array `[]`.
   *
   * @typeParam T - Type representing each row in this table.
   * @returns Array of typed rows from the current result table.
   */
  public read<T = unknown>(): T[] {
    if (this.currentIndex >= this.resultSets.length) {
      return [];
    }
    const current = this.resultSets[this.currentIndex++];
    return (current || []) as T[];
  }

  /**
   * Reads a single record (the first row) from the next table, or returns `null` if the table is empty.
   *
   * @typeParam T - Type representing the record.
   * @returns The first matching record or `null`.
   */
  public readFirst<T = unknown>(): T | null {
    const list = this.read<T>();
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Returns all returned tables as a tuple or array of arrays without consuming the reader.
   *
   * @typeParam T - Tuple of table arrays, e.g. `[Customer[], Order[], Stat[]]`.
   */
  public readAll<T extends unknown[] = unknown[]>(): T {
    return this.resultSets as unknown as T;
  }

  /**
   * Total number of tables / result sets returned by the procedure.
   */
  public get tableCount(): number {
    return this.resultSets.length;
  }

  /**
   * True if there are more unread tables remaining.
   */
  public get hasMore(): boolean {
    return this.currentIndex < this.resultSets.length;
  }

  /**
   * The 0-based index of the table that will be read on the next `.read()` call.
   */
  public get position(): number {
    return this.currentIndex;
  }
}
