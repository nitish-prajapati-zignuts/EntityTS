import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface PrimaryKeyOptions {
  autoIncrement?: boolean;
}

/**
 * Property decorator designating a property as the primary key of the entity.
 *
 * @usecase Designate unique record identifiers for `find()`, `update()`, `remove()`, and relation joins.
 * @param options - Configuration options such as `autoIncrement`.
 * @example
 * ```ts
 * @PrimaryKey({ autoIncrement: true })
 * id!: number;
 * ```
 */
export function PrimaryKey(options?: PrimaryKeyOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    if (!metadata.primaryKeys.includes(propName)) {
      metadata.primaryKeys.push(propName);
    }

    const col = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: propName,
    };
    col.isPrimaryKey = true;
    if (options?.autoIncrement !== undefined) {
      col.isAutoIncrement = options.autoIncrement;
    }
    metadata.columns.set(propName, col);
  };
}

export interface ForeignKeyOptions {
  name?: string;
  referencedColumn?: string;
}

/**
 * Property decorator defining an explicit foreign key column referencing another entity.
 *
 * @usecase Link relational child entities to their parent entity tables.
 * @param referencedEntity - Lambda returning the referenced parent entity class.
 * @param options - Column naming and referenced column settings.
 * @example
 * ```ts
 * @ForeignKey(() => User)
 * userId!: number;
 * ```
 */
export function ForeignKey(
  referencedEntity: () => Function,
  options?: ForeignKeyOptions,
): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    const col = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: options?.name || propName,
    };
    metadata.columns.set(propName, col);
  };
}

/**
 * Property decorator telling the ORM to completely ignore this property during database operations.
 *
 * @usecase Exclude calculated/computed fields, client state, or transient helper properties from SQL queries and persistence.
 * @example
 * ```ts
 * @Ignore()
 * temporaryToken?: string;
 * ```
 */
export function Ignore(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    metadata.ignoredProperties.add(propName);
    metadata.columns.delete(propName);
  };
}
