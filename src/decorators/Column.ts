import { ModelMetadataRegistry } from '../model/EntityMetadata';
import { SqlType } from '../procedure/SqlType';

export interface ColumnOptions {
  name?: string;
  type?: SqlType;
  nullable?: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  defaultValue?: unknown;
}

/**
 * Property decorator mapping a class property to a database table column.
 *
 * Configures database column names, data types, nullability, character limits, precision, and defaults.
 *
 * @usecase Map TypeScript entity fields to database columns with specific constraints and data types.
 * @param options - Column mapping options.
 * @example
 * ```ts
 * @Column({ name: 'email_address', maxLength: 255, nullable: false })
 * email!: string;
 * ```
 */
export function Column(options?: ColumnOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: options?.name || propName,
    };

    metadata.columns.set(propName, {
      ...existing,
      columnName: options?.name || existing.columnName || propName,
      sqlType: options?.type ?? existing.sqlType,
      isNullable: options?.nullable ?? existing.isNullable,
      maxLength: options?.maxLength ?? existing.maxLength,
      precision: options?.precision ?? existing.precision,
      scale: options?.scale ?? existing.scale,
      defaultValue: options?.defaultValue ?? existing.defaultValue,
    });
  };
}
