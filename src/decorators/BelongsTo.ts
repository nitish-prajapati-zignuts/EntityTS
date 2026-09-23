import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface BelongsToOptions {
  foreignKey: string;
  lazy?: boolean;
}

/**
 * Property decorator establishing a child-to-parent inverse relationship.
 *
 * Enables eager loading through `context.set(Child).include('user')` or lazy loading via `LazyRelation`.
 *
 * @usecase Model child-to-parent associations (e.g. Post belongs to User, OrderItem belongs to Order).
 * @param target - Lambda returning the parent entity constructor.
 * @param options - Foreign key property on this child entity pointing to the parent.
 * @example
 * ```ts
 * @BelongsTo(() => User, { foreignKey: 'userId', lazy: true })
 * user?: LazyRelation<User>;
 * ```
 */
export function BelongsTo(target: () => Function, options: BelongsToOptions): PropertyDecorator {
  return (proto: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(proto.constructor);
    metadata.relations.set(propName, {
      propertyName: propName,
      type: 'belongsTo',
      target,
      foreignKey: options.foreignKey,
      lazy: options.lazy,
    });
  };
}
