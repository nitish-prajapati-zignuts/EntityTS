import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Property decorator designating a default value or generator function for an entity property.
 *
 * The default is applied automatically when inserting new records if the property is `undefined`,
 * and is emitted into table definitions during Code-First schema generation (`ensureCreated()`).
 *
 * @usecase Auto-populate defaults such as active flags, initial counters, or timestamp generators.
 * @param value - Literal value or a generator function (e.g. `() => new Date()`, `() => uuid()`).
 * @example
 * ```ts
 * @Default('active')
 * status!: string;
 *
 * @Default(0)
 * points!: number;
 *
 * @Default(() => new Date())
 * createdAt!: Date;
 * ```
 */
export function Default(value: unknown | (() => unknown)): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target.constructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: propName,
    };

    existing.defaultValue = value;
    metadata.columns.set(propName, existing);
  };
}
