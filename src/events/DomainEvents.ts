/**
 * Base interface for all typed entity lifecycle domain events.
 */
export interface IDomainEvent<T = unknown> {
  /** The entity instance involved in the lifecycle event. */
  readonly entity: T;
  /** Name of the entity model or class. */
  readonly entityName: string;
  /** Database table name. */
  readonly tableName: string;
  /** Timestamp when the event occurred. */
  readonly timestamp: Date;
}

/**
 * Event emitted immediately after an entity is successfully inserted/created.
 */
export class EntityCreated<T = unknown> implements IDomainEvent<T> {
  public readonly timestamp: Date;

  constructor(
    public readonly entity: T,
    public readonly entityName: string,
    public readonly tableName: string,
    timestamp?: Date
  ) {
    this.timestamp = timestamp || new Date();
  }
}

/**
 * Event emitted immediately after an entity is successfully updated.
 */
export class EntityUpdated<T = unknown> implements IDomainEvent<T> {
  public readonly timestamp: Date;

  constructor(
    public readonly entity: T,
    public readonly entityName: string,
    public readonly tableName: string,
    public readonly previous?: Partial<T>,
    timestamp?: Date
  ) {
    this.timestamp = timestamp || new Date();
  }
}

/**
 * Event emitted immediately after an entity is successfully removed/deleted (soft or hard).
 */
export class EntityDeleted<T = unknown> implements IDomainEvent<T> {
  public readonly timestamp: Date;

  constructor(
    public readonly entity: T,
    public readonly entityName: string,
    public readonly tableName: string,
    timestamp?: Date
  ) {
    this.timestamp = timestamp || new Date();
  }
}

// Aliases for user flexibility
export { EntityCreated as EntityCreatedEvent, EntityUpdated as EntityUpdatedEvent, EntityDeleted as EntityDeletedEvent };
