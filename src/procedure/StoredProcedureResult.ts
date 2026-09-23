export interface StoredProcedureResult<T = unknown> {
  /**
   * The primary record set or array of record sets returned by the procedure.
   */
  records: T;

  /**
   * Key-value map of named OUTPUT / INOUT parameters.
   */
  outputParams: Record<string, unknown>;

  /**
   * The integer return value of the procedure (commonly supported in SQL Server / Sybase).
   * Defaults to 0 if not supported or not set.
   */
  returnValue: number;

  /**
   * Total number of rows affected by modifications in the procedure.
   */
  rowsAffected: number;
}
