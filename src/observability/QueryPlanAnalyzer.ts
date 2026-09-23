import { QueryHooks } from '../hooks/QueryHook';
import { IDbAdapter, DbProvider } from '../adapters/IDbAdapter';

// ─── Public Types ─────────────────────────────────────────────────────────────

/**
 * A single node extracted from the query plan tree (PostgreSQL JSON format).
 * @public
 */
export interface PlanNode {
  /** Node type e.g. "Seq Scan", "Index Scan", "Hash Join", "Nested Loop" */
  type: string;
  /** Relation (table) name, if applicable */
  relation?: string;
  /** Planner estimated startup cost */
  startupCost: number;
  /** Planner estimated total cost */
  totalCost: number;
  /** Planner estimated row count */
  planRows: number;
  /** Actual row count returned at runtime (ANALYZE mode only) */
  actualRows?: number;
  /** Actual total loop time in ms (ANALYZE mode only) */
  actualTimeMs?: number;
  /** Index name used by this node, if any */
  indexName?: string;
  /** Child plan nodes */
  children: PlanNode[];
}

/**
 * Parsed result of an EXPLAIN [ANALYZE] execution.
 * @public
 */
export interface QueryPlanResult {
  /** The original SQL statement that was analyzed */
  sql: string;
  /** Database provider that produced the plan */
  provider: DbProvider | string;
  /** Wall-clock execution time in ms (ANALYZE only) */
  executionTimeMs?: number;
  /** Planner estimated total cost (root node) */
  totalCost: number;
  /** Planner estimated row count (root node) */
  planRows: number;
  /** Actual rows at runtime (ANALYZE only) */
  actualRows?: number;
  /** True when at least one Seq Scan is present — potential index opportunity */
  hasSeqScan: boolean;
  /** Index names used across all plan nodes */
  indexesUsed: string[];
  /** True when a Nested Loop join exceeded 10k actual rows */
  hasNestedLoopWarning: boolean;
  /** Raw plan text (non-Postgres providers) */
  rawPlan?: string;
  /** Parsed plan tree (PostgreSQL JSON format only) */
  planTree?: PlanNode;
}

/**
 * Options for createQueryPlanLogger.
 * @public
 */
export interface QueryPlanLoggerOptions {
  /**
   * The live adapter to issue EXPLAIN queries against.
   * Must be the same adapter used by the DbContext.
   */
  adapter: IDbAdapter;

  /**
   * When true, runs EXPLAIN ANALYZE (executes the real query for accurate timing).
   * When false (default), runs EXPLAIN only without re-executing the query.
   *
   * @caution EXPLAIN ANALYZE actually executes the SQL — only use it on SELECT queries.
   * @defaultValue false
   */
  analyze?: boolean;

  /**
   * Only run the planner when actual query execution time exceeds this threshold in ms.
   * Leave undefined to always run the planner on matching queries.
   * @defaultValue undefined
   */
  thresholdMs?: number;

  /**
   * SQL operation prefixes to analyze.
   * @defaultValue ['SELECT'] — INSERT/UPDATE/DELETE excluded by default to avoid double-execution.
   */
  operations?: Array<'SELECT' | 'WITH' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'>;

  /**
   * Emit a warning log line when a Seq Scan (full table scan) is detected.
   * @defaultValue true
   */
  warnOnSeqScan?: boolean;

  /**
   * Whether to include ANSI terminal colors in output.
   * @defaultValue auto-detected from process.stdout.isTTY
   */
  colorize?: boolean;

  /**
   * Custom log destination. Defaults to console.log.
   */
  logger?: (message: string) => void;

  /**
   * Called after each plan is computed, with the structured result.
   * Use to push plan data to a metrics pipeline or alerting system.
   */
  onPlan?: (plan: QueryPlanResult) => void;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function buildExplainSql(provider: string, sql: string, analyze: boolean): string | null {
  switch (provider) {
    case 'postgres':
    case 'neon':
    case 'cockroachdb':
    case 'supabase':
      return analyze
        ? `EXPLAIN (ANALYZE, COSTS, FORMAT JSON) ${sql}`
        : `EXPLAIN (COSTS, FORMAT JSON) ${sql}`;
    case 'mysql':
      return `EXPLAIN ${sql}`;
    case 'sqlite':
    case 'turso':
    case 'd1':
      return `EXPLAIN QUERY PLAN ${sql}`;
    default:
      return null;
  }
}

function parsePgNode(raw: any): PlanNode {
  const node: PlanNode = {
    type: raw['Node Type'] ?? 'Unknown',
    relation: raw['Relation Name'],
    startupCost: raw['Startup Cost'] ?? 0,
    totalCost: raw['Total Cost'] ?? 0,
    planRows: raw['Plan Rows'] ?? 0,
    actualRows: raw['Actual Rows'],
    actualTimeMs:
      raw['Actual Total Time'] !== undefined
        ? parseFloat(raw['Actual Total Time'].toFixed(3))
        : undefined,
    indexName: raw['Index Name'],
    children: [],
  };
  if (raw.Plans && Array.isArray(raw.Plans)) {
    node.children = raw.Plans.map(parsePgNode);
  }
  return node;
}

function walkPlanTree(
  node: PlanNode,
  state: { hasSeqScan: boolean; indexes: Set<string>; hasNestedLoop: boolean },
): void {
  if (node.type === 'Seq Scan') state.hasSeqScan = true;
  if (node.type === 'Nested Loop' && (node.actualRows ?? 0) > 10_000) state.hasNestedLoop = true;
  if (node.indexName) state.indexes.add(node.indexName);
  for (const child of node.children) walkPlanTree(child, state);
}

function makeColors(colorize: boolean) {
  return {
    cCyan: colorize ? '\x1b[36m' : '',
    cGreen: colorize ? '\x1b[32m' : '',
    cYellow: colorize ? '\x1b[33m' : '',
    cRed: colorize ? '\x1b[31m' : '',
    cGray: colorize ? '\x1b[90m' : '',
    cWhite: colorize ? '\x1b[37m' : '',
    cBold: colorize ? '\x1b[1m' : '',
    cReset: colorize ? '\x1b[0m' : '',
  };
}

function formatPlanTree(
  node: PlanNode,
  indent: number,
  colors: ReturnType<typeof makeColors>,
): string {
  const { cCyan, cYellow, cRed, cGreen, cGray, cWhite, cReset } = colors;
  const pad = '  '.repeat(indent);
  const arrow = indent === 0 ? '→ ' : '↳ ';

  const nodeColor = node.type.includes('Seq Scan') ? cRed : node.indexName ? cGreen : cCyan;
  let label = `${pad}${arrow}${nodeColor}${node.type}${cReset}`;
  if (node.relation) label += ` ${cWhite}on ${node.relation}${cReset}`;
  if (node.indexName) label += ` ${cGray}[index: ${node.indexName}]${cReset}`;

  const cost = `${cGray}cost=${node.startupCost.toFixed(2)}..${node.totalCost.toFixed(2)} rows=${node.planRows}${cReset}`;

  let actual = '';
  if (node.actualRows !== undefined) {
    const ratio = node.planRows > 0 ? node.actualRows / node.planRows : 1;
    const pct = Math.round(ratio * 100);
    const actColor = Math.abs(ratio - 1) > 0.5 ? cYellow : cGreen;
    actual = ` ${actColor}actual=${node.actualRows} (est ${pct}%)${cReset}`;
    if (node.actualTimeMs !== undefined) {
      actual += ` ${cGray}${node.actualTimeMs}ms${cReset}`;
    }
  }

  let result = `${label}  ${cost}${actual}\n`;
  for (const child of node.children) {
    result += formatPlanTree(child, indent + 1, colors);
  }
  return result;
}

// ─── Public Factory ────────────────────────────────────────────────────────────

/**
 * Creates a QueryHooks plugin that transparently runs EXPLAIN [ANALYZE] alongside
 * each SELECT query and prints a rich, structured plan report with:
 *
 * - Estimated vs actual row counts (and accuracy percentage)
 * - Total planner cost (coloured by magnitude)
 * - Index names used at each plan node
 * - Seq Scan detection with an actionable warning
 * - Nested Loop warnings for large join results
 * - Execution time breakdown (ANALYZE mode)
 *
 * Dialect support:
 * - PostgreSQL / Neon / CockroachDB / Supabase: full JSON plan tree with recursive node parsing
 * - MySQL: text EXPLAIN output
 * - SQLite / Turso / D1: EXPLAIN QUERY PLAN text output
 *
 * @usecase
 * Identify missing indexes, planner row-count mis-estimates, and expensive full-table
 * scans directly in your server logs — in development or staging — without running
 * separate database tooling.
 *
 * @param opts - Configuration options including the live adapter and analysis mode.
 * @returns QueryHooks object ready to pass to options.withHooks(...).
 *
 * @example
 * ```ts
 * // In onConfiguring() — always analyze SELECTs (EXPLAIN, no re-execution):
 * options.withHooks(
 *   createQueryPlanLogger({ adapter })
 * );
 *
 * // EXPLAIN ANALYZE only when query takes > 50ms:
 * options.withHooks(
 *   createQueryPlanLogger({
 *     adapter,
 *     analyze: true,
 *     thresholdMs: 50,
 *     warnOnSeqScan: true,
 *     onPlan: (plan) => {
 *       if (plan.hasSeqScan) alerting.warn('seq_scan', plan.sql);
 *     },
 *   })
 * );
 * ```
 */
export function createQueryPlanLogger(opts: QueryPlanLoggerOptions): QueryHooks {
  const {
    adapter,
    analyze = false,
    thresholdMs,
    operations = ['SELECT'],
    warnOnSeqScan = true,
    onPlan,
  } = opts;

  const colorize = opts.colorize ?? process.stdout?.isTTY !== false;
  const logFn = opts.logger ?? ((msg: string) => console.log(msg));
  const colors = makeColors(colorize);
  const { cCyan, cYellow, cRed, cGreen, cGray, cBold, cReset } = colors;

  const shouldAnalyzeOp = (sql: string): boolean => {
    if (operations.some(o => o === 'ALL')) return true;
    const upper = sql.trimStart().toUpperCase();
    return operations.some(op => upper.startsWith(op));
  };

  return {
    onAfterQuery: async (sql: string, _params?: unknown[], durationMs?: number) => {
      // Threshold check
      if (thresholdMs !== undefined && (durationMs ?? 0) < thresholdMs) return;
      // Operation filter
      if (!shouldAnalyzeOp(sql)) return;

      const provider = adapter.provider;
      const explainSql = buildExplainSql(provider, sql, analyze);
      if (!explainSql) return;

      let planResult: QueryPlanResult;

      try {
        if (['postgres', 'neon', 'cockroachdb', 'supabase'].includes(provider)) {
          const rows = await adapter.executeQuery<Record<string, any>>(explainSql, []);

          // pg returns QUERY PLAN column containing a JSON array
          const planJson = rows?.[0]?.['QUERY PLAN']?.[0] ?? rows?.[0];
          const rootRaw = planJson?.Plan ?? planJson;

          if (!rootRaw) {
            const raw = rows.map((r: any) => Object.values(r).join(' ')).join('\n');
            planResult = {
              sql,
              provider,
              totalCost: 0,
              planRows: 0,
              hasSeqScan: false,
              indexesUsed: [],
              hasNestedLoopWarning: false,
              rawPlan: raw,
            };
          } else {
            const planTree = parsePgNode(rootRaw);
            const state = { hasSeqScan: false, indexes: new Set<string>(), hasNestedLoop: false };
            walkPlanTree(planTree, state);

            planResult = {
              sql,
              provider,
              executionTimeMs:
                planJson?.['Execution Time'] !== undefined
                  ? parseFloat(planJson['Execution Time'].toFixed(3))
                  : undefined,
              totalCost: planTree.totalCost,
              planRows: planTree.planRows,
              actualRows: planTree.actualRows,
              hasSeqScan: state.hasSeqScan,
              indexesUsed: Array.from(state.indexes),
              hasNestedLoopWarning: state.hasNestedLoop,
              planTree,
            };
          }
        } else {
          const rows = await adapter.executeQuery<Record<string, any>>(explainSql, []);
          const rawPlan = rows.map((r: any) => Object.values(r).join(' | ')).join('\n');
          planResult = {
            sql,
            provider,
            totalCost: 0,
            planRows: 0,
            hasSeqScan:
              rawPlan.toUpperCase().includes('SCAN') && !rawPlan.toUpperCase().includes('INDEX'),
            indexesUsed: [],
            hasNestedLoopWarning: false,
            rawPlan,
          };
        }
      } catch {
        return; // Fail silently — EXPLAIN inside transactions can be unsupported
      }

      // ─── Render Plan Output ────────────────────────────────────────────────
      const sep = `${cGray}──────────────────────────────────────────────────────${cReset}`;
      const trimmed = sql.trimStart().replace(/\s+/g, ' ');
      const preview = trimmed.length > 72 ? trimmed.substring(0, 72) + '…' : trimmed;
      const mode = analyze
        ? `${cGray}(EXPLAIN ANALYZE)${cReset}`
        : `${cGray}(EXPLAIN only)${cReset}`;

      const lines: string[] = [
        sep,
        `${cBold}${cCyan}query:plan${cReset}  ${cGray}${preview}${cReset}`,
        `  ${cGray}Provider: ${cReset} ${provider}  ${mode}`,
      ];

      if (planResult.totalCost > 0) {
        const costColor = planResult.totalCost > 500 ? cYellow : cGreen;
        lines.push(
          `  ${cGray}Est. Cost:${cReset} ${costColor}${planResult.totalCost.toFixed(2)}${cReset}`,
        );
        lines.push(`  ${cGray}Est. Rows:${cReset} ${planResult.planRows}`);
      }
      if (planResult.actualRows !== undefined) {
        lines.push(`  ${cGray}Act. Rows:${cReset} ${cGreen}${planResult.actualRows}${cReset}`);
      }
      if (planResult.executionTimeMs !== undefined) {
        lines.push(
          `  ${cGray}Plan  ms: ${cReset} ${cGreen}${planResult.executionTimeMs}ms${cReset}`,
        );
      }
      if (durationMs !== undefined) {
        lines.push(`  ${cGray}Query ms: ${cReset} ${cGreen}${durationMs}ms${cReset}`);
      }
      if (planResult.indexesUsed.length > 0) {
        lines.push(
          `  ${cGray}Indexes:  ${cReset} ${cGreen}${planResult.indexesUsed.join(', ')}${cReset}`,
        );
      } else if (planResult.planTree) {
        lines.push(`  ${cGray}Indexes:  ${cReset} ${cGray}none${cReset}`);
      }

      if (planResult.hasSeqScan && warnOnSeqScan) {
        lines.push(
          `  ${cRed}⚠  Seq Scan detected — consider adding an index on filtered column(s)${cReset}`,
        );
      }
      if (planResult.hasNestedLoopWarning) {
        lines.push(
          `  ${cYellow}⚠  Nested Loop join with >10k actual rows — check join strategy${cReset}`,
        );
      }

      if (planResult.planTree) {
        lines.push(`  ${cGray}Plan Tree:${cReset}`);
        lines.push(formatPlanTree(planResult.planTree, 2, colors).trimEnd());
      } else if (planResult.rawPlan) {
        lines.push(`  ${cGray}Plan:${cReset}`);
        for (const row of planResult.rawPlan.split('\n')) {
          lines.push(`    ${cGray}${row}${cReset}`);
        }
      }

      lines.push(sep);
      logFn(lines.join('\n'));

      if (onPlan) onPlan(planResult);
    },
  };
}
