import { ModelMetadataRegistry } from '../model/EntityMetadata';

/**
 * Class decorator designating a multi-column composite primary key for an entity.
 *
 * When applied, DDL generation emits a table-level `PRIMARY KEY (col1, col2)` constraint
 * instead of adding `PRIMARY KEY` inline on individual columns. Individual `@PrimaryKey()`
 * decorators on the listed properties should still be present for ORM-level awareness.
 *
 * @param columnNames - The **column** names (not property names) that together form the PK.
 * @usecase Junction tables, order-line items, and any entity without a single surrogate key.
 * @example
 * ```ts
 * @Entity()
 * @Table('order_items')
 * @CompositeKey(['order_id', 'product_id'])
 * export class OrderItem {
 *   @PrimaryKey()
 *   @Column({ name: 'order_id' })
 *   orderId!: number;
 *
 *   @PrimaryKey()
 *   @Column({ name: 'product_id' })
 *   productId!: number;
 *
 *   quantity!: number;
 * }
 * ```
 */
export function CompositeKey(columnNames: string[]): ClassDecorator {
  return (target: Function) => {
    const metadata = ModelMetadataRegistry.getInstance().getOrCreate(target);
    if (!metadata.compositeKeys) {
      metadata.compositeKeys = [];
    }
    metadata.compositeKeys.push(columnNames);
  };
}
