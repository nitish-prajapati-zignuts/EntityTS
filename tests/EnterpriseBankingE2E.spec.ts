import { DbContext } from '../src/context/DbContext';
import { DbContextOptionsBuilder } from '../src/context/DbContextOptionsBuilder';
import { Table, PrimaryKey, Column } from '../src/decorators';
import { Decimal, Currency } from '../src/decorators/BankingDecorators';
import { Money } from '../src/banking/Money';
import { IdempotencyConflictException, UnbalancedLedgerException } from '../src/errors';

@Table('bank_accounts')
class BankAccount {
  @PrimaryKey({ autoIncrement: false })
  id!: string;

  @Column({ name: 'owner_name' })
  ownerName!: string;

  @Decimal({ precision: 18, scale: 4 })
  balance!: string;

  @Currency({ defaultCurrency: 'USD' })
  currency!: string;
}

class BankingDbContext extends DbContext {
  public readonly accounts = this.set(BankAccount);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:').withLogging(false);
  }
}

describe('Enterprise Banking & Financial Transactions E2E', () => {
  let db: BankingDbContext;

  beforeEach(async () => {
    db = new BankingDbContext();
    await db.adapter.connect();

    // Create table
    await db.adapter.executeNonQuery(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id TEXT PRIMARY KEY,
        owner_name TEXT NOT NULL,
        balance TEXT NOT NULL,
        currency TEXT NOT NULL
      )
    `);

    // Seed test accounts
    await db.accounts.add({
      id: 'ACC-101',
      ownerName: 'Alice Smith',
      balance: '1000.0000',
      currency: 'USD',
    });

    await db.accounts.add({
      id: 'ACC-202',
      ownerName: 'Bob Jones',
      balance: '50.0000',
      currency: 'USD',
    });
  });

  afterEach(async () => {
    await db.adapter.disconnect();
  });

  describe('1. Precision-Safe Monetary Ledger Operations', () => {
    it('executes atomic debit and credit using Money without IEEE-754 loss', async () => {
      const initialAlice = await db.accounts.first({ id: 'ACC-101' });
      const aliceBalance = Money.usd(initialAlice!.balance);

      const transferAmount = Money.usd('125.5025');
      const remainingAlice = aliceBalance.subtract(transferAmount);

      expect(remainingAlice.toDecimalString(4)).toBe('874.4975');
    });
  });

  describe('2. Pessimistic Row Locking in Transaction', () => {
    it('queries with forUpdate() within transaction', async () => {
      await db.useTransaction(async tx => {
        const lockedAccount = await db.accounts
          .inTransaction(tx)
          .where({ id: 'ACC-101' })
          .forUpdate()
          .first();

        expect(lockedAccount).toBeDefined();
        expect(lockedAccount?.id).toBe('ACC-101');
      });
    });
  });

  describe('3. Idempotent Transfer Execution via DbContext', () => {
    it('deduplicates repeat transfer executions with identical idempotency keys', async () => {
      let runCount = 0;

      const performTransfer = (key: string) =>
        db.withIdempotencyKey(key, async () => {
          runCount++;
          // Perform transfer in ledger
          const entry = await db.ledger.transfer({
            fromAccount: 'ACC-101',
            toAccount: 'ACC-202',
            amount: Money.usd('100.00'),
            reference: 'P2P-REF-99',
            description: 'Rent contribution',
          });

          // Enqueue outbox event
          await db.outbox.enqueue('TRANSFER_PROCESSED', {
            entryId: entry.id,
            amount: '100.00',
            from: 'ACC-101',
            to: 'ACC-202',
          });

          return { success: true, entryId: entry.id };
        });

      const res1 = await performTransfer('IDEMP-TX-1001');
      const res2 = await performTransfer('IDEMP-TX-1001');
      const res3 = await performTransfer('IDEMP-TX-1001');

      expect(runCount).toBe(1);
      expect(res1).toEqual(res2);
      expect(res2).toEqual(res3);

      // Ledger must only have exactly 1 transfer (2 journal lines)
      const bobLedger = await db.ledger.getAccountBalance('ACC-202', 'USD');
      expect(bobLedger.toDecimalString(2)).toBe('100.00');

      // Outbox must only have 1 pending message
      const pendingOutbox = await db.outbox.getPendingCount();
      expect(pendingOutbox).toBe(1);
    });
  });

  describe('4. Double-Entry Audit Ledger & Outbox Dispatcher', () => {
    it('dispatches pending transactional outbox events to subscribers', async () => {
      await db.outbox.enqueue('AUDIT_LOG', { action: 'ACCOUNT_CREATED', accountId: 'ACC-303' });
      await db.outbox.enqueue('AUDIT_LOG', { action: 'ACCOUNT_VERIFIED', accountId: 'ACC-303' });

      const events: any[] = [];
      const summary = await db.outbox.dispatchPending(async msg => {
        events.push(msg.payload);
      });

      expect(summary.dispatchedCount).toBe(2);
      expect(summary.failedCount).toBe(0);
      expect(events.length).toBe(2);
    });

    it('enforces debits equal credits in multi-leg journal entries', async () => {
      // Balanced entry
      const entry = await db.ledger.postEntry(b => {
        b.reference('SPLIT-101')
          .debit('CASH', Money.usd('300.00'))
          .credit('SAVINGS', Money.usd('200.00'))
          .credit('CHECKING', Money.usd('100.00'));
      });

      expect(entry.lines.length).toBe(3);

      // Unbalanced entry throws
      await expect(
        db.ledger.postEntry(b => {
          b.debit('CASH', Money.usd('300.00')).credit('SAVINGS', Money.usd('250.00'));
        }),
      ).rejects.toThrow(UnbalancedLedgerException);
    });
  });
});
