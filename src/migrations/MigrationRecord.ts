export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: Date;
  batch: number;
}
