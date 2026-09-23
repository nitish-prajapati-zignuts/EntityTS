import {
  Entity,
  Table,
  PrimaryKey,
  Column,
  Version,
  CreatedAt,
  UpdatedAt,
  SqlType,
} from 'entityts';

@Entity()
@Table('products')
export class Product {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'sku', type: SqlType.VarChar, maxLength: 50 })
  sku!: string;

  @Column({ name: 'name', type: SqlType.VarChar, maxLength: 150 })
  name!: string;

  @Column({ name: 'category', type: SqlType.VarChar, maxLength: 50 })
  category!: string;

  @Column({ name: 'price', type: SqlType.Decimal })
  price!: number;

  @Column({ name: 'stock', type: SqlType.Int, defaultValue: 0 })
  stock!: number;

  @Column({ name: 'version', type: SqlType.Int, defaultValue: 1 })
  @Version({ strategy: 'number' })
  version!: number;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;
}
