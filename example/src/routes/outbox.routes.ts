import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';
import { OutboxDispatcher } from 'entityts';

export const outboxRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

/**
 * 1. Enqueue Message within an Atomic Database Transaction
 * POST /api/outbox/publish
 */
outboxRouter.post('/publish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { eventType, payload } = req.body;

    if (!eventType || !payload) {
      res.status(400).json({ error: 'eventType and payload are required.' });
      return;
    }

    const outbox = new OutboxDispatcher(db.adapter);
    await outbox.ensureSchema();

    // Atomically commit user action + outbox message in the same transaction
    const result = await db.useTransaction(async tx => {
      const msg = await outbox.enqueue(eventType, payload, tx);
      return msg;
    });

    res.status(201).json({
      success: true,
      message: 'Event successfully published to transactional outbox',
      outboxRecord: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Dispatch Pending Outbox Messages
 * POST /api/outbox/dispatch
 */
outboxRouter.post('/dispatch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);
    const { batchSize = 10 } = req.body;

    const outbox = new OutboxDispatcher(db.adapter);
    await outbox.ensureSchema();
    const dispatchedEvents: Array<{ id: string; type: string }> = [];

    const stats = await outbox.dispatchPending(
      async msg => {
        // Handler simulating publishing to Kafka / RabbitMQ / SQS
        dispatchedEvents.push({ id: msg.id, type: msg.eventType });
      },
      { batchSize: Number(batchSize) },
    );

    res.json({
      success: true,
      stats,
      dispatchedEvents,
    });
  } catch (err) {
    next(err);
  }
});
