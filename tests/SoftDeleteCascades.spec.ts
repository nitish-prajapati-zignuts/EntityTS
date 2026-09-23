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

    it('automatically cascades soft-delete to @HasMany children', async () => {
      const ctx = buildCtx();

      // Soft delete user 1 (which has cascade: true)
      await ctx.users.remove(1);

      // Verify posts for user 1 (10 and 11) are soft-deleted from active query
      const activePosts = await ctx.posts.toList();
      expect(activePosts.find(p => p.id === 10)).toBeUndefined();
      expect(activePosts.find(p => p.id === 11)).toBeUndefined();

      // Verify post 12 belonging to user 2 is untouched
      expect(activePosts.find(p => p.id === 12)).toBeDefined();

      // Verify soft-deleted posts are still present via .withDeleted()
      const allPosts = await ctx.posts.withDeleted().toList();
      expect(allPosts.find(p => p.id === 10)).toBeDefined();
      expect(allPosts.find(p => p.id === 11)).toBeDefined();
    });

    it('automatically cascades restore() back to @HasMany children', async () => {
      const ctx = buildCtx();

      // Soft delete user 1 and cascade to posts
      await ctx.users.remove(1);
      expect((await ctx.posts.toList()).find(p => p.id === 10)).toBeUndefined();

      // Restore user 1 (cascade: true should also restore posts)
      await ctx.users.restore(1);

      const restoredUsers = await ctx.users.toList();
      expect(restoredUsers.find(u => u.id === 1)).toBeDefined();

      const restoredPosts = await ctx.posts.toList();
      expect(restoredPosts.find(p => p.id === 10)).toBeDefined();
      expect(restoredPosts.find(p => p.id === 11)).toBeDefined();
    });

    it('does not delete non-soft-delete child entities when parent is soft-deleted', async () => {
      const ctx = buildCtx();
      await ctx.users.remove(1);

      // Categories have no @SoftDelete and should not be deleted
      const categories = await ctx.categories.toList();
      expect(categories.length).toBe(1);
      expect(categories[0].id).toBe(100);
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

  describe('Multi-level grandchild recursive soft-delete cascading', () => {
    @Entity()
    @Table('sd_blogs')
    @SoftDelete({ column: 'deleted_at', cascade: true })
    class SdBlog {
      @PrimaryKey()
      id!: number;

      @Column()
      title!: string;

      @Column({ name: 'deleted_at', nullable: true })
      deletedAt?: Date | null;

      @HasMany(() => SdArticle, 'blogId')
      articles?: SdArticle[];
    }

    @Entity()
    @Table('sd_articles')
    @SoftDelete({ column: 'deleted_at', cascade: true })
    class SdArticle {
      @PrimaryKey()
      id!: number;

      @Column()
      blogId!: number;

      @Column()
      headline!: string;

      @Column({ name: 'deleted_at', nullable: true })
      deletedAt?: Date | null;

      @HasMany(() => SdReview, 'articleId')
      reviews?: SdReview[];
    }

    @Entity()
    @Table('sd_reviews')
    @SoftDelete({ column: 'deleted_at' })
    class SdReview {
      @PrimaryKey()
      id!: number;

      @Column()
      articleId!: number;

      @Column()
      comment!: string;

      @Column({ name: 'deleted_at', nullable: true })
      deletedAt?: Date | null;
    }

    class MultiLevelContext extends DbContext {
      public blogs = this.set(SdBlog);
      public articles = this.set(SdArticle);
      public reviews = this.set(SdReview);

      protected onConfiguring(options: DbContextOptionsBuilder): void {
        options.useMock({
          tables: {
            sd_blogs: [{ id: 1, title: 'Tech Blog', deleted_at: null }],
            sd_articles: [{ id: 101, blogId: 1, headline: 'TypeScript 5', deleted_at: null }],
            sd_reviews: [
              { id: 1001, articleId: 101, comment: 'Great read!', deleted_at: null },
              { id: 1002, articleId: 999, comment: 'Other review', deleted_at: null },
            ],
          },
        });
      }
    }

    it('cascades soft deletion across all 3 levels (Blog -> Article -> Review)', async () => {
      const ctx = new MultiLevelContext();

      // Soft delete root blog
      await ctx.blogs.remove(1);

      // Level 1: Blog is soft-deleted
      const activeBlogs = await ctx.blogs.toList();
      expect(activeBlogs.find(b => b.id === 1)).toBeUndefined();

      // Level 2: Article is soft-deleted
      const activeArticles = await ctx.articles.toList();
      expect(activeArticles.find(a => a.id === 101)).toBeUndefined();

      // Level 3: Review on Article 101 is soft-deleted
      const activeReviews = await ctx.reviews.toList();
      expect(activeReviews.find(r => r.id === 1001)).toBeUndefined();

      // Unrelated review on article 999 is unaffected
      expect(activeReviews.find(r => r.id === 1002)).toBeDefined();
    });
  });
});
