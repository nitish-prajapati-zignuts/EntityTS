import { SqlType } from '../procedure/SqlType';

export interface ColumnMetadata {
  propertyName: string;
  columnName: string;
  sqlType?: SqlType;
  isPrimaryKey?: boolean;
  isAutoIncrement?: boolean;
  isNullable?: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  defaultValue?: unknown | (() => unknown);
  isComputed?: boolean;
  computedExpression?: string;
  /** Allowed enum values. DDL emits ENUM/CHECK constraint when set. */
  enumValues?: string[];
  /** When true, DDL emits a UNIQUE constraint on this column. */
  isUnique?: boolean;
  /** When true, this column is encrypted using AES-256-GCM. */
  isEncrypted?: boolean;
  /** Custom encryption options (key, algorithm). */
  encryptionOptions?: any;
  /** When true, this column stores AI vector embeddings. */
  isVector?: boolean;
  /** Vector embeddings dimension count (e.g. 1536 for OpenAI, 384 for MiniLM). */
  dimensions?: number;
}

export interface SoftDeleteMetadata {
  column: string;
  propertyName?: string;
  /**
   * When `true`, soft-deleting a parent entity also cascades the `deletedAt`
   * timestamp to all `hasMany` / `hasOne` children defined on the entity.
   * `restore()` cascades the nullification back to those children.
   */
  cascade?: boolean;
}

export interface IndexMetadata {
  name?: string;
  columns: string[];
  unique?: boolean;
}

export interface RelationMetadata {
  propertyName: string;
  type: 'hasOne' | 'hasMany' | 'belongsTo' | 'manyToMany';
  target: () => Function;
  foreignKey: string;
  otherKey?: string;
  through?: string;
  lazy?: boolean;
}

export interface VersionMetadata {
  propertyName: string;
  columnName: string;
  strategy: 'number' | 'timestamp' | 'uuid';
}

export interface EntityLifecycleHooks {
  beforeInsert?: string[];
  afterInsert?: string[];
  beforeUpdate?: string[];
  afterUpdate?: string[];
  beforeRemove?: string[];
  afterRemove?: string[];
}

export interface EntityMetadata {
  target: Function;
  tableName: string;
  schema?: string;
  columns: Map<string, ColumnMetadata>; // key: propertyName
  primaryKeys: string[]; // property names
  /**
   * Composite primary key definitions. Each inner array is a set of column names forming one PK.
   * When set, DDL emits a table-level PRIMARY KEY constraint instead of per-column PRIMARY KEY.
   */
  compositeKeys?: string[][];
  ignoredProperties: Set<string>;
  softDelete?: SoftDeleteMetadata;
  createdAtProperty?: string;
  updatedAtProperty?: string;
  createdByProperty?: string;
  versionProperty?: VersionMetadata;
  concurrencyCheckProperties: Set<string>;
  queryFilters: Array<(clause: any) => void | any>;
  relations: Map<string, RelationMetadata>;
  indexes?: IndexMetadata[];
  lifecycleHooks?: EntityLifecycleHooks;
  tenantIdProperty?: string;
  /**
   * When true, this entity maps to a database VIEW rather than a table.
   * DDL generation is skipped; write operations (add/update/remove) throw at runtime.
   */
  isView?: boolean;
}

export class ModelMetadataRegistry {
  private static instance: ModelMetadataRegistry;
  private readonly entities: Map<Function, EntityMetadata> = new Map();

  private constructor() {}

  public static getInstance(): ModelMetadataRegistry {
    if (!ModelMetadataRegistry.instance) {
      ModelMetadataRegistry.instance = new ModelMetadataRegistry();
    }
    return ModelMetadataRegistry.instance;
  }

  public getOrCreate(target: Function): EntityMetadata {
    let metadata = this.entities.get(target);
    if (!metadata) {
      metadata = {
        target,
        tableName: target.name,
        columns: new Map(),
        primaryKeys: [],
        ignoredProperties: new Set(),
        concurrencyCheckProperties: new Set(),
        queryFilters: [],
        relations: new Map(),
      };
      this.entities.set(target, metadata);
    }
    return metadata;
  }

  public get(target: Function): EntityMetadata | undefined {
    return this.entities.get(target);
  }

  public register(target: Function, metadata: EntityMetadata): void {
    this.entities.set(target, metadata);
  }

  public clear(): void {
    this.entities.clear();
  }
}
