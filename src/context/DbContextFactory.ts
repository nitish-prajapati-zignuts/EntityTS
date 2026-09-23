import { DbContext } from './DbContext';
import { DbContextOptions } from './DbContextOptions';

export interface IDbContextFactory<TContext extends DbContext> {
  createDbContext(): TContext;
}

export class DbContextFactory<TContext extends DbContext> implements IDbContextFactory<TContext> {
  constructor(
    private readonly contextClass: new (options?: DbContextOptions) => TContext,
    private readonly options?: DbContextOptions
  ) {}

  public createDbContext(): TContext {
    return new this.contextClass(this.options);
  }
}
