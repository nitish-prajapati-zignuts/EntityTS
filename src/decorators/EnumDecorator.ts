import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator restricting a column's value to a specific set of allowed enum strings.
 *
 * DDL generation behaviour per provider:
 * - **MySQL / PlanetScale**: native `ENUM('val1', 'val2')` column type.
 * - **PostgreSQL / Neon / CockroachDB / Supabase**: `VARCHAR(N) CHECK (col IN ('val1', 'val2'))`.
 * - **SQLite / Turso / D1**: `TEXT CHECK (col IN ('val1', 'val2'))`.
 * - **MSSQL**: `NVARCHAR(N)` + column-level `CHECK` constraint.
 *
 * The TypeScript property type should be a string union matching the allowed values.
 *
 * @param values - The exhaustive list of allowed enum string values.
 * @usecase Status columns, type discriminators, or constrained category fields.
 * @example
 * ```ts
 * @Enum(['active', 'inactive', 'suspended'])
 * status!: 'active' | 'inactive' | 'suspended';
 * ```
 */
export function Enum(values: string[]): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: propName,
    };

    metadata.columns.set(propName, {
      ...existing,
      enumValues: values,
    });
  };
}
