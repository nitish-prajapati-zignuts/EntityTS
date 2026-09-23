import { EntityState } from './EntityState';
import { EntityMetadata } from '../model/EntityMetadata';

export class EntityEntry<T extends object = any> {
  private _state: EntityState;
  private readonly _originalValues: Map<string, unknown> = new Map();

  constructor(
    public readonly entity: T,
    public readonly metadata?: EntityMetadata,
    initialState: EntityState = EntityState.Unchanged,
  ) {
    this._state = initialState;
    this.snapshot();
  }

  public get state(): EntityState {
    return this._state;
  }

  public set state(val: EntityState) {
    this._state = val;
  }

  public snapshot(): void {
    this._originalValues.clear();
    for (const [key, val] of Object.entries(this.entity)) {
      this._originalValues.set(key, val);
    }
  }

  public getOriginalValue(prop: string): unknown {
    return this._originalValues.get(prop);
  }

  public getChanges(): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(this.entity)) {
      if (this.metadata?.ignoredProperties.has(key)) continue;
      const original = this._originalValues.get(key);
      if (val !== original) {
        changes[key] = val;
      }
    }
    return changes;
  }

  public acceptChanges(): void {
    if (this._state === EntityState.Deleted) {
      this._state = EntityState.Detached;
    } else {
      this._state = EntityState.Unchanged;
      this.snapshot();
    }
  }
}
