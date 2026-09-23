import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface HasOneOptions {
  foreignKey: string;
  lazy?: boolean;
}

/**
 * Property decorator establishing a one-to-one parent relationship with another entity.
 *
 * Enables eager loading through `context.set(Parent).include('profile')` or lazy loading via `LazyRelation`.
 *
 * @usecase Model one-to-one associations (e.g. User has one Profile, Order has one Invoice).
 * @param target - Lambda returning the child entity constructor.
 * @param options - Foreign key property on the child entity pointing to this parent, or options object.
 * @example
 * ```ts
 * @HasOne(() => Profile, { foreignKey: 'userId', lazy: true })
 * profile?: LazyRelation<Profile>;
 * ```
 */
export function HasOne(target: () => Function, options: HasOneOptions | string): PropertyDecorator {
  return (proto: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const foreignKey = typeof options === 'string' ? options : options.foreignKey;
    const lazy = typeof options === 'object' ? options.lazy : undefined;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(proto.constructor);
    metadata.relations.set(propName, {
      propertyName: propName,
      type: 'hasOne',
      target,
      foreignKey,
      lazy,
    });
  };
}
