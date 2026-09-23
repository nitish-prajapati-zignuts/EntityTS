import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';
import { EntityNotFoundException } from 'entityts';

export const userRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Single Entity Insertion
 * POST /api/users
 */
userRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { name, email, role, score } = req.body;

    if (!name || !email) {
      res.status(400).json({ error: 'Name and email are required.' });
      return;
    }

    const newUser = await db.users.add({
      name,
      email,
      role: role || 'user',
      score: score !== undefined ? Number(score) : 0,
    });

    res.status(201).json(newUser);
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Batch Entity Insertion
 * POST /api/users/batch
 */
userRouter.post('/batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const usersData = req.body;

    if (!Array.isArray(usersData) || usersData.length === 0) {
      res.status(400).json({ error: 'Request body must be a non-empty array of users.' });
      return;
    }

    const createdUsers = await db.users.addRange(usersData);
    res.status(201).json({
      count: createdUsers.length,
      users: createdUsers,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// READ SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3. Filtered & Sorted Query using LINQ-like Fluent Builder
 * GET /api/users
 * Optional query params: role, minScore, maxScore, orderBy, order, skip, take
 */
userRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { role, minScore, maxScore, orderBy, order, skip, take } = req.query;

    let query = db.users.where(q => {
      let builder = q;
      if (role) {
        builder = builder.eq('role', String(role));
      }
      if (minScore !== undefined) {
        builder = role
          ? builder.and().gte('score', Number(minScore))
          : builder.gte('score', Number(minScore));
      }
      if (maxScore !== undefined) {
        builder =
          role || minScore !== undefined
            ? builder.and().lte('score', Number(maxScore))
            : builder.lte('score', Number(maxScore));
      }
      return builder;
    });

    if (orderBy) {
      const dir = String(order).toLowerCase() === 'desc' ? 'desc' : 'asc';
      query = query.orderBy(String(orderBy) as any, dir);
    } else {
      query = query.orderBy('id', 'asc');
    }

    if (skip !== undefined) {
      query = query.skip(Number(skip));
    }
    if (take !== undefined) {
      query = query.take(Number(take));
    }

    const items = await query.toList();
    res.json({ count: items.length, items });
  } catch (err) {
    next(err);
  }
});

/**
 * 4. Offset Pagination with Metadata
 * GET /api/users/paged?page=1&pageSize=10
 */
userRouter.get('/paged', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.max(1, parseInt(String(req.query.pageSize || '10'), 10));

    const pagedResult = await db.users.orderBy('id', 'asc').toPagedList(page, pageSize);
    res.json(pagedResult);
  } catch (err) {
    next(err);
  }
});

/**
 * 5. Keyset / Cursor Pagination (High efficiency for feeds/infinite scroll)
 * GET /api/users/cursor?cursor=...&limit=5&direction=forward
 */
userRouter.get('/cursor', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
    const limit = Math.max(1, parseInt(String(req.query.limit || '5'), 10));
    const direction = req.query.direction === 'backward' ? 'desc' : 'asc';

    const cursorResult = await db.users.toCursorPage({
      cursor,
      limit,
      direction,
      orderBy: 'id',
    });

    res.json(cursorResult);
  } catch (err) {
    next(err);
  }
});

/**
 * 6. Multi-Column Full-Text Search
 * GET /api/users/search?q=alice
 */
userRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const term = String(req.query.q || '').trim();

    if (!term) {
      res.status(400).json({ error: 'Search term query parameter `q` is required.' });
      return;
    }

    const results = await db.users.whereSearch(['name', 'email'], term).toList();
    res.json({ term, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

/**
 * 7. Aggregate Calculations (count, avg, min, max, sum)
 * GET /api/users/stats
 */
userRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);

    const count = await db.users.count();
    const avgScore = await db.users.avg('score');
    const minScore = await db.users.min<number>('score');
    const maxScore = await db.users.max<number>('score');
    const sumScore = await db.users.sum('score');

    res.json({
      totalUsers: count,
      averageScore: avgScore,
      minScore,
      maxScore,
      totalScoreSum: sumScore,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 8. Transparent Query Caching Demo
 * GET /api/users/cache/demo
 */
userRouter.get('/cache/demo', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const start = Date.now();
    // Cache this specific query for 15 seconds with custom key
    const cachedItems = await db.users.cache(15000, 'all-active-users-cache').toList();
    const durationMs = Date.now() - start;

    res.json({
      durationMs,
      fromCache: durationMs < 5, // if very fast, it was served from MemoryQueryCache
      count: cachedItems.length,
      items: cachedItems,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 9. Invalidate Query Cache
 * POST /api/users/cache/invalidate
 */
userRouter.post('/cache/invalidate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    await db.users.invalidateCache();
    res.json({ message: 'User query cache cleared successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * 10. Soft-Delete Trash View (only deleted rows)
 * GET /api/users/trash
 */
userRouter.get('/trash', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const deletedUsers = await db.users.onlyDeleted().toList();
    res.json({ count: deletedUsers.length, items: deletedUsers });
  } catch (err) {
    next(err);
  }
});

/**
 * 11. View All Rows (active + soft-deleted)
 * GET /api/users/with-deleted
 */
userRouter.get('/with-deleted', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const allUsers = await db.users.withDeleted().toList();
    res.json({ count: allUsers.length, items: allUsers });
  } catch (err) {
    next(err);
  }
});

/**
 * 12. Single Entity Lookup by Primary Key
 * GET /api/users/:id
 */
userRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);
    const user = await db.users.find(id);

    if (!user) {
      res.status(404).json({ error: `User with id ${id} not found.` });
      return;
    }

    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * 13. Eager Loading Relationships (.include())
 * GET /api/users/:id/relations
 */
userRouter.get('/:id/relations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);

    const users = await db.users.include('profile').include('posts').where({ id }).toList();

    const userWithRelations = users[0];

    if (!userWithRelations) {
      res.status(404).json({ error: `User with id ${id} not found.` });
      return;
    }

    res.json(userWithRelations);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 14. Direct Update by ID
 * PUT /api/users/:id
 */
userRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);
    const { name, email, role, score } = req.body;

    const existing = await db.users.find(id);
    if (!existing) {
      res.status(404).json({ error: `User with id ${id} not found.` });
      return;
    }

    const patch: any = {};
    if (name !== undefined) patch.name = name;
    if (email !== undefined) patch.email = email;
    if (role !== undefined) patch.role = role;
    if (score !== undefined) patch.score = Number(score);

    const updated = await db.users.update(id, patch);

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * 15. Conditional Update (update matching predicate via bulkUpdate)
 * PATCH /api/users/bulk-promote
 */
userRouter.patch('/bulk-promote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const minScore = Number(req.query.minScore || 80);
    const newRole = String(req.body.role || 'vip');

    const usersToPromote = await db.users.where({ role: 'user' }).toList();
    const affected = await db.users.bulkUpdate(
      usersToPromote.map(u => ({ id: u.id, role: newRole })),
      { keys: ['id'], update: ['role'] },
    );

    res.json({
      message: `Updated users with role 'user' to '${newRole}'.`,
      affectedRows: affected,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 16. Upsert (Insert or Update on conflict)
 * POST /api/users/upsert
 */
userRouter.post('/upsert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { name, email, role, score } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required for upsert operation.' });
      return;
    }

    const result = await db.users.upsert(
      {
        name: name || 'Anonymous',
        email,
        role: role || 'user',
        score: score !== undefined ? Number(score) : 50,
      },
      ['email'],
    );

    res.json({ message: 'User upserted successfully.', result });
  } catch (err) {
    next(err);
  }
});

/**
 * 17. Change Tracker Proxy Mutation (EF Core style)
 * PATCH /api/users/:id/track
 */
userRouter.patch('/:id/track', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);

    // 1. Begin tracking entity
    const trackedUser = await db.users.track(id);

    // 2. Modify properties directly - intercepted by ES Proxy
    if (req.body.name !== undefined) trackedUser.name = req.body.name;
    if (req.body.score !== undefined) trackedUser.score = Number(req.body.score);
    if (req.body.role !== undefined) trackedUser.role = req.body.role;

    // 3. Flush all tracked modifications
    const savedCount = await db.saveChanges();

    res.json({
      message: `Flushed ${savedCount} tracked changes to database.`,
      savedCount,
      user: trackedUser,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 18. Restore Soft-Deleted Entity
 * POST /api/users/:id/restore
 */
userRouter.post('/:id/restore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);

    const deletedUser = await db.users.onlyDeleted().find(id);
    if (!deletedUser) {
      res.status(404).json({ error: `Deleted user with id ${id} not found.` });
      return;
    }

    const restored = await db.users.withDeleted().update(id, { deletedAt: null as any });
    res.json({ message: `User ${id} restored successfully.`, restored });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 19. Soft Delete Entity (auto sets deleted_at)
 * DELETE /api/users/:id
 */
userRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);

    const existing = await db.users.find(id);
    if (!existing) {
      res.status(404).json({ error: `User with id ${id} not found.` });
      return;
    }

    await db.users.remove(id);
    res.status(200).json({ message: `User ${id} soft-deleted.` });
  } catch (err) {
    next(err);
  }
});

/**
 * 20. Permanent Hard Delete
 * DELETE /api/users/:id/permanent
 */
userRouter.delete('/:id/permanent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);

    await db.users.hardRemove(id);
    res.status(200).json({ message: `User ${id} permanently deleted from database.` });
  } catch (err) {
    next(err);
  }
});

/**
 * 21. Conditional Delete (delete matching predicate)
 * DELETE /api/users/by-role/:role
 */
userRouter.delete('/by-role/:role', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const role = String(req.params.role);

    const affected = await db.users.removeWhere({ role });
    res.json({ message: `Soft-deleted users matching role '${role}'.`, affectedRows: affected });
  } catch (err) {
    next(err);
  }
});
