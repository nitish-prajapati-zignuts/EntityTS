import { DbSet } from '../src/set/DbSet';
import { QueryBuilder } from '../src/query/QueryBuilder';
import { WhereClause } from '../src/query/WhereClause';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { PostgresAdapter } from '../src/adapters/PostgresAdapter';
import { MysqlAdapter } from '../src/adapters/MysqlAdapter';
import { MssqlAdapter } from '../src/adapters/MssqlAdapter';
import { SqliteAdapter } from '../src/adapters/SqliteAdapter';

interface Article {
  id: number;
  title: string;
  content: string;
  category: string;
  [key: string]: unknown;
}

describe('Native Full-Text Search (.whereSearch)', () => {
  describe('Dialect-Specific SQL Translation', () => {
    it('translates to PostgreSQL to_tsvector and websearch_to_tsquery', () => {
      const adapter = new PostgresAdapter('postgresql://localhost/test');
      const qb = new QueryBuilder<Article>(adapter, 'articles');
      const where = new WhereClause<Article>();

      where.whereSearch(['title', 'content'], 'typescript performance', {
        mode: 'websearch',
        language: 'english',
      });
      qb.where(where);

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain(
        `to_tsvector('english', coalesce("title", '') || ' ' || coalesce("content", '')) @@ websearch_to_tsquery('english', $1)`
      );
      expect(params).toHaveLength(1);
      expect(params[0].value).toBe('typescript performance');
    });

    it('translates to PostgreSQL plainto_tsquery by default', () => {
      const adapter = new PostgresAdapter('postgresql://localhost/test');
      const qb = new QueryBuilder<Article>(adapter, 'articles');
      const where = new WhereClause<Article>();

      where.whereSearch(['title'], 'database');
      qb.where(where);

      const { sql } = qb.toSelectSql();
      expect(sql).toContain(`to_tsvector('english', coalesce("title", '')) @@ websearch_to_tsquery('english', $1)`);
    });

    it('translates to MySQL MATCH ... AGAINST in BOOLEAN MODE', () => {
      const adapter = new MysqlAdapter('mysql://localhost/test');
      const qb = new QueryBuilder<Article>(adapter, 'articles');
      const where = new WhereClause<Article>();

      where.whereSearch(['title', 'content'], '+fast +reliable', { mode: 'boolean' });
      qb.where(where);

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain('MATCH(`title`, `content`) AGAINST(? IN BOOLEAN MODE)');
      expect(params[0].value).toBe('+fast +reliable');
    });

    it('translates to MySQL MATCH ... AGAINST in NATURAL LANGUAGE MODE', () => {
      const adapter = new MysqlAdapter('mysql://localhost/test');
      const qb = new QueryBuilder<Article>(adapter, 'articles');
      const where = new WhereClause<Article>();

      where.whereSearch(['title'], 'machine learning', { mode: 'natural' });
      qb.where(where);

      const { sql } = qb.toSelectSql();
      expect(sql).toContain('MATCH(`title`) AGAINST(? IN NATURAL LANGUAGE MODE)');
    });

    it('translates to MSSQL CONTAINS', () => {
      const adapter = new MssqlAdapter('Server=localhost;Database=test');
      const qb = new QueryBuilder<Article>(adapter, 'articles');
      const where = new WhereClause<Article>();

      where.whereSearch(['title', 'content'], 'high availability');
      qb.where(where);

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain('CONTAINS(([title], [content]), @p0)');
      expect(params[0].value).toBe('high availability');
    });

    it('translates to SQLite LIKE fallback', () => {
      const adapter = new SqliteAdapter(':memory:');
      const qb = new QueryBuilder<Article>(adapter, 'articles');
      const where = new WhereClause<Article>();

      where.whereSearch(['title', 'content'], 'search query');
      qb.where(where);

      const { sql, params } = qb.toSelectSql();
      expect(sql).toContain('("title" LIKE ? OR "content" LIKE ?)');
      expect(params[0].value).toBe('%search query%');
    });
  });

  describe('DbSet.whereSearch() Execution', () => {
    let adapter: MockDbAdapter;
    let articleSet: DbSet<Article>;

    const initialArticles: Article[] = [
      { id: 1, title: 'Learn TypeScript in 2026', content: 'Comprehensive guide to TypeScript ORM design', category: 'Tech' },
      { id: 2, title: 'Database Indexing Strategies', content: 'How B-Trees and Full-Text search indexes scale', category: 'Tech' },
      { id: 3, title: 'Cooking Italian Pasta', content: 'Delicious homemade pasta recipes and sauces', category: 'Food' },
    ];

    beforeEach(() => {
      adapter = new MockDbAdapter({
        tables: {
          articles: initialArticles,
        },
      });
      articleSet = new DbSet<Article>(adapter, 'articles');
    });

    it('searches across multiple columns using whereSearch', async () => {
      const results = await articleSet
        .whereSearch(['title', 'content'], 'TypeScript')
        .toList();

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Learn TypeScript in 2026');
    });

    it('supports arrow selector functions for column specification', async () => {
      const results = await articleSet
        .whereSearch([a => a.title, a => a.content], 'Pasta')
        .toList();

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Cooking Italian Pasta');
    });

    it('combines whereSearch with standard where filters', async () => {
      const results = await articleSet
        .where({ category: 'Tech' })
        .whereSearch(['title', 'content'], 'Indexing')
        .toList();

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(2);
    });

    it('returns empty array when search query matches nothing', async () => {
      const results = await articleSet
        .whereSearch(['title', 'content'], 'quantum computing non-existent')
        .toList();

      expect(results).toHaveLength(0);
    });
  });
});
