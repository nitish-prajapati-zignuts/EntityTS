import { DbContext } from '../../context/DbContext';

export function getDbContextToken<TContext extends DbContext>(
  contextClass: new (...args: any[]) => TContext,
): string {
  return `${contextClass.name}_TOKEN`;
}

/**
 * Parameter decorator for injecting DbContext into NestJS constructors.
 */
export function InjectDbContext<TContext extends DbContext>(
  contextClass: new (...args: any[]) => TContext,
) {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    try {
      // Lazy require of @nestjs/common Inject
      const { Inject } = require('@nestjs/common');
      return Inject(getDbContextToken(contextClass))(target, propertyKey, parameterIndex);
    } catch {
      // If NestJS is not available in runtime, store metadata using reflect-metadata
      const existingInjections = Reflect.getOwnMetadata('custom:dbcontext_inject', target) || [];
      existingInjections.push({ index: parameterIndex, token: getDbContextToken(contextClass) });
      Reflect.defineMetadata('custom:dbcontext_inject', existingInjections, target);
    }
  };
}
