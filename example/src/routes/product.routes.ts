import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';
import { DbUpdateConcurrencyException } from '@nsp/dbcontext';

export const productRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

/**
 * List all products
 * GET /api/products
 */
productRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const category = req.query.category ? String(req.query.category) : undefined;

    let query = db.products.orderBy('id', 'asc');
    if (category) {
      query = db.products.where({ category }).orderBy('id', 'asc');
    }

    const items = await query.toList();
    res.json({ count: items.length, items });
  } catch (err) {
    next(err);
  }
});

/**
 * Get product by ID
 * GET /api/products/:id
 */
productRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);
    const item = await db.products.find(id);

    if (!item) {
      res.status(404).json({ error: `Product with id ${id} not found.` });
      return;
    }

    res.json(item);
  } catch (err) {
    next(err);
  }
});

/**
 * 22. High-Performance Bulk Insert
 * POST /api/products/bulk-insert
 */
productRouter.post('/bulk-insert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be an array of products to insert.' });
      return;
    }

    const batchSize = parseInt(String(req.query.batchSize || '250'), 10);
    const insertedCount = await db.products.bulkInsert(items, {
      batchSize,
      ignoreDuplicates: true,
    });

    res.status(201).json({
      message: `Bulk inserted ${insertedCount} products.`,
      count: insertedCount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 23. High-Performance Bulk Update by matching Keys
 * PUT /api/products/bulk-update
 */
productRouter.put('/bulk-update', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be an array of product patches with `id`.' });
      return;
    }

    const affected = await db.products.bulkUpdate(items, {
      keys: ['id'],
      update: ['price', 'stock'],
    });

    res.json({
      message: `Bulk updated products successfully.`,
      affectedRows: affected,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 24. High-Performance Bulk Upsert (insert or update on conflict)
 * POST /api/products/bulk-upsert
 */
productRouter.post('/bulk-upsert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be an array of products for upsert.' });
      return;
    }

    const affected = await db.products.bulkUpsert(items, {
      conflictKeys: ['sku'],
      update: ['name', 'price', 'stock', 'category'],
    });

    res.json({
      message: `Bulk upserted products successfully.`,
      affectedRows: affected,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 25. High-Performance Bulk Delete
 * DELETE /api/products/bulk-delete?category=Discontinued
 */
productRouter.delete('/bulk-delete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const category = req.query.category ? String(req.query.category) : undefined;

    if (!category) {
      res.status(400).json({ error: 'Category query parameter is required for bulk delete.' });
      return;
    }

    const affected = await db.products.bulkDelete({ category });

    res.json({
      message: `Bulk deleted products in category '${category}'.`,
      affectedRows: affected,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 26. Optimistic Concurrency Control with @Version()
 * PUT /api/products/:id/concurrency
 * Body: { price: number, expectedVersion: number }
 */
productRouter.put('/:id/concurrency', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const id = Number(req.params.id);
    const { price, stock, expectedVersion } = req.body;

    if (expectedVersion === undefined) {
      res.status(400).json({
        error: '`expectedVersion` is required to demonstrate optimistic concurrency control.',
      });
      return;
    }

    const patch: any = {};
    if (price !== undefined) patch.price = Number(price);
    if (stock !== undefined) patch.stock = Number(stock);

    const updated = await db.products.update(
      id,
      patch,
      Number(expectedVersion)
    );

    res.json({
      message: 'Product updated successfully under optimistic concurrency.',
      product: updated,
    });
  } catch (err) {
    if (err instanceof DbUpdateConcurrencyException) {
      res.status(409).json({
        error: 'Concurrency conflict detected',
        message: err.message,
        entityName: err.entityName,
        entityKey: err.entityKey,
      });
      return;
    }
    next(err);
  }
});
