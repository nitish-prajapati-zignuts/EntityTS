import express, { Request, Response, NextFunction } from 'express';
import {
  dbContextMiddleware,
  EntityNotFoundException,
  DbUpdateConcurrencyException,
  DbException,
} from 'entityts';
import { AppDbContext } from './database/AppDbContext';
import {
  userRouter,
  productRouter,
  transactionRouter,
  sqlRouter,
  procedureRouter,
  aiRouter,
  outboxRouter,
} from './routes';
import { config } from './config';

export const app = express();

// 1. Standard body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const statusColor =
      res.statusCode >= 500 ? '\x1b[31m' : res.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
    console.log(
      `[HTTP] ${req.method} ${req.originalUrl} -> ${statusColor}${res.statusCode}\x1b[0m (${duration}ms)`,
    );
  });
  next();
});

// 3. Scoped DbContext middleware (EF Core Unit of Work per request)
app.use(dbContextMiddleware(AppDbContext));

// 4. API Routes
app.use('/api/users', userRouter);
app.use('/api/products', productRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/sql', sqlRouter);
app.use('/api/procedures', procedureRouter);
app.use('/api/ai', aiRouter);
app.use('/api/outbox', outboxRouter);

// 5. Health Check & Diagnostics
app.get('/health', async (req: Request, res: Response) => {
  const db = (req as any).dbContext as AppDbContext;
  try {
    const isConnected = await db.ping();
    res.json({
      status: isConnected ? 'healthy' : 'unreachable',
      database: {
        provider: db.provider,
        connected: isConnected,
      },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'unhealthy',
      error: err.message,
    });
  }
});

// 6. Interactive Documentation Dashboard (GET /)
app.get('/', async (req: Request, res: Response) => {
  const db = (req as any).dbContext as AppDbContext;
  const isHealthy = await db.ping().catch(() => false);

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>entityts — Express CRUD Operations Showcase</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --green: #3fb950;
      --orange: #d29922;
      --purple: #bc8cff;
      --red: #f85149;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      margin: 0;
      padding: 24px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    h1 { color: var(--heading); margin: 0 0 8px 0; font-size: 26px; }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: bold;
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .status-ok {
      background: rgba(63, 185, 80, 0.15);
      color: var(--green);
      border-color: var(--green);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 18px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
    }
    .card h2 {
      margin-top: 0;
      font-size: 18px;
      color: var(--heading);
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .endpoint {
      margin: 12px 0;
      padding: 10px;
      background: #090d13;
      border-radius: 6px;
      border-left: 4px solid var(--accent);
      font-size: 13px;
    }
    .endpoint.get { border-left-color: var(--accent); }
    .endpoint.post { border-left-color: var(--green); }
    .endpoint.put { border-left-color: var(--orange); }
    .endpoint.patch { border-left-color: var(--purple); }
    .endpoint.delete { border-left-color: var(--red); }
    .method {
      font-weight: 700;
      display: inline-block;
      min-width: 55px;
    }
    .method.GET { color: var(--accent); }
    .method.POST { color: var(--green); }
    .method.PUT { color: var(--orange); }
    .method.PATCH { color: var(--purple); }
    .method.DELETE { color: var(--red); }
    .path {
      font-family: monospace;
      color: var(--heading);
      font-weight: 600;
    }
    .desc {
      color: #8b949e;
      margin-top: 4px;
      font-size: 12px;
    }
    pre {
      background: #04070b;
      padding: 8px 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 11px;
      color: #7ee787;
      margin: 6px 0 0 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>⚡ entityts — Express API Showcase</h1>
      <p style="margin: 4px 0 12px 0; color: #8b949e;">EF Core-inspired DbContext & DbSet ORM with Stored Procedures, Transactions, and Full CRUD in Node.js</p>
      <div>
        <span class="badge status-ok">● Database: ${db.provider.toUpperCase()} (${isHealthy ? 'Connected' : 'Disconnected'})</span>
        <span class="badge">Scoped DbContext Middleware: Active</span>
        <span class="badge">In-Memory Cache: Enabled</span>
      </div>
    </header>
 

    <div class="grid">
      <!-- CREATE SCENARIOS -->
      <div class="card">
        <h2>🟢 Create Scenarios</h2>
        <div class="endpoint post">
          <div><span class="method POST">POST</span> <span class="path">/api/users</span></div>
          <div class="desc">1. Single entity insert via <code>.add()</code></div>
          <pre>curl -X POST http://localhost:${config.port}/api/users \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Grace Hopper","email":"grace@navy.mil","role":"admin","score":99}'</pre>
        </div>
        <div class="endpoint post">
          <div><span class="method POST">POST</span> <span class="path">/api/users/batch</span></div>
          <div class="desc">2. Batch insert multiple entities via <code>.addRange()</code></div>
          <pre>curl -X POST http://localhost:${config.port}/api/users/batch \\
  -H "Content-Type: application/json" \\
  -d '[{"name":"User A","email":"a@ex.com"},{"name":"User B","email":"b@ex.com"}]'</pre>
        </div>
        <div class="endpoint post">
          <div><span class="method POST">POST</span> <span class="path">/api/products/bulk-insert</span></div>
          <div class="desc">3. High-performance batch insert via <code>.bulkInsert()</code></div>
          <pre>curl -X POST http://localhost:${config.port}/api/products/bulk-insert \\
  -H "Content-Type: application/json" \\
  -d '[{"sku":"ITEM-1","name":"Pad","category":"Office","price":12.5,"stock":100}]'</pre>
        </div>
      </div>

      <!-- READ SCENARIOS -->
      <div class="card">
        <h2>🔵 Read Scenarios</h2>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users?role=user&minScore=50&orderBy=score&order=desc</span></div>
          <div class="desc">4. Fluent LINQ filter with <code>.where()</code>, <code>.orderBy()</code>, <code>.take()</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/paged?page=1&pageSize=3</span></div>
          <div class="desc">5. Offset pagination with metadata via <code>.toPagedList()</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/cursor?limit=2</span></div>
          <div class="desc">6. Keyset / cursor pagination via <code>.toCursorPagedList()</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/search?q=alice</span></div>
          <div class="desc">7. Full-text search across multiple columns via <code>.search()</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/stats</span></div>
          <div class="desc">8. Aggregations: <code>.count()</code>, <code>.avg()</code>, <code>.min()</code>, <code>.max()</code>, <code>.sum()</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/1/relations</span></div>
          <div class="desc">9. Eager loading relations without N+1 via <code>.include('profile').include('posts')</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/cache/demo</span></div>
          <div class="desc">10. Transparent query caching via <code>.cache(15000)</code></div>
        </div>
        <div class="endpoint get">
          <div><span class="method GET">GET</span> <span class="path">/api/users/trash</span></div>
          <div class="desc">11. View soft-deleted records via <code>.onlyDeleted()</code></div>
        </div>
      </div>

      <!-- UPDATE SCENARIOS -->
      <div class="card">
        <h2>🟡 Update Scenarios</h2>
        <div class="endpoint put">
          <div><span class="method PUT">PUT</span> <span class="path">/api/users/1</span></div>
          <div class="desc">12. Direct update by ID via <code>.update(id, patch)</code></div>
          <pre>curl -X PUT http://localhost:${config.port}/api/users/1 \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Alice Updated","score":100}'</pre>
        </div>
        <div class="endpoint patch">
          <div><span class="method PATCH">PATCH</span> <span class="path">/api/users/bulk-promote?minScore=80</span></div>
          <div class="desc">13. Conditional update matching predicate via <code>.updateWhere()</code></div>
        </div>
        <div class="endpoint post">
          <div><span class="method POST">POST</span> <span class="path">/api/users/upsert</span></div>
          <div class="desc">14. Upsert (Insert or Update on conflict) via <code>.upsert()</code></div>
        </div>
        <div class="endpoint patch">
          <div><span class="method PATCH">PATCH</span> <span class="path">/api/users/1/track</span></div>
          <div class="desc">15. EF Core-style Proxy Change Tracking via <code>.track(id)</code> and <code>saveChanges()</code></div>
        </div>
        <div class="endpoint put">
          <div><span class="method PUT">PUT</span> <span class="path">/api/products/bulk-update</span></div>
          <div class="desc">16. Bulk update matching keys via <code>.bulkUpdate()</code></div>
        </div>
        <div class="endpoint put">
          <div><span class="method PUT">PUT</span> <span class="path">/api/products/1/concurrency</span></div>
          <div class="desc">17. Optimistic Concurrency Control via <code>@Version()</code> (detects 409 conflict)</div>
        </div>
      </div>

      <!-- DELETE SCENARIOS -->
      <div class="card">
        <h2>🔴 Delete & Restore Scenarios</h2>
        <div class="endpoint delete">
          <div><span class="method DELETE">DELETE</span> <span class="path">/api/users/2</span></div>
          <div class="desc">18. Soft-delete via <code>.remove(id)</code> (sets <code>deleted_at</code> timestamp)</div>
        </div>
        <div class="endpoint post">
          <div><span class="method POST">POST</span> <span class="path">/api/users/2/restore</span></div>
          <div class="desc">19. Restore soft-deleted entity via <code>.withDeleted().update()</code></div>
        </div>
        <div class="endpoint delete">
          <div><span class="method DELETE">DELETE</span> <span class="path">/api/users/2/permanent</span></div>
          <div class="desc">20. Permanent hard delete via <code>.hardRemove(id)</code></div>
        </div>
        <div class="endpoint delete">
          <div><span class="method DELETE">DELETE</span> <span class="path">/api/products/bulk-delete?category=Discontinued</span></div>
          <div class="desc">21. Bulk delete matching records via <code>.bulkDelete()</code></div>
        </div>
      </div>

      <!-- TRANSACTION & SQL SCENARIOS -->
      <div class="card" style="grid-column: 1 / -1;">
        <h2>🟣 Transactions & Raw SQL Scenarios</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 14px;">
          <div class="endpoint post">
            <div><span class="method POST">POST</span> <span class="path">/api/transactions/atomic-multi-entity</span></div>
            <div class="desc">22. Multi-table atomic transaction with rollback via <code>ctx.useTransaction()</code></div>
            <pre>curl -X POST http://localhost:${config.port}/api/transactions/atomic-multi-entity \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Tx Demo","bio":"Bio","postTitle":"Post","simulateError":false}'</pre>
          </div>
          <div class="endpoint post">
            <div><span class="method POST">POST</span> <span class="path">/api/transactions/credit-transfer</span></div>
            <div class="desc">23. Atomic balance transfer with rollback on insufficient balance</div>
          </div>
          <div class="endpoint get">
            <div><span class="method GET">GET</span> <span class="path">/api/sql/raw-query?minScore=70</span></div>
            <div class="desc">24. Parameterized query via <code>ctx.fromSql()</code></div>
          </div>
          <div class="endpoint get">
            <div><span class="method GET">GET</span> <span class="path">/api/sql/tagged-query?role=admin</span></div>
            <div class="desc">25. Parameterized tagged template literal via <code>ctx.sql\`...\`</code></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`);
});

// 7. Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof EntityNotFoundException) {
    res.status(404).json({ error: 'EntityNotFoundException', message: err.message });
    return;
  }
  if (err instanceof DbUpdateConcurrencyException) {
    res.status(409).json({
      error: 'DbUpdateConcurrencyException',
      message: err.message,
      entityName: err.entityName,
      entityKey: err.entityKey,
    });
    return;
  }
  if (err instanceof DbException) {
    res.status(400).json({ error: 'DbException', message: err.message });
    return;
  }

  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({
    error: 'InternalServerError',
    message: err.message || 'An unexpected database error occurred.',
  });
});
