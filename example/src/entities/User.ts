import {
  Entity,
  Table,
  PrimaryKey,
  Column,
  SoftDelete,
  CreatedAt,
  UpdatedAt,
  HasMany,
  HasOne,
  SqlType,
} from '@nsp/dbcontext';
import { Post } from './Post';
import { Profile } from './Profile';

@Entity()
@Table('users')
@SoftDelete('deleted_at')
export class User {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'name', type: SqlType.VarChar, maxLength: 100 })
  name!: string;

  @Column({ name: 'email', type: SqlType.VarChar, maxLength: 150 })
  email!: string;

  @Column({ name: 'role', type: SqlType.VarChar, maxLength: 50, defaultValue: 'user' })
  role!: string;

  @Column({ name: 'score', type: SqlType.Int, defaultValue: 0 })
  score!: number;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;

  @HasMany(() => Post, { foreignKey: 'user_id' })
  posts?: Post[];

  @HasOne(() => Profile, { foreignKey: 'user_id' })
  profile?: Profile;
}
