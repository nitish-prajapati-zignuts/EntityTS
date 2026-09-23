import {
  DbContext,
  DbContextOptionsBuilder,
  DbSet,
  Table,
  Entity,
  PrimaryKey,
  Column,
  SoftDelete,
  CreatedAt,
  UpdatedAt,
  CreatedBy,
  ModelMetadataRegistry,
  GlobalQueryFilterRegistry,
} from '../src';

@Entity()
@Table('articles')
@SoftDelete('deleted_at')
class Article {
  @PrimaryKey()
  id!: number;

  @Column()
  title!: string;

  @CreatedAt()
  createdAt!: Date;

  @UpdatedAt()
  updatedAt!: Date;

  @CreatedBy()
  createdBy?: string;

  @Column({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}

class TestBlogDbContext extends DbContext {
  public articles!: DbSet<Article>;

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useMock({
      tables: {
        articles: [
          { id: 1, title: 'Active Post 1', deleted_at: null },
          { id: 2, title: 'Active Post 2', deleted_at: null },
          { id: 3, title: 'Deleted Post 3', deleted_at: new Date('2026-01-01') },
        ],
      },
    });
  }
}

describe('Soft Delete, Global Filters, and Audit Decorators', () => {
  let ctx: TestBlogDbContext;

  beforeEach(() => {
    ctx = new TestBlogDbContext();
    ctx.articles = ctx.set(Article);
    ctx.currentUser = 'admin_user';
  });

  describe('Soft Delete', () => {
    it('filters out soft-deleted records by default', async () => {
      const active = await ctx.articles.toList();
      expect(active.length).toBe(2);
      expect(active.every(a => a.deletedAt === null || a.deletedAt === undefined)).toBe(true);
    });

    it('returns all records including soft-deleted with .withDeleted()', async () => {
      const all = await ctx.articles.withDeleted().toList();
      expect(all.length).toBe(3);
    });

    it('returns only soft-deleted records with .onlyDeleted()', async () => {
      const deletedOnly = await ctx.articles.onlyDeleted().toList();
      expect(deletedOnly.length).toBe(1);
      expect(deletedOnly[0].id).toBe(3);
    });

    it('soft deletes by updating deleted_at column instead of SQL DELETE', async () => {
      await ctx.articles.remove(1);
      const post1 = await ctx.articles.withDeleted().find(1);
      expect(post1).toBeDefined();
      expect(post1!.deletedAt).toBeDefined();

      // Should no longer appear in normal query
      const active = await ctx.articles.toList();
      expect(active.find(a => a.id === 1)).toBeUndefined();
    });

    it('hard deletes record completely with hardRemove()', async () => {
      await ctx.articles.hardRemove(2);
      const post2 = await ctx.articles.withDeleted().find(2);
      expect(post2).toBeNull();
    });
  });

  describe('Audit Fields', () => {
    it('automatically populates createdAt, updatedAt, and createdBy on add()', async () => {
      const newArticle = await ctx.articles.add({
        id: 4,
        title: 'Freshly Created Post',
      });

      expect(newArticle.createdAt).toBeInstanceOf(Date);
      expect(newArticle.updatedAt).toBeInstanceOf(Date);
      expect(newArticle.createdBy).toBe('admin_user');
    });

    it('automatically updates updatedAt on update()', async () => {
      const beforeUpdate = new Date(Date.now() - 5000);
      const updated = await ctx.articles.update(1, { title: 'Updated Title' });
      expect(updated.title).toBe('Updated Title');
      expect(updated.updatedAt).toBeDefined();
    });
  });

  describe('Global Query Filters', () => {
    it('applies registered global filter to all queries', async () => {
      GlobalQueryFilterRegistry.getInstance().register(Article, clause => {
        clause.eq('title', 'Active Post 2');
      });

      const filtered = await ctx.articles.toList();
      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Active Post 2');

      // Opt out of global query filters
      const unfiltered = await ctx.articles.ignoreQueryFilters().toList();
      expect(unfiltered.length).toBe(2);

      GlobalQueryFilterRegistry.getInstance().clear();
    });
  });
});
