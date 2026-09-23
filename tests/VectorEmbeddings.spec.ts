import { Table, PrimaryKey, Column, Vector } from '../src/decorators';
import { ModelMetadataRegistry } from '../src/model/EntityMetadata';
import { DbSet } from '../src/set/DbSet';
import { MockDbAdapter } from '../src/adapters/MockDbAdapter';
import { PostgresAdapter } from '../src/adapters/PostgresAdapter';

@Table('documents')
class Document {
  @PrimaryKey()
  id!: number;

  @Column()
  title!: string;

  @Vector(1536)
  @Column()
  embedding!: number[];
}

describe('AI Vector Embeddings (pgvector & Semantic Search)', () => {
  it('registers vector metadata with custom dimension size via @Vector decorator', () => {
    const meta = ModelMetadataRegistry.getInstance().get(Document);
    expect(meta).toBeDefined();

    const embeddingCol = meta?.columns.get('embedding');
    expect(embeddingCol).toBeDefined();
    expect(embeddingCol?.isVector).toBe(true);
    expect(embeddingCol?.dimensions).toBe(1536);
  });

  describe('Query compilation with nearest()', () => {
    it('compiles pgvector cosine distance operator <=> on PostgresAdapter', async () => {
      const pg = new PostgresAdapter({ connectionString: 'postgres://localhost/test' });
      const docSet = new DbSet<Document>(pg, Document);

      const qb = (docSet as any).queryBuilder.clone();
      qb.nearest('embedding', [0.1, 0.2, -0.5], { distance: 'cosine', limit: 5 });

      const { sql, params } = qb.toSelectSql();

      expect(sql).toContain('ORDER BY "embedding" <=> $1::vector ASC');
      expect(sql).toContain('LIMIT 5');
      expect(params).toHaveLength(1);
      expect(params[0].value).toBe('[0.1,0.2,-0.5]');
    });

    it('compiles pgvector Euclidean L2 distance operator <->', async () => {
      const pg = new PostgresAdapter({ connectionString: 'postgres://localhost/test' });
      const docSet = new DbSet<Document>(pg, Document);

      const qb = (docSet as any).queryBuilder.clone();
      qb.nearest('embedding', [1, 2, 3], { distance: 'l2', limit: 10 });

      const { sql } = qb.toSelectSql();
      expect(sql).toContain('ORDER BY "embedding" <-> $1::vector ASC');
      expect(sql).toContain('LIMIT 10');
    });

    it('compiles pgvector inner product operator <#>', async () => {
      const pg = new PostgresAdapter({ connectionString: 'postgres://localhost/test' });
      const docSet = new DbSet<Document>(pg, Document);

      const qb = (docSet as any).queryBuilder.clone();
      qb.nearest('embedding', [0.5, 0.5], { distance: 'inner_product' });

      const { sql } = qb.toSelectSql();
      expect(sql).toContain('ORDER BY "embedding" <#> $1::vector ASC');
    });

    it('executes nearest() through DbSet fluent API', async () => {
      const mock = new MockDbAdapter({
        tables: {
          documents: [
            { id: 1, title: 'Doc 1', embedding: [0.1, 0.2] },
            { id: 2, title: 'Doc 2', embedding: [0.9, 0.8] },
          ],
        },
      });

      const docSet = new DbSet<Document>(mock, Document);
      const results = await docSet.nearest('embedding', [0.1, 0.2], { limit: 2 }).toList();

      expect(results).toHaveLength(2);
      expect(mock.executedQueries).toHaveLength(1);
      expect(mock.executedQueries[0].sql).toContain('ORDER BY "embedding" <=> @p0 ASC');
      expect(mock.executedQueries[0].sql).toContain('LIMIT 2');
    });
  });
});
