export interface QueryHooks {
  onBeforeQuery?: (sql: string, params?: unknown[]) => void | Promise<void>;
  onAfterQuery?: (sql: string, params?: unknown[], durationMs?: number) => void | Promise<void>;
  onError?: (err: Error, sql: string, params?: unknown[]) => void | Promise<void>;
}
