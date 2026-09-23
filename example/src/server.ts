import { app } from './app';
import { config } from './config';
import { AppDbContext } from './database/AppDbContext';

async function bootstrap() {
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('  Starting entityts Express Showcase Server');
  console.log('──────────────────────────────────────────────────────────────────');

  // 1. Initialize Database Schema & Seed Data
  console.log(
    `[BOOT] Initializing database provider: \x1b[35m${config.dbProvider.toUpperCase()}\x1b[0m`,
  );
  const initDb = new AppDbContext();

  try {
    await initDb.initDatabase();
    console.log('[BOOT] Database tables and initial seed verified.');
  } catch (err) {
    console.error('[BOOT] Error during database initialization:', err);
    process.exit(1);
  } finally {
    await initDb.dispose();
  }

  // 2. Start HTTP Server
  const server = app.listen(config.port, () => {
    console.log(`\n🚀 Server listening on: \x1b[32mhttp://localhost:${config.port}\x1b[0m`);
    console.log(`📖 Open the dashboard in browser to explore all CRUD endpoints:`);
    console.log(`   \x1b[36mhttp://localhost:${config.port}/\x1b[0m`);
    console.log(`🩺 Health check endpoint:`);
    console.log(`   \x1b[36mhttp://localhost:${config.port}/health\x1b[0m\n`);
  });

  // 3. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Closing HTTP server...`);
    server.close(() => {
      console.log('[SHUTDOWN] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
