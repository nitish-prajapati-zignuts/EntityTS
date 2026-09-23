import { EntityState } from './EntityState';
import { EntityEntry } from './EntityEntry';
import { EntityMetadata } from '../model/EntityMetadata';

const PROXY_TARGET = Symbol('PROXY_TARGET');

/**
 * Tracks changes made to entity instances to enable unit-of-work persistence via `DbContext.saveChanges()`.
 *
 * Keeps track of Added, Modified, Deleted, and Unchanged states and detects modified properties via reactive ES6 proxies.
 */
export class ChangeTracker {
  private readonly _entries = new Map<any, EntityEntry>();

  /**
   * Returns all entity entries currently tracked by this tracker.
   *
   * @usecase Inspect tracked entities, check states, or identify pending modifications.
   * @returns Array of `EntityEntry` instances.
   */
  public entries(): EntityEntry[] {
    return Array.from(this._entries.values());
  }

  /**
   * Looks up the tracked `EntityEntry` for a specific entity instance.
   *
   * @usecase Inspect property changes, original values, or state of a specific entity.
   * @param entity - The tracked entity instance or proxy.
   * @returns The corresponding `EntityEntry` or `undefined` if not tracked.
   */
  public entry<T extends object>(entity: T): EntityEntry<T> | undefined {
    const raw = (entity as any)[PROXY_TARGET] || entity;
    return this._entries.get(raw);
  }

  /**
   * Checks whether there are any pending changes (Added, Modified, or Deleted entities) waiting to be saved.
   *
   * @usecase Determine whether a call to `saveChanges()` is needed.
   * @returns `true` if uncommitted modifications exist, otherwise `false`.
   */
  public hasChanges(): boolean {
    return Array.from(this._entries.values()).some(
      e =>
        e.state === EntityState.Added ||
        e.state === EntityState.Modified ||
        e.state === EntityState.Deleted
    );
  }

  /**
   * Clears all tracked entities from the tracker.
   *
   * @usecase Reset change tracking state between tests or after rolling back changes.
   */
  public clear(): void {
    this._entries.clear();
  }

  /**
   * Marks a new entity as Added, scheduling it for an SQL INSERT on `saveChanges()`.
   *
   * @usecase Enqueue a newly created entity to be persisted during the next `saveChanges()`.
   * @param entity - The entity object to insert.
   * @param metadata - Optional model metadata.
   * @returns The newly created `EntityEntry`.
   */
  public add<T extends object>(entity: T, metadata?: EntityMetadata): EntityEntry<T> {
    const raw = (entity as any)[PROXY_TARGET] || entity;
    let entry = this._entries.get(raw);
    if (!entry) {
      entry = new EntityEntry<T>(raw, metadata, EntityState.Added);
      this._entries.set(raw, entry);
    } else {
      entry.state = EntityState.Added;
    }
    return entry;
  }

  /**
   * Marks an entity as Deleted, scheduling it for an SQL DELETE on `saveChanges()`.
   *
   * @usecase Enqueue an existing entity for deletion during the next `saveChanges()`.
   * @param entity - The entity object to remove.
   * @param metadata - Optional model metadata.
   * @returns The `EntityEntry` marked as Deleted.
   */
  public remove<T extends object>(entity: T, metadata?: EntityMetadata): EntityEntry<T> {
    const raw = (entity as any)[PROXY_TARGET] || entity;
    let entry = this._entries.get(raw);
    if (!entry) {
      entry = new EntityEntry<T>(raw, metadata, EntityState.Deleted);
      this._entries.set(raw, entry);
    } else {
      entry.state = EntityState.Deleted;
    }
    return entry;
  }

  /**
   * Attaches an existing entity to the tracker in a specified state (default: `Unchanged`).
   *
   * @usecase Attach detached entities (e.g. deserialized from an API request) to be managed by the tracker.
   * @param entity - The entity instance to track.
   * @param metadata - Optional model metadata.
   * @param state - Initial entity state (defaults to `EntityState.Unchanged`).
   * @returns The tracked `EntityEntry`.
   */
  public attach<T extends object>(
    entity: T,
    metadata?: EntityMetadata,
    state: EntityState = EntityState.Unchanged
  ): EntityEntry<T> {
    const raw = (entity as any)[PROXY_TARGET] || entity;
    let entry = this._entries.get(raw);
    if (!entry) {
      entry = new EntityEntry<T>(raw, metadata, state);
      this._entries.set(raw, entry);
    } else {
      entry.state = state;
    }
    return entry;
  }

  /**
   * Wraps an entity in a reactive ES6 Proxy that automatically marks the entity as Modified when any property changes.
   *
   * @usecase Enables effortless dirty checking — just modify properties on the returned object and call `saveChanges()`.
   * @param entity - The entity to track.
   * @param metadata - Optional entity metadata.
   * @param state - Initial state (defaults to `EntityState.Unchanged`).
   * @returns A transparent Proxy around the entity.
   * @example
   * ```ts
   * const user = changeTracker.track(existingUser);
   * user.email = 'new@example.com'; // automatically transitions state to Modified
   * ```
   */
  public track<T extends object>(
    entity: T,
    metadata?: EntityMetadata,
    state: EntityState = EntityState.Unchanged
  ): T {
    const raw = (entity as any)[PROXY_TARGET] || entity;
    let entry = this._entries.get(raw);
    if (!entry) {
      entry = new EntityEntry<T>(raw, metadata, state);
      this._entries.set(raw, entry);
    }

    const self = this;
    const proxy = new Proxy(raw, {
      get(target, prop, receiver) {
        if (prop === PROXY_TARGET) return target;
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        const key = String(prop);
        const original = entry!.getOriginalValue(key);
        const success = Reflect.set(target, prop, value, receiver);
        if (success && entry!.state !== EntityState.Added && entry!.state !== EntityState.Deleted) {
          if (value !== original) {
            entry!.state = EntityState.Modified;
          }
        }
        return success;
      },
    });

    return proxy;
  }
}
