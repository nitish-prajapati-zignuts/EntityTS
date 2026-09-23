import { DbProvider } from './IDbAdapter';
import { PostgresAdapter, PostgresAdapterConfig } from './PostgresAdapter';

export interface SupabaseAdapterConfig extends PostgresAdapterConfig {}

/**
 * Supabase PostgreSQL adapter.
 * Extends PostgresAdapter with Supabase provider identity and SSL defaults.
 */
export class SupabaseAdapter extends PostgresAdapter {
  public override readonly provider: DbProvider = 'supabase';

  constructor(config: SupabaseAdapterConfig | string) {
    const resolvedConfig =
      typeof config === 'string'
        ? { connectionString: config, ssl: { rejectUnauthorized: false } }
        : { ssl: { rejectUnauthorized: false }, ...config };
    super(resolvedConfig);
  }
}
