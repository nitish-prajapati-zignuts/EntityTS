import { IDbAdapter } from '../adapters/IDbAdapter';
import { DbTransaction } from '../transaction/DbTransaction';
import { AuditMetadataRegistry, AuditLogEntry, AuditOptions } from './AuditMetadata';

/**
 * Engine that builds and persists `AuditLogEntry` rows to the audit changelog table.
 *
 * This class is used internally by `DbSet` — it should not be instantiated directly
 * by application code. All writes occur within the same transaction as the originating
 * mutation, guaranteeing atomicity.
 */
export class AuditEngine {
  /**
   * Returns `true` if the given entity class is decorated with `@Auditable`
   * and has `changelog: true`.
   */
  public static shouldLog(target: Function): boolean {
    const opts = AuditMetadataRegistry.getInstance().get(target);
    return !!(opts?.changelog);
  }

  /**
   * Returns the audit options for the given entity class, or `undefined`.
   */
  public static getOptions(target: Function): AuditOptions | undefined {
    return AuditMetadataRegistry.getInstance().get(target);
  }

  /**
   * Builds an `AuditLogEntry` object without persisting it.
   * Used to preview or buffer audit rows.
   */
  public static buildEntry(
    operation: 'INSERT' | 'UPDATE' | 'DELETE',
    entityName: string,
    entityKey: unknown,
    newSnapshot: Record<string, unknown> | undefined,
    oldSnapshot: Record<string, unknown> | undefined,
    currentUser?: string,
    includeOld = true
  ): AuditLogEntry {
    const entry: AuditLogEntry = {
      entity_name: entityName,
      entity_key: JSON.stringify(entityKey),
      operation,
      changed_by: currentUser ?? null,
      changed_at: new Date(),
    };

    if (operation === 'INSERT' || operation === 'UPDATE') {
      entry.new_values = newSnapshot ? JSON.stringify(newSnapshot) : null;
    }

    if ((operation === 'UPDATE' || operation === 'DELETE') && includeOld) {
      entry.old_values = oldSnapshot ? JSON.stringify(oldSnapshot) : null;
    }

    return entry;
  }

  /**
   * Persists a single `AuditLogEntry` to the audit log table using the
   * provided database adapter and optional transaction.
   *
   * @param entry - The audit log entry to write.
   * @param adapter - The database adapter to execute the INSERT against.
   * @param auditTable - Target table name (defaults to `_audit_log`).
   * @param transaction - Optional active transaction to enlist the INSERT in.
   */
  public static async write(
    entry: AuditLogEntry,
    adapter: IDbAdapter,
    auditTable = '_audit_log',
    transaction?: DbTransaction
  ): Promise<void> {
    try {
      const cols = [
        'entity_name',
        'entity_key',
        'operation',
        'old_values',
        'new_values',
        'changed_by',
        'changed_at',
      ];

      const params: unknown[] = [
        entry.entity_name,
        entry.entity_key,
        entry.operation,
        entry.old_values ?? null,
        entry.new_values ?? null,
        entry.changed_by ?? null,
        entry.changed_at,
      ];

      // Build parameterized INSERT using the adapter's placeholder style
      const placeholders = params.map((_, i) =>
        adapter.formatParameterPlaceholder(`p${i}`, i + 1)
      );

      const escapedTable = adapter.escapeIdentifier(auditTable);
      const escapedCols = cols.map(c => adapter.escapeIdentifier(c)).join(', ');
      const sql = `INSERT INTO ${escapedTable} (${escapedCols}) VALUES (${placeholders.join(', ')})`;

      // Convert to adapter-specific param format
      const adapterParams: any[] = params.map((val, i) => ({
        name: `p${i}`,
        value: val,
      }));

      await adapter.executeNonQuery(sql, adapterParams, transaction);
    } catch {
      // Audit failures must never break the main operation.
      // Silently swallow — implementers can override by subclassing.
    }
  }

  /**
   * Takes a snapshot of an entity's own (non-relation, non-function) properties
   * for storage as `old_values` / `new_values` in the audit log.
   */
  public static snapshot(entity: any): Record<string, unknown> {
    if (!entity || typeof entity !== 'object') return {};
    const snap: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(entity)) {
      if (typeof val === 'function') continue;
      if (Array.isArray(val)) continue;
      if (val !== null && typeof val === 'object' && !(val instanceof Date)) continue;
      snap[key] = val;
    }
    return snap;
  }
}
