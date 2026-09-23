import {
  Entity,
  Table,
  PrimaryKey,
  Column,
  CreatedAt,
  SqlType,
} from '@nsp/dbcontext';

@Entity()
@Table('audit_logs')
export class AuditLog {
  @PrimaryKey({ autoIncrement: true })
  @Column({ type: SqlType.Int })
  id!: number;

  @Column({ name: 'action', type: SqlType.VarChar, maxLength: 50 })
  action!: string;

  @Column({ name: 'entity_name', type: SqlType.VarChar, maxLength: 50 })
  entityName!: string;

  @Column({ name: 'entity_id', type: SqlType.Int, nullable: true })
  entityId?: number;

  @Column({ name: 'details', type: SqlType.Text })
  details!: string;

  @CreatedAt()
  createdAt!: Date;
}
