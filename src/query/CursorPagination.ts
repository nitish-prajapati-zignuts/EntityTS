import { ColumnKey } from './WhereClause';

export interface CursorPaginationOptions<T> {
  /**
   * The cursor token (base64 string) or plain object representing the cursor position.
   */
  cursor?: string | Record<string, any>;

  /**
   * Maximum number of items to return.
   */
  limit: number;

  /**
   * Column or selector function to order by.
   */
  orderBy: ColumnKey<T> | ((entity: T) => unknown);

  /**
   * Sort direction: 'asc' or 'desc'. Defaults to 'asc'.
   */
  direction?: 'asc' | 'desc';

  /**
   * Tie-breaker column name or selector function. Defaults to 'id'.
   */
  tieBreaker?: ColumnKey<T> | ((entity: T) => unknown);
}

export interface CursorPageResult<T> {
  /**
   * List of items returned for the current page.
   */
  items: T[];

  /**
   * Opaque base64 token representing the cursor for the next page, or null if no next page.
   */
  nextCursor: string | null;

  /**
   * Opaque base64 token representing the cursor for the previous page, or null if at the beginning.
   */
  prevCursor: string | null;

  /**
   * Whether more items exist after this page.
   */
  hasNextPage: boolean;

  /**
   * Whether items exist before this page.
   */
  hasPreviousPage: boolean;
}

export interface PagedListOptions {
  page: number;
  pageSize: number;
}

/**
 * Encodes cursor data into a URL-safe Base64 string.
 */
export function encodeCursor(data: Record<string, any>): string {
  const json = JSON.stringify(data);
  return Buffer.from(json, 'utf8').toString('base64url');
}

/**
 * Decodes a cursor token (Base64 string or plain object) into an object.
 */
export function decodeCursor(cursor: string | Record<string, any>): Record<string, any> | null {
  if (!cursor) return null;
  if (typeof cursor === 'object') return cursor;

  try {
    // Supports standard base64 and base64url
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}
