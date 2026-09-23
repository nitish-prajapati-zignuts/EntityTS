import { ModelMetadataRegistry, EntityMetadata } from './EntityMetadata';
import { EntityTypeBuilder } from './EntityTypeBuilder';

export type EntityConstructor<T extends object = object> = new (...args: any[]) => T;

/**
 * Fluent model configuration builder used in `DbContext.onModelCreating(modelBuilder)`.
 *
 * Allows defining entity schemas, table names, keys, column mappings, and relationships without using decorators.
 */
export class ModelBuilder {
  private readonly registry = ModelMetadataRegistry.getInstance();

  /**
   * Configures an entity type's schema, table name, keys, and properties.
   *
   * @usecase Fluent entity mapping in `onModelCreating` without polluting domain models with decorators.
   * @param entityType - Entity class constructor.
   * @param configure - Optional callback receiving the `EntityTypeBuilder<T>`.
   * @returns The `EntityTypeBuilder<T>` instance for chaining.
   * @example
   * ```ts
   * modelBuilder.entity(User, b => {
   *   b.toTable('app_users');
   *   b.hasKey(u => u.id);
   * });
   * ```
   */
  public entity<T extends object>(
    entityType: EntityConstructor<T>,
    configure?: (builder: EntityTypeBuilder<T>) => void
  ): EntityTypeBuilder<T> {
    const metadata = this.registry.getOrCreate(entityType);
    const builder = new EntityTypeBuilder<T>(metadata);
    if (configure) {
      configure(builder);
    }
    return builder;
  }

  /**
   * Returns registered model metadata for an entity type if configured.
   *
   * @param entityType - Entity constructor.
   * @returns Entity metadata or `undefined`.
   */
  public getMetadata(entityType: Function): EntityMetadata | undefined {
    return this.registry.get(entityType);
  }
}
