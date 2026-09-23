import { DbContext } from '../context/DbContext';
import { DbContextOptions } from '../context/DbContextOptions';

export interface DbContextMiddlewareOptions<TContext extends DbContext> {
  contextClass: new (options?: DbContextOptions) => TContext;
  options?: DbContextOptions;
  autoDispose?: boolean;
}

/**
 * Express / Connect middleware that attaches a scoped DbContext instance to `req.dbContext`.
 * Automatically disconnects on response finish if autoDispose is enabled.
 */
export function dbContextMiddleware<TContext extends DbContext>(
  contextClassOrOptions:
    | (new (options?: DbContextOptions) => TContext)
    | DbContextMiddlewareOptions<TContext>,
  defaultOptions?: DbContextOptions
) {
  let contextClass: new (options?: DbContextOptions) => TContext;
  let options: DbContextOptions | undefined = defaultOptions;
  let autoDispose = true;

  if (typeof contextClassOrOptions === 'function') {
    contextClass = contextClassOrOptions;
  } else {
    contextClass = contextClassOrOptions.contextClass;
    options = contextClassOrOptions.options ?? defaultOptions;
    if (contextClassOrOptions.autoDispose !== undefined) {
      autoDispose = contextClassOrOptions.autoDispose;
    }
  }

  return (req: any, res: any, next: (err?: any) => void) => {
    const ctx = new contextClass(options);
    req.dbContext = ctx;

    if (autoDispose && res && typeof res.on === 'function') {
      res.on('finish', () => {
        ctx.dispose().catch(() => {});
      });
      res.on('close', () => {
        ctx.dispose().catch(() => {});
      });
    }

    next();
  };
}
