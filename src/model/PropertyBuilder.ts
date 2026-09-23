import { ColumnMetadata } from './EntityMetadata';
import { SqlType } from '../procedure/SqlType';

export class PropertyBuilder<TEntity, TProp = unknown> {
  constructor(private readonly columnMeta: ColumnMetadata) {}

  public hasColumnName(name: string): this {
    this.columnMeta.columnName = name;
    return this;
  }

  public hasColumnType(type: SqlType): this {
    this.columnMeta.sqlType = type;
    return this;
  }

  public isRequired(required = true): this {
    this.columnMeta.isNullable = !required;
    return this;
  }

  public isNullable(nullable = true): this {
    this.columnMeta.isNullable = nullable;
    return this;
  }

  public hasMaxLength(length: number): this {
    this.columnMeta.maxLength = length;
    return this;
  }

  public hasPrecision(precision: number, scale?: number): this {
    this.columnMeta.precision = precision;
    this.columnMeta.scale = scale;
    return this;
  }

  public isAutoIncrement(auto = true): this {
    this.columnMeta.isAutoIncrement = auto;
    return this;
  }

  public hasDefaultValue(value: unknown): this {
    this.columnMeta.defaultValue = value;
    return this;
  }
}
