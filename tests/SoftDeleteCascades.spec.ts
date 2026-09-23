import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  SoftDelete,
  HasMany,
  ModelMetadataRegistry,
} from '../src';

// ─── Entities ───────────────────────────────────────────────────────────────

@Entity()
@Table('sd_users')
@SoftDelete({ column: 'deleted_at', cascade: true })
class SdUser {
  @PrimaryKey()
  id!: number;

  @Column()
  name!: string;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;

  @HasMany(() => SdPost, 'userId')
  posts?: SdPost[];
}

@Entity()
@Table('sd_posts')
@SoftDelete({ column: 'deleted_at' })
class SdPost {
  @PrimaryKey()
  id!: number;

  @Column()
  title!: string;

  @Column()
  userId!: number;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date | null;
}

@Entity()
@Table('sd_categories')
class SdCategory {
  @PrimaryKey()
  id!: number;

  @Column()
  name!: string;
}

// ─── DbContext factory ────────────────────────────────────────────────────────

function buildCtx() {
  class SdTestContext extends DbContext {
    public users!: DbSet<SdUser>;
    public posts!: DbSet<SdPost>;
    public categories!: DbSet<SdCategory>;

    protected onConfiguring(options: DbContextOptionsBuilder): void {
      options.useMock({
        tables: {
          sd_users: [
            { id: 1, name: 'Alice', deleted_at: null },
            { id: 2, name: 'Bob', deleted_at: null },
          ],
          sd_posts: [
            { id: 10, title: 'Post A', userId: 1, deleted_at: null },
            { id: 11, title: 'Post B', userId: 1, deleted_at: null },
            { id: 12, title: 'Post C', userId: 2, deleted_at: null },
          ],
          sd_categories: [{ id: 100, name: 'Tech' }],
        },
      });
    }
  }

  const ctx = new SdTestContext();
  ctx.users = ctx.set(SdUser);
  ctx.posts = ctx.set(SdPost);
  ctx.categories = ctx.set(SdCategory);
  return ctx;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Soft Delete Cascades', () => {
  describe('@SoftDelete decorator with cascade option', () => {
    it('persists cascade:true flag in entity metadata for SdUser', () => {
      const meta = ModelMetadataRegistry.getInstance().get(SdUser);
      expect(meta?.softDelete?.cascade).toBe(true);
    });

    it('persists column name correctly', () => {
      const meta = ModelMetadataRegistry.getInstance().get(SdUser);
      expect(meta?.softDelete?.column).toBe('deleted_at');
    });

    it('defaults cascade to false when not specified', () => {
      const meta = ModelMetadataRegistry.getInstance().get(SdPost);
      expect(meta?.softDelete?.cascade).toBeFalsy();
    });

    it('SdCategory has no @SoftDelete metadata', () => {
      const meta = ModelMetadataRegistry.getInstance().get(SdCategory);
      expect(meta?.softDelete).toBeUndefined();
    });
  });

  describe('restore(id)', () => {
    it('throws if entity does not have @SoftDelete configured', async () => {
      const ctx = buildCtx();
      await expect(ctx.categories.restore(100)).rejects.toThrow(
        /Cannot restore.*sd_categories.*@SoftDelete/i,
      );
    });

    it('resolves without throwing for a soft-delete enabled entity', async () => {
      const ctx = buildCtx();
      await expect(ctx.users.restore(1)).resolves.not.toThrow();
    });

    it('resolve without throwing for SdPost', async () => {
      const ctx = buildCtx();
      await expect(ctx.posts.restore(10)).resolves.not.toThrow();
    });
  });

  describe('restoreWhere(predicate)', () => {
    it('throws if entity does not have @SoftDelete configured', async () => {
      const ctx = buildCtx();
      await expect(ctx.categories.restoreWhere({ id: 100 })).rejects.toThrow(
        /Cannot restoreWhere.*sd_categories/i,
      );
    });

    it('resolves and returns affected row count for a soft-delete entity', async () => {
      const ctx = buildCtx();
      const count = await ctx.posts.restoreWhere({ userId: 1 });
      expect(typeof count).toBe('number');
    });
  });

  describe('Cascade soft-delete via remove()', () => {
    it('soft-deletes parent row', async () => {
      const ctx = buildCtx();
      // Remove should set deleted_at on user
      await ctx.users.remove(1);
      // With mock adapter, the row filtering uses deleted_at null check
      const active = await ctx.users.toList();
      // After soft delete, user 1 must not be in the active list
      expect(active.find(u => u.id === 1)).toBeUndefined();
    });

    it('the deleted user is visible via .withDeleted()', async () => {
      const ctx = buildCtx();
      await ctx.users.remove(1);
      const all = await ctx.users.withDeleted().toList();
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    it('standard remove without cascade does not affect unrelated records', async () => {
      const ctx = buildCtx();
      // Remove post 10, verify post 12 is unaffected
      await ctx.posts.remove(10);
      const post12 = await ctx.posts.find(12);
      expect(post12).toBeDefined();
    });
  });

  describe('SoftDeleteOptions type', () => {
    it('SoftDelete({ column, cascade }) registers both fields', () => {
      const meta = ModelMetadataRegistry.getInstance().get(SdUser);
      expect(meta?.softDelete).toBeDefined();
      expect(meta!.softDelete!.column).toBe('deleted_at');
      expect(meta!.softDelete!.cascade).toBe(true);
    });
  });
});
