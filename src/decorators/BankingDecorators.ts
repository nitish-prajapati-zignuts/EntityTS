import { ModelMetadataRegistry } from '../model/EntityMetadata';
import { SqlType } from '../procedure/SqlType';

export interface DecimalOptions {
  name?: string;
  precision?: number;
  scale?: number;
  nullable?: boolean;
  defaultValue?: unknown;
}

/**
 * Property decorator defining a high-precision decimal database column.
 * Typically maps to SQL DECIMAL(precision, scale) or NUMERIC(precision, scale).
 * Default precision is 18 and scale is 4, matching institutional banking standards.
 *
 * @param options - Decimal precision and scale options.
 * @example
 * ```ts
 * @Decimal({ precision: 18, scale: 4 })
 * balance!: Money;
 * ```
 */
export function Decimal(options?: DecimalOptions): PropertyDecorator {
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
      sqlType: SqlType.Decimal,
      precision: options?.precision ?? 18,
      scale: options?.scale ?? 4,
      isNullable: options?.nullable ?? existing.isNullable,
      defaultValue: options?.defaultValue ?? existing.defaultValue,
    });
  };
}

export interface CurrencyOptions {
  name?: string;
  defaultCurrency?: string;
  nullable?: boolean;
}

/**
 * Property decorator defining an ISO 4217 3-character currency code column (e.g. 'USD', 'EUR', 'GBP').
 *
 * @param options - Currency configuration options.
 * @example
 * ```ts
 * @Currency({ defaultCurrency: 'USD' })
 * currency!: string;
 * ```
 */
export function Currency(options?: CurrencyOptions): PropertyDecorator {
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
      sqlType: SqlType.VarChar,
      maxLength: 3,
      isNullable: options?.nullable ?? existing.isNullable,
      defaultValue: options?.defaultCurrency ?? 'USD',
    });
  };
}
