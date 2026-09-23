import { IDbAdapter } from '../adapters/IDbAdapter';
import { Money } from './Money';
import { UnbalancedLedgerException } from '../errors';

export type JournalDirection = 'DEBIT' | 'CREDIT';

export interface JournalLine {
  id?: string;
  entryId?: string;
  accountId: string;
  direction: JournalDirection;
  amount: Money;
  currency: string;
  description?: string;
}

export interface LedgerEntry {
  id: string;
  reference?: string;
  description?: string;
  postedAt: number;
  metadata?: Record<string, unknown>;
  lines: JournalLine[];
}

export interface TransferOptions {
  fromAccount: string;
  toAccount: string;
  amount: Money | string | number;
  currency?: string;
  reference?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Fluent builder for multi-leg double-entry journal postings.
 */
export class LedgerEntryBuilder {
  private readonly lines: JournalLine[] = [];
  private entryReference?: string;
  private entryDescription?: string;
  private entryMetadata?: Record<string, unknown>;

  constructor(private readonly defaultCurrency: string = 'USD') {}

  public reference(ref: string): this {
    this.entryReference = ref;
    return this;
  }

  public description(desc: string): this {
    this.entryDescription = desc;
    return this;
  }

  public metadata(meta: Record<string, unknown>): this {
    this.entryMetadata = meta;
    return this;
  }

  /**
   * Adds a DEBIT line to the journal entry.
   */
  public debit(
    accountId: string,
    amount: Money | string | number,
    description?: string,
    currency?: string,
  ): this {
    const curr = currency || (amount instanceof Money ? amount.currency : this.defaultCurrency);
    const m = Money.from(amount, curr);
    this.lines.push({
      accountId,
      direction: 'DEBIT',
      amount: m,
      currency: curr,
      description,
    });
    return this;
  }

  /**
   * Adds a CREDIT line to the journal entry.
   */
  public credit(
    accountId: string,
    amount: Money | string | number,
    description?: string,
    currency?: string,
  ): this {
    const curr = currency || (amount instanceof Money ? amount.currency : this.defaultCurrency);
    const m = Money.from(amount, curr);
    this.lines.push({
      accountId,
      direction: 'CREDIT',
      amount: m,
      currency: curr,
      description,
    });
    return this;
  }

  /**
   * Validates mathematical balance: Sum of Debits MUST equal Sum of Credits.
   * Throws `UnbalancedLedgerException` if $\sum \text{Debits} \neq \sum \text{Credits}$.
   */
  public validate(): void {
    if (this.lines.length < 2) {
      throw new Error('A double-entry transaction must contain at least two journal lines.');
    }

    // Group by currency to enforce balancing per currency
    const balancesByCurrency = new Map<string, { debits: Money; credits: Money }>();

    for (const line of this.lines) {
      if (!balancesByCurrency.has(line.currency)) {
        balancesByCurrency.set(line.currency, {
          debits: Money.zero(line.currency),
          credits: Money.zero(line.currency),
        });
      }
      const b = balancesByCurrency.get(line.currency)!;
      if (line.direction === 'DEBIT') {
        b.debits = b.debits.add(line.amount);
      } else {
        b.credits = b.credits.add(line.amount);
      }
    }

    for (const [curr, { debits, credits }] of balancesByCurrency.entries()) {
      if (!debits.equals(credits)) {
        throw new UnbalancedLedgerException(
          `${curr} ${debits.toDecimalString(4)}`,
          `${curr} ${credits.toDecimalString(4)}`,
        );
      }
    }
  }

  public getLines(): JournalLine[] {
    return [...this.lines];
  }

  public getReference(): string | undefined {
    return this.entryReference;
  }

  public getDescription(): string | undefined {
    return this.entryDescription;
  }

  public getMetadata(): Record<string, unknown> | undefined {
    return this.entryMetadata;
  }
}

/**
 * Enterprise Double-Entry Ledger Engine for @nsp/dbcontext.
 * Provides immutable append-only ledger entries and guaranteed debit/credit mathematical balancing.
 */
export class LedgerManager {
  private schemaEnsured = false;

  constructor(private readonly adapter: IDbAdapter) {}

  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;

    const provider = this.adapter.provider;
    let entriesSql: string;
    let linesSql: string;

    if (provider === 'mssql') {
      entriesSql = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='__nsp_ledger_entries' AND xtype='U')
        CREATE TABLE [__nsp_ledger_entries] (
          [id] NVARCHAR(64) PRIMARY KEY,
          [reference] NVARCHAR(255),
          [description] NVARCHAR(500),
          [posted_at] BIGINT NOT NULL,
          [metadata] NVARCHAR(MAX)
        )
      `;
      linesSql = `
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='__nsp_journal_lines' AND xtype='U')
        CREATE TABLE [__nsp_journal_lines] (
          [id] NVARCHAR(64) PRIMARY KEY,
          [entry_id] NVARCHAR(64) NOT NULL,
          [account_id] NVARCHAR(255) NOT NULL,
          [direction] NVARCHAR(10) NOT NULL,
          [amount] NVARCHAR(32) NOT NULL,
          [currency] NVARCHAR(3) NOT NULL,
          [description] NVARCHAR(500)
        )
      `;
    } else if (provider === 'mysql' || provider === 'planetscale') {
      entriesSql = `
        CREATE TABLE IF NOT EXISTS \`__nsp_ledger_entries\` (
          \`id\` VARCHAR(64) PRIMARY KEY,
          \`reference\` VARCHAR(255),
          \`description\` VARCHAR(500),
          \`posted_at\` BIGINT NOT NULL,
          \`metadata\` LONGTEXT
        )
      `;
      linesSql = `
        CREATE TABLE IF NOT EXISTS \`__nsp_journal_lines\` (
          \`id\` VARCHAR(64) PRIMARY KEY,
          \`entry_id\` VARCHAR(64) NOT NULL,
          \`account_id\` VARCHAR(255) NOT NULL,
          \`direction\` VARCHAR(10) NOT NULL,
          \`amount\` VARCHAR(32) NOT NULL,
          \`currency\` VARCHAR(3) NOT NULL,
          \`description\` VARCHAR(500)
        )
      `;
    } else if (
      provider === 'postgres' ||
      provider === 'neon' ||
      provider === 'supabase' ||
      provider === 'cockroachdb'
    ) {
      entriesSql = `
        CREATE TABLE IF NOT EXISTS "__nsp_ledger_entries" (
          "id" VARCHAR(64) PRIMARY KEY,
          "reference" VARCHAR(255),
          "description" VARCHAR(500),
          "posted_at" BIGINT NOT NULL,
          "metadata" TEXT
        )
      `;
      linesSql = `
        CREATE TABLE IF NOT EXISTS "__nsp_journal_lines" (
          "id" VARCHAR(64) PRIMARY KEY,
          "entry_id" VARCHAR(64) NOT NULL,
          "account_id" VARCHAR(255) NOT NULL,
          "direction" VARCHAR(10) NOT NULL,
          "amount" VARCHAR(32) NOT NULL,
          "currency" VARCHAR(3) NOT NULL,
          "description" VARCHAR(500)
        )
      `;
    } else {
      // SQLite, Turso, D1
      entriesSql = `
        CREATE TABLE IF NOT EXISTS __nsp_ledger_entries (
          id TEXT PRIMARY KEY,
          reference TEXT,
          description TEXT,
          posted_at INTEGER NOT NULL,
          metadata TEXT
        )
      `;
      linesSql = `
        CREATE TABLE IF NOT EXISTS __nsp_journal_lines (
          id TEXT PRIMARY KEY,
          entry_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          direction TEXT NOT NULL,
          amount TEXT NOT NULL,
          currency TEXT NOT NULL,
          description TEXT
        )
      `;
    }

    await this.adapter.executeNonQuery(entriesSql);
    await this.adapter.executeNonQuery(linesSql);
    this.schemaEnsured = true;
  }

  /**
   * Posts an immutable multi-leg double-entry transaction to the ledger.
   * Enforces debits == credits balancing prior to database persistence.
   */
  public async postEntry(
    builderCallback: (builder: LedgerEntryBuilder) => void,
  ): Promise<LedgerEntry> {
    await this.ensureSchema();

    const builder = new LedgerEntryBuilder();
    builderCallback(builder);
    builder.validate();

    const lines = builder.getLines();
    const entryId = `ENT-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const postedAt = Date.now();
    const ref = builder.getReference() || null;
    const desc = builder.getDescription() || null;
    const meta = builder.getMetadata() ? JSON.stringify(builder.getMetadata()) : null;

    const escape = (col: string) => this.adapter.escapeIdentifier(col);
    const ph = (name: string, idx: number) => this.adapter.formatParameterPlaceholder(name, idx);

    // 1. Insert Entry header
    const insertEntrySql = `
      INSERT INTO ${escape('__nsp_ledger_entries')}
      (${escape('id')}, ${escape('reference')}, ${escape('description')}, ${escape('posted_at')}, ${escape('metadata')})
      VALUES (${ph('id', 1)}, ${ph('ref', 2)}, ${ph('desc', 3)}, ${ph('posted', 4)}, ${ph('meta', 5)})
    `;
    await this.adapter.executeNonQuery(insertEntrySql, [
      { name: 'id', value: entryId },
      { name: 'ref', value: ref },
      { name: 'desc', value: desc },
      { name: 'posted', value: postedAt },
      { name: 'meta', value: meta },
    ]);

    // 2. Insert Journal Lines
    const savedLines: JournalLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineId = `JRN-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const lineSql = `
        INSERT INTO ${escape('__nsp_journal_lines')}
        (${escape('id')}, ${escape('entry_id')}, ${escape('account_id')}, ${escape('direction')}, ${escape('amount')}, ${escape('currency')}, ${escape('description')})
        VALUES (${ph('id', 1)}, ${ph('eid', 2)}, ${ph('acc', 3)}, ${ph('dir', 4)}, ${ph('amt', 5)}, ${ph('curr', 6)}, ${ph('desc', 7)})
      `;
      await this.adapter.executeNonQuery(lineSql, [
        { name: 'id', value: lineId },
        { name: 'eid', value: entryId },
        { name: 'acc', value: line.accountId },
        { name: 'dir', value: line.direction },
        { name: 'amt', value: line.amount.toDecimalString(4) },
        { name: 'curr', value: line.currency },
        { name: 'desc', value: line.description || null },
      ]);

      savedLines.push({
        ...line,
        id: lineId,
        entryId,
      });
    }

    return {
      id: entryId,
      reference: ref ?? undefined,
      description: desc ?? undefined,
      postedAt,
      metadata: builder.getMetadata(),
      lines: savedLines,
    };
  }

  /**
   * Convenience method to execute a balanced two-party funds transfer.
   * Debits the destination account and credits the originating account.
   */
  public async transfer(options: TransferOptions): Promise<LedgerEntry> {
    const currency =
      options.currency || (options.amount instanceof Money ? options.amount.currency : 'USD');
    const money = Money.from(options.amount, currency);

    return this.postEntry(b => {
      if (options.reference) b.reference(options.reference);
      if (options.description) b.description(options.description);
      if (options.metadata) b.metadata(options.metadata);

      // Debit receiving account, Credit source account
      b.debit(options.toAccount, money, options.description);
      b.credit(options.fromAccount, money, options.description);
    });
  }

  /**
   * Computes the net balance of an account from immutable journal lines.
   * Balance = Total Debits - Total Credits.
   */
  public async getAccountBalance(accountId: string, currency = 'USD'): Promise<Money> {
    await this.ensureSchema();

    const escape = (col: string) => this.adapter.escapeIdentifier(col);
    const ph = (name: string, idx: number) => this.adapter.formatParameterPlaceholder(name, idx);

    const querySql = `
      SELECT ${escape('direction')}, ${escape('amount')}
      FROM ${escape('__nsp_journal_lines')}
      WHERE ${escape('account_id')} = ${ph('acc', 1)} AND ${escape('currency')} = ${ph('curr', 2)}
    `;

    const rows = await this.adapter.executeQuery<{ direction: string; amount: string }>(querySql, [
      { name: 'acc', value: accountId },
      { name: 'curr', value: currency },
    ]);

    let total = Money.zero(currency);
    for (const r of rows) {
      const amt = Money.from(r.amount, currency);
      if (r.direction === 'DEBIT') {
        total = total.add(amt);
      } else {
        total = total.subtract(amt);
      }
    }

    return total;
  }
}
