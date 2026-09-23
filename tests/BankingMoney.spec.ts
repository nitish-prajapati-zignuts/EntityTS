import { Money, RoundingMode } from '../src/banking/Money';
import { Decimal, Currency } from '../src/decorators/BankingDecorators';
import { ModelMetadataRegistry } from '../src/model/EntityMetadata';
import { SqlType } from '../src/procedure/SqlType';

describe('Banking & Financial Precision: Money and Decorators', () => {
  describe('Money Arithmetic & Precision', () => {
    it('solves classic IEEE-754 floating point imprecision (0.1 + 0.2 = 0.3)', () => {
      const a = Money.usd('0.1000');
      const b = Money.usd('0.2000');
      const result = a.add(b);

      expect(result.toDecimalString(4)).toBe('0.3000');
      expect(result.toNumber()).toBe(0.3);
    });

    it('handles precise sub-penny calculations (4 decimal places standard)', () => {
      const m1 = Money.usd('1250.0025');
      const m2 = Money.usd('750.0075');
      const sum = m1.add(m2);

      expect(sum.toDecimalString(4)).toBe('2000.0100');
      expect(sum.toDecimalString(2)).toBe('2000.01');
    });

    it('correctly subtracts amounts and supports negative money', () => {
      const balance = Money.usd('100.00');
      const withdrawal = Money.usd('150.50');
      const result = balance.subtract(withdrawal);

      expect(result.isNegative()).toBe(true);
      expect(result.toDecimalString(2)).toBe('-50.50');
      expect(result.abs().toDecimalString(2)).toBe('50.50');
    });

    it('multiplies by scalar factors accurately', () => {
      const unitPrice = Money.usd('19.9900');
      const total = unitPrice.multiply(3);

      expect(total.toDecimalString(2)).toBe('59.97');
    });

    it('enforces currency mismatch guard', () => {
      const usd = Money.usd('100.00');
      const eur = Money.eur('100.00');

      expect(() => usd.add(eur)).toThrow(/Currency mismatch/);
      expect(() => usd.subtract(eur)).toThrow(/Currency mismatch/);
      expect(() => usd.greaterThan(eur)).toThrow(/Currency mismatch/);
    });

    it('performs Banker\'s Rounding (HALF_EVEN) correctly', () => {
      // Banker's rounding rounds half to nearest even number
      // 2.5 -> 2, 3.5 -> 4
      const m1 = Money.usd('5.0000'); // 5 / 2 = 2.5000 units
      const d1 = m1.divide(2, 'HALF_EVEN');
      expect(d1.toDecimalString(2)).toBe('2.50');

      // Test odd/even rounding on 0.00005:
      // In 4 decimals: 1 unit / 2 = 0.5 unit (half).
      // Quotient 0 (even) -> stays 0
      const oddUnits = new Money(1n, 'USD'); // 0.0001
      const halfOdd = oddUnits.divide(2n, 'HALF_EVEN');
      // 1 / 2 = 0 remainder 1 (exact half). Quotient 0 is even, so stays 0n:
      expect(halfOdd.rawUnits).toBe(0n);

      // 3 units / 2 = 1 remainder 1 (exact half). Quotient 1 is odd, so rounds to 2n (even):
      const threeUnits = new Money(3n, 'USD');
      const halfThree = threeUnits.divide(2n, 'HALF_EVEN');
      expect(halfThree.rawUnits).toBe(2n);
    });

    it('supports alternative rounding modes (HALF_UP, CEIL, FLOOR, TRUNCATE)', () => {
      const threeUnits = new Money(3n, 'USD');
      expect(threeUnits.divide(2n, 'HALF_UP').rawUnits).toBe(2n);
      expect(threeUnits.divide(2n, 'FLOOR').rawUnits).toBe(1n);
      expect(threeUnits.divide(2n, 'CEIL').rawUnits).toBe(2n);
      expect(threeUnits.divide(2n, 'TRUNCATE').rawUnits).toBe(1n);
    });

    it('compares amounts properly', () => {
      const a = Money.usd('100.00');
      const b = Money.usd('50.00');
      const c = Money.usd('100.00');

      expect(a.greaterThan(b)).toBe(true);
      expect(b.lessThan(a)).toBe(true);
      expect(a.equals(c)).toBe(true);
      expect(a.greaterThanOrEqual(c)).toBe(true);
      expect(b.lessThanOrEqual(a)).toBe(true);
    });

    it('formats currency with Intl formatting and JSON serialization', () => {
      const amount = Money.usd('1250000.50');
      expect(amount.toDecimalString(2)).toBe('1250000.50');
      expect(amount.toString()).toBe('USD 1250000.50');
      expect(amount.toJSON()).toEqual({
        amount: '1250000.50',
        currency: 'USD',
      });
    });
  });

  describe('Banking Decorators (@Decimal, @Currency)', () => {
    class BankAccount {
      id!: number;

      @Decimal({ precision: 19, scale: 4 })
      balance!: Money;

      @Currency({ defaultCurrency: 'EUR' })
      currency!: string;
    }

    it('registers @Decimal with 19 precision and 4 scale on entity metadata', () => {
      const meta = ModelMetadataRegistry.getInstance().get(BankAccount);
      expect(meta).toBeDefined();

      const balanceCol = meta?.columns.get('balance');
      expect(balanceCol).toBeDefined();
      expect(balanceCol?.sqlType).toBe(SqlType.Decimal);
      expect(balanceCol?.precision).toBe(19);
      expect(balanceCol?.scale).toBe(4);
    });

    it('registers @Currency with 3-char code on entity metadata', () => {
      const meta = ModelMetadataRegistry.getInstance().get(BankAccount);
      const currCol = meta?.columns.get('currency');

      expect(currCol).toBeDefined();
      expect(currCol?.sqlType).toBe(SqlType.VarChar);
      expect(currCol?.maxLength).toBe(3);
      expect(currCol?.defaultValue).toBe('EUR');
    });
  });
});
