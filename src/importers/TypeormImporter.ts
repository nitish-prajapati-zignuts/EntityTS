import { GeneratedFile, ImportResult } from './PrismaImporter';

export class TypeormImporter {
  /**
   * Translates TypeORM entity source code into @nsp/dbcontext entity code.
   */
  public static translateEntity(typeormCode: string): string {
    let result = typeormCode;

    // Replace import statement
    result = result.replace(
      /import\s+\{[^}]*\}\s+from\s+['"]typeorm['"];?/g,
      `import { Table, PrimaryKey, Column, Unique, CreatedAt, UpdatedAt, Version, HasMany, BelongsTo } from '@nsp/dbcontext';`,
    );

    // Replace @Entity('tableName') with @Table('tableName')
    result = result.replace(/@Entity\(([^)]*)\)/g, (match, arg) => {
      const clean = arg.trim();
      return clean ? `@Table(${clean})` : `@Table()`;
    });

    // Replace primary keys
    result = result.replace(/@PrimaryGeneratedColumn\([^)]*\)/g, '@PrimaryKey()');
    result = result.replace(/@PrimaryColumn\([^)]*\)/g, '@PrimaryKey()\n  @Column()');

    // Replace lifecycle & auditing columns
    result = result.replace(/@CreateDateColumn\([^)]*\)/g, '@CreatedAt()\n  @Column()');
    result = result.replace(/@UpdateDateColumn\([^)]*\)/g, '@UpdatedAt()\n  @Column()');
    result = result.replace(/@VersionColumn\([^)]*\)/g, '@Version()\n  @Column()');

    // Replace relations
    result = result.replace(/@OneToMany\(\s*\(\)\s*=>\s*(\w+)[^)]*\)/g, '@HasMany(() => $1)');
    result = result.replace(
      /@ManyToOne\(\s*\(\)\s*=>\s*(\w+)[^)]*\)/g,
      '@BelongsTo(() => $1, "$1Id")',
    );

    // Replace unique column options: @Column({ ..., unique: true }) -> @Unique()\n  @Column()
    result = result.replace(/@Column\(\{[^}]*unique:\s*true[^}]*\}\)/g, '@Unique()\n  @Column()');

    return result;
  }

  /**
   * Imports multiple TypeORM entity code strings and generates an AppDbContext.
   */
  public static importEntities(
    entities: { name: string; content: string }[],
    contextName = 'AppDbContext',
  ): ImportResult {
    const entityFiles: GeneratedFile[] = [];
    const modelNames: string[] = [];

    for (const ent of entities) {
      const translated = this.translateEntity(ent.content);
      const classMatch = /export\s+class\s+(\w+)/.exec(translated);
      const modelName = classMatch ? classMatch[1] : ent.name.replace(/\.ts$/, '');
      modelNames.push(modelName);

      entityFiles.push({
        filename: `${modelName}.ts`,
        content: translated,
      });
    }

    const contextLines: string[] = [
      `import { DbContext, DbContextOptionsBuilder, DbSet } from '@nsp/dbcontext';`,
    ];
    for (const name of modelNames) {
      contextLines.push(`import { ${name} } from './${name}';`);
    }
    contextLines.push('');
    contextLines.push(`export class ${contextName} extends DbContext {`);
    for (const name of modelNames) {
      const propName = name.charAt(0).toLowerCase() + name.slice(1) + 's';
      contextLines.push(`  public readonly ${propName}!: DbSet<${name}>;`);
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
}
