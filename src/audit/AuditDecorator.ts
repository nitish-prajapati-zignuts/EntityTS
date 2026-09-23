import { AuditMetadataRegistry, AuditOptions } from './AuditMetadata';

/**
 * Class decorator that enables automatic audit changelog tracking for an entity.
 *
 * When `changelog: true` is set, every INSERT, UPDATE, and DELETE executed against
 * this entity via `DbSet` is recorded as a structured row in the `_audit_log` table
 * (or a custom table via the `tableName` option).
 *
 * The audit log row is written within the **same database transaction** as the
 * mutation, ensuring atomicity — there are no orphaned audit entries.
 *
 * @param options - Audit configuration options.
 * @example
 * ```ts
 * @Auditable({ changelog: true })
 * @Table('accounts')
 * export class Account {
 *   @PrimaryKey()
 *   id!: number;
 *
 *   @Column()
 *   balance!: number;
 * }
 * ```
 */
export function Auditable(options: AuditOptions = {}): ClassDecorator {
  return (target: Function) => {
    AuditMetadataRegistry.getInstance().register(target, {
      changelog: options.changelog ?? false,
      tableName: options.tableName ?? '_audit_log',
      includeOld: options.includeOld ?? true,
    });
  };
}
