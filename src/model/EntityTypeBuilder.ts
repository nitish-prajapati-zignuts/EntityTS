import { EntityMetadata, ColumnMetadata } from './EntityMetadata';
import { PropertyBuilder } from './PropertyBuilder';
import { WhereClause } from '../query/WhereClause';

export type PropertySelector<T, R> = (entity: T) => R;

/**
 * Fluent builder for configuring metadata, table names, primary keys, and properties of an entity.
 */
export class EntityTypeBuilder<T extends object> {
  constructor(private readonly metadata: EntityMetadata) {}

  /**
   * Configures the database table name and schema for this entity.
   *
   * @usecase Map the entity to a specific database table name.
   * @param tableName - Name of the database table.
   * @param schema - Optional database schema name (e.g. `'public'`).
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * b.toTable('users', 'public');
   * ```
   */
  public toTable(tableName: string, schema?: string): this {
    this.metadata.tableName = tableName;
    this.metadata.schema = schema;
    return this;
  }

  /**
   * Designates a property as the primary key of this entity.
   *
   * @usecase Define the primary key property for lookups and joins.
   * @param keySelector - Property accessor lambda or property name.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * b.hasKey(u => u.id);
   * ```
   */
  public hasKey(keySelector: PropertySelector<T, unknown> | keyof T): this {
    const propName = this.extractPropertyName(keySelector);
    if (!this.metadata.primaryKeys.includes(propName)) {
      this.metadata.primaryKeys.push(propName);
    }
    const col = this.getOrCreateColumn(propName);
    col.isPrimaryKey = true;
    return this;
  }

  /**
   * Configures an individual property of the entity.
   *
   * @usecase Customize column names, data types, nullability, or max lengths fluently.
   * @param propSelector - Property accessor lambda or property name.
   * @param configure - Optional callback for setting property options.
   * @returns A `PropertyBuilder` instance.
   * @example
   * ```ts
   * b.property(u => u.email, p => p.hasColumnName('email_addr').isNullable(false));
   * ```
   */
  public property<R>(
    propSelector: PropertySelector<T, R> | keyof T,
    configure?: (builder: PropertyBuilder<T, R>) => void,
  ): PropertyBuilder<T, R> {
    const propName = this.extractPropertyName(propSelector);
    const col = this.getOrCreateColumn(propName);
    const builder = new PropertyBuilder<T, R>(col);
    if (configure) {
      configure(builder);
    }
    return builder;
  }

  /**
   * Ignores a property, excluding it from database mapping and queries.
   *
   * @usecase Exclude non-persisted helper properties.
   * @param propSelector - Property accessor lambda or property name.
   * @returns `this` builder instance for chaining.
   */
  public ignore(propSelector: PropertySelector<T, unknown> | keyof T): this {
    const propName = this.extractPropertyName(propSelector);
    this.metadata.ignoredProperties.add(propName);
    this.metadata.columns.delete(propName);
    return this;
  }

  /**
   * Configures soft deletion for this entity.
   *
   * @usecase Retain records on deletion by populating a timestamp column.
   * @param columnName - Name of the soft delete column (defaults to `'deleted_at'`).
   * @returns `this` builder instance for chaining.
   */
  public hasSoftDelete(columnName: string = 'deleted_at'): this {
    this.metadata.softDelete = { column: columnName };
    return this;
  }

  /**
   * Attaches a global query filter to this entity type (e.g. multi-tenant isolation).
   *
   * @usecase Multi-tenant data filtering or automatic status filtering across all queries on this entity.
   * @param filter - Function receiving a `WhereClause` builder.
   * @returns `this` builder instance for chaining.
   * @example
   * ```ts
   * b.hasQueryFilter(w => w.eq('isArchived', false));
   * ```
   */
  public hasQueryFilter(filter: (clause: WhereClause<T>) => void | WhereClause<T>): this {
    this.metadata.queryFilters.push(filter);
    return this;
  }

  private getOrCreateColumn(propertyName: string): ColumnMetadata {
    let col = this.metadata.columns.get(propertyName);
    if (!col) {
      col = {
        propertyName,
        columnName: propertyName,
      };
      this.metadata.columns.set(propertyName, col);
    }
    return col;
  }

  private extractPropertyName(selector: PropertySelector<T, unknown> | keyof T): string {
    if (typeof selector === 'string') {
      return selector;
    }
    if (typeof selector === 'symbol') {
      return selector.toString();
    }
    // Parse arrow function: (x) => x.prop or function(x) { return x.prop; }
    const fnStr = selector.toString();
    const match = fnStr.match(/(?:=>|\breturn\b)\s*([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)/);
    if (match && match[2]) {
      return match[2];
    }
    // Fallback: proxy inspection
    let accessedProp = '';
    const proxy = new Proxy({} as any, {
      get: (_, prop) => {
        accessedProp = String(prop);
        return undefined;
      },
    });
    try {
      (selector as any)(proxy);
    } catch {
      // Ignore
    }
    if (accessedProp) {
      return accessedProp;
    }
    throw new Error(`Could not determine property name from selector: ${fnStr}`);
  }
}
