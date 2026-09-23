import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator designating a database-computed / virtual column.
 *
 * Computed columns are populated by SQL expressions or generated columns in the database.
 * They are automatically excluded from `INSERT` and `UPDATE` queries, but read during `SELECT`.
 *
 * @usecase Map generated columns (e.g. `GENERATED ALWAYS AS`), full-text search tsvectors, or database formula columns.
 * @param expression - Optional SQL expression or description of how the column is computed.
 * @example
 * ```ts
 * @Computed('LOWER(email)')
 * emailLower!: string;
 *
 * @Computed('price * quantity')
 * lineTotal!: number;
 * ```
 */
export function Computed(expression?: string): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: propName,
    };

    existing.isComputed = true;
    if (expression) {
      existing.computedExpression = expression;
    }

    metadata.columns.set(propName, existing);
  };
}
