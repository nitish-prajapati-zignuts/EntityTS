import { DbContext } from '../context/DbContext';
import { DbContextOptions } from '../context/DbContextOptions';

export interface FastifyDbContextOptions<TContext extends DbContext> {
  contextClass: new (options?: DbContextOptions) => TContext;
  options?: DbContextOptions;
  autoDispose?: boolean;
}

/**
 * Fastify plugin that attaches a scoped DbContext instance to `request.dbContext`.
 * Automatically disposes the context on the `onResponse` hook if autoDispose is enabled (default true).
 *
 * Usage:
 * ```ts
 * fastify.register(fastifyDbContext, { contextClass: AppDbContext, options: dbOptions });
 * // or shorthand:
 * fastify.register(fastifyDbContext, AppDbContext);
 * ```
 */
export async function fastifyDbContext<TContext extends DbContext>(
  fastify: any,
  opts: FastifyDbContextOptions<TContext> | (new (options?: DbContextOptions) => TContext),
): Promise<void> {
  let contextClass: new (options?: DbContextOptions) => TContext;
  let options: DbContextOptions | undefined;
  let autoDispose = true;

  if (typeof opts === 'function') {
    contextClass = opts;
  } else {
    contextClass = opts.contextClass;
    options = opts.options;
    if (opts.autoDispose !== undefined) {
      autoDispose = opts.autoDispose;
    }
  }

  if (!fastify.hasRequestDecorator || !fastify.hasRequestDecorator('dbContext')) {
    fastify.decorateRequest('dbContext', null);
  }

  fastify.addHook('onRequest', async (request: any) => {
    request.dbContext = new contextClass(options);
  });

  if (autoDispose) {
    fastify.addHook('onResponse', async (request: any) => {
      if (request.dbContext && typeof request.dbContext.dispose === 'function') {
        try {
          await request.dbContext.dispose();
        } catch {
          // ignore cleanup error during teardown
        }
      }
    });
  }
}

export default fastifyDbContext;
