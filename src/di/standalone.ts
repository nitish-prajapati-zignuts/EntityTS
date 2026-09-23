import { DbContext } from '../context/DbContext';
import { DbContextOptions } from '../context/DbContextOptions';
import { DbContextOptionsBuilder } from '../context/DbContextOptionsBuilder';

export function createDbContext<TContext extends DbContext>(
  contextClass: new (options?: DbContextOptions) => TContext,
  configure?: (options: DbContextOptionsBuilder) => void
): TContext {
  if (configure) {
    const builder = new DbContextOptionsBuilder();
    configure(builder);
    return new contextClass(builder.build());
  }
  return new contextClass();
}
