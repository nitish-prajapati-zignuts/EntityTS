import * as fs from 'fs';
import * as path from 'path';
import {
  IntrospectedTable,
  IntrospectedColumn,
  IntrospectedForeignKey,
} from './SchemaIntrospector';

export interface EntityScaffolderOptions {
  /** Output directory for generated files (default: './src/entities') */
  outputDir?: string;
  /** Overwrite existing files when true (default: false) */
  force?: boolean;
  /** Base class name for the generated DbContext file (default: 'AppDbContext') */
  contextName?: string;
}

/**
 * Maps a raw database type string to a TypeScript primitive and a SqlType enum value.
 */
function mapDbTypeToTs(dbType: string): { tsType: string; sqlTypeImport?: string } {
  const t = dbType.toLowerCase();
  if (['int', 'integer', 'smallint', 'tinyint', 'mediumint'].some(k => t.startsWith(k)))
    return { tsType: 'number', sqlTypeImport: 'SqlType.Int' };
  if (t.startsWith('bigint')) return { tsType: 'number', sqlTypeImport: 'SqlType.BigInt' };
  if (t.startsWith('float') || t.startsWith('double') || t.startsWith('real'))
    return { tsType: 'number', sqlTypeImport: 'SqlType.Float' };
  if (t.startsWith('decimal') || t.startsWith('numeric') || t.startsWith('money'))
    return { tsType: 'number', sqlTypeImport: 'SqlType.Decimal' };
  if (t.startsWith('varchar') || t.startsWith('nvarchar') || t.startsWith('character varying'))
    return { tsType: 'string', sqlTypeImport: 'SqlType.VarChar' };
  if (['char', 'nchar', 'character'].some(k => t.startsWith(k)))
    return { tsType: 'string', sqlTypeImport: 'SqlType.Char' };
  if (t.startsWith('text') || t.startsWith('ntext') || t.startsWith('clob'))
    return { tsType: 'string', sqlTypeImport: 'SqlType.Text' };
  if (t === 'bit' || t === 'boolean' || t === 'bool' || t === 'tinyint(1)')
    return { tsType: 'boolean', sqlTypeImport: 'SqlType.Bit' };
  if (t.startsWith('timestamp') || t.startsWith('datetime'))
    return { tsType: 'Date', sqlTypeImport: 'SqlType.DateTime2' };
  if (t === 'date') return { tsType: 'Date', sqlTypeImport: 'SqlType.Date' };
  if (t === 'time') return { tsType: 'string', sqlTypeImport: 'SqlType.Time' };
  if (t === 'uuid' || t === 'uniqueidentifier' || t === 'guid')
    return { tsType: 'string', sqlTypeImport: 'SqlType.UniqueIdentifier' };
  if (t === 'json' || t === 'jsonb')
    return { tsType: 'Record<string, unknown>', sqlTypeImport: undefined };
  if (t.startsWith('blob') || t.startsWith('binary') || t.startsWith('varbinary'))
    return { tsType: 'Buffer', sqlTypeImport: 'SqlType.Binary' };
  return { tsType: 'unknown', sqlTypeImport: undefined };
}

/** Converts snake_case or kebab-case to PascalCase */
function toPascalCase(str: string): string {
  return str
    .replace(/[_-](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

/** Converts snake_case or kebab-case to camelCase */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function generateEntityFile(table: IntrospectedTable, allTables: IntrospectedTable[]): string {
  const className = toPascalCase(table.name);
  const tableSet = new Set(allTables.map(t => t.name.toLowerCase()));

  const lines: string[] = [];
  const imports = new Set<string>(['Entity', 'Column', 'SqlType']);
  if (table.isView) {
    imports.add('ViewEntity');
  } else {
    imports.add('Table');
  }

  // Collect relation metadata
  const relations: Array<{
    propName: string;
    decorator: string;
    targetClass: string;
    foreignKey: string;
    isMany: boolean;
  }> = [];

  // Check for incoming FK references (HasMany)
  for (const otherTable of allTables) {
    if (otherTable.name === table.name) continue;
    for (const fk of otherTable.foreignKeys) {
      if (fk.referencedTable.toLowerCase() === table.name.toLowerCase()) {
        const targetClass = toPascalCase(otherTable.name);
        const propName = toCamelCase(otherTable.name) + 's';
        imports.add('HasMany');
        relations.push({
          propName,
          decorator: `@HasMany(() => ${targetClass}, { foreignKey: '${fk.columnName}' })`,
          targetClass,
          foreignKey: fk.columnName,
          isMany: true,
        });
      }
    }
  }

  // Check outgoing FK references (BelongsTo)
  for (const fk of table.foreignKeys) {
    const targetClass = toPascalCase(fk.referencedTable);
    const propName = toCamelCase(fk.referencedTable);
    imports.add('BelongsTo');
    relations.push({
      propName,
      decorator: `@BelongsTo(() => ${targetClass}, { foreignKey: '${fk.columnName}' })`,
      targetClass,
      foreignKey: fk.columnName,
      isMany: false,
    });
  }

  const hasPrimary = table.columns.some(c => c.isPrimary);
  if (hasPrimary) {
    imports.add('PrimaryKey');
  }

  lines.push(`import { ${Array.from(imports).sort().join(', ')} } from '@nsp/dbcontext';`);

  // Import related entity types
  const relatedClasses = new Set(relations.map(r => r.targetClass));
  for (const cls of relatedClasses) {
    if (cls !== className) {
      lines.push(`import { ${cls} } from './${cls}';`);
    }
  }

  lines.push('');
  lines.push(`@Entity()`);
  if (table.isView) {
    lines.push(`@ViewEntity('${table.name}')`);
  } else {
    lines.push(`@Table('${table.name}')`);
  }
  lines.push(`export class ${className} {`);

  // Columns
  for (const col of table.columns) {
    const { tsType, sqlTypeImport } = mapDbTypeToTs(col.dataType);
    const propName = toCamelCase(col.name);
    const optional = col.isNullable ? '?' : '!';
    const typeAnnotation = col.isNullable ? `${tsType} | null` : tsType;

    if (col.isPrimary) {
      const autoInc = col.isAutoIncrement ? '{ autoIncrement: true }' : '';
      lines.push(`  @PrimaryKey(${autoInc})`);
    }

    const colOptions: string[] = [];
    if (col.name !== propName) colOptions.push(`name: '${col.name}'`);
    if (sqlTypeImport) colOptions.push(`type: ${sqlTypeImport}`);
    if (col.maxLength) colOptions.push(`maxLength: ${col.maxLength}`);
    if (col.isNullable) colOptions.push(`nullable: true`);
    const colDecoArg = colOptions.length > 0 ? `{ ${colOptions.join(', ')} }` : '';
    lines.push(`  @Column(${colDecoArg})`);
    lines.push(`  ${propName}${optional}: ${typeAnnotation};`);
    lines.push('');
  }

  // Relations
  for (const rel of relations) {
    lines.push(`  ${rel.decorator}`);
    lines.push(`  ${rel.propName}?: ${rel.isMany ? `${rel.targetClass}[]` : rel.targetClass};`);
    lines.push('');
  }

  lines.push(`}`);
  return lines.join('\n');
}

function generateContextFile(tables: IntrospectedTable[], contextName: string): string {
  const classNames = tables.map(t => toPascalCase(t.name));
  const imports = classNames.map(c => `import { ${c} } from './${c}';`).join('\n');

  const sets = tables
    .map(t => {
      const propName = toCamelCase(t.name) + 's';
      const cls = toPascalCase(t.name);
      return `  public ${propName} = this.set(${cls});`;
    })
    .join('\n');

  return [
    `import { DbContext, DbContextOptionsBuilder, ModelBuilder } from '@nsp/dbcontext';`,
    imports,
    ``,
    `export class ${contextName} extends DbContext {`,
    sets,
    ``,
    `  protected onConfiguring(options: DbContextOptionsBuilder): void {`,
    `    // TODO: configure your database connection here`,
    `    // options.useSqlServer(process.env.DB_CONNECTION_STRING!);`,
    `    // options.usePostgres(process.env.DATABASE_URL!);`,
    `  }`,
    ``,
    `  protected onModelCreating(model: ModelBuilder): void {`,
    `    // Optional: add fluent model overrides here`,
    `  }`,
    `}`,
  ].join('\n');
}

export interface ScaffoldResult {
  written: string[];
  skipped: string[];
}

/**
 * Takes a list of IntrospectedTable descriptors and scaffolds TypeScript entity
 * files and a DbContext subclass to the output directory.
 */
export class EntityScaffolder {
  private readonly outputDir: string;
  private readonly force: boolean;
  private readonly contextName: string;

  constructor(options: EntityScaffolderOptions = {}) {
    this.outputDir = options.outputDir ?? path.join(process.cwd(), 'src', 'entities');
    this.force = options.force ?? false;
    this.contextName = options.contextName ?? 'AppDbContext';
  }

  public scaffold(tables: IntrospectedTable[]): ScaffoldResult {
    const written: string[] = [];
    const skipped: string[] = [];

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Entity files
    for (const table of tables) {
      const className = toPascalCase(table.name);
      const filePath = path.join(this.outputDir, `${className}.ts`);

      if (fs.existsSync(filePath) && !this.force) {
        skipped.push(filePath);
        continue;
      }

      const content = generateEntityFile(table, tables);
      fs.writeFileSync(filePath, content, 'utf-8');
      written.push(filePath);
    }

    // DbContext file
    const ctxPath = path.join(this.outputDir, `${this.contextName}.ts`);
    if (fs.existsSync(ctxPath) && !this.force) {
      skipped.push(ctxPath);
    } else {
      const ctxContent = generateContextFile(tables, this.contextName);
      fs.writeFileSync(ctxPath, ctxContent, 'utf-8');
      written.push(ctxPath);
    }

    return { written, skipped };
  }

  /** Returns the generated entity source without writing to disk. */
  public previewEntity(table: IntrospectedTable, allTables: IntrospectedTable[]): string {
    return generateEntityFile(table, allTables);
  }

  /** Returns the generated DbContext source without writing to disk. */
  public previewContext(tables: IntrospectedTable[]): string {
    return generateContextFile(tables, this.contextName);
  }
}
