import {
  DbContext,
  DbContextOptionsBuilder,
  Table,
  PrimaryKey,
  Column,
  HasMany,
  BelongsTo,
  LazyRelation,
  WithLoaded,
} from '../src';

@Table('lazy_users')
class LazyUser {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column()
  name!: string;

  @HasMany(() => LazyPost, { foreignKey: 'userId', lazy: true })
  posts!: LazyRelation<LazyPost[]> | LazyPost[];
}

@Table('lazy_posts')
class LazyPost {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column()
  userId!: number;

  @Column()
  title!: string;

  @BelongsTo(() => LazyUser, { foreignKey: 'userId', lazy: true })
  user?: LazyRelation<LazyUser> | LazyUser;
}

class TestLazyDbContext extends DbContext {
  public readonly users = this.set(LazyUser);
  public readonly posts = this.set(LazyPost);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:');
  }
}

describe('Transparent Lazy Loading & Type Narrowing', () => {
  let ctx: TestLazyDbContext;
  let user1: LazyUser;
  let post1: LazyPost;
  let post2: LazyPost;

  beforeAll(async () => {
    ctx = new TestLazyDbContext();
    await ctx.ensureCreated();

    user1 = await ctx.users.add({ name: 'Alice Walker' });
    post1 = await ctx.posts.add({ userId: user1.id, title: 'First Article' });
    post2 = await ctx.posts.add({ userId: user1.id, title: 'Second Article' });
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  describe('LazyRelation with .fetch(), .resolve(), .get(), and .isFetched()', () => {
    it('instantiates LazyRelation on unpopulated relations when lazy: true is configured', async () => {
      const user = await ctx.users.find(user1.id);
      expect(user).not.toBeNull();
      expect(user!.posts).toBeInstanceOf(LazyRelation);

      const lazy = user!.posts as LazyRelation<LazyPost[]>;
      expect(lazy.isFetched()).toBe(false);

      // Fetch on demand using .fetch()
      const fetchedPosts = await lazy.fetch();
      expect(Array.isArray(fetchedPosts)).toBe(true);
      expect(fetchedPosts.length).toBe(2);
      expect(fetchedPosts.map(p => p.title)).toEqual(['First Article', 'Second Article']);
      expect(lazy.isFetched()).toBe(true);

      // Replaced directly on parent entity
      expect(Array.isArray(user!.posts)).toBe(true);
    });

    it('supports .resolve() and .get() aliases instead of the word load', async () => {
      const post = await ctx.posts.find(post1.id);
      expect(post).not.toBeNull();
      expect(post!.user).toBeInstanceOf(LazyRelation);

      const lazyUser = post!.user as LazyRelation<LazyUser>;
      expect(lazyUser.isFetched()).toBe(false);

      // Use .resolve() alias
      const resolvedUser = await lazyUser.resolve();
      expect(resolvedUser.name).toBe('Alice Walker');
      expect(lazyUser.isFetched()).toBe(true);

      // Second post using .get() alias
      const postB = await ctx.posts.find(post2.id);
      const lazyUserB = postB!.user as LazyRelation<LazyUser>;
      const gotUser = await lazyUserB.get();
      expect(gotUser.name).toBe('Alice Walker');
    });
  });

  describe('DbContext.fetchRelation() & DbSet.fetchRelation()', () => {
    it('dynamically fetches relations via ctx.fetchRelation(entity, relationName)', async () => {
      const user = await ctx.users.find(user1.id);
      const posts = await ctx.fetchRelation<LazyUser, LazyPost[]>(user!, 'posts');

      expect(Array.isArray(posts)).toBe(true);
      expect(posts.length).toBe(2);
    });

    it('dynamically fetches relations via set.fetchRelation(entity, relationName)', async () => {
      const post = await ctx.posts.find(post1.id);
      const user = await ctx.posts.fetchRelation<LazyUser>(post!, 'user');

      expect(user).toBeDefined();
      expect(user.name).toBe('Alice Walker');
    });
  });

  describe('DbSet.withLazy()', () => {
    it('enables lazy relation proxies dynamically for a query chain', async () => {
      const users = await ctx.users.withLazy().toList();
      expect(users.length).toBe(1);
      expect(users[0].posts).toBeInstanceOf(LazyRelation);

      const loaded = await (users[0].posts as LazyRelation<LazyPost[]>).fetch();
      expect(loaded.length).toBe(2);
    });
  });

  describe('Compile-Time Relation Projection Type Narrowing (WithLoaded<T, K>)', () => {
    it('narrows entity type at compile time when including relations', async () => {
      const users = await ctx.users.include('posts').toList();
      const firstUser: WithLoaded<LazyUser, 'posts'> = users[0];
      expect(firstUser.posts).toBeDefined();
      expect(Array.isArray(firstUser.posts)).toBe(true);
      expect((firstUser.posts as LazyPost[]).length).toBe(2);
    });
  });
});
