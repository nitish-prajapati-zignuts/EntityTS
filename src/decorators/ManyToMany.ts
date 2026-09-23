import { ModelMetadataRegistry } from '../model/EntityMetadata';

export interface ManyToManyOptions {
  through: string;
  foreignKey?: string;
  otherKey?: string;
}

/**
 * Property decorator establishing a many-to-many relationship joined via a junction table.
 *
 * @usecase Model many-to-many associations (e.g. Students and Courses via StudentCourses junction table).
 * @param target - Lambda returning the target related entity constructor.
 * @param options - Junction table name (`through`), primary foreign key, and other foreign key.
 * @example
 * ```ts
 * @ManyToMany(() => Tag, { through: 'post_tags', foreignKey: 'postId', otherKey: 'tagId' })
 * tags!: Tag[];
 * ```
 */
export function ManyToMany(target: () => Function, options: ManyToManyOptions): PropertyDecorator {
  return (proto: Object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(proto.constructor);
    metadata.relations.set(propName, {
      propertyName: propName,
      type: 'manyToMany',
      target,
      through: options.through,
      foreignKey: options.foreignKey || 'id',
      otherKey: options.otherKey,
    });
  };
}
