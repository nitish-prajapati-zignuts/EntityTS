/**
 * Options for the `@Auditable` class decorator.
 */
export interface AuditOptions {
  /**
   * When `true`, every INSERT, UPDATE, and DELETE on this entity is written
   * as a row in the `_audit_log` table (or the custom `tableName` below).
   * @default false
   */
  changelog?: boolean;

  /**
   * Override the target audit log table name.
   * @default '_audit_log'
   */
  tableName?: string;

  /**
   * When `true`, the `oldValues` snapshot is captured before UPDATE/DELETE.
   * @default true
   */
  includeOld?: boolean;
}

/**
 * A single row written to the audit changelog table for every tracked mutation.
 */
export interface AuditLogEntry {
  /** Auto-incremented primary key (populated after insert). */
  id?: number;
  /** The entity/table name being audited (e.g. `'Account'`). */
  entity_name: string;
  /** JSON-serialized primary key of the affected row. */
  entity_key: string;
  /** The type of database operation performed. */
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  /** Snapshot of field values before the mutation (UPDATE / DELETE only). */
  old_values?: string | null;
  /** Snapshot of field values after the mutation (INSERT / UPDATE only). */
  new_values?: string | null;
  /** `context.currentUser` at the time of the mutation. */
  changed_by?: string | null;
  /** Timestamp of the mutation (UTC). */
  changed_at: Date;
}

/**
 * Internal registry mapping entity constructors to their `AuditOptions`.
 * Populated by the `@Auditable` class decorator at decoration-time.
 */
export class AuditMetadataRegistry {
  private static instance: AuditMetadataRegistry;
  private readonly registry = new Map<Function, AuditOptions>();

  private constructor() {}

  public static getInstance(): AuditMetadataRegistry {
    if (!AuditMetadataRegistry.instance) {
      AuditMetadataRegistry.instance = new AuditMetadataRegistry();
    }
    return AuditMetadataRegistry.instance;
  }

  /** Registers audit options for an entity class. */
  public register(target: Function, options: AuditOptions): void {
    this.registry.set(target, options);
  }

  /** Returns audit options for an entity class, or `undefined` if not auditable. */
  public get(target: Function): AuditOptions | undefined {
    return this.registry.get(target);
  }

  /** Returns `true` if the entity class has been decorated with `@Auditable`. */
  public isAuditable(target: Function): boolean {
    return this.registry.has(target);
  }

  /** Clears all registered entries. Used in tests. */
  public clear(): void {
    this.registry.clear();
  }
}
