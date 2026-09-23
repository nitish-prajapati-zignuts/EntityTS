import { IDbAdapter } from '../adapters/IDbAdapter';
import { MigrationBuilder } from './MigrationBuilder';
import { MigrationRecord } from './MigrationRecord';

export interface MigrationModule {
  id: string;
  name: string;
  up: (schema: MigrationBuilder) => Promise<void> | void;
  down: (schema: MigrationBuilder) => Promise<void> | void;
}

export class MigrationRunner {
  private readonly tableName = '__nsp_migrations';

  constructor(private readonly adapter: IDbAdapter) {}

  public async ensureMigrationsTable(): Promise<void> {
    const table = this.adapter.escapeIdentifier(this.tableName);
    const sql = `CREATE TABLE IF NOT EXISTS ${table} (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      batch INT NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
    await this.adapter.executeNonQuery(sql);
  }

  public async getAppliedMigrations(): Promise<MigrationRecord[]> {
    await this.ensureMigrationsTable();
    const table = this.adapter.escapeIdentifier(this.tableName);
    const sql = `SELECT id, name, batch, applied_at as appliedAt FROM ${table} ORDER BY batch ASC, applied_at ASC;`;
    return this.adapter.executeQuery<MigrationRecord>(sql);
  }

  public async up(migrations: MigrationModule[]): Promise<{ applied: string[] }> {
    await this.ensureMigrationsTable();
    const appliedRecords = await this.getAppliedMigrations();
    const appliedIds = new Set(appliedRecords.map(r => r.id));

    const pending = migrations.filter(m => !appliedIds.has(m.id));
    if (pending.length === 0) {
      return { applied: [] };
    }

    const currentMaxBatch = appliedRecords.reduce((max, r) => Math.max(max, r.batch || 0), 0);
    const nextBatch = currentMaxBatch + 1;
    const appliedNames: string[] = [];

    for (const migration of pending) {
      const builder = new MigrationBuilder();
      await migration.up(builder);
      const sqlStatements = builder.getSqlStatements(this.adapter);

      const tx = await this.adapter.beginTransaction();
      try {
        for (const statement of sqlStatements) {
          await this.adapter.executeNonQuery(statement, undefined, tx);
        }

        const table = this.adapter.escapeIdentifier(this.tableName);
        const insertRecordSql = `INSERT INTO ${table} (id, name, batch) VALUES (?, ?, ?);`;
        await this.adapter.executeNonQuery(
          insertRecordSql,
          [
            { name: 'p1', value: migration.id },
            { name: 'p2', value: migration.name },
            { name: 'p3', value: nextBatch },
          ],
          tx
        );

        await tx.commit();
        appliedNames.push(migration.name);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }

    return { applied: appliedNames };
  }

  public async down(migrations: MigrationModule[]): Promise<{ reverted: string[] }> {
    await this.ensureMigrationsTable();
    const appliedRecords = await this.getAppliedMigrations();
    if (appliedRecords.length === 0) {
      return { reverted: [] };
    }

    const maxBatch = appliedRecords.reduce((max, r) => Math.max(max, r.batch || 0), 0);
    const lastBatchRecords = appliedRecords.filter(r => r.batch === maxBatch).reverse();

    const migrationMap = new Map(migrations.map(m => [m.id, m]));
    const revertedNames: string[] = [];

    for (const record of lastBatchRecords) {
      const migration = migrationMap.get(record.id);
      if (!migration) {
        throw new Error(`Migration ${record.id} (${record.name}) not found in migration list.`);
      }

      const builder = new MigrationBuilder();
      await migration.down(builder);
      const sqlStatements = builder.getSqlStatements(this.adapter);

      const tx = await this.adapter.beginTransaction();
      try {
        for (const statement of sqlStatements) {
          await this.adapter.executeNonQuery(statement, undefined, tx);
        }

        const table = this.adapter.escapeIdentifier(this.tableName);
        const deleteRecordSql = `DELETE FROM ${table} WHERE id = ?;`;
        await this.adapter.executeNonQuery(
          deleteRecordSql,
          [{ name: 'p1', value: migration.id }],
          tx
        );

        await tx.commit();
        revertedNames.push(migration.name);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }

    return { reverted: revertedNames };
  }

  public async status(
    migrations: MigrationModule[]
  ): Promise<{ id: string; name: string; applied: boolean; appliedAt?: Date; batch?: number }[]> {
    await this.ensureMigrationsTable();
    const appliedRecords = await this.getAppliedMigrations();
    const appliedMap = new Map(appliedRecords.map(r => [r.id, r]));

    return migrations.map(m => {
      const applied = appliedMap.get(m.id);
      return {
        id: m.id,
        name: m.name,
        applied: !!applied,
        appliedAt: applied?.appliedAt,
        batch: applied?.batch,
      };
    });
  }
}
