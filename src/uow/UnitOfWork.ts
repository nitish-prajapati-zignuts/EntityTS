import { DbContext } from '../context/DbContext';
import { DbSet } from '../set/DbSet';
import { EntityState } from '../tracking/EntityState';
import { ModelMetadataRegistry, EntityMetadata } from '../model/EntityMetadata';

export interface UnitOfWorkOperation<T extends object = any> {
  entity: T;
  set: DbSet<T>;
  state: EntityState;
  patch?: Partial<T>;
}

export interface UnitOfWorkCommitResult {
  insertedCount: number;
  updatedCount: number;
  deletedCount: number;
  totalAffected: number;
}

/**
 * Enterprise Unit of Work pattern implementation for EntityTS.
 *
 * Collects entity mutations across multiple `DbSet` collections, performs topological
 * dependency resolution to sequence parent-before-child inserts and child-before-parent deletes,
 * and commits all operations atomically within a single database transaction across PostgreSQL, MySQL, SQLite, and MSSQL.
 *
 * @usecase Coordinate multi-aggregate transactions where multiple entities across different tables must be persisted together or fail together.
 *
 * @example
 * **PostgreSQL / MySQL / SQLite / MSSQL:**
 * ```ts
 * const uow = context.createUnitOfWork();
 *
 * const customer = new Customer({ name: 'Acme Corp' });
 * const order = new Order({ totalAmount: 1500 });
 * const invoice = new Invoice({ status: 'PENDING' });
 *
 * uow.registerNew(context.customers, customer);
 * uow.registerNew(context.orders, order);
 * uow.registerNew(context.invoices, invoice);
 *
 * const result = await uow.commit();
 * console.log(`Committed ${result.insertedCount} entities in atomic transaction.`);
 * ```
 */
export class UnitOfWork<TContext extends DbContext = DbContext> {
  private readonly _operations: UnitOfWorkOperation[] = [];

  constructor(public readonly context: TContext) {}

  /**
   * The count of uncommitted operations currently queued in this Unit of Work.
   */
  public get pendingCount(): number {
    return this._operations.length;
  }

  /**
   * Returns true if there are uncommitted operations waiting in the Unit of Work.
   */
  public hasChanges(): boolean {
    return this._operations.length > 0;
  }

  /**
   * Registers a newly created entity to be inserted during `commit()`.
   *
   * @usecase Queue an entity insertion in the Unit of Work.
   * @param set - Target `DbSet` for the entity.
   * @param entity - The entity object to insert.
   * @returns `this` instance for chaining.
   */
  public registerNew<T extends object>(set: DbSet<T>, entity: T): this {
    return this.register(set, entity, EntityState.Added);
  }

  /**
   * Registers an existing entity as modified to be updated during `commit()`.
   *
   * @usecase Queue an entity modification with optional patch payload.
   * @param set - Target `DbSet` for the entity.
   * @param entity - The entity object being modified.
   * @param patch - Optional partial update payload.
   * @returns `this` instance for chaining.
   */
  public registerDirty<T extends object>(set: DbSet<T>, entity: T, patch?: Partial<T>): this {
    return this.register(set, entity, EntityState.Modified, patch);
  }

  /**
   * Registers an entity to be deleted during `commit()`.
   */
  public registerDeleted<T extends object>(set: DbSet<T>, entity: T): this {
    return this.register(set, entity, EntityState.Deleted);
  }

  /**
   * Registers an entity with a specific `EntityState` lifecycle.
   */
  public register<T extends object>(
    set: DbSet<T>,
    entity: T,
    state: EntityState,
    patch?: Partial<T>,
  ): this {
    this._operations.push({
      set: set as DbSet<any>,
      entity,
      state,
      patch,
    });
    return this;
  }

  /**
   * Clears all pending operations without committing them to the database.
   */
  public rollback(): void {
    this._operations.length = 0;
  }

  /**
   * Commits all queued operations atomically within a single database transaction
   * with topological dependency ordering (parents before children on insert,
   * children before parents on delete).
   */
  public async commit(): Promise<UnitOfWorkCommitResult> {
    if (this._operations.length === 0) {
      return {
        insertedCount: 0,
        updatedCount: 0,
        deletedCount: 0,
        totalAffected: 0,
      };
    }

    const inserts = this._operations.filter(op => op.state === EntityState.Added);
    const updates = this._operations.filter(op => op.state === EntityState.Modified);
    const deletes = this._operations.filter(op => op.state === EntityState.Deleted);

    // Topological sorting of inserts: parent entities first
    const sortedInserts = this.sortInsertsByDependency(inserts);

    // Topological sorting of deletes: child entities first
    const sortedDeletes = this.sortDeletesByDependency(deletes);

    let insertedCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    await this.context.useTransaction(async tx => {
      // 1. Flush inserts in parent-first order
      for (const op of sortedInserts) {
        const scopedSet = op.set.inTransaction(tx);
        // Propagate parent foreign keys if child references a parent in this unit of work
        this.propagateParentKeys(op.entity, sortedInserts);
        const added = await scopedSet.add(op.entity);
        Object.assign(op.entity, added);
        insertedCount++;
      }

      const getPk = (op: UnitOfWorkOperation): unknown => {
        const pkProp =
          typeof (op.set as any).getPrimaryKeyProperty === 'function'
            ? (op.set as any).getPrimaryKeyProperty()
            : 'id';
        return (op.entity as any)[pkProp] ?? op.entity;
      };

      // 2. Flush updates
      for (const op of updates) {
        const scopedSet = op.set.inTransaction(tx);
        const pk = getPk(op);
        const changes = op.patch || { ...op.entity };
        const updated = await scopedSet.update(pk, changes);
        Object.assign(op.entity, updated);
        updatedCount++;
      }

      // 3. Flush deletes in child-first order
      for (const op of sortedDeletes) {
        const scopedSet = op.set.inTransaction(tx);
        const pk = getPk(op);
        await scopedSet.remove(pk);
        deletedCount++;
      }
    });

    this._operations.length = 0;

    return {
      insertedCount,
      updatedCount,
      deletedCount,
      totalAffected: insertedCount + updatedCount + deletedCount,
    };
  }

  /**
   * Sorts insert operations so that referenced parent entities are inserted before children.
   */
  private sortInsertsByDependency(ops: UnitOfWorkOperation[]): UnitOfWorkOperation[] {
    const registry = ModelMetadataRegistry.getInstance();
    const result: UnitOfWorkOperation[] = [];
    const visited = new Set<UnitOfWorkOperation>();
    const visiting = new Set<UnitOfWorkOperation>();

    const getEntityTarget = (op: UnitOfWorkOperation): Function => {
      return (op.set as any).entityTarget || op.entity.constructor;
    };

    const isChildOf = (childOp: UnitOfWorkOperation, parentOp: UnitOfWorkOperation): boolean => {
      const childTarget = getEntityTarget(childOp);
      const parentTarget = getEntityTarget(parentOp);
      const childMeta = registry.get(childTarget);
      if (!childMeta) return false;

      // Check BelongsTo relations on child pointing to parent
      if (childMeta.relations) {
        for (const [, rel] of childMeta.relations) {
          if (rel.type === 'belongsTo') {
            const relTarget = rel.target();
            if (relTarget === parentTarget) return true;
          }
        }
      }

      // Check HasMany / HasOne on parent pointing to child
      const parentMeta = registry.get(parentTarget);
      if (parentMeta && parentMeta.relations) {
        for (const [, rel] of parentMeta.relations) {
          if (rel.type === 'hasMany' || rel.type === 'hasOne') {
            const relTarget = rel.target();
            if (relTarget === childTarget) return true;
          }
        }
      }

      return false;
    };

    const visit = (op: UnitOfWorkOperation) => {
      if (visited.has(op)) return;
      if (visiting.has(op)) {
        // Cycle detected: fall back to insertion order
        result.push(op);
        visited.add(op);
        return;
      }

      visiting.add(op);

      // Find all prerequisites (parents) that this op depends on
      for (const candidateParent of ops) {
        if (candidateParent !== op && isChildOf(op, candidateParent)) {
          visit(candidateParent);
        }
      }

      visiting.delete(op);
      visited.add(op);
      result.push(op);
    };

    for (const op of ops) {
      visit(op);
    }

    return result;
  }

  /**
   * Sorts delete operations so that child entities are deleted before parents.
   */
  private sortDeletesByDependency(ops: UnitOfWorkOperation[]): UnitOfWorkOperation[] {
    // Reverse the topological insert order
    const insertSorted = this.sortInsertsByDependency(ops);
    return [...insertSorted].reverse();
  }

  /**
   * Automatically assigns foreign key IDs from inserted parents to dependent child entities.
   */
  private propagateParentKeys(childEntity: any, allInserts: UnitOfWorkOperation[]): void {
    const registry = ModelMetadataRegistry.getInstance();
    const childTarget = childEntity.constructor;
    const childMeta = registry.get(childTarget);
    if (!childMeta || !childMeta.relations) return;

    for (const [, rel] of childMeta.relations) {
      if (rel.type === 'belongsTo') {
        const parentTarget = rel.target();
        const parentOp = allInserts.find(
          op =>
            (op.set as any).entityTarget === parentTarget || op.entity.constructor === parentTarget,
        );

        if (parentOp) {
          const parentMeta = registry.get(parentTarget);
          const parentPkProp = parentMeta?.primaryKeys[0] || 'id';
          const parentId = (parentOp.entity as any)[parentPkProp];

          if (parentId !== undefined) {
            // If the foreign key on child is unset, assign from inserted parent
            if (childEntity[rel.foreignKey] === undefined || childEntity[rel.foreignKey] === null) {
              childEntity[rel.foreignKey] = parentId;
            }
          }
        }
      }
    }
  }
}
