import { Entity, Table, PrimaryKey, Column, Vector, CreatedAt, UpdatedAt, SqlType } from 'entityts';

@Entity()
@Table('documents')
export class Document {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'title', type: SqlType.VarChar, maxLength: 200 })
  title!: string;

  @Column({ name: 'content', type: SqlType.Text })
  content!: string;

  @Column({ name: 'category', type: SqlType.VarChar, maxLength: 50 })
  category!: string;

  @Column({ name: 'embedding', type: SqlType.Text })
  @Vector(1536)
  embedding!: number[];

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;
}
