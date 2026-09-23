import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface TableOptions {
  schema?: string;
}

/**
 * Class decorator mapping an entity class to a specific database table name and schema.
 *
 * @usecase Explicitly define the database table name and schema rather than defaulting to class name.
 * @param tableName - Name of the table in the database.
 * @param options - Optional table settings (e.g. database schema name).
 * @example
 * ```ts
 * @Table('users', { schema: 'public' })
 * export class User {
 *   @PrimaryKey()
 *   id!: number;
 * }
 * ```
 */
export function Table(tableName: string, options?: TableOptions): ClassDecorator {
  return (target: Function) => {
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target);
    metadata.tableName = tableName;
    if (options?.schema) {
      metadata.schema = options.schema;
    }
  };
}

export interface EntityOptions {
  tableName?: string;
  schema?: string;
}

/**
 * Class decorator marking a TypeScript class as a database entity managed by `DbContext`.
 *
 * @usecase Register a model class for ORM mapping, automated schema generation, and `DbSet` integration.
 * @param options - Optional entity configuration or table name string.
 * @example
 * ```ts
 * @Entity({ tableName: 'orders' })
 * export class Order {
 *   @PrimaryKey()
 *   id!: number;
 * }
 * ```
 */
export function Entity(options?: EntityOptions | string): ClassDecorator {
  return (target: Function) => {
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target);
    if (typeof options === 'string') {
      metadata.tableName = options;
    } else if (options) {
      if (options.tableName) {
        metadata.tableName = options.tableName;
      }
      if (options.schema) {
        metadata.schema = options.schema;
      }
    }
  };
}

/**
 * Class decorator mapping an entity class to a database **VIEW** rather than a table.
 *
 * When applied:
 * - DDL schema generation (`ensureCreated`, `db:push`, migration generation) **skips** this entity.
 * - `DbSet` write operations (`add`, `addRange`, `update`, `remove`) throw a `DbException` at runtime.
 * - `DbSet` read operations (`toList`, `find`, `where`, `count`, etc.) work normally via `SELECT`.
 *
 * @param viewName - The exact name of the database view.
 * @usecase Expose pre-aggregated or joined views as typed, read-only query targets.
 * @example
 * ```ts
 * @ViewEntity('v_active_orders')
 * export class ActiveOrder {
 *   @Column()
 *   id!: number;
 *
 *   @Column()
 *   customerName!: string;
 *
 *   @Column()
 *   total!: number;
 * }
 *
 * // Usage
 * const orders = await ctx.set(ActiveOrder).where(o => o.total > 500).toList();
 * ```
 */
export function ViewEntity(viewName: string): ClassDecorator {
  return (target: Function) => {
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target);
    metadata.tableName = viewName;
    metadata.isView = true;
  };
}
