import { IDbAdapter } from '../adapters/IDbAdapter';

export interface SeedModule {
  /**
   * Unique, stable identifier for this seed (e.g. `'20240101_seed_roles'`).
   * Used to track whether the seed has already been applied.
   */
  id: string;

  /**
   * Human-readable name for display in `db:seed:status` output.
   */
  name: string;

  /**
   * The seeding function that inserts or upserts data.
   * Receives the database adapter for raw SQL operations.
   * For higher-level access, pass the full `DbContext` from your application code.
   */
  run(adapter: IDbAdapter): Promise<void>;
}

export interface SeedRecord {
  id: string;
  name: string;
  appliedAt?: Date;
}

export interface SeedStatus {
  id: string;
  name: string;
  applied: boolean;
  appliedAt?: Date;
}

/**
 * Tracks and executes structured seed modules, preventing double-execution via a `__entityts_seeds` table.
 *
 * Models the same pattern as `MigrationRunner` for consistency.
 *
 * @example
 * ```ts
 * import * as seed1 from './seeds/001_roles';
 * import * as seed2 from './seeds/002_default_users';
 *
 * const runner = new SeedRunner(context.adapter);
 * const { applied } = await runner.run([seed1, seed2]);
 * console.log('Seeds applied:', applied);
 * ```
 */
export class SeedRunner {
  private readonly tableName = '__entityts_seeds';

  constructor(private readonly adapter: IDbAdapter) {}

  /**
   * Creates the `__entityts_seeds` tracking table if it doesn't exist.
   */
  public async ensureSeedsTable(): Promise<void> {
    const table = this.adapter.escapeIdentifier(this.tableName);
    const sql = `CREATE TABLE IF NOT EXISTS ${table} (
      id VARCHAR(255) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
    await this.adapter.executeNonQuery(sql);
  }

  /**
   * Returns all seed records that have been applied to the database.
   */
  public async getAppliedSeeds(): Promise<SeedRecord[]> {
    await this.ensureSeedsTable();
    const table = this.adapter.escapeIdentifier(this.tableName);
    const sql = `SELECT id, name, applied_at as appliedAt FROM ${table} ORDER BY applied_at ASC;`;
    return this.adapter.executeQuery<SeedRecord>(sql);
  }

  /**
   * Runs all pending seed modules that have not yet been applied.
   *
   * @param seeds - Ordered list of seed modules to execute.
   * @returns An object containing the names of seeds applied in this run.
   */
  public async run(seeds: SeedModule[]): Promise<{ applied: string[] }> {
    await this.ensureSeedsTable();
    const appliedRecords = await this.getAppliedSeeds();
    const appliedIds = new Set(appliedRecords.map(r => r.id));

    const pending = seeds.filter(s => !appliedIds.has(s.id));
    if (pending.length === 0) {
      return { applied: [] };
    }

    const appliedNames: string[] = [];

    for (const seed of pending) {
      // Execute seed in a transaction for atomicity
      const tx = await this.adapter.beginTransaction();
      try {
        await seed.run(this.adapter);

        const table = this.adapter.escapeIdentifier(this.tableName);
        const insertSql = `INSERT INTO ${table} (id, name) VALUES (?, ?);`;
        await this.adapter.executeNonQuery(
          insertSql,
          [
            { name: 'p1', value: seed.id },
            { name: 'p2', value: seed.name },
          ],
          tx,
        );

        await tx.commit();
        appliedNames.push(seed.name);
      } catch (err) {
        await tx.rollback();
        throw err;
      }
    }

    return { applied: appliedNames };
  }

  /**
   * Returns the applied/pending status of each seed module.
   *
   * @param seeds - The full list of seed modules in dependency order.
   * @returns An array of `SeedStatus` objects indicating which seeds have been applied.
   * @example
   * ```ts
   * const statuses = await runner.status([seed1, seed2]);
   * statuses.forEach(s => console.log(s.name, s.applied ? '✅' : '⏳'));
   * ```
   */
  public async status(seeds: SeedModule[]): Promise<SeedStatus[]> {
    await this.ensureSeedsTable();
    const appliedRecords = await this.getAppliedSeeds();
    const appliedMap = new Map(appliedRecords.map(r => [r.id, r]));

    return seeds.map(s => {
      const record = appliedMap.get(s.id);
      return {
        id: s.id,
        name: s.name,
        applied: !!record,
        appliedAt: record?.appliedAt,
      };
    });
  }

  /**
   * Clears all entries from the `__entityts_seeds` tracking table, allowing all seeds to be re-run.
   *
   * **Warning**: This does NOT undo the data changes made by the seeds — it only resets the
   * tracking table. Use only in development/test environments.
   */
  public async reset(): Promise<void> {
    await this.ensureSeedsTable();
    const table = this.adapter.escapeIdentifier(this.tableName);
    await this.adapter.executeNonQuery(`DELETE FROM ${table};`);
  }
}
