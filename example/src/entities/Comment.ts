import { Entity, Table, PrimaryKey, Column, CreatedAt, BelongsTo, SqlType } from 'entityts';
import { Post } from './Post';

@Entity()
@Table('comments')
export class Comment {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'post_id', type: SqlType.Int })
  postId!: number;

  @Column({ name: 'author', type: SqlType.VarChar, maxLength: 100 })
  author!: string;

  @Column({ name: 'text', type: SqlType.Text })
  text!: string;

  @CreatedAt()
  createdAt!: Date;

  @BelongsTo(() => Post, { foreignKey: 'post_id' })
  post?: Post;
}
