export interface OrderByClause {
  column: string;
  direction: 'ASC' | 'DESC';
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface JoinClause {
  type: JoinType;
  tableName: string;
  alias?: string;
  leftColumn: string;
  rightColumn: string;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  totalCount: number;
  page: number;
  pageIndex: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasNextPage: boolean;
  hasPrevious: boolean;
  hasPreviousPage: boolean;
}

export interface SqlResult<T = unknown> {
  rows: T[];
  rowsAffected: number;
  insertId?: unknown;
}
