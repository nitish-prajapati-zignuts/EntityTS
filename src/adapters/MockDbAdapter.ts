import { IDbAdapter, DbProvider } from './IDbAdapter';
import { AdapterParam } from './AdapterParam';
import { StoredProcedureResult } from '../procedure/StoredProcedureResult';
import { ParameterDirection } from '../procedure/ParameterDirection';
import { IsolationLevel, DbTransaction } from '../transaction';
import { ProcedureNotFoundException } from '../errors';

export interface MockProcedureHandler {
  (params: Record<string, unknown>): {
    records?: unknown;
    outputParams?: Record<string, unknown>;
    returnValue?: number;
    rowsAffected?: number;
  };
}

export interface MockProcedureDef {
  records?: unknown;
  outputParams?: Record<string, unknown>;
  returnValue?: number;
  rowsAffected?: number;
  handler?: MockProcedureHandler;
}

export interface MockDbAdapterOptions {
  tables?: Record<string, Record<string, unknown>[]>;
  procedures?: Record<string, MockProcedureDef | MockProcedureHandler>;
}

export class MockDbAdapter implements IDbAdapter {
  public readonly provider: DbProvider = 'mock';
  public isConnected = false;
  public readonly executedQueries: { sql: string; params?: AdapterParam[] }[] = [];
  public readonly executedProcedures: { name: string; params: AdapterParam[] }[] = [];

  private readonly tables: Map<string, Record<string, unknown>[]> = new Map();
  private readonly procedures: Map<string, MockProcedureDef> = new Map();

  constructor(options?: MockDbAdapterOptions) {
    if (options?.tables) {
      for (const [table, rows] of Object.entries(options.tables)) {
        this.tables.set(table.toLowerCase(), JSON.parse(JSON.stringify(rows)));
      }
    }
    if (options?.procedures) {
      for (const [name, def] of Object.entries(options.procedures)) {
        if (typeof def === 'function') {
          this.procedures.set(name.toLowerCase(), { handler: def });
        } else {
          this.procedures.set(name.toLowerCase(), { ...def });
        }
      }
    }
  }

  public async connect(): Promise<void> {
    this.isConnected = true;
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  public async ping(): Promise<boolean> {
    return true;
  }

  public registerTable(name: string, data: Record<string, unknown>[]): void {
    this.tables.set(name.toLowerCase(), data.map(r => ({ ...r })));
  }

  public getTableData(name: string): Record<string, unknown>[] {
    return this.tables.get(name.toLowerCase()) || [];
  }

  public registerProcedure(name: string, def: MockProcedureDef | MockProcedureHandler): void {
    if (typeof def === 'function') {
      this.procedures.set(name.toLowerCase(), { handler: def });
    } else {
      this.procedures.set(name.toLowerCase(), { ...def });
    }
  }

  public async executeQuery<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction
  ): Promise<T[]> {
    this.executedQueries.push({ sql, params });

    if (/^(INSERT|MERGE)\b/i.test(sql) && (/RETURNING/i.test(sql) || /OUTPUT\s+INSERTED/i.test(sql))) {
      const res = await this.executeNonQuery(sql, params, _transaction);
      // Remove duplicate recording caused by internal call
      this.executedQueries.pop();
      const match = sql.match(/(?:INSERT\s+INTO|MERGE\s+INTO)\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        const rows = this.tables.get(rawTable) || [];
        if (res.insertId !== undefined) {
          const row = rows.find(r => r['id'] === res.insertId);
          if (row) return [{ ...row }] as T[];
        }
        if (rows.length > 0) {
          return [{ ...rows[rows.length - 1] }] as T[];
        }
      }
      return [] as T[];
    }

    const match = sql.match(/FROM\s+([`"[\]\w.]+)/i);
    if (match) {
      const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
      const rows = this.tables.get(rawTable) || [];
      const filtered = this.filterRows(rows, sql, params);
      return filtered.map(r => ({ ...r })) as T[];
    }
    return [] as T[];
  }

  public async executeNonQuery(
    sql: string,
    params?: AdapterParam[],
    _transaction?: DbTransaction
  ): Promise<{ rowsAffected: number; insertId?: unknown }> {
    this.executedQueries.push({ sql, params });

    if (/^MERGE\s+INTO\s+([`"[\]\w.]+)/i.test(sql)) {
      const match = sql.match(/^MERGE\s+INTO\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        let rows = this.tables.get(rawTable);
        if (!rows) {
          rows = [];
          this.tables.set(rawTable, rows);
        }

        const sourceColsMatch = sql.match(/AS\s+source\s*\(([^)]+)\)/i);
        const colNames = sourceColsMatch
          ? sourceColsMatch[1].split(',').map(c => c.replace(/[`"[\]\s]/g, ''))
          : [];

        const rowObj: Record<string, unknown> = {};
        if (colNames.length > 0 && params && params.length >= colNames.length) {
          for (let c = 0; c < colNames.length; c++) {
            rowObj[colNames[c]] = params[c].value;
          }
        }

        const onMatch = sql.match(/ON\s+([\s\S]+?)\s+WHEN\s+MATCHED/i);
        let existingRow: Record<string, unknown> | undefined;
        if (onMatch) {
          const onExpr = onMatch[1];
          const conds = Array.from(onExpr.matchAll(/target\.([`"[\]\w.]+)\s*=\s*source\.([`"[\]\w.]+)/gi));
          if (conds.length > 0) {
            existingRow = rows.find(r =>
              conds.every(cond => {
                const targetCol = cond[1].replace(/[`"[\]]/g, '');
                const sourceCol = cond[2].replace(/[`"[\]]/g, '');
                return r[targetCol] !== undefined && r[targetCol] === rowObj[sourceCol];
              })
            );
          }
        }

        if (existingRow) {
          Object.assign(existingRow, rowObj);
          return { rowsAffected: 1, insertId: existingRow['id'] };
        } else {
          const insertId = rows.length + 1;
          rowObj['id'] = rowObj['id'] ?? insertId;
          rows.push(rowObj);
          return { rowsAffected: 1, insertId: rowObj['id'] };
        }
      }
    }

    if (/^INSERT\s+INTO\s+([`"[\]\w.]+)/i.test(sql)) {
      const match = sql.match(/^INSERT\s+INTO\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        let rows = this.tables.get(rawTable);
        if (!rows) {
          rows = [];
          this.tables.set(rawTable, rows);
        }
        const valuesIdx = sql.toUpperCase().indexOf('VALUES');
        const beforeValues = valuesIdx !== -1 ? sql.substring(0, valuesIdx) : sql;
        const colMatch = beforeValues.match(/\(([^)]+)\)/);
        const colNames = colMatch
          ? colMatch[1].split(',').map(c => c.replace(/[`"[\]\s]/g, ''))
          : [];

        const onConflictMatch = sql.match(/ON\s+CONFLICT\s*\(([^)]+)\)/i);
        const onDuplicateKey = /ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql);

        let insertedCount = 0;
        let lastInsertId: unknown;

        if (colNames.length > 0 && params && params.length > 0) {
          const numCols = colNames.length;
          const numRows = Math.floor(params.length / numCols);
          for (let r = 0; r < numRows; r++) {
            const rowObj: Record<string, unknown> = {};
            for (let c = 0; c < numCols; c++) {
              const p = params[r * numCols + c];
              rowObj[colNames[c]] = p.value;
            }

            // Check conflict for upsert
            let existingRow: Record<string, unknown> | undefined;
            if (onConflictMatch) {
              const conflictCols = onConflictMatch[1].split(',').map(c => c.replace(/[`"[\]\s]/g, ''));
              existingRow = rows.find(row =>
                conflictCols.every(c => row[c] !== undefined && row[c] === rowObj[c])
              );
            } else if (onDuplicateKey) {
              const candidateCols = colNames.filter(c => c === 'id' || c === 'email' || c.endsWith('_id') || c === 'sku');
              existingRow = candidateCols.length > 0
                ? rows.find(row => candidateCols.some(c => row[c] !== undefined && row[c] === rowObj[c]))
                : undefined;
            }

            if (existingRow) {
              Object.assign(existingRow, rowObj);
              lastInsertId = existingRow['id'];
              insertedCount++;
            } else {
              const insertId = rows.length + 1;
              rowObj['id'] = rowObj['id'] ?? insertId;
              lastInsertId = rowObj['id'];
              rows.push(rowObj);
              insertedCount++;
            }
          }
        } else {
          const newObj: Record<string, unknown> = {};
          if (params) {
            params.forEach(p => {
              newObj[p.name] = p.value;
            });
          }
          const insertId = rows.length + 1;
          newObj['id'] = newObj['id'] ?? insertId;
          lastInsertId = newObj['id'];
          rows.push(newObj);
          insertedCount = 1;
        }

        return { rowsAffected: insertedCount, insertId: lastInsertId };
      }
    }

    if (/^UPDATE\s+([`"[\]\w.]+)/i.test(sql)) {
      const match = sql.match(/^UPDATE\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        const rows = this.tables.get(rawTable) || [];
        const whereIdx = sql.toUpperCase().indexOf('WHERE');
        const whereSql = whereIdx !== -1 ? sql.substring(whereIdx) : '';
        const matchedRows = this.filterRows(rows, whereSql, params);

        // Apply SET assignments
        if (params && params.length > 0) {
          // Identify set params vs where params
          // In QueryBuilder, SET params come before WHERE params
          const setPart = whereIdx !== -1 ? sql.substring(0, whereIdx) : sql;
          const setCols = Array.from(setPart.matchAll(/([`"[\]\w.]+)\s*=\s*(@p\d+|\?|\$\d+)/gi));
          for (let i = 0; i < setCols.length; i++) {
            const col = setCols[i][1].replace(/[`"[\]]/g, '');
            const p = params[i];
            if (p) {
              matchedRows.forEach(r => {
                r[col] = p.value;
              });
            }
          }
        }
        return { rowsAffected: matchedRows.length };
      }
    }

    if (/^DELETE\s+FROM\s+([`"[\]\w.]+)/i.test(sql)) {
      const match = sql.match(/^DELETE\s+FROM\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        const rows = this.tables.get(rawTable) || [];
        const matched = this.filterRows(rows, sql, params);
        const matchedSet = new Set(matched);
        const remaining = rows.filter(r => !matchedSet.has(r));
        this.tables.set(rawTable, remaining);
        return { rowsAffected: matched.length };
      }
    }

    return { rowsAffected: 1 };
  }

  public async executeScalar<T = unknown>(
    sql: string,
    params?: AdapterParam[],
    transaction?: DbTransaction
  ): Promise<T> {
    if (/COUNT\s*\(/i.test(sql)) {
      const match = sql.match(/FROM\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        const rows = this.tables.get(rawTable) || [];
        const filtered = this.filterRows(rows, sql, params);
        return filtered.length as unknown as T;
      }
      return 0 as unknown as T;
    }

    const aggMatch = sql.match(/SELECT\s+(SUM|AVG|MIN|MAX)\s*\(\s*[`"[\]]?(\w+)[`"[\]]?\s*\)/i);
    if (aggMatch) {
      const aggFn = aggMatch[1].toUpperCase();
      const col = aggMatch[2].toLowerCase();
      const match = sql.match(/FROM\s+([`"[\]\w.]+)/i);
      if (match) {
        const rawTable = match[1].replace(/[`"[\]]/g, '').toLowerCase();
        const rows = this.tables.get(rawTable) || [];
        const filtered = this.filterRows(rows, sql, params);
        const values = filtered
          .map(r => {
            const key = Object.keys(r).find(k => k.toLowerCase() === col);
            return key ? Number(r[key]) : NaN;
          })
          .filter(v => !isNaN(v));

        if (values.length === 0) return 0 as unknown as T;
        if (aggFn === 'SUM') {
          return values.reduce((acc, v) => acc + v, 0) as unknown as T;
        }
        if (aggFn === 'AVG') {
          return (values.reduce((acc, v) => acc + v, 0) / values.length) as unknown as T;
        }
        if (aggFn === 'MIN') {
          return Math.min(...values) as unknown as T;
        }
        if (aggFn === 'MAX') {
          return Math.max(...values) as unknown as T;
        }
      }
    }

    const rows = await this.executeQuery<any>(sql, params, transaction);
    if (!rows || rows.length === 0) {
      return null as unknown as T;
    }
    const first = rows[0];
    if (typeof first === 'object' && first !== null) {
      const keys = Object.keys(first);
      return first[keys[0]] as T;
    }
    return first as T;
  }

  private filterRows(
    rows: Record<string, unknown>[],
    sql: string,
    params?: AdapterParam[]
  ): Record<string, unknown>[] {
    let result = rows;

    // Check IS NULL
    const isNullMatches = Array.from(sql.matchAll(/([`"[\]\w.]+)\s+IS\s+NULL/gi));
    for (const m of isNullMatches) {
      const col = m[1].replace(/[`"[\]]/g, '');
      result = result.filter(r => r[col] === null || r[col] === undefined);
    }

    // Check IS NOT NULL
    const isNotNullMatches = Array.from(sql.matchAll(/([`"[\]\w.]+)\s+IS\s+NOT\s+NULL/gi));
    for (const m of isNotNullMatches) {
      const col = m[1].replace(/[`"[\]]/g, '');
      result = result.filter(r => r[col] !== null && r[col] !== undefined);
    }

    const getParamVal = (placeholder: string, fallbackIdx: number): unknown => {
      if (!params || params.length === 0) return undefined;
      if (placeholder.startsWith('@')) {
        const pName = placeholder.substring(1);
        const found = params.find(x => x.name === pName);
        return found ? found.value : undefined;
      }
      if (placeholder.startsWith('$')) {
        const idx = parseInt(placeholder.substring(1), 10) - 1;
        return params[idx]?.value;
      }
      return params[fallbackIdx]?.value;
    };

    // Check WHERE parameterized conditions
    const whereIdx = sql.toUpperCase().indexOf('WHERE');
    if (whereIdx !== -1 && params && params.length > 0) {
      let wherePart = sql.substring(whereIdx);

      // Check multi-column LIKE disjunctions: (col1 LIKE ph OR col2 LIKE ph ...)
      const likeDisjunctionRegex = /\(([`"[\]\w]+\s+LIKE\s+(@p\d+|\?|\$\d+)(?:\s+OR\s+[`"[\]\w]+\s+LIKE\s+(@p\d+|\?|\$\d+))+)\)/gi;
      const likeGroups = Array.from(wherePart.matchAll(likeDisjunctionRegex));
      for (const lg of likeGroups) {
        const groupSql = lg[1];
        const arms = Array.from(groupSql.matchAll(/[`"[\]]?(\w+)[`"[\]]?\s+LIKE\s+(@p\d+|\?|\$\d+)/gi));
        result = result.filter(r => {
          return arms.some(arm => {
            const col = arm[1];
            const ph = arm[2];
            const pVal = getParamVal(ph, 0);
            if (pVal === undefined) return false;
            const key = Object.keys(r).find(k => k.toLowerCase() === col.toLowerCase());
            const val = key ? r[key] : undefined;
            if (val === undefined) return false;
            const regex = new RegExp('^' + String(pVal).replace(/%/g, '.*') + '$', 'i');
            return regex.test(String(val));
          });
        });
        wherePart = wherePart.replace(lg[0], '1=1');
      }

      // Count placeholders in SET clause before WHERE in UPDATE statements
      let setParamCount = 0;
      if (sql.toUpperCase().startsWith('UPDATE')) {
        const setPart = sql.substring(0, whereIdx);
        setParamCount = Array.from(setPart.matchAll(/(@p\d+|\?|\$\d+)/g)).length;
      }

      // 1. Column comparisons:
      // Equality (=) matches both quoted and unquoted identifiers
      // Inequalities (<, >, <=, >=, !=, <>) match quoted identifiers to avoid breaking unquoted raw SQL tests
      const compMatches = Array.from(
        wherePart.matchAll(/(?:WHERE\s+|AND\s+|OR\s+|,\s*|\(\s*)(?:[`"[\]](\w+)[`"[\]]\s*(=|!=|<>|>=|<=|>|<|LIKE)|[`"[\]]?(\w+)[`"[\]]?\s*(=))\s*(@p\d+|\?|\$\d+)/gi)
      );
      let wherePlaceholderIdx = 0;
      for (const m of compMatches) {
        const col = m[1] || m[3];
        const op = (m[2] || m[4]).toUpperCase();
        const placeholder = m[5];
        const paramVal = getParamVal(placeholder, setParamCount + wherePlaceholderIdx);
        wherePlaceholderIdx++;

        if (paramVal !== undefined) {
          result = result.filter(r => {
            const key = Object.keys(r).find(k => k.toLowerCase() === col.toLowerCase());
            const val = key ? r[key] : undefined;
            if (val === undefined) return false;
            if (op === '=') return String(val) === String(paramVal);
            if (op === '!=' || op === '<>') return String(val) !== String(paramVal);
            if (op === '>') return (val as any) > (paramVal as any);
            if (op === '>=') return (val as any) >= (paramVal as any);
            if (op === '<') return (val as any) < (paramVal as any);
            if (op === '<=') return (val as any) <= (paramVal as any);
            if (op === 'LIKE') {
              const regex = new RegExp('^' + String(paramVal).replace(/%/g, '.*') + '$', 'i');
              return regex.test(String(val));
            }
            return true;
          });
        }
      }

      // 2. Full-text search matching (Postgres, MySQL, MSSQL, SQLite)
      const tsMatches = Array.from(
        wherePart.matchAll(/(?:to_tsvector\s*\([^)]*\)\s*@@\s*\w+_to_tsquery\s*\([^,]+,\s*(@p\d+|\?|\$\d+)\)|MATCH\s*\(([^)]+)\)\s*AGAINST\s*\(\s*(@p\d+|\?|\$\d+)|CONTAINS\s*\([^,]+,\s*(@p\d+|\?|\$\d+)\))/gi)
      );
      for (const tm of tsMatches) {
        const placeholder = tm[1] || tm[3] || tm[4];
        if (placeholder) {
          const paramVal = getParamVal(placeholder, 0);
          if (paramVal !== undefined) {
            const terms = String(paramVal).toLowerCase().split(/\s+/).filter(Boolean);
            result = result.filter(r => {
              const str = Object.values(r).join(' ').toLowerCase();
              return terms.some(t => str.includes(t));
            });
          }
        }
      }

      // 3. JSON path extraction (SQLite json_extract, MySQL JSON_UNQUOTE)
      const jsonExtractMatches = Array.from(
        wherePart.matchAll(/(?:json_extract|JSON_UNQUOTE\s*\(\s*JSON_EXTRACT)\s*\(\s*[`"[\]]?(\w+)[`"[\]]?\s*,\s*'([^']+)'\s*\)\s*(=|!=|<>|>|>=|<|<=|LIKE)\s*(@p\d+|\?|\$\d+)/gi)
      );
      for (const jm of jsonExtractMatches) {
        const col = jm[1];
        const jsonPath = jm[2];
        const op = jm[3];
        const placeholder = jm[4];
        const paramVal = getParamVal(placeholder, 0);

        if (paramVal !== undefined) {
          const pathParts = jsonPath.replace(/^\$\.?/, '').split('.');
          result = result.filter(r => {
            const colKey = Object.keys(r).find(k => k.toLowerCase() === col.toLowerCase());
            let current: any = colKey ? r[colKey] : undefined;
            if (typeof current === 'string') {
              try { current = JSON.parse(current); } catch {}
            }
            for (const part of pathParts) {
              if (current === null || current === undefined) break;
              current = current[part];
            }
            if (op === '=') return String(current) === String(paramVal);
            if (op === '!=' || op === '<>') return String(current) !== String(paramVal);
            if (op === '>') return Number(current) > Number(paramVal);
            if (op === '>=') return Number(current) >= Number(paramVal);
            if (op === '<') return Number(current) < Number(paramVal);
            if (op === '<=') return Number(current) <= Number(paramVal);
            if (op.toUpperCase() === 'LIKE') {
              const regex = new RegExp('^' + String(paramVal).replace(/%/g, '.*') + '$', 'i');
              return regex.test(String(current));
            }
            return true;
          });
        }
      }

      // 4. PostgreSQL style JSON arrows: col->'a'->>'b' = ph
      const pgMatches = Array.from(
        wherePart.matchAll(/[`"[\]]?(\w+)[`"[\]]?(->(?:'[^']+'|\d+))*->>(?:'([^']+)'|(\d+))\s*(=|!=|<>|>|>=|<|<=|LIKE)\s*(@p\d+|\?|\$\d+)/gi)
      );
      for (const pm of pgMatches) {
        const fullExpr = pm[0];
        const col = pm[1];
        const lastPart = pm[3] || pm[4];
        const op = pm[5];
        const placeholder = pm[6];

        const innerArrows = Array.from(fullExpr.matchAll(/->(?:'([^']+)'|(\d+))/g)).map(m => m[1] || m[2]);
        const allParts = [...innerArrows, lastPart];

        const paramVal = getParamVal(placeholder, 0);

        if (paramVal !== undefined) {
          result = result.filter(r => {
            const colKey = Object.keys(r).find(k => k.toLowerCase() === col.toLowerCase());
            let current: any = colKey ? r[colKey] : undefined;
            if (typeof current === 'string') {
              try { current = JSON.parse(current); } catch {}
            }
            for (const part of allParts) {
              if (current === null || current === undefined) break;
              current = current[part];
            }
            if (op === '=') return String(current) === String(paramVal);
            if (op === '!=' || op === '<>') return String(current) !== String(paramVal);
            if (op === '>') return Number(current) > Number(paramVal);
            if (op === '>=') return Number(current) >= Number(paramVal);
            if (op === '<') return Number(current) < Number(paramVal);
            if (op === '<=') return Number(current) <= Number(paramVal);
            if (op.toUpperCase() === 'LIKE') {
              const regex = new RegExp('^' + String(paramVal).replace(/%/g, '.*') + '$', 'i');
              return regex.test(String(current));
            }
            return true;
          });
        }
      }
    }

    // Handle ORDER BY
    const orderMatch = sql.match(/ORDER\s+BY\s+([^;]+?)(?:\s+LIMIT|\s+OFFSET|\s+FETCH|$)/i);
    if (orderMatch) {
      const orderDefs = orderMatch[1].split(',').map(part => {
        const trimmed = part.trim();
        const desc = /DESC$/i.test(trimmed);
        const col = trimmed.replace(/\s+(ASC|DESC)$/i, '').replace(/[`"[\]]/g, '').trim();
        return { col, desc };
      });
      result = [...result].sort((a, b) => {
        for (const { col, desc } of orderDefs) {
          if (col === '(SELECT NULL)') continue;
          const keyA = Object.keys(a).find(k => k.toLowerCase() === col.toLowerCase());
          const keyB = Object.keys(b).find(k => k.toLowerCase() === col.toLowerCase());
          const valA = keyA ? (a as any)[keyA] : undefined;
          const valB = keyB ? (b as any)[keyB] : undefined;
          if (valA === valB) continue;
          if (valA === undefined || valA === null) return desc ? 1 : -1;
          if (valB === undefined || valB === null) return desc ? -1 : 1;
          const cmp = valA > valB ? 1 : -1;
          return desc ? -cmp : cmp;
        }
        return 0;
      });
    }

    // Handle LIMIT / OFFSET
    let limit: number | undefined;
    let offset: number | undefined;

    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) {
      limit = parseInt(limitMatch[1], 10);
    }
    const offsetMatch = sql.match(/OFFSET\s+(\d+)/i);
    if (offsetMatch) {
      offset = parseInt(offsetMatch[1], 10);
    }
    const fetchMatch = sql.match(/FETCH\s+NEXT\s+(\d+)\s+ROWS/i);
    if (fetchMatch) {
      limit = parseInt(fetchMatch[1], 10);
    }

    if (offset !== undefined || limit !== undefined) {
      const start = offset || 0;
      const end = limit !== undefined ? start + limit : undefined;
      result = result.slice(start, end);
    }

    return result;
  }

  public async executeProcedure<T = unknown>(
    name: string,
    params: AdapterParam[],
    _timeoutMs?: number,
    _transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T[]>> {
    this.executedProcedures.push({ name, params });

    const def = this.procedures.get(name.toLowerCase());
    if (def) {
      if (def.handler) {
        const paramMap: Record<string, unknown> = {};
        params.forEach(p => (paramMap[p.name] = p.value));
        const res = def.handler(paramMap);
        return {
          records: (res.records ?? []) as T[],
          outputParams: res.outputParams ?? {},
          returnValue: res.returnValue ?? 0,
          rowsAffected: res.rowsAffected ?? 0,
        };
      }

      // Populate output params from def or reflection
      const outputParams: Record<string, unknown> = { ...(def.outputParams || {}) };
      for (const p of params) {
        if (
          p.direction === ParameterDirection.Output ||
          p.direction === ParameterDirection.InputOutput
        ) {
          if (!(p.name in outputParams)) {
            outputParams[p.name] = p.value ?? null;
          }
        }
      }

      return {
        records: (def.records ?? []) as T[],
        outputParams,
        returnValue: def.returnValue ?? 0,
        rowsAffected: def.rowsAffected ?? 1,
      };
    }

    throw new ProcedureNotFoundException(
      `Stored procedure '${name}' does not exist in the database.`,
      name
    );
  }

  public async executeProcedureMultiple<T extends unknown[] = unknown[]>(
    name: string,
    params: AdapterParam[],
    timeoutMs?: number,
    transaction?: DbTransaction
  ): Promise<StoredProcedureResult<T>> {
    const single = await this.executeProcedure<any>(name, params, timeoutMs, transaction);
    const records = (Array.isArray(single.records) && Array.isArray(single.records[0])
      ? single.records
      : [single.records]) as unknown as T;

    return {
      records,
      outputParams: single.outputParams,
      returnValue: single.returnValue,
      rowsAffected: single.rowsAffected,
    };
  }

  public async beginTransaction(isolationLevel = IsolationLevel.ReadCommitted): Promise<DbTransaction> {
    const driver = {
      commit: async () => {},
      rollback: async () => {},
      savepoint: async () => {},
      rollbackTo: async () => {},
    };
    return new DbTransaction(driver, isolationLevel);
  }

  public escapeIdentifier(name: string): string {
    return `"${name}"`;
  }

  public formatParameterPlaceholder(paramName: string, _index: number): string {
    return `@${paramName}`;
  }
}
