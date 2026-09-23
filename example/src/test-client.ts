import http from 'http';
import { app } from './app';
import { AppDbContext } from './database/AppDbContext';

interface TestSummary {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

const results: TestSummary[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ name, passed: true, durationMs });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${durationMs}ms)\x1b[0m`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ name, passed: false, durationMs, details: err.message });
    console.error(`  \x1b[31m✗\x1b[0m ${name} \x1b[90m(${durationMs}ms)\x1b[0m`);
    console.error(`    \x1b[31mError:\x1b[0m ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log('  @nsp/dbcontext — Comprehensive CRUD End-to-End Test Suite');
  console.log('══════════════════════════════════════════════════════════════════\n');

  // Initialize DB
  const initDb = new AppDbContext();
  await initDb.initDatabase();
  await initDb.dispose();

  // Start ephemeral test server on random free port
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  console.log(`Test server active at: ${baseUrl}\n`);

  try {
    // 1. Health check
    await runTest('GET /health - Database connectivity and ping', async () => {
      const res = await fetch(`${baseUrl}/health`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert(body.status === 'healthy', `Expected healthy status, got ${body.status}`);
      assert(body.database.connected === true, 'Database ping failed');
    });

    // 2. Single Create
    let createdUserId: number = 0;
    await runTest('POST /api/users - Single Entity Insert (.add)', async () => {
      const res = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'admin',
          score: 100,
        }),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      const user: any = await res.json();
      assert(user.id > 0, 'Expected generated user id');
      assert(user.name === 'Ada Lovelace', 'Name mismatch');
      assert(user.createdAt !== undefined, 'Expected @CreatedAt timestamp');
      createdUserId = user.id;
    });

    // 3. Batch Create (.addRange)
    await runTest('POST /api/users/batch - Batch Entities Insert (.addRange)', async () => {
      const res = await fetch(`${baseUrl}/api/users/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([
          { name: 'Grace Hopper', email: 'grace@example.com', role: 'admin', score: 98 },
          { name: 'Margaret Hamilton', email: 'margaret@example.com', role: 'editor', score: 92 },
        ]),
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      const body: any = await res.json();
      assert(body.count === 2, `Expected 2 users, got ${body.count}`);
    });

    // 4. Bulk Insert (.bulkInsert)
    await runTest(
      'POST /api/products/bulk-insert - High-performance Bulk Insert (.bulkInsert)',
      async () => {
        const res = await fetch(`${baseUrl}/api/products/bulk-insert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              sku: 'BULK-001',
              name: 'USB-C Cable 1m',
              category: 'Accessories',
              price: 9.99,
              stock: 200,
            },
            {
              sku: 'BULK-002',
              name: 'USB-C Cable 2m',
              category: 'Accessories',
              price: 14.99,
              stock: 150,
            },
            {
              sku: 'BULK-003',
              name: 'Laptop Stand',
              category: 'Accessories',
              price: 34.99,
              stock: 75,
            },
          ]),
        });
        assert(res.status === 201, `Expected 201, got ${res.status}`);
        const body: any = await res.json();
        assert(body.count === 3, `Expected 3 products, got ${body.count}`);
      },
    );

    // 5. Fluent Filter & Sort (.where, .orderBy)
    await runTest('GET /api/users - Fluent LINQ-style filter & order', async () => {
      const res = await fetch(
        `${baseUrl}/api/users?role=admin&minScore=90&orderBy=score&order=desc`,
      );
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert(body.items.length >= 2, 'Expected at least 2 admin users with score >= 90');
      assert(body.items[0].score >= body.items[1].score, 'Expected descending order');
    });

    // 6. Offset Pagination (.toPagedList)
    await runTest(
      'GET /api/users/paged - Offset Pagination with Metadata (.toPagedList)',
      async () => {
        const res = await fetch(`${baseUrl}/api/users/paged?page=1&pageSize=3`);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.items.length === 3, `Expected 3 items, got ${body.items.length}`);
        assert(body.total > 3, `Expected total > 3, got ${body.total}`);
        assert(body.totalPages >= 2, `Expected totalPages >= 2`);
        assert(body.hasNext === true, 'Expected hasNext true');
      },
    );

    // 7. Cursor Pagination (.toCursorPage)
    await runTest(
      'GET /api/users/cursor - Keyset / Cursor Pagination (.toCursorPage)',
      async () => {
        const res = await fetch(`${baseUrl}/api/users/cursor?limit=2`);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.items.length === 2, `Expected 2 items, got ${body.items.length}`);
        assert(body.nextCursor !== null, 'Expected nextCursor for next page');
      },
    );

    // 8. Multi-column Search (.whereSearch)
    await runTest(
      'GET /api/users/search - Full-Text Multi-Column Search (.whereSearch)',
      async () => {
        const res = await fetch(`${baseUrl}/api/users/search?q=Alice`);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.count >= 1, `Expected at least 1 match for Alice, got ${body.count}`);
        assert(body.results[0].name.includes('Alice'), 'Expected result to contain Alice');
      },
    );

    // 9. Aggregations (count, avg, min, max, sum)
    await runTest(
      'GET /api/users/stats - Aggregate Calculations (.count, .avg, .min, .max, .sum)',
      async () => {
        const res = await fetch(`${baseUrl}/api/users/stats`);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.totalUsers > 0, 'Expected positive totalUsers');
        assert(body.averageScore > 0, 'Expected positive averageScore');
        assert(body.maxScore >= body.minScore, 'Expected maxScore >= minScore');
      },
    );

    // 10. Eager Loading Relations (.include)
    await runTest('GET /api/users/1/relations - Eager loading relations (.include)', async () => {
      const res = await fetch(`${baseUrl}/api/users/1/relations`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const user: any = await res.json();
      assert(user.profile !== undefined, 'Expected eager-loaded profile');
      assert(Array.isArray(user.posts), 'Expected eager-loaded posts array');
    });

    // 11. Query Caching (.cache & .invalidateCache)
    await runTest(
      'GET /api/users/cache/demo & POST /cache/invalidate - Query Cache & Invalidation',
      async () => {
        // 1st request caches it
        const res1 = await fetch(`${baseUrl}/api/users/cache/demo`);
        assert(res1.status === 200, 'Expected 200 on first cache call');

        // 2nd request should hit cache
        const res2 = await fetch(`${baseUrl}/api/users/cache/demo`);
        assert(res2.status === 200, 'Expected 200 on second cache call');

        // Invalidate
        const res3 = await fetch(`${baseUrl}/api/users/cache/invalidate`, { method: 'POST' });
        assert(res3.status === 200, 'Expected 200 on cache invalidate');
      },
    );

    // 12. Direct Update by ID (.update)
    await runTest('PUT /api/users/:id - Direct Update by ID (.update)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${createdUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ada Lovelace Byron', score: 105 }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const updated: any = await res.json();
      assert(updated.name === 'Ada Lovelace Byron', 'Name was not updated');
      assert(updated.score === 105, 'Score was not updated');
    });

    // 13. Conditional Update (.bulkUpdate)
    await runTest('PATCH /api/users/bulk-promote - Conditional Update', async () => {
      const res = await fetch(`${baseUrl}/api/users/bulk-promote`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'contributor' }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert(body.affectedRows >= 0, 'Expected affectedRows number');
    });

    // 14. Upsert (.upsert)
    await runTest('POST /api/users/upsert - Upsert on Conflict Key (.upsert)', async () => {
      const res = await fetch(`${baseUrl}/api/users/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Ada Lovelace Updated Via Upsert',
          email: 'ada@example.com',
          role: 'fellow',
          score: 110,
        }),
      });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert(
        body.result.name === 'Ada Lovelace Updated Via Upsert',
        'Upsert did not update existing row',
      );
    });

    // 15. Change Tracker Proxy Mutation (track -> mutate -> saveChanges)
    await runTest(
      'PATCH /api/users/:id/track - Proxy Change Tracking & saveChanges()',
      async () => {
        const res = await fetch(`${baseUrl}/api/users/${createdUserId}/track`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score: 120 }),
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.savedCount === 1, `Expected 1 flushed change, got ${body.savedCount}`);
        assert(body.user.score === 120, 'Tracked score mismatch');
      },
    );

    // 16. Soft Delete (.remove)
    await runTest('DELETE /api/users/:id - Soft Delete (.remove sets deleted_at)', async () => {
      const res = await fetch(`${baseUrl}/api/users/${createdUserId}`, { method: 'DELETE' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);

      // Regular fetch should now return 404
      const checkRes = await fetch(`${baseUrl}/api/users/${createdUserId}`);
      assert(checkRes.status === 404, `Expected 404 after soft delete, got ${checkRes.status}`);
    });

    // 17. Soft Delete Trash & All-with-deleted (.onlyDeleted & .withDeleted)
    await runTest('GET /api/users/trash & with-deleted - Soft Delete Query Filters', async () => {
      const trashRes = await fetch(`${baseUrl}/api/users/trash`);
      assert(trashRes.status === 200, `Expected 200, got ${trashRes.status}`);
      const trash: any = await trashRes.json();
      const foundInTrash = trash.items.some((u: any) => u.id === createdUserId);
      assert(foundInTrash, 'Soft-deleted user was not found in trash');

      const allRes = await fetch(`${baseUrl}/api/users/with-deleted`);
      assert(allRes.status === 200, `Expected 200, got ${allRes.status}`);
      const all: any = await allRes.json();
      const foundInAll = all.items.some((u: any) => u.id === createdUserId);
      assert(foundInAll, 'Soft-deleted user was not found in with-deleted list');
    });

    // 18. Restore Soft-Deleted User
    await runTest('POST /api/users/:id/restore - Restore Soft-Deleted Entity', async () => {
      const res = await fetch(`${baseUrl}/api/users/${createdUserId}/restore`, { method: 'POST' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);

      // Now regular lookup succeeds
      const checkRes = await fetch(`${baseUrl}/api/users/${createdUserId}`);
      assert(checkRes.status === 200, `Expected 200 after restore, got ${checkRes.status}`);
    });

    // 19. Permanent Hard Delete (.hardRemove)
    await runTest(
      'DELETE /api/users/:id/permanent - Permanent Hard Delete (.hardRemove)',
      async () => {
        const res = await fetch(`${baseUrl}/api/users/${createdUserId}/permanent`, {
          method: 'DELETE',
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);

        // Even withDeleted will NOT find it
        const allRes = await fetch(`${baseUrl}/api/users/with-deleted`);
        const all: any = await allRes.json();
        const found = all.items.some((u: any) => u.id === createdUserId);
        assert(!found, 'User should be permanently deleted from database table');
      },
    );

    // 20. Bulk Update (.bulkUpdate)
    await runTest(
      'PUT /api/products/bulk-update - High-performance Bulk Update (.bulkUpdate)',
      async () => {
        const res = await fetch(`${baseUrl}/api/products/bulk-update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            { id: 1, price: 139.99, stock: 40 },
            { id: 2, price: 74.99, stock: 110 },
          ]),
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.affectedRows >= 1, 'Expected affected rows from bulkUpdate');
      },
    );

    // 21. Bulk Upsert (.bulkUpsert)
    await runTest(
      'POST /api/products/bulk-upsert - High-performance Bulk Upsert (.bulkUpsert)',
      async () => {
        const res = await fetch(`${baseUrl}/api/products/bulk-upsert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            {
              sku: 'PROD-001',
              name: 'Ergonomic Mechanical Keyboard v2',
              category: 'Electronics',
              price: 159.99,
              stock: 50,
            },
            {
              sku: 'PROD-NEW-01',
              name: 'Desk LED Lamp',
              category: 'Office',
              price: 39.99,
              stock: 80,
            },
          ]),
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.affectedRows >= 1, 'Expected affected rows from bulkUpsert');
      },
    );

    // 22. Optimistic Concurrency Control (@Version)
    await runTest(
      'PUT /api/products/:id/concurrency - Optimistic Concurrency Control (@Version)',
      async () => {
        // 1. Fetch current product version
        const prodRes = await fetch(`${baseUrl}/api/products/1`);
        const product: any = await prodRes.json();
        const currentVersion = product.version;

        // 2. Update with correct expectedVersion -> succeeds
        const updateRes = await fetch(`${baseUrl}/api/products/1/concurrency`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: 169.99, expectedVersion: currentVersion }),
        });
        assert(
          updateRes.status === 200,
          `Expected 200 on matching version, got ${updateRes.status}`,
        );

        // 3. Update again with old stale expectedVersion -> throws 409 Conflict!
        const staleRes = await fetch(`${baseUrl}/api/products/1/concurrency`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ price: 179.99, expectedVersion: currentVersion }),
        });
        assert(
          staleRes.status === 409,
          `Expected 409 Conflict on stale version, got ${staleRes.status}`,
        );
        const conflictBody: any = await staleRes.json();
        assert(
          conflictBody.error === 'Concurrency conflict detected',
          'Expected concurrency conflict error',
        );
      },
    );

    // 23. Atomic Multi-Entity Transaction (useTransaction)
    await runTest(
      'POST /api/transactions/atomic-multi-entity - Multi-Entity Atomic Transaction',
      async () => {
        // Success test
        const successRes = await fetch(`${baseUrl}/api/transactions/atomic-multi-entity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Tx Success User',
            email: 'tx-success@example.com',
            bio: 'Atomic Bio',
            postTitle: 'Atomic Post Title',
            simulateError: false,
          }),
        });
        assert(successRes.status === 201, `Expected 201, got ${successRes.status}`);
        const body: any = await successRes.json();
        assert(body.result.user.id > 0, 'Expected committed user');
        assert(body.result.profile.id > 0, 'Expected committed profile');
        assert(body.result.post.id > 0, 'Expected committed post');
        assert(body.result.audit.id > 0, 'Expected committed audit log');

        // Rollback test
        const rollbackRes = await fetch(`${baseUrl}/api/transactions/atomic-multi-entity`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Tx Revert User',
            email: 'tx-revert@example.com',
            simulateError: true,
          }),
        });
        assert(rollbackRes.status === 400, `Expected 400 on rollback, got ${rollbackRes.status}`);
        const rollbackBody: any = await rollbackRes.json();
        assert(rollbackBody.status === 'Rolled back', 'Expected transaction rollback status');
      },
    );

    // 24. Credit Transfer Transaction
    await runTest(
      'POST /api/transactions/credit-transfer - Score/Credit Transfer in Transaction',
      async () => {
        const res = await fetch(`${baseUrl}/api/transactions/credit-transfer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fromUserId: 1,
            toUserId: 2,
            amount: 10,
          }),
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
      },
    );

    // 25. Resilient Transaction Execution Strategy
    await runTest('POST /api/transactions/resilient - Resilient Retry Transaction', async () => {
      const res = await fetch(`${baseUrl}/api/transactions/resilient`, { method: 'POST' });
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });

    // 26. Savepoints
    await runTest(
      'POST /api/transactions/savepoints - Manual Transaction with Savepoints',
      async () => {
        const res = await fetch(`${baseUrl}/api/transactions/savepoints`, { method: 'POST' });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.committedUser !== undefined, 'Expected committed primary user');
      },
    );

    // 27. Raw Parameterized SQL (.fromSql)
    await runTest('GET /api/sql/raw-query - Raw Parameterized Query (.fromSql)', async () => {
      const res = await fetch(`${baseUrl}/api/sql/raw-query?minScore=50`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert(body.rows.length > 0, 'Expected query results');
    });

    // 28. Raw Parameterized Command (.executeSql)
    await runTest(
      'POST /api/sql/raw-execute - Raw Parameterized Command (.executeSql)',
      async () => {
        const res = await fetch(`${baseUrl}/api/sql/raw-execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bonus: 2, role: 'admin' }),
        });
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.rowsAffected >= 0, 'Expected rowsAffected');
      },
    );

    // 29. Tagged Template SQL (ctx.sql`...`)
    await runTest(
      'GET /api/sql/tagged-query - Tagged Template Literal Query (ctx.sql)',
      async () => {
        const res = await fetch(`${baseUrl}/api/sql/tagged-query?role=admin&minScore=50`);
        assert(res.status === 200, `Expected 200, got ${res.status}`);
        const body: any = await res.json();
        assert(body.rows.length > 0, 'Expected results from tagged template query');
      },
    );

    // 30. Stored Procedure Builder Inspection
    await runTest('GET /api/sql/procedure-demo - Fluent Stored Procedure Builder', async () => {
      const res = await fetch(`${baseUrl}/api/sql/procedure-demo`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const body: any = await res.json();
      assert(body.procedureName === 'usp_GetTopUsers', 'Expected procedure name');
    });
  } finally {
    server.close();
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`  Tests Passed: \x1b[32m${passed}\x1b[0m / ${results.length}`);
  if (failed > 0) {
    console.log(`  Tests Failed: \x1b[31m${failed}\x1b[0m`);
    process.exit(1);
  } else {
    console.log(`  \x1b[32mAll CRUD Scenarios Verified Successfully!\x1b[0m`);
    console.log('══════════════════════════════════════════════════════════════════\n');
  }
}

main().catch(err => {
  console.error('[FATAL TEST ERROR]', err);
  process.exit(1);
});
