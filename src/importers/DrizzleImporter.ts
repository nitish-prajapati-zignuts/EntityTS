import { GeneratedFile, ImportResult } from './PrismaImporter';

interface DrizzleColumn {
  propName: string;
  colName: string;
  type: string;
  isPrimary: boolean;
  isUnique: boolean;
  isNotNull: boolean;
  isCreatedAt: boolean;
  isUpdatedAt: boolean;
}

interface DrizzleTable {
  varName: string;
  tableName: string;
  className: string;
  columns: DrizzleColumn[];
}

export class DrizzleImporter {
  /**
   * Translates Drizzle schema file content into entityts entities and AppDbContext.
   */
  public static importSchema(drizzleCode: string, contextName = 'AppDbContext'): ImportResult {
    const tables: DrizzleTable[] = [];

    // Match tables: export const <varName> = (pgTable|mysqlTable|sqliteTable)('<tableName>', {
    const tableStartRegex =
      /export\s+const\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\(\s*['"]([^'"]+)['"]\s*,\s*\{/g;
    let match: RegExpExecArray | null;

    while ((match = tableStartRegex.exec(drizzleCode)) !== null) {
      const varName = match[1];
      const tableName = match[2];
      const startIndex = match.index + match[0].length;
      let depth = 1;
      let endIndex = startIndex;
      while (endIndex < drizzleCode.length && depth > 0) {
        if (drizzleCode[endIndex] === '{') depth++;
        else if (drizzleCode[endIndex] === '}') depth--;
        endIndex++;
      }
      const body = drizzleCode.substring(startIndex, endIndex - 1);

      // Convert table_name or users -> User class name
      const singular = tableName.endsWith('s') ? tableName.slice(0, -1) : tableName;
      const className = singular.charAt(0).toUpperCase() + singular.slice(1);

      const columns: DrizzleColumn[] = [];
      const lines = body.split('\n');

      for (const line of lines) {
        const trimmed = line.trim().replace(/,$/, '');
        if (!trimmed || trimmed.startsWith('//')) continue;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1) continue;

        const propName = trimmed.slice(0, colonIdx).trim();
        const colDef = trimmed.slice(colonIdx + 1).trim();

        const typeMatch = /^(\w+)\(/.exec(colDef);
        if (!typeMatch) continue;

        const drizzleType = typeMatch[1];
        const isPrimary = colDef.includes('.primaryKey()') || drizzleType === 'serial';
        const isUnique = colDef.includes('.unique()');
        const isCreatedAt =
          colDef.includes('.defaultNow()') || propName.toLowerCase().includes('created');
        const isUpdatedAt = propName.toLowerCase().includes('updated');
        const isNotNull = colDef.includes('.notNull()') || isPrimary || isCreatedAt;

        const nameMatch = /^\w+\(\s*['"]([^'"]+)['"]/.exec(colDef);
        const colName = nameMatch ? nameMatch[1] : propName;

        columns.push({
          propName,
          colName,
          type: this.mapType(drizzleType),
          isPrimary,
          isUnique,
          isNotNull,
          isCreatedAt,
          isUpdatedAt,
        });
      }

      tables.push({
        varName,
        tableName,
        className,
        columns,
      });
    }

    const entityFiles: GeneratedFile[] = [];

    for (const t of tables) {
      const lines: string[] = [
        `import { Table, PrimaryKey, Column, Unique, CreatedAt, UpdatedAt } from 'entityts';`,
        '',
        `@Table('${t.tableName}')`,
        `export class ${t.className} {`,
      ];

      for (const c of t.columns) {
        if (c.isPrimary) {
          lines.push('  @PrimaryKey()');
        }
        if (c.isUnique) {
          lines.push('  @Unique()');
        }
        if (c.isCreatedAt) {
          lines.push('  @CreatedAt()');
        } else if (c.isUpdatedAt) {
          lines.push('  @UpdatedAt()');
        }

        const colOpts = c.colName !== c.propName ? `{ name: '${c.colName}' }` : '';
        lines.push(`  @Column(${colOpts})`);
        const mark = c.isNotNull ? '!' : '?';
        lines.push(`  ${c.propName}${mark}: ${c.type};\n`);
      }

      lines.push('}');

      entityFiles.push({
        filename: `${t.className}.ts`,
        content: lines.join('\n'),
      });
    }

    // Generate AppDbContext
    const contextLines: string[] = [
      `import { DbContext, DbContextOptionsBuilder, DbSet } from 'entityts';`,
    ];
    for (const t of tables) {
      contextLines.push(`import { ${t.className} } from './${t.className}';`);
    }
    contextLines.push('');
    contextLines.push(`export class ${contextName} extends DbContext {`);
    for (const t of tables) {
      contextLines.push(`  public readonly ${t.varName}!: DbSet<${t.className}>;`);
    }
    contextLines.push('');
    contextLines.push(
      '  protected override onConfiguring(options: DbContextOptionsBuilder): void {',
    );
    contextLines.push(
      "    options.usePostgres(process.env.DATABASE_URL || 'postgresql://localhost:5432/mydb');",
    );
    contextLines.push('  }');
    contextLines.push('}');

    return {
      entities: entityFiles,
      context: {
        filename: `${contextName}.ts`,
        content: contextLines.join('\n'),
      },
    };
  }

  private static mapType(drizzleType: string): string {
    switch (drizzleType) {
      case 'serial':
      case 'integer':
      case 'smallint':
      case 'bigint':
      case 'real':
      case 'doublePrecision':
      case 'numeric':
      case 'decimal':
        return 'number';
      case 'text':
      case 'varchar':
      case 'char':
      case 'uuid':
        return 'string';
      case 'boolean':
        return 'boolean';
      case 'timestamp':
      case 'date':
      case 'time':
        return 'Date';
      case 'json':
      case 'jsonb':
        return 'Record<string, unknown>';
      default:
        return 'any';
    }
  }
}
