import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';
import { SqlType } from 'entityts';

export const sqlRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

/**
 * 31. Parameterized Raw SQL Query via ctx.fromSql()
 * GET /api/sql/raw-query?minScore=80
 */
sqlRouter.get('/raw-query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const minScore = parseInt(String(req.query.minScore || '70'), 10);

    // Secure parameterized query with @p0, @p1 placeholders
    const rows = await db.fromSql<{ id: number; name: string; email: string; score: number }>(
      'SELECT id, name, email, score FROM users WHERE score >= @p0 AND deleted_at IS NULL ORDER BY score DESC',
      [minScore],
    );

    res.json({
      parameter: { minScore },
      count: rows.length,
      rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 32. Parameterized Raw SQL Command via ctx.executeSql()
 * POST /api/sql/raw-execute
 * Body: { bonus: 5, role: 'user' }
 */
sqlRouter.post('/raw-execute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const bonus = Number(req.body.bonus || 5);
    const role = String(req.body.role || 'user');

    const result = await db.executeSql(
      'UPDATE users SET score = score + @p0 WHERE role = @p1 AND deleted_at IS NULL',
      [bonus, role],
    );

    res.json({
      message: `Bonus score added to all users with role '${role}'.`,
      rowsAffected: result.rowsAffected,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 33. Tagged Template SQL Literal via ctx.sql`...`
 * GET /api/sql/tagged-query?role=admin&minScore=50
 */
sqlRouter.get('/tagged-query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const role = String(req.query.role || 'admin');
    const minScore = Number(req.query.minScore || 50);

    // Completely injection-safe tagged template with dialect-appropriate placeholders
    const rows = await db.sql<{ id: number; name: string; email: string; score: number }>`
      SELECT id, name, email, score
      FROM users
      WHERE role = ${role} AND score >= ${minScore} AND deleted_at IS NULL
      ORDER BY id ASC
    `;

    res.json({
      params: { role, minScore },
      count: rows.length,
      rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 34. Stored Procedure Builder Inspection & Demonstration
 * GET /api/sql/procedure-demo
 */
sqlRouter.get('/procedure-demo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);

    // Stored Procedure builder demonstrates fluent typed parameters
    const procBuilder = db
      .procedure('usp_GetTopUsers')
      .withParam('MinScore', 80, SqlType.Int)
      .withParam('RoleFilter', 'admin', SqlType.VarChar)
      .withOutputParam('TotalMatched', SqlType.Int)
      .withReturnValue();

    console.log(procBuilder);

    res.json({
      message: 'Stored Procedure builder initialized with typed parameters.',
      procedureName: 'usp_GetTopUsers',
      details: {
        provider: db.provider,
        featureInfo:
          'When running against SQL Server, Postgres, or MySQL, this executes the native stored procedure with typed output parameters and multiple result sets.',
      },
    });
  } catch (err) {
    next(err);
  }
});
