import { Router, Request, Response, NextFunction } from 'express';
import { AppDbContext } from '../database/AppDbContext';

export const transactionRouter = Router();

function getDb(req: Request): AppDbContext {
  return (req as any).dbContext as AppDbContext;
}

/**
 * 27. Atomic Multi-Entity Insertion via useTransaction()
 * POST /api/transactions/atomic-multi-entity
 * Inserts User + Profile + Post + AuditLog atomically.
 * If simulateError=true is passed, rolls back completely.
 */
transactionRouter.post(
  '/atomic-multi-entity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb(req);
      const { name, email, bio, postTitle, postContent, simulateError } = req.body;

      const result = await db.useTransaction(async tx => {
        // 1. Create User in transaction
        const user = await db.users.inTransaction(tx).add({
          name: name || 'Transaction Demo User',
          email: email || `tx-${Date.now()}@example.com`,
          role: 'user',
          score: 100,
        });

        // 2. Create Profile in transaction
        const profile = await db.profiles.inTransaction(tx).add({
          userId: user.id,
          bio: bio || 'Created atomically inside a transaction.',
        });

        // 3. Create Initial Post in transaction
        const post = await db.posts.inTransaction(tx).add({
          userId: user.id,
          title: postTitle || 'My First Atomic Post',
          content: postContent || 'This post was saved within a transaction block.',
        });

        // 4. Log the audit event in transaction
        const audit = await db.auditLogs.inTransaction(tx).add({
          action: 'CREATE_USER_BUNDLE',
          entityName: 'User',
          entityId: user.id,
          details: `Created user ${user.id} with profile ${profile.id} and post ${post.id}.`,
        });

        if (simulateError) {
          throw new Error('Simulated failure triggering automatic transaction rollback!');
        }

        return { user, profile, post, audit };
      });

      res.status(201).json({
        message: 'All entities created atomically within transaction.',
        result,
      });
    } catch (err: any) {
      if (req.body.simulateError) {
        res.status(400).json({
          status: 'Rolled back',
          error: err.message,
          explanation: 'All changes were cleanly rolled back. No records were persisted.',
        });
        return;
      }
      next(err);
    }
  },
);

/**
 * 28. Credit / Score Transfer between Users with Rollback Protection
 * POST /api/transactions/credit-transfer
 */
transactionRouter.post(
  '/credit-transfer',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = getDb(req);
      const { fromUserId, toUserId, amount } = req.body;

      if (!fromUserId || !toUserId || !amount || amount <= 0) {
        res
          .status(400)
          .json({ error: 'fromUserId, toUserId, and a positive amount are required.' });
        return;
      }

      const result = await db.useTransaction(async tx => {
        const userA = await db.users.inTransaction(tx).find(Number(fromUserId));
        const userB = await db.users.inTransaction(tx).find(Number(toUserId));

        if (!userA) throw new Error(`Source user ${fromUserId} not found.`);
        if (!userB) throw new Error(`Target user ${toUserId} not found.`);

        if (userA.score < amount) {
          throw new Error(
            `Insufficient score/credits: User ${userA.id} has ${userA.score}, requested ${amount}.`,
          );
        }

        // Deduct from A
        const updatedA = await db.users
          .inTransaction(tx)
          .update(userA.id, { score: userA.score - amount });

        // Credit to B
        const updatedB = await db.users
          .inTransaction(tx)
          .update(userB.id, { score: userB.score + amount });

        // Record audit
        await db.auditLogs.inTransaction(tx).add({
          action: 'TRANSFER_CREDITS',
          entityName: 'User',
          entityId: userA.id,
          details: `Transferred ${amount} score from User ${userA.id} to User ${userB.id}`,
        });

        return { from: updatedA, to: updatedB, amountTransferred: amount };
      });

      res.json({ message: 'Credits transferred successfully.', result });
    } catch (err: any) {
      res.status(400).json({ error: err.message, status: 'Transaction rolled back' });
    }
  },
);

/**
 * 29. Resilient Transaction with Auto-Retry Execution Strategy
 * POST /api/transactions/resilient
 */
transactionRouter.post('/resilient', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDb(req);

    const result = await db.executeResilientTransaction(async tx => {
      const log = await db.auditLogs.inTransaction(tx).add({
        action: 'RESILIENT_TX',
        entityName: 'System',
        details: 'Executed within resilient retry wrapper at ' + new Date().toISOString(),
      });
      return log;
    });

    res.json({
      message: 'Resilient transaction executed with automatic retry strategy.',
      result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 30. Manual Transaction with Savepoints
 * POST /api/transactions/savepoints
 */
transactionRouter.post('/savepoints', async (req: Request, res: Response, next: NextFunction) => {
  const db = getDb(req);
  const tx = await db.beginTransaction();

  try {
    // 1. Initial change in transaction
    const user = await db.users.inTransaction(tx).add({
      name: 'Savepoint Primary User',
      email: `sp-primary-${Date.now()}@example.com`,
      role: 'user',
      score: 50,
    });

    // 2. Set Savepoint
    await tx.savepoint('sp_after_primary');

    // 3. Speculative change that we decide to revert
    await db.users.inTransaction(tx).add({
      name: 'Speculative User To Be Reverted',
      email: `sp-speculative-${Date.now()}@example.com`,
      role: 'guest',
      score: 0,
    });

    // 4. Rollback to savepoint (undoing speculative change while keeping primary)
    await tx.rollbackTo('sp_after_primary');

    // 5. Commit remaining changes
    await tx.commit();

    res.json({
      message: 'Savepoint rollback successful: speculative user undone, primary user committed.',
      committedUser: user,
    });
  } catch (err) {
    await tx.rollback();
    next(err);
  }
});
