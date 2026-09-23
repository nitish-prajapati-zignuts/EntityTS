import {
  Entity,
  Table,
  PrimaryKey,
  Column,
  SoftDelete,
  CreatedAt,
  UpdatedAt,
  BelongsTo,
  HasMany,
  SqlType,
} from 'entityts';
import { User } from './User';
import { Comment } from './Comment';

@Entity()
@Table('posts')
@SoftDelete('deleted_at')
export class Post {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'user_id', type: SqlType.Int })
  userId!: number;

  @Column({ name: 'title', type: SqlType.VarChar, maxLength: 200 })
  title!: string;

  @Column({ name: 'content', type: SqlType.Text })
  content!: string;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;

  @BelongsTo(() => User, { foreignKey: 'user_id' })
  user?: User;

  @HasMany(() => Comment, { foreignKey: 'post_id' })
  comments?: Comment[];
}
