import { DbSet } from './DbSet';
import { RelationMetadata } from '../model/EntityMetadata';

/**
 * Encapsulates a deferred navigation property reference.
 * Allows on-demand asynchronous resolution of related entities without upfront eager .include().
 */
export class LazyRelation<T = any> {
  private _cached?: T;
  private _isLoaded = false;

  constructor(
    private readonly parentEntity: any,
    private readonly relationMeta: RelationMetadata,
    private readonly dbSet: DbSet<any>
  ) {}

  /**
   * Resolves and fetches the relation dataset from the database on demand.
   * Caches the result on the entity so subsequent accesses return immediately.
   */
  public async fetch(): Promise<T> {
    if (this._isLoaded) {
      return this._cached as T;
    }

    const rel = this.relationMeta;
    const targetEntity = rel.target();
    const childSet = (this.dbSet as any).context
      ? (this.dbSet as any).context.set(targetEntity)
      : new DbSet((this.dbSet as any).adapter, targetEntity as any);

    const parentPk = (this.dbSet as any).getPrimaryKeyProperty();
    const parentId = this.parentEntity[parentPk];

    let result: any;
    if (rel.type === 'hasMany') {
      result = await childSet
        .where((clause: any) => clause.eq(rel.foreignKey, parentId))
        .toList();
    } else if (rel.type === 'hasOne') {
      result = await childSet
        .where((clause: any) => clause.eq(rel.foreignKey, parentId))
        .first();
    } else if (rel.type === 'belongsTo') {
      const fkValue = this.parentEntity[rel.foreignKey];
      const targetMeta = (childSet as any).metadata;
      const targetPk = targetMeta?.primaryKeys[0] || 'id';
      result =
        fkValue !== undefined && fkValue !== null
          ? await childSet.where((clause: any) => clause.eq(targetPk, fkValue)).first()
          : null;
    }

    this._cached = result;
    this._isLoaded = true;

    // Populate the resolved value on the entity
    this.parentEntity[rel.propertyName] = result;

    return result;
  }

  /**
   * Alias for fetch().
   */
  public async resolve(): Promise<T> {
    return this.fetch();
  }

  /**
   * Alias for fetch().
   */
  public async get(): Promise<T> {
    return this.fetch();
  }

  /**
   * Checks whether the relation dataset has already been fetched into memory.
   */
  public isFetched(): boolean {
    return this._isLoaded;
  }
}
