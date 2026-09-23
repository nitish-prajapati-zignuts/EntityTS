import { DbContext } from '../../context/DbContext';
import { DbContextOptions } from '../../context/DbContextOptions';
import { DbContextOptionsBuilder } from '../../context/DbContextOptionsBuilder';
import { getDbContextToken } from './InjectDbContext';

export interface DbContextModuleOptions<TContext extends DbContext> {
  context: new (options?: DbContextOptions) => TContext;
  options?: DbContextOptions;
  configure?: (builder: DbContextOptionsBuilder) => void;
  isGlobal?: boolean;
}

export interface DbContextModuleAsyncOptions<TContext extends DbContext> {
  context: new (options?: DbContextOptions) => TContext;
  useFactory: (...args: any[]) => Promise<DbContextOptions> | DbContextOptions;
  inject?: any[];
  isGlobal?: boolean;
}

export class DbContextModule {
  public static forRoot<TContext extends DbContext>(
    options: DbContextModuleOptions<TContext>,
  ): any {
    const token = getDbContextToken(options.context);

    const provider = {
      provide: token,
      useFactory: () => {
        if (options.configure) {
          const builder = new DbContextOptionsBuilder();
          options.configure(builder);
          return new options.context(builder.build());
        }
        return new options.context(options.options);
      },
    };

    return {
      module: DbContextModule,
      global: options.isGlobal ?? false,
      providers: [provider, options.context],
      exports: [token, options.context],
    };
  }

  public static forRootAsync<TContext extends DbContext>(
    asyncOptions: DbContextModuleAsyncOptions<TContext>,
  ): any {
    const token = getDbContextToken(asyncOptions.context);

    const provider = {
      provide: token,
      useFactory: async (...args: any[]) => {
        const opts = await asyncOptions.useFactory(...args);
        return new asyncOptions.context(opts);
      },
      inject: asyncOptions.inject || [],
    };

    return {
      module: DbContextModule,
      global: asyncOptions.isGlobal ?? false,
      providers: [provider, asyncOptions.context],
      exports: [token, asyncOptions.context],
    };
  }
}
