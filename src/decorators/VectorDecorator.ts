import { ModelMetadataRegistry } from '../model/EntityMetadata';
import { SqlType } from '../procedure/SqlType';

export interface VectorOptions {
  name?: string;
  distance?: 'cosine' | 'l2' | 'inner_product';
  nullable?: boolean;
}

/**
 * Property decorator defining an AI vector embedding column (e.g. pgvector, OpenAI, Cohere, Llama).
 * Supports similarity searches with cosine distance (`<=>`), Euclidean/L2 distance (`<->`), and inner product (`<#>`).
 *
 * @param dimensions - Vector dimensionality (e.g. 1536 for OpenAI, 384 for MiniLM, 768 for BERT).
 * @param options - Distance metric and column options.
 * @example
 * ```ts
 * @Vector(1536, { distance: 'cosine' })
 * embedding!: number[];
 * ```
 */
export function Vector(dimensions: number, options?: VectorOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = String(propertyKey);
    const entityConstructor = target.constructor;
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(entityConstructor);

    const existing = metadata.columns.get(propName) || {
      propertyName: propName,
      columnName: options?.name || propName,
    };

    metadata.columns.set(propName, {
      ...existing,
      columnName: options?.name || existing.columnName || propName,
      sqlType: existing.sqlType || SqlType.Text,
      isVector: true,
      dimensions,
      isNullable: options?.nullable ?? existing.isNullable ?? true,
    });
  };
}
