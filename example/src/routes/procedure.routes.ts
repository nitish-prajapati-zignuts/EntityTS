import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';
import { SqlType } from 'entityts';

export const procedureRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

/**
 * 1. Execute Stored Procedure / Function Returning Single Result Set
 * POST /api/procedures/top-users
 */
procedureRouter.post('/top-users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { minScore = 50, limit = 10 } = req.body;

    // Fluent StoredProcedureBuilder withParam
    const result = await db
      .procedure('usp_GetTopUsers')
      .withParam('minScore', Number(minScore), SqlType.Int)
      .withParam('limitCount', Number(limit), SqlType.Int)
      .query<{ id: number; name: string; score: number }>();

    res.json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Execute Stored Procedure with OUTPUT Parameters & Multiple Result Sets
 * POST /api/procedures/customer-dashboard
 */
procedureRouter.post(
  '/customer-dashboard',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb(req);
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({ error: 'userId is required.' });
        return;
      }

      // Capture multiple result sets (User details + User posts + Aggregate stats)
      const { records, out, rowsAffected } = await db
        .procedure('usp_GetUserDashboard')
        .input({ UserId: Number(userId) })
        .output<{ ServerExecutionTimeMs: number; Status: string }>()
        .queryMultiple<
          [
            Array<{ id: number; name: string; email: string }>,
            Array<{ id: number; title: string; views: number }>,
            Array<{ totalPosts: number; avgViews: number }>,
          ]
        >();

      const [userRecord, posts, summary] = records;

      res.json({
        success: true,
        user: userRecord[0] || null,
        posts,
        summary: summary[0] || null,
        serverStats: out,
        rowsAffected,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 3. Execute Scalar Stored Procedure / Function
 * POST /api/procedures/calculate-discount
 */
procedureRouter.post(
  '/calculate-discount',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb(req);
      const { originalPrice, discountPercent } = req.body;

      const finalPrice = await db
        .procedure('fn_CalculateDiscount')
        .withParam('originalPrice', Number(originalPrice), SqlType.Decimal)
        .withParam('discountPercent', Number(discountPercent), SqlType.Decimal)
        .scalar<number>();

      res.json({
        originalPrice,
        discountPercent,
        finalPrice,
      });
    } catch (err) {
      next(err);
    }
  },
);
