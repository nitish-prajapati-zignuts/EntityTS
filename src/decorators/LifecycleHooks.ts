import { ModelMetadataRegistry, EntityLifecycleHooks } from '../model/EntityMetadata';

function registerLifecycleHook(
  eventName: keyof EntityLifecycleHooks,
  target: any,
  propertyKey: string | symbol,
): void {
  const constructor = typeof target === 'function' ? target : target.constructor;
  const metadata = ModelMetadataRegistry.getInstance().getOrCreate(constructor);

  if (!metadata.lifecycleHooks) {
    metadata.lifecycleHooks = {};
  }

  const list = metadata.lifecycleHooks[eventName] || [];
  const methodName = String(propertyKey);
  if (!list.includes(methodName)) {
    list.push(methodName);
  }
  metadata.lifecycleHooks[eventName] = list;
}

/**
 * Method decorator marking a method to run immediately before this entity is inserted into the database.
 *
 * Can be synchronous or asynchronous. Any uncaught error aborts the insert operation.
 *
 * @usecase Input normalization, password hashing, pre-insert calculations, or domain validation.
 * @example
 * ```ts
 * @BeforeInsert()
 * normalizeData() {
 *   this.email = this.email.trim().toLowerCase();
 * }
 * ```
 */
export function BeforeInsert(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    registerLifecycleHook('beforeInsert', target, propertyKey);
  };
}

/**
 * Method decorator marking a method to run immediately after this entity is inserted and its ID is assigned.
 *
 * @usecase Publish events, trigger welcome notifications, or log audit trails.
 * @example
 * ```ts
 * @AfterInsert()
 * onCreated() {
 *   console.log(`User created with id: ${this.id}`);
 * }
 * ```
 */
export function AfterInsert(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    registerLifecycleHook('afterInsert', target, propertyKey);
  };
}

/**
 * Method decorator marking a method to run immediately before an existing entity is updated.
 *
 * @usecase Recalculate totals, validate update constraints, or track modification history.
 * @example
 * ```ts
 * @BeforeUpdate()
 * onUpdate() {
 *   this.updatedCount = (this.updatedCount || 0) + 1;
 * }
 * ```
 */
export function BeforeUpdate(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    registerLifecycleHook('beforeUpdate', target, propertyKey);
  };
}

/**
 * Method decorator marking a method to run immediately after an existing entity is updated.
 *
 * @usecase Invalidate cache, publish update event messages, or notify connected clients.
 */
export function AfterUpdate(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    registerLifecycleHook('afterUpdate', target, propertyKey);
  };
}

/**
 * Method decorator marking a method to run immediately before an entity is removed or soft-deleted.
 *
 * @usecase Pre-delete authorization checks, cascade cleanup preparations, or audit snapshots.
 */
export function BeforeRemove(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    registerLifecycleHook('beforeRemove', target, propertyKey);
  };
}

/**
 * Method decorator marking a method to run immediately after an entity is removed.
 *
 * @usecase Post-delete cleanup, metrics tracking, or domain event notification.
 */
export function AfterRemove(): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    registerLifecycleHook('afterRemove', target, propertyKey);
  };
}
