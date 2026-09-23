import { SqliteAdapter } from '../src/adapters/SqliteAdapter';
import { LedgerManager, LedgerEntryBuilder } from '../src/banking/LedgerBuilder';
import { Money } from '../src/banking/Money';
import { UnbalancedLedgerException } from '../src/errors';

describe('Double-Entry Banking Ledger', () => {
  let adapter: SqliteAdapter;
  let ledger: LedgerManager;

  beforeEach(async () => {
    adapter = new SqliteAdapter(':memory:');
    await adapter.connect();
    ledger = new LedgerManager(adapter);
    await ledger.ensureSchema();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('rejects an unbalanced journal entry with UnbalancedLedgerException', async () => {
    await expect(
      ledger.postEntry(b => {
        b.debit('ACC-ASSET-01', Money.usd('100.00'));
        b.credit('ACC-LIABILITY-01', Money.usd('90.00')); // Out of balance by $10
      }),
    ).rejects.toThrow(UnbalancedLedgerException);
  });

  it('rejects an entry with fewer than two journal lines', async () => {
    await expect(
      ledger.postEntry(b => {
        b.debit('ACC-01', Money.usd('50.00'));
      }),
    ).rejects.toThrow(/must contain at least two journal lines/);
  });

  it('posts a balanced multi-leg transaction (split payment)', async () => {
    const entry = await ledger.postEntry(b => {
      b.reference('INV-2026-001')
        .description('Customer payment with state tax split')
        .debit('ACC-BANK-CASH', Money.usd('108.00')) // Total received
        .credit('ACC-MERCHANT-SALES', Money.usd('100.00')) // Sale portion
        .credit('ACC-TAX-PAYABLE', Money.usd('8.00')); // Sales tax portion
    });

    expect(entry.id).toBeDefined();
    expect(entry.reference).toBe('INV-2026-001');
    expect(entry.lines.length).toBe(3);
  });

  it('executes a balanced P2P transfer and updates ledger balances', async () => {
    await ledger.transfer({
      fromAccount: 'WALLET-ALICE',
      toAccount: 'WALLET-BOB',
      amount: Money.usd('250.00'),
      reference: 'TX-P2P-7761',
      description: 'Monthly rent split',
    });

    // Bob received funds -> Debit $250.00
    const bobBalance = await ledger.getAccountBalance('WALLET-BOB', 'USD');
    expect(bobBalance.toDecimalString(2)).toBe('250.00');

    // Alice sent funds -> Credit $250.00 -> Net is -250.00
    const aliceBalance = await ledger.getAccountBalance('WALLET-ALICE', 'USD');
    expect(aliceBalance.toDecimalString(2)).toBe('-250.00');
  });

  it('maintains exact mathematical precision over successive ledger operations', async () => {
    for (let i = 0; i < 10; i++) {
      await ledger.transfer({
        fromAccount: 'SENDER',
        toAccount: 'RECEIVER',
        amount: '10.0025',
      });
    }

    const receiverBalance = await ledger.getAccountBalance('RECEIVER', 'USD');
    expect(receiverBalance.toDecimalString(4)).toBe('100.0250');
  });
});
