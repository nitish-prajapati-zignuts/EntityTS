import { DbSet } from '../src/set/DbSet';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { encodeCursor, decodeCursor } from '../src/query/CursorPagination';

interface Post {
  id: number;
  title: string;
  createdAt: string;
  status: string;
  [key: string]: unknown;
}

describe('Keyset (Cursor-Based) & Offset Pagination', () => {
  let adapter: MockDbAdapter;
  let postSet: DbSet<Post>;

  const initialPosts: Post[] = [
    { id: 1, title: 'Post A', createdAt: '2026-01-01T00:00:00Z', status: 'published' },
    { id: 2, title: 'Post B', createdAt: '2026-01-02T00:00:00Z', status: 'published' },
    { id: 3, title: 'Post C', createdAt: '2026-01-03T00:00:00Z', status: 'published' },
    { id: 4, title: 'Post D', createdAt: '2026-01-04T00:00:00Z', status: 'published' },
    { id: 5, title: 'Post E', createdAt: '2026-01-05T00:00:00Z', status: 'published' },
    { id: 6, title: 'Post F', createdAt: '2026-01-06T00:00:00Z', status: 'published' },
    { id: 7, title: 'Post G', createdAt: '2026-01-07T00:00:00Z', status: 'draft' },
  ];

  beforeEach(() => {
    adapter = new MockDbAdapter({
      tables: {
        posts: initialPosts,
      },
    });
    postSet = new DbSet<Post>(adapter, 'posts');
  });

  describe('encodeCursor & decodeCursor', () => {
    it('encodes and decodes cursor data into URL-safe base64 string', () => {
      const payload = { createdAt: '2026-01-03T00:00:00Z', id: 3 };
      const token = encodeCursor(payload);
      expect(typeof token).toBe('string');
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');

      const decoded = decodeCursor(token);
      expect(decoded).toEqual(payload);
    });

    it('handles raw object if passed as cursor', () => {
      const payload = { createdAt: '2026-01-03T00:00:00Z', id: 3 };
      const decoded = decodeCursor(payload);
      expect(decoded).toEqual(payload);
    });

    it('returns null on invalid cursor string', () => {
      expect(decodeCursor('invalid-not-json-token')).toBeNull();
      expect(decodeCursor('')).toBeNull();
    });
  });

  describe('.toCursorPage() Keyset Pagination', () => {
    it('fetches first page with limit and generates nextCursor', async () => {
      const page1 = await postSet.where({ status: 'published' }).toCursorPage({
        limit: 2,
        orderBy: p => p.createdAt,
        direction: 'asc',
      });

      expect(page1.items).toHaveLength(2);
      expect(page1.items[0].title).toBe('Post A');
      expect(page1.items[1].title).toBe('Post B');
      expect(page1.hasNextPage).toBe(true);
      expect(page1.hasPreviousPage).toBe(false);
      expect(page1.nextCursor).toBeTruthy();
    });

    it('fetches second page using nextCursor token', async () => {
      // First page
      const page1 = await postSet.where({ status: 'published' }).toCursorPage({
        limit: 2,
        orderBy: p => p.createdAt,
        direction: 'asc',
      });

      // Second page
      const page2 = await postSet.where({ status: 'published' }).toCursorPage({
        cursor: page1.nextCursor!,
        limit: 2,
        orderBy: p => p.createdAt,
        direction: 'asc',
      });

      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].title).toBe('Post C');
      expect(page2.items[1].title).toBe('Post D');
      expect(page2.hasNextPage).toBe(true);
      expect(page2.hasPreviousPage).toBe(true);
      expect(page2.prevCursor).toBeTruthy();
    });

    it('navigates in descending order (newest first)', async () => {
      const page = await postSet.where({ status: 'published' }).toCursorPage({
        limit: 3,
        orderBy: p => p.createdAt,
        direction: 'desc',
      });

      expect(page.items).toHaveLength(3);
      expect(page.items[0].title).toBe('Post F');
      expect(page.items[1].title).toBe('Post E');
      expect(page.items[2].title).toBe('Post D');
      expect(page.hasNextPage).toBe(true);
    });

    it('sets hasNextPage to false when reaching the last page', async () => {
      const page = await postSet.where({ status: 'published' }).toCursorPage({
        limit: 10,
        orderBy: 'createdAt',
        direction: 'asc',
      });

      expect(page.items).toHaveLength(6);
      expect(page.hasNextPage).toBe(false);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('.toPagedList() Page-Number Pagination', () => {
    it('supports traditional signature toPagedList(page, pageSize)', async () => {
      const result = await postSet.toPagedList(1, 3);

      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(7);
      expect(result.totalCount).toBe(7);
      expect(result.page).toBe(1);
      expect(result.pageIndex).toBe(1);
      expect(result.pageSize).toBe(3);
      expect(result.totalPages).toBe(3);
      expect(result.hasNext).toBe(true);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPrevious).toBe(false);
      expect(result.hasPreviousPage).toBe(false);
    });

    it('supports options object signature toPagedList({ page, pageSize })', async () => {
      const result = await postSet.toPagedList({ page: 2, pageSize: 3 });

      expect(result.items).toHaveLength(3);
      expect(result.pageIndex).toBe(2);
      expect(result.hasNextPage).toBe(true);
      expect(result.hasPreviousPage).toBe(true);
    });

    it('correctly marks last page flags', async () => {
      const result = await postSet.toPagedList({ page: 3, pageSize: 3 });

      expect(result.items).toHaveLength(1);
      expect(result.pageIndex).toBe(3);
      expect(result.hasNextPage).toBe(false);
      expect(result.hasPreviousPage).toBe(true);
    });
  });
});
