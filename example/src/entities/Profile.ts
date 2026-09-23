import {
  Entity,
  Table,
  PrimaryKey,
  Column,
  BelongsTo,
  SqlType,
} from '@nsp/dbcontext';
import { User } from './User';

@Entity()
@Table('profiles')
export class Profile {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'user_id', type: SqlType.Int })
  userId!: number;

  @Column({ name: 'bio', type: SqlType.VarChar, maxLength: 255 })
  bio!: string;

  @Column({ name: 'website', type: SqlType.VarChar, maxLength: 100, nullable: true })
  website?: string;

  @BelongsTo(() => User, { foreignKey: 'user_id' })
  user?: User;
}
