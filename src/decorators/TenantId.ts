import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator marking a field as the tenant discriminator identifier.
 *
 * Entities with `@TenantId()` are automatically filtered by `tenantId` in queries (`SELECT`, `UPDATE`, `DELETE`),
 * and automatically populated on `INSERT` from the active context tenant configuration (`ctx.forTenant(id)`).
 *
 * @usecase Multi-tenant SaaS architectures requiring strict tenant data isolation.
 * @param columnName - Optional custom database column name (defaults to property name).
 * @example
 * ```ts
 * @Entity('customers')
 * class Customer {
 *   @TenantId()
 *   tenantId!: string;
 * }
 * ```
 */
export function TenantId(columnName?: string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);
    metadata.tenantIdProperty = propName;

    const colName = columnName || propName;
    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: colName,
    };
    if (columnName) {
      existing.columnName = columnName;
    }
    metadata.columns.set(propName, existing);
  };
}
