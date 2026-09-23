import { PrismaImporter, TypeormImporter, DrizzleImporter } from '../src/importers';

describe('Universal ORM Migration Importers', () => {
  describe('PrismaImporter', () => {
    it('translates schema.prisma into @nsp/dbcontext entities and AppDbContext', () => {
      const prismaSchema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
}
`;

      const result = PrismaImporter.importSchema(prismaSchema, 'MyDbContext');

      expect(result.entities).toHaveLength(2);
      expect(result.context.filename).toBe('MyDbContext.ts');

      // User entity check
      const userFile = result.entities.find(e => e.filename === 'User.ts');
      expect(userFile).toBeDefined();
      expect(userFile?.content).toContain("@Table('users')");
      expect(userFile?.content).toContain('@PrimaryKey()');
      expect(userFile?.content).toContain('id!: number;');
      expect(userFile?.content).toContain('@Unique()');
      expect(userFile?.content).toContain('email!: string;');
      expect(userFile?.content).toContain('name?: string;');
      expect(userFile?.content).toContain('@CreatedAt()');
      expect(userFile?.content).toContain('@UpdatedAt()');
      expect(userFile?.content).toContain('@HasMany(() => Post)');

      // Post entity check
      const postFile = result.entities.find(e => e.filename === 'Post.ts');
      expect(postFile).toBeDefined();
      expect(postFile?.content).toContain("@Table('posts')");
      expect(postFile?.content).toContain("@BelongsTo(() => User, 'authorId')");

      // Context check
      expect(result.context.content).toContain('export class MyDbContext extends DbContext');
      expect(result.context.content).toContain('public readonly users!: DbSet<User>;');
      expect(result.context.content).toContain('public readonly posts!: DbSet<Post>;');
    });
  });

  describe('TypeormImporter', () => {
    it('translates TypeORM entity code to @nsp/dbcontext', () => {
      const typeormCode = `
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, VersionColumn, OneToMany } from 'typeorm';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  accountNumber: string;

  @Column()
  balance: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @VersionColumn()
  version: number;

  @OneToMany(() => Transaction, tx => tx.account)
  transactions: Transaction[];
}
`;

      const translated = TypeormImporter.translateEntity(typeormCode);

      expect(translated).toContain(
        "import { Table, PrimaryKey, Column, Unique, CreatedAt, UpdatedAt, Version, HasMany, BelongsTo } from '@nsp/dbcontext';",
      );
      expect(translated).not.toContain("from 'typeorm'");
      expect(translated).toContain("@Table('accounts')");
      expect(translated).toContain('@PrimaryKey()');
      expect(translated).toContain('@Unique()');
      expect(translated).toContain('@CreatedAt()');
      expect(translated).toContain('@UpdatedAt()');
      expect(translated).toContain('@Version()');
      expect(translated).toContain('@HasMany(() => Transaction)');
    });

    it('generates multi-entity import result with DbContext', () => {
      const code = `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;
}
`;
      const result = TypeormImporter.importEntities([{ name: 'Product.ts', content: code }]);
      expect(result.entities).toHaveLength(1);
      expect(result.context.content).toContain('public readonly products!: DbSet<Product>;');
    });
  });

  describe('DrizzleImporter', () => {
    it('translates Drizzle schema to @nsp/dbcontext entities and AppDbContext', () => {
      const drizzleCode = `
import { pgTable, serial, text, varchar, integer, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name'),
  email: varchar('email', { length: 256 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});
`;

      const result = DrizzleImporter.importSchema(drizzleCode);

      expect(result.entities).toHaveLength(1);
      const userFile = result.entities[0];
      expect(userFile.filename).toBe('User.ts');
      expect(userFile.content).toContain("@Table('users')");
      expect(userFile.content).toContain('@PrimaryKey()');
      expect(userFile.content).toContain('id!: number;');
      expect(userFile.content).toContain('@Unique()');
      expect(userFile.content).toContain('email!: string;');
      expect(userFile.content).toContain('@CreatedAt()');
      expect(userFile.content).toContain('createdAt!: Date;');

      expect(result.context.content).toContain('public readonly users!: DbSet<User>;');
    });
  });
});
