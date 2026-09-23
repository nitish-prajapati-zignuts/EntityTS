import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';

export const aiRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

/**
 * 1. Native PostgreSQL Full-Text Search (.whereSearch)
 * GET /api/ai/search?q=query
 */
aiRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { q } = req.query;

    if (!q) {
      res.status(400).json({ error: 'Search query parameter "q" is required.' });
      return;
    }

    const results = await db.documents
      .whereSearch(['title', 'content'], String(q))
      .select('id', 'title', 'category', 'createdAt')
      .take(10)
      .toList();

    res.json({
      query: q,
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. pgvector Semantic Nearest Neighbor Distance Search (.nearest)
 * POST /api/ai/semantic-search
 * Body: { embedding: number[], limit?: number, distance?: 'cosine' | 'l2' | 'inner_product' }
 */
aiRouter.post('/semantic-search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { embedding, limit = 5, distance = 'cosine' } = req.body;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      res.status(400).json({ error: 'Embedding vector array is required.' });
      return;
    }

    const matchedDocs = await db.documents
      .nearest('embedding', embedding, { distance, limit: Number(limit) })
      .select('id', 'title', 'content', 'category')
      .toList();

    res.json({
      distance,
      limit,
      count: matchedDocs.length,
      matches: matchedDocs,
    });
  } catch (err) {
    next(err);
  }
});
