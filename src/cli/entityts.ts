#!/usr/bin/env node
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

// ─── Help ─────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
EntityTS CLI tool

Usage:
  entityts <command> [options]

CODE FIRST commands:
  db:push                      Apply schema changes to the DB (no migration file)
  db:push --dry-run            Print DDL that would be applied — no changes made
  db:migrate:generate <name>   Auto-generate a migration file from entity metadata
  db:migrate:create <name>     Scaffold a blank migration file
  db:migrate                   Run all pending migration files
  db:migrate:revert            Revert the last batch of applied migrations
  db:migrate:status            Display status of all migrations

DATABASE FIRST commands:
  db:scaffold                  Introspect live DB and generate entity + DbContext files
  db:scaffold --output <dir>   Output directory (default: ./src/entities)
  db:scaffold --tables <t1,t2> Scaffold only specific tables
  db:scaffold --force          Overwrite existing entity files

SEED commands:
  db:seed                      Run all pending seed modules
  db:seed:status               Display applied/pending status of seeds
  db:seed:reset                Clear __entityts_seeds tracking table (re-enable seeds)

BENCHMARK commands:
  benchmark                    Run ORM execution benchmarks (throughput, latency, memory)
  benchmark --iterations <n>   Number of iterations per scenario (default: 500)
  benchmark --filter <pattern> Filter scenarios by name or category
  benchmark --json             Output benchmark results in JSON format

DRIVER ISOLATION commands:
  add <provider>               Install ONLY the package for your database (e.g. entityts add mssql)
                               Prevents installing unneeded drivers (e.g. will not install pg for mssql)
  init --db <provider>         Scaffold DbContext and install only the driver for that database

ORM MIGRATION IMPORTERS:
  import --from <prisma|typeorm|drizzle> --input <path>
                               Automatically migrate from Prisma, TypeORM, or Drizzle
                               into entityts entities and DbContext
  import --output <dir>        Output directory (default: ./src/database)

Other:
  db:ping                      Test database connectivity
  --help, -h                   Show this help screen

Options (Code First / db:push, db:migrate:generate):
  --context <path>             Path to your DbContext subclass file (required)
  --entities <glob>            Glob of entity class files to include

Options (Seeds / db:seed, db:seed:status, db:seed:reset):
  --context <path>             Path to your DbContext subclass file (required)
  --seeds <paths>              Comma-separated seed files or directories (default: ./src/seeds, ./seeds)


Options (Database First / db:scaffold):
  --context <path>             Path to your DbContext subclass file (required)
  --output <dir>               Directory to write scaffolded files
  --tables <t1,t2,...>         Comma-separated list of tables to scaffold
  --force                      Overwrite existing files
  --context-name <name>        Name for generated DbContext class (default: AppDbContext)
`);
}

// ─── Arg parser ───────────────────────────────────────────────────────────

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

// ─── Context loader ───────────────────────────────────────────────────────

async function loadAdapter(
  contextPath: string,
): Promise<import('../adapters/IDbAdapter').IDbAdapter> {
  const resolved = path.resolve(process.cwd(), contextPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Context file not found: ${resolved}`);
  }
  // Dynamically import the module — supports ESM and CJS
  const mod = await import(resolved);
  const ContextClass: any =
    mod.default ||
    Object.values(mod).find((v: any) => {
      return typeof v === 'function' && v.prototype && typeof v.prototype.set === 'function';
    });

  if (!ContextClass) {
    throw new Error(
      `Could not find a DbContext subclass export in: ${resolved}\n` +
        `Ensure your context file has a default export or a named export of a DbContext subclass.`,
    );
  }

  const ctx = new ContextClass();
  return ctx.adapter;
}

// ─── Commands ─────────────────────────────────────────────────────────────

async function cmdDbPush(flags: Record<string, string | boolean>): Promise<void> {
  const dryRun = flags['dry-run'] === true;
  const contextPath = flags['context'] as string | undefined;

  if (!contextPath) {
    console.error('Error: --context <path> is required for db:push');
    process.exit(1);
  }

  console.log(
    dryRun ? '🔍 Dry-run mode — no changes will be made.' : '🚀 Pushing schema changes...',
  );

  try {
    const { SchemaGenerator } = await import('../codegen/SchemaGenerator');
    const adapter = await loadAdapter(contextPath);
    // Entity classes are automatically registered via decorators when the context module is imported
    const { ModelMetadataRegistry } = await import('../model/EntityMetadata');
    const registry = ModelMetadataRegistry.getInstance();

    // Access all registered entities via reflection — iterate the internal map
    const allEntities: Function[] = (registry as any).entities
      ? Array.from((registry as any).entities.keys())
      : [];

    if (allEntities.length === 0) {
      console.warn('⚠  No entity classes found in registry. Make sure your entities are imported.');
      return;
    }

    const generator = new SchemaGenerator(adapter, allEntities);
    const applied = await generator.push(dryRun);

    if (applied.length === 0) {
      console.log('✅ Schema is already up to date.');
    } else {
      const verb = dryRun ? 'Would apply' : 'Applied';
      console.log(`${verb} ${applied.length} statement(s):`);
      applied.forEach(s => console.log('  ', s));
    }
  } catch (err: any) {
    console.error('Error during db:push:', err.message || err);
    process.exit(1);
  }
}

async function cmdMigrateGenerate(
  name: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const contextPath = flags['context'] as string | undefined;

  if (!contextPath) {
    console.error('Error: --context <path> is required for db:migrate:generate');
    process.exit(1);
  }

  try {
    const { SchemaGenerator } = await import('../codegen/SchemaGenerator');
    const adapter = await loadAdapter(contextPath);
    const { ModelMetadataRegistry } = await import('../model/EntityMetadata');
    const registry = ModelMetadataRegistry.getInstance();
    const allEntities: Function[] = Array.from((registry as any).entities?.keys() ?? []);

    const generator = new SchemaGenerator(adapter, allEntities);
    const migrationsDir = path.resolve(process.cwd(), 'migrations');
    const useDiff = flags['diff'] === true;
    const filePath = useDiff
      ? await generator.writeDiffMigration(name, migrationsDir)
      : generator.writeMigration(name, migrationsDir);
    console.log(`✅ Created migration: ${filePath}`);
  } catch (err: any) {
    console.error('Error during db:migrate:generate:', err.message || err);
    process.exit(1);
  }
}

async function cmdDbScaffold(flags: Record<string, string | boolean>): Promise<void> {
  const contextPath = flags['context'] as string | undefined;

  if (!contextPath) {
    console.error('Error: --context <path> is required for db:scaffold');
    process.exit(1);
  }

  const outputDir = flags['output'] as string | undefined;
  const tablesArg = flags['tables'] as string | undefined;
  const force = flags['force'] === true;
  const contextName = (flags['context-name'] as string | undefined) ?? 'AppDbContext';
  const filterTables = tablesArg ? tablesArg.split(',').map(t => t.trim()) : undefined;

  try {
    const { SchemaIntrospector } = await import('../scaffold/SchemaIntrospector');
    const { EntityScaffolder } = await import('../scaffold/EntityScaffolder');
    const adapter = await loadAdapter(contextPath);

    console.log('🔍 Introspecting database schema...');
    const introspector = new SchemaIntrospector(adapter);
    const tables = await introspector.introspect(filterTables);

    if (tables.length === 0) {
      console.warn('⚠  No tables found in the database.');
      return;
    }

    console.log(`Found ${tables.length} table(s): ${tables.map(t => t.name).join(', ')}`);
    console.log('✏️  Scaffolding entity files...');

    const scaffolder = new EntityScaffolder({
      outputDir: outputDir ? path.resolve(process.cwd(), outputDir) : undefined,
      force,
      contextName,
    });

    const result = scaffolder.scaffold(tables);
    result.written.forEach(f => console.log(`  ✅ ${f}`));
    result.skipped.forEach(f =>
      console.log(`  ⏭  Skipped (exists): ${f}  (use --force to overwrite)`),
    );
    console.log(
      `\nDone! ${result.written.length} file(s) written, ${result.skipped.length} skipped.`,
    );
  } catch (err: any) {
    console.error('Error during db:scaffold:', err.message || err);
    process.exit(1);
  }
}

// ─── Migration commands (existing + create) ───────────────────────────────

function cmdMigrateCreate(name: string): void {
  if (!name) {
    console.error(
      'Error: Migration name required. Example: entityts db:migrate:create AddUsersTable',
    );
    process.exit(1);
  }

  const timestamp = Date.now();
  const fileName = `${timestamp}_${name}.ts`;
  const migrationsDir = path.resolve(process.cwd(), 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const template = `import { MigrationBuilder } from 'entityts';

export const id = '${timestamp}';
export const name = '${name}';

export async function up(schema: MigrationBuilder): Promise<void> {
  await schema.createTable('${name.toLowerCase()}', t => {
    t.increments('id').primary();
    t.string('name', 255).notNullable();
    t.timestamp('created_at').defaultToNow();
  });
}

export async function down(schema: MigrationBuilder): Promise<void> {
  await schema.dropTableIfExists('${name.toLowerCase()}');
}
`;

  const filePath = path.join(migrationsDir, fileName);
  fs.writeFileSync(filePath, template, 'utf-8');
  console.log(`✅ Created migration: ${filePath}`);
}

async function cmdBenchmark(flags: Record<string, string | boolean>): Promise<void> {
  const iterations = flags['iterations'] ? Number(flags['iterations']) : 500;
  const filter = flags['filter'] as string | undefined;
  const json = Boolean(flags['json']);
  const contextPath = flags['context'] as string | undefined;

  let customAdapter: any;
  if (contextPath) {
    try {
      customAdapter = await loadAdapter(contextPath);
    } catch {
      // Ignore if adapter cannot be loaded; fallback to built-in SQLite/mock
    }
  }

  const { runExecutionBenchmarks } = await import('../benchmark');
  if (!json) {
    console.log(`\n⚡ Starting EntityTS Execution Benchmarks (iterations: ${iterations})...\n`);
  }

  const results = await runExecutionBenchmarks(
    {
      iterations,
      filter,
      silent: json,
    },
    customAdapter,
  );

  if (json) {
    console.log(JSON.stringify(results, null, 2));
  }
}

// ─── Seeding ──────────────────────────────────────────────────────────────

async function loadSeedModules(seedPathsStr?: string): Promise<import('../seeding').SeedModule[]> {
  const defaultDirs = [
    path.resolve(process.cwd(), 'src/seeds'),
    path.resolve(process.cwd(), 'seeds'),
  ];
  if (!seedPathsStr) {
    const foundDir = defaultDirs.find(d => fs.existsSync(d) && fs.statSync(d).isDirectory());
    if (foundDir) {
      const files = fs
        .readdirSync(foundDir)
        .filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'))
        .sort();
      const modules: import('../seeding').SeedModule[] = [];
      for (const file of files) {
        const fullPath = path.join(foundDir, file);
        const mod = await import(fullPath);
        const seed = mod.default || mod.seed || mod;
        if (seed && typeof seed.run === 'function') {
          modules.push({
            id: seed.id || path.basename(file, path.extname(file)),
            name: seed.name || path.basename(file, path.extname(file)),
            run: seed.run.bind(seed),
          });
        }
      }
      return modules;
    }
    return [];
  }

  const paths = seedPathsStr.split(',').map(s => s.trim());
  const modules: import('../seeding').SeedModule[] = [];
  for (const p of paths) {
    const resolved = path.resolve(process.cwd(), p);
    if (!fs.existsSync(resolved)) {
      console.warn(`Seed path not found: ${resolved}`);
      continue;
    }
    if (fs.statSync(resolved).isDirectory()) {
      const files = fs
        .readdirSync(resolved)
        .filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'))
        .sort();
      for (const file of files) {
        const fullPath = path.join(resolved, file);
        const mod = await import(fullPath);
        const seed = mod.default || mod.seed || mod;
        if (seed && typeof seed.run === 'function') {
          modules.push({
            id: seed.id || path.basename(file, path.extname(file)),
            name: seed.name || path.basename(file, path.extname(file)),
            run: seed.run.bind(seed),
          });
        }
      }
    } else {
      const mod = await import(resolved);
      const seed = mod.default || mod.seed || mod;
      if (seed && typeof seed.run === 'function') {
        modules.push({
          id: seed.id || path.basename(p, path.extname(p)),
          name: seed.name || path.basename(p, path.extname(p)),
          run: seed.run.bind(seed),
        });
      } else {
        console.warn(`Seed module at ${p} has no valid run() function`);
      }
    }
  }
  return modules;
}

async function cmdDbSeed(flags: Record<string, string | boolean>): Promise<void> {
  const contextPath = flags['context'] as string | undefined;
  if (!contextPath) {
    console.error('Error: --context <path> is required for db:seed.');
    process.exit(1);
  }
  const adapter = await loadAdapter(contextPath);
  const seeds = await loadSeedModules(flags['seeds'] as string | undefined);
  if (seeds.length === 0) {
    console.log('No seed modules found. Specify seed files or directory with --seeds <paths>');
    return;
  }
  const { SeedRunner } = await import('../seeding');
  const runner = new SeedRunner(adapter);
  const result = await runner.run(seeds);
  if (result.applied.length === 0) {
    console.log('All seeds are already applied. Database is up to date.');
  } else {
    console.log(`Successfully applied ${result.applied.length} seed(s):`);
    result.applied.forEach(name => console.log(`  ✓ ${name}`));
  }
}

async function cmdDbSeedStatus(flags: Record<string, string | boolean>): Promise<void> {
  const contextPath = flags['context'] as string | undefined;
  if (!contextPath) {
    console.error('Error: --context <path> is required for db:seed:status.');
    process.exit(1);
  }
  const adapter = await loadAdapter(contextPath);
  const seeds = await loadSeedModules(flags['seeds'] as string | undefined);
  const { SeedRunner } = await import('../seeding');
  const runner = new SeedRunner(adapter);
  const statuses = await runner.status(seeds);
  if (statuses.length === 0) {
    console.log('No seed modules found.');
    return;
  }
  console.log('\nSeed Status:');
  console.log('─'.repeat(60));
  for (const s of statuses) {
    const mark = s.applied ? '✓ APPLIED' : '⏳ PENDING';
    const dateStr = s.appliedAt ? ` (${new Date(s.appliedAt).toISOString()})` : '';
    console.log(`${mark.padEnd(12)} ${s.id} - ${s.name}${dateStr}`);
  }
  console.log('─'.repeat(60));
}

async function cmdDbSeedReset(flags: Record<string, string | boolean>): Promise<void> {
  const contextPath = flags['context'] as string | undefined;
  if (!contextPath) {
    console.error('Error: --context <path> is required for db:seed:reset.');
    process.exit(1);
  }
  const adapter = await loadAdapter(contextPath);
  const { SeedRunner } = await import('../seeding');
  const runner = new SeedRunner(adapter);
  await runner.reset();
  console.log('✓ Cleared __entityts_seeds tracking table. All seeds can now be re-applied.');
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];
  const flags = parseArgs(rawArgs.slice(1));

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'benchmark' || command === 'bench') {
    await cmdBenchmark(flags);
    return;
  }

  if (command === 'db:push') {
    await cmdDbPush(flags);
    return;
  }

  if (command === 'db:migrate:generate' || command === 'migration:generate') {
    const name = rawArgs[1];
    if (!name || name.startsWith('--')) {
      console.error(
        'Error: Migration name required. Example: entityts db:migrate:generate InitSchema',
      );
      process.exit(1);
    }
    await cmdMigrateGenerate(name, flags);
    return;
  }

  if (command === 'db:scaffold') {
    await cmdDbScaffold(flags);
    return;
  }

  if (command === 'db:migrate:create') {
    cmdMigrateCreate(rawArgs[1]);
    return;
  }

  if (command === 'db:seed') {
    await cmdDbSeed(flags);
    return;
  }

  if (command === 'db:seed:status') {
    await cmdDbSeedStatus(flags);
    return;
  }

  if (command === 'db:seed:reset') {
    await cmdDbSeedReset(flags);
    return;
  }

  if (
    command === 'db:migrate' ||
    command === 'db:migrate:revert' ||
    command === 'db:migrate:status'
  ) {
    console.log(`Running '${command}'...`);
    console.log(
      `To execute migrations, pass your MigrationRunner + MigrationModule[] from your application code.`,
    );
    console.log(
      `See: MigrationRunner.up(migrations) / MigrationRunner.down(migrations) / MigrationRunner.status(migrations)`,
    );
    return;
  }

  if (command === 'db:ping') {
    const contextPath = flags['context'] as string | undefined;
    if (!contextPath) {
      console.log('Pass --context <path> to test live connectivity.');
      return;
    }
    try {
      const adapter = await loadAdapter(contextPath);
      const ok = await adapter.ping();
      console.log(ok ? '✅ Database connection successful.' : '❌ Ping failed.');
    } catch (err: any) {
      console.error('Connection failed:', err.message || err);
      process.exit(1);
    }
    return;
  }

  if (command === 'add' || command === 'driver:add') {
    const providerArg = rawArgs[1];
    await cmdAdd(providerArg, flags);
    return;
  }

  if (command === 'init') {
    await cmdInit(flags);
    return;
  }

  if (command === 'import') {
    await cmdImport(flags);
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function detectProjectConfiguredProvider(cwd: string = process.cwd()): string | null {
  if (process.env.DB_PROVIDER) {
    return process.env.DB_PROVIDER.toLowerCase();
  }

  const candidateFiles = [
    'src/database/AppDbContext.ts',
    'src/database/AppDbContext.js',
    'src/AppDbContext.ts',
    'src/AppDbContext.js',
    'src/context/AppDbContext.ts',
    'src/context/AppDbContext.js',
    'example/src/database/AppDbContext.ts',
  ];

  for (const rel of candidateFiles) {
    const full = path.join(cwd, rel);
    if (fs.existsSync(full)) {
      try {
        const content = fs.readFileSync(full, 'utf-8');
        if (
          content.includes('useSqlServer') ||
          content.includes("provider = 'mssql'") ||
          content.includes('MssqlAdapter')
        ) {
          return 'mssql';
        }
        if (
          content.includes('usePostgres') ||
          content.includes("provider = 'postgres'") ||
          content.includes('PostgresAdapter')
        ) {
          return 'postgres';
        }
        if (
          content.includes('useMysql') ||
          content.includes("provider = 'mysql'") ||
          content.includes('MysqlAdapter')
        ) {
          return 'mysql';
        }
        if (
          content.includes('useSqlite') ||
          content.includes("provider = 'sqlite'") ||
          content.includes('SqliteAdapter')
        ) {
          return 'sqlite';
        }
      } catch {
        // ignore read error
      }
    }
  }
  return null;
}

async function cmdAdd(
  providerArg: string | undefined,
  flags: Record<string, string | boolean>,
): Promise<void> {
  if (!providerArg || providerArg.startsWith('--')) {
    console.error('Error: Database provider required. Example: entityts add mssql');
    console.log('Supported providers: mssql, postgres, mysql, sqlite, turso, neon, planetscale');
    process.exit(1);
  }

  const { normalizeProvider, DRIVER_REGISTRY, detectPackageManager, getInstallCommand } =
    await import('../adapters/DriverLoader');
  const provider = normalizeProvider(providerArg);

  if (!provider || !DRIVER_REGISTRY[provider]) {
    console.error(`Error: Unknown database provider '${providerArg}'.`);
    console.log('Supported providers: mssql, postgres, mysql, sqlite, turso, neon, planetscale');
    process.exit(1);
  }

  const info = DRIVER_REGISTRY[provider];

  // Driver isolation guard: if project is configured for mssql, prevent accidentally installing pg
  const force = flags['force'] === true;
  if (!force) {
    const configuredProvider = detectProjectConfiguredProvider();
    if (configuredProvider && configuredProvider !== provider) {
      console.warn(
        `\n⚠️  WARNING: Project is configured for '${configuredProvider.toUpperCase()}'.`,
      );
      console.warn(
        `   Installing '${info.packageName}' (${info.displayName}) is NOT needed for ${configuredProvider}.`,
      );
      console.warn(
        `   To keep your dependencies minimal, only install the driver for your database:`,
      );
      console.warn(`     entityts add ${configuredProvider}`);
      console.warn(`   (If you really want to install both, pass --force to proceed anyway).\n`);
      process.exit(1);
    }
  }

  const pm = detectPackageManager();
  console.log(`📦 Installing isolated driver for ${info.displayName}...`);
  console.log(
    `   Package: ${info.packageName} (only this driver is installed; no unused packages)`,
  );

  const { execSync } = await import('child_process');
  const installCmd = getInstallCommand(info.packageName, pm);
  console.log(`> ${installCmd}`);
  execSync(installCmd, { stdio: 'inherit', cwd: process.cwd() });

  const isTs = fs.existsSync(path.join(process.cwd(), 'tsconfig.json'));
  if (isTs && info.typesPackage) {
    const devFlag =
      pm === 'yarn' ? '--dev' : pm === 'pnpm' ? '-D' : pm === 'bun' ? '-d' : '--save-dev';
    const typesCmd = `${pm === 'pnpm' ? 'pnpm add' : pm === 'yarn' ? 'yarn add' : pm === 'bun' ? 'bun add' : 'npm install'} ${devFlag} ${info.typesPackage}`;
    console.log(`> ${typesCmd}`);
    try {
      execSync(typesCmd, { stdio: 'inherit', cwd: process.cwd() });
    } catch {
      // non-fatal
    }
  }

  console.log(`\n✅ Successfully installed ${info.displayName} driver.`);
  if (info.exclusiveNotes) {
    console.log(`ℹ️  ${info.exclusiveNotes}\n`);
  }
}

async function cmdInit(flags: Record<string, string | boolean>): Promise<void> {
  const dbArg = (flags['db'] || flags['provider'] || flags['database']) as string | undefined;
  if (!dbArg) {
    console.error('Error: --db <provider> is required for entityts init.');
    console.log('Examples:');
    console.log('  entityts init --db mssql');
    console.log('  entityts init --db postgres');
    console.log('  entityts init --db mysql');
    console.log('  entityts init --db sqlite');
    process.exit(1);
  }

  const { normalizeProvider, DRIVER_REGISTRY } = await import('../adapters/DriverLoader');
  const provider = normalizeProvider(dbArg);
  if (!provider || !DRIVER_REGISTRY[provider]) {
    console.error(
      `Error: Unknown provider '${dbArg}'. Supported: mssql, postgres, mysql, sqlite, turso, neon, planetscale`,
    );
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), 'src/database');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const contextPath = path.join(outDir, 'AppDbContext.ts');
  if (!fs.existsSync(contextPath)) {
    let configMethod =
      "options.useSqlServer(process.env.DATABASE_URL || 'Server=localhost;Database=mydb;User Id=sa;Password=secret;');";
    if (provider === 'postgres')
      configMethod =
        "options.usePostgres(process.env.DATABASE_URL || 'postgresql://localhost:5432/mydb');";
    if (provider === 'mysql')
      configMethod =
        "options.useMysql(process.env.DATABASE_URL || 'mysql://root:secret@localhost:3306/mydb');";
    if (provider === 'sqlite')
      configMethod = "options.useSqlite(process.env.DATABASE_URL || './dev.db');";
    if (provider === 'turso')
      configMethod =
        "options.useTurso({ url: process.env.TURSO_DATABASE_URL || '', authToken: process.env.TURSO_AUTH_TOKEN });";
    if (provider === 'neon') configMethod = "options.useNeon(process.env.DATABASE_URL || '');";
    if (provider === 'planetscale')
      configMethod =
        'options.usePlanetScale({ host: process.env.DATABASE_HOST, username: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD });';

    const content = `import { DbContext, DbContextOptionsBuilder } from 'entityts';

export class AppDbContext extends DbContext {
  protected override onConfiguring(options: DbContextOptionsBuilder): void {
    ${configMethod}
  }
}
`;
    fs.writeFileSync(contextPath, content, 'utf-8');
    console.log(`📝 Generated ${contextPath}`);
  } else {
    console.log(`ℹ️  Context file already exists: ${contextPath}`);
  }

  // Install ONLY the chosen database package
  await cmdAdd(provider, { force: true });
}

async function cmdImport(flags: Record<string, string | boolean>): Promise<void> {
  const from = (flags['from'] || flags['source']) as string | undefined;
  const input = (flags['input'] || flags['in'] || flags['file']) as string | undefined;
  const output = (flags['output'] || flags['out'] || './src/database') as string;
  const contextName = (flags['context-name'] || flags['context'] || 'AppDbContext') as string;

  if (!from || !['prisma', 'typeorm', 'drizzle'].includes(from.toLowerCase())) {
    console.error('Error: --from <prisma|typeorm|drizzle> is required.');
    process.exit(1);
  }

  if (!input) {
    console.error('Error: --input <path> is required.');
    process.exit(1);
  }

  const resolvedInput = path.resolve(process.cwd(), input);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`Error: Input path not found: ${resolvedInput}`);
    process.exit(1);
  }

  const { PrismaImporter, TypeormImporter, DrizzleImporter } = await import('../importers');
  let result: import('../importers').ImportResult;

  const normalizedFrom = from.toLowerCase();
  if (normalizedFrom === 'prisma') {
    const content = fs.readFileSync(resolvedInput, 'utf-8');
    result = PrismaImporter.importSchema(content, contextName);
  } else if (normalizedFrom === 'typeorm') {
    const stat = fs.statSync(resolvedInput);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(resolvedInput).filter(f => f.endsWith('.ts'));
      const entities = files.map(f => ({
        name: f,
        content: fs.readFileSync(path.join(resolvedInput, f), 'utf-8'),
      }));
      result = TypeormImporter.importEntities(entities, contextName);
    } else {
      const content = fs.readFileSync(resolvedInput, 'utf-8');
      result = TypeormImporter.importEntities(
        [{ name: path.basename(resolvedInput), content }],
        contextName,
      );
    }
  } else {
    const content = fs.readFileSync(resolvedInput, 'utf-8');
    result = DrizzleImporter.importSchema(content, contextName);
  }

  const outDir = path.resolve(process.cwd(), output);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const ent of result.entities) {
    const entPath = path.join(outDir, ent.filename);
    fs.writeFileSync(entPath, ent.content, 'utf-8');
    console.log(`📝 Generated entity: ${entPath}`);
  }

  const contextPath = path.join(outDir, result.context.filename);
  fs.writeFileSync(contextPath, result.context.content, 'utf-8');
  console.log(`📝 Generated DbContext: ${contextPath}`);

  console.log(
    `\n✅ Successfully imported ${result.entities.length} entities from ${normalizedFrom} into entityts!`,
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
