import fs from 'fs';
import path from 'path';
import {
  DbContext,
  DbContextOptions,
  DbContextOptionsBuilder,
  DbSet,
  ModelBuilder,
  MemoryQueryCache,
  createSlowQueryLogger,
  createQueryPlanLogger,
} from '@nsp/dbcontext';
import { config } from '../config';
import { User, Profile, Post, Comment, Product, AuditLog } from '../entities';
import { seedDatabase } from './seed';

export class AppDbContext extends DbContext {
  constructor(options?: DbContextOptions) {
    super(options);
  }

  // --- Strongly-typed DbSet accessors ---
  public get users(): DbSet<User> {
    return this.set(User);
  }

  public get profiles(): DbSet<Profile> {
    return this.set(Profile);
  }

  public get posts(): DbSet<Post> {
    return this.set(Post);
  }

  public get comments(): DbSet<Comment> {
    return this.set(Comment);
  }

  public get products(): DbSet<Product> {
    return this.set(Product);
  }

  public get auditLogs(): DbSet<AuditLog> {
    return this.set(AuditLog);
  }

  protected override onConfiguring(options: DbContextOptionsBuilder): void {
    if (config.dbProvider === 'postgres' || config.databaseUrl) {
      const conn = config.databaseUrl || 'postgresql://localhost:5432/postgres';
      options.usePostgres(conn);
    } else {
      // Ensure SQLite directory exists
      const dbDir = path.dirname(config.sqlitePath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      options.useSqlite(config.sqlitePath);
    }

    if (config.logQueries) {
      // Prisma-style structured SQL query logging with duration and parameters
      options.withLogging('prisma');
    }

    // Attach slow query detection
    options.withHooks(
      createSlowQueryLogger({
        thresholdMs: config.slowQueryThresholdMs,
        logger: (msg, duration, sql) => {
          console.warn(`\x1b[33m[SLOW QUERY WARNING]\x1b[0m ${duration}ms: ${sql}`);
        },
      })
    );

    // Query plan analyzer — runs EXPLAIN [ANALYZE] alongside SELECT queries
    // Enable with:  EXPLAIN_QUERIES=true npm run example:postgres
    // EXPLAIN ANALYZE (accurate timing):  EXPLAIN_ANALYZE=true npm run example:postgres
    if (config.explainQueries) {
      options.withQueryPlanner({
        analyze: config.explainAnalyze,
        warnOnSeqScan: true,
        // Optionally threshold: only explain queries slower than 20ms
        // thresholdMs: 20,
      });
    }

    // In-memory query caching
    options.withCache(
      new MemoryQueryCache({
        maxSize: 500,
        defaultTtlMs: config.cacheTtlMs,
      })
    );

    // Resilient connection strategy with auto-retry on transient errors
    options.enableRetryOnFailure(3, 1000);
  }

  protected override onModelCreating(model: ModelBuilder): void {
    // Fluent model configuration & relationship overrides
    model.entity(User, e => {
      e.toTable('users');
      e.hasKey(u => u.id);
      e.property(u => u.email).isRequired();
    });

    model.entity(Profile, e => {
      e.toTable('profiles');
      e.hasKey(p => p.id);
    });

    model.entity(Post, e => {
      e.toTable('posts');
      e.hasKey(p => p.id);
    });

    model.entity(Comment, e => {
      e.toTable('comments');
      e.hasKey(c => c.id);
    });

    model.entity(Product, e => {
      e.toTable('products');
      e.hasKey(p => p.id);
    });

    model.entity(AuditLog, e => {
      e.toTable('audit_logs');
      e.hasKey(a => a.id);
    });
  }

  /**
   * Initializes the database schema using Code-First ensureCreated(),
   * then seeds initial data if the database is newly initialized.
   */
  public async initDatabase(): Promise<void> {
    await this.ensureCreated([User, Profile, Post, Comment, Product, AuditLog]);
    await seedDatabase(this);
  }
}
