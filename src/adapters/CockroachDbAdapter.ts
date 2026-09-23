import { DbProvider } from './IDbAdapter';
import { PostgresAdapter, PostgresAdapterConfig } from './PostgresAdapter';

export interface CockroachDbAdapterConfig extends PostgresAdapterConfig {}

/**
 * CockroachDB distributed database adapter.
 * Extends PostgresAdapter with CockroachDB-specific provider identity and PostgreSQL wire compatibility.
 */
export class CockroachDbAdapter extends PostgresAdapter {
  public override readonly provider: DbProvider = 'cockroachdb';

  constructor(config: CockroachDbAdapterConfig | string) {
    super(config);
  }
}
