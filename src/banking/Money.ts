/**
 * Arbitrary-precision monetary and decimal representation for financial and banking transactions.
 * Uses BigInt with a fixed scale (default 4 decimal places: 1 unit = 10,000 sub-units) to eliminate
 * IEEE-754 floating-point rounding errors (such as 0.1 + 0.2 = 0.30000000000000004).
 */

export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'FLOOR' | 'CEIL' | 'TRUNCATE';

export class Money {
  public static readonly DEFAULT_SCALE = 4; // 4 decimal places (standard in banking/forex)
  public static readonly MULTIPLIER = 10_000n; // 10^4

  private readonly units: bigint; // Stored in 10^-4 units
  public readonly currency: string;

  constructor(units: bigint, currency: string = 'USD') {
    this.units = units;
    this.currency = currency.toUpperCase();
  }

  /**
   * Internal units getter (in 10^-4 increments).
   */
  public get rawUnits(): bigint {
    return this.units;
  }

  /**
   * Creates a Money instance from a string, number, or bigint.
   * Strings are strongly recommended for exact financial inputs (e.g. "100.50").
   */
  public static from(value: string | number | bigint | Money, currency: string = 'USD'): Money {
    if (value instanceof Money) {
      if (currency && value.currency !== currency.toUpperCase()) {
        throw new Error(`Currency mismatch: cannot convert ${value.currency} to ${currency}`);
      }
      return value;
    }

    if (typeof value === 'bigint') {
      return new Money(value * Money.MULTIPLIER, currency);
    }

    const str = typeof value === 'number' ? value.toFixed(Money.DEFAULT_SCALE) : value.trim();
    const parts = str.split('.');
    const isNegative = parts[0].startsWith('-');
    const wholeStr = isNegative ? parts[0].substring(1) : parts[0];
    const whole = BigInt(wholeStr || '0');

    let fractionStr = parts[1] || '';
    if (fractionStr.length > Money.DEFAULT_SCALE) {
      fractionStr = fractionStr.substring(0, Money.DEFAULT_SCALE);
    } else {
      fractionStr = fractionStr.padEnd(Money.DEFAULT_SCALE, '0');
    }

    const fraction = BigInt(fractionStr);
    const total = whole * Money.MULTIPLIER + fraction;
    return new Money(isNegative ? -total : total, currency);
  }

  public static zero(currency: string = 'USD'): Money {
    return new Money(0n, currency);
  }

  public static usd(value: string | number): Money {
    return Money.from(value, 'USD');
  }

  public static eur(value: string | number): Money {
    return Money.from(value, 'EUR');
  }

  public static gbp(value: string | number): Money {
    return Money.from(value, 'GBP');
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch in operation: cannot combine ${this.currency} with ${other.currency}`);
    }
  }

  public add(other: Money | string | number): Money {
    const o = Money.from(other, this.currency);
    this.ensureSameCurrency(o);
    return new Money(this.units + o.units, this.currency);
  }

  public subtract(other: Money | string | number): Money {
    const o = Money.from(other, this.currency);
    this.ensureSameCurrency(o);
    return new Money(this.units - o.units, this.currency);
  }

  public multiply(factor: number | string | bigint): Money {
    if (typeof factor === 'bigint') {
      return new Money(this.units * factor, this.currency);
    }

    // Convert factor with scale 4
    const factorMoney = Money.from(factor, this.currency);
    const resultUnits = (this.units * factorMoney.units) / Money.MULTIPLIER;
    return new Money(resultUnits, this.currency);
  }

  /**
   * Divides monetary amount with Banker's Rounding (HALF_EVEN by default).
   */
  public divide(divisor: number | string | bigint, mode: RoundingMode = 'HALF_EVEN'): Money {
    const divBig = typeof divisor === 'bigint' ? divisor * Money.MULTIPLIER : Money.from(divisor, this.currency).units;
    if (divBig === 0n) {
      throw new Error('Division by zero in Money calculation');
    }

    // Multiply by scale factor for precise division
    const numerator = this.units * Money.MULTIPLIER;
    const remainder = numerator % divBig;
    let quotient = numerator / divBig;

    if (remainder !== 0n) {
      const absRemainder = remainder < 0n ? -remainder : remainder;
      const absDivisor = divBig < 0n ? -divBig : divBig;
      const halfDivisor = absDivisor / 2n;

      if (mode === 'HALF_EVEN') {
        // Banker's Rounding: round to nearest even integer on exact half
        if (absRemainder > halfDivisor || (absRemainder === halfDivisor && (quotient % 2n !== 0n))) {
          quotient += (numerator > 0n ? 1n : -1n);
        }
      } else if (mode === 'HALF_UP') {
        if (absRemainder >= halfDivisor) {
          quotient += (numerator > 0n ? 1n : -1n);
        }
      } else if (mode === 'CEIL' && numerator > 0n) {
        quotient += 1n;
      } else if (mode === 'FLOOR' && numerator < 0n) {
        quotient -= 1n;
      }
    }

    return new Money(quotient, this.currency);
  }

  public isZero(): boolean {
    return this.units === 0n;
  }

  public isPositive(): boolean {
    return this.units > 0n;
  }

  public isNegative(): boolean {
    return this.units < 0n;
  }

  public equals(other: Money | string | number): boolean {
    const o = Money.from(other, this.currency);
    return this.currency === o.currency && this.units === o.units;
  }

  public greaterThan(other: Money | string | number): boolean {
    const o = Money.from(other, this.currency);
    this.ensureSameCurrency(o);
    return this.units > o.units;
  }

  public greaterThanOrEqual(other: Money | string | number): boolean {
    const o = Money.from(other, this.currency);
    this.ensureSameCurrency(o);
    return this.units >= o.units;
  }

  public lessThan(other: Money | string | number): boolean {
    const o = Money.from(other, this.currency);
    this.ensureSameCurrency(o);
    return this.units < o.units;
  }

  public lessThanOrEqual(other: Money | string | number): boolean {
    const o = Money.from(other, this.currency);
    this.ensureSameCurrency(o);
    return this.units <= o.units;
  }

  public abs(): Money {
    return this.units < 0n ? new Money(-this.units, this.currency) : this;
  }

  public negate(): Money {
    return new Money(-this.units, this.currency);
  }

  /**
   * Formats to exact decimal string (e.g. "100.5000" or "100.50").
   */
  public toDecimalString(decimalPlaces: number = 2): string {
    const isNeg = this.units < 0n;
    const absUnits = isNeg ? -this.units : this.units;
    const whole = absUnits / Money.MULTIPLIER;
    const fraction = absUnits % Money.MULTIPLIER;

    let fracStr = fraction.toString().padStart(Money.DEFAULT_SCALE, '0');
    if (decimalPlaces < Money.DEFAULT_SCALE) {
      fracStr = fracStr.substring(0, decimalPlaces);
    } else if (decimalPlaces > Money.DEFAULT_SCALE) {
      fracStr = fracStr.padEnd(decimalPlaces, '0');
    }

    const res = `${whole}.${fracStr}`;
    return isNeg ? `-${res}` : res;
  }

  /**
   * Formats as currency with symbol (e.g. "$1,250.00").
   */
  public format(locale: string = 'en-US'): string {
    const num = this.toNumber();
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  }

  /**
   * Explicit conversion to JS number.
   */
  public toNumber(): number {
    return Number(this.units) / Number(Money.MULTIPLIER);
  }

  public toJSON(): { amount: string; currency: string } {
    return {
      amount: this.toDecimalString(2),
      currency: this.currency,
    };
  }

  public toString(): string {
    return `${this.currency} ${this.toDecimalString(2)}`;
  }
}
