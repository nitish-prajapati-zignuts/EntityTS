export interface GeneratedFile {
  filename: string;
  content: string;
}

export interface ImportResult {
  entities: GeneratedFile[];
  context: GeneratedFile;
}

interface PrismaField {
  name: string;
  type: string;
  isOptional: boolean;
  isArray: boolean;
  isId: boolean;
  isUnique: boolean;
  isUpdatedAt: boolean;
  isCreatedAt?: boolean;
  defaultVal?: string;
  relation?: {
    target: string;
    fields?: string;
    references?: string;
  };
}

interface PrismaModel {
  name: string;
  tableName: string;
  fields: PrismaField[];
}

interface PrismaEnum {
  name: string;
  values: string[];
}

export class PrismaImporter {
  /**
   * Imports a schema.prisma string and translates it into @nsp/dbcontext entities and DbContext.
   */
  public static importSchema(prismaSchema: string, contextName = 'AppDbContext'): ImportResult {
    const enums: PrismaEnum[] = [];
    const models: PrismaModel[] = [];

    // Parse enums
    const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = enumRegex.exec(prismaSchema)) !== null) {
      const name = match[1];
      const values = match[2]
        .split('\n')
        .map(v => v.trim())
        .filter(v => v && !v.startsWith('//'));
      enums.push({ name, values });
    }

    // Parse models
    const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
    while ((match = modelRegex.exec(prismaSchema)) !== null) {
      const modelName = match[1];
      const body = match[2];
      const fields: PrismaField[] = [];

      const lines = body.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
          continue;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;

        const fieldName = parts[0];
        let rawType = parts[1];
        const isOptional = rawType.endsWith('?');
        const isArray = rawType.endsWith('[]');
        const cleanType = rawType.replace('?', '').replace('[]', '');

        const isId = trimmed.includes('@id');
        const isUnique = trimmed.includes('@unique');
        const isUpdatedAt = trimmed.includes('@updatedAt');
        const isCreatedAt = trimmed.includes('@default(now())');

        let defaultVal: string | undefined;
        const defaultMatch = /@default\((.+)\)/.exec(trimmed);
        if (defaultMatch) {
          defaultVal = defaultMatch[1];
        }

        let relation: PrismaField['relation'];
        const relationMatch = /@relation\(([^)]+)\)/.exec(trimmed);
        if (relationMatch) {
          const relContent = relationMatch[1];
          const fieldsMatch = /fields:\s*\[([^\]]+)\]/.exec(relContent);
          const refsMatch = /references:\s*\[([^\]]+)\]/.exec(relContent);
          relation = {
            target: cleanType,
            fields: fieldsMatch ? fieldsMatch[1].trim() : undefined,
            references: refsMatch ? refsMatch[1].trim() : undefined,
          };
        }

        fields.push({
          name: fieldName,
          type: cleanType,
          isOptional,
          isArray,
          isId,
          isUnique,
          isUpdatedAt,
          isCreatedAt,
          defaultVal,
          relation,
        });
      }

      models.push({
        name: modelName,
        tableName: modelName.toLowerCase() + 's',
        fields,
      });
    }

    const entityFiles: GeneratedFile[] = [];

    // Generate enum declarations
    let enumDeclarations = '';
    if (enums.length > 0) {
      enumDeclarations = enums
        .map(
          e => `export enum ${e.name} {\n${e.values.map(v => `  ${v} = '${v}',`).join('\n')}\n}\n`,
        )
        .join('\n');
    }

    // Generate each model entity
    for (const model of models) {
      const codeLines: string[] = [
        `import { Table, PrimaryKey, Column, Unique, CreatedAt, UpdatedAt, HasMany, BelongsTo } from '@nsp/dbcontext';`,
      ];

      codeLines.push('');
      codeLines.push(`@Table('${model.tableName}')`);
      codeLines.push(`export class ${model.name} {`);

      for (const f of model.fields) {
        // Skip relational object fields without foreign keys for columns, or generate HasMany / BelongsTo
        const targetModel = models.find(m => m.name === f.type);
        if (targetModel) {
          if (f.isArray) {
            codeLines.push(`  @HasMany(() => ${f.type})`);
            codeLines.push(`  ${f.name}?: ${f.type}[];\n`);
          } else if (f.relation && f.relation.fields) {
            codeLines.push(`  @BelongsTo(() => ${f.type}, '${f.relation.fields}')`);
            codeLines.push(`  ${f.name}?: ${f.type};\n`);
          }
          continue;
        }

        if (f.isId) {
          codeLines.push('  @PrimaryKey()');
        }
        if (f.isUnique) {
          codeLines.push('  @Unique()');
        }
        if (f.isUpdatedAt) {
          codeLines.push('  @UpdatedAt()');
        } else if (f.isCreatedAt || f.defaultVal === 'now()') {
          codeLines.push('  @CreatedAt()');
        }

        const tsType = this.mapType(f.type, enums);
        const optMark = f.isOptional ? '?' : '!';
        codeLines.push(`  @Column()`);
        codeLines.push(`  ${f.name}${optMark}: ${tsType};\n`);
      }

      codeLines.push('}');
      entityFiles.push({
        filename: `${model.name}.ts`,
        content: (enumDeclarations ? enumDeclarations + '\n' : '') + codeLines.join('\n'),
      });
    }

    // Generate AppDbContext
    const contextLines: string[] = [
      `import { DbContext, DbContextOptionsBuilder, DbSet } from '@nsp/dbcontext';`,
    ];
    for (const m of models) {
      contextLines.push(`import { ${m.name} } from './${m.name}';`);
    }
    contextLines.push('');
    contextLines.push(`export class ${contextName} extends DbContext {`);
    for (const m of models) {
      const propName = m.name.charAt(0).toLowerCase() + m.name.slice(1) + 's';
      contextLines.push(`  public readonly ${propName}!: DbSet<${m.name}>;`);
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

  private static mapType(prismaType: string, enums: PrismaEnum[]): string {
    if (enums.some(e => e.name === prismaType)) {
      return prismaType;
    }
    switch (prismaType) {
      case 'Int':
      case 'Float':
      case 'Decimal':
        return 'number';
      case 'String':
        return 'string';
      case 'Boolean':
        return 'boolean';
      case 'DateTime':
        return 'Date';
      case 'Json':
        return 'Record<string, unknown>';
      case 'Bytes':
        return 'Buffer';
      case 'BigInt':
        return 'bigint';
      default:
        return 'any';
    }
  }
}
