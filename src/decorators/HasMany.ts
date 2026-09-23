import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface HasManyOptions {
  foreignKey: string;
  lazy?: boolean;
}

/**
 * Property decorator establishing a one-to-many relationship with another entity.
 *
 * Enables eager loading through `context.set(Parent).include('children')` or lazy loading via `LazyRelation`.
 *
 * @usecase Model one-to-many associations (e.g. User has many Posts, Order has many Items).
 * @param target - Lambda returning the child entity constructor.
 * @param options - Foreign key property on the child entity pointing to this parent, or options object.
 * @example
 * ```ts
 * @HasMany(() => Post, { foreignKey: 'userId', lazy: true })
 * posts!: LazyRelation<Post[]>;
 * ```
 */
export function HasMany(target: () => Function, options: HasManyOptions | string): PropertyDecorator {
  return (proto: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const foreignKey = typeof options === 'string' ? options : options.foreignKey;
    const lazy = typeof options === 'object' ? options.lazy : undefined;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(proto.constructor);
    metadata.relations.set(propName, {
      propertyName: propName,
      type: 'hasMany',
      target,
      foreignKey,
      lazy,
    });
  };
}
