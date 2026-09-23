import {
  DbContext,
  DbContextOptionsBuilder,
  Table,
  PrimaryKey,
  Column,
  IsEmail,
  Length,
  Min,
  Max,
  IsNotEmpty,
  Matches,
  IsUrl,
  CustomValidator,
  ValidationEngine,
  EntityValidationException,
} from '../src';

@Table('validated_users')
class ValidatedUser {
  @PrimaryKey({ autoIncrement: true })
  id!: number;

  @Column()
  @IsNotEmpty('Name is required')
  @Length(2, 50, 'Name must be between 2 and 50 characters')
  name!: string;

  @Column()
  @IsEmail('Must be a valid email address')
  email!: string;

  @Column()
  @Min(18, 'Must be at least 18 years old')
  @Max(120, 'Age cannot exceed 120')
  age!: number;

  @Column()
  @Matches(/^[A-Z]{3}-\d{4}$/, 'Code must follow pattern AAA-1234')
  code!: string;

  @Column({ nullable: true })
  @IsUrl('Website must be a valid URL')
  website?: string;

  @Column({ nullable: true })
  @CustomValidator((val: string) => !val.includes('forbidden'), 'Field contains forbidden word')
  bio?: string;
}

class BaseEntity {
  @IsNotEmpty('Tenant ID cannot be empty')
  tenantId!: string;
}

@Table('derived_entities')
class DerivedEntity extends BaseEntity {
  @PrimaryKey()
  id!: number;

  @IsEmail()
  email!: string;
}

class TestValidationDbContext extends DbContext {
  public readonly users = this.set(ValidatedUser);
  public readonly derived = this.set(DerivedEntity);

  protected onConfiguring(options: DbContextOptionsBuilder): void {
    options.useSqlite(':memory:');
  }
}

describe('Declarative Entity Validation Engine', () => {
  let ctx: TestValidationDbContext;

  beforeAll(async () => {
    ctx = new TestValidationDbContext();
    await ctx.ensureCreated();
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  describe('ValidationEngine.validate()', () => {
    it('returns isValid: true for a valid entity', () => {
      const valid = new ValidatedUser();
      valid.name = 'Alice';
      valid.email = 'alice@example.com';
      valid.age = 25;
      valid.code = 'ABC-1234';
      valid.website = 'https://example.com';
      valid.bio = 'Hello world';

      const res = ValidationEngine.validate(valid);
      expect(res.isValid).toBe(true);
      expect(Object.keys(res.errors).length).toBe(0);
    });

    it('collects all validation errors for invalid fields', () => {
      const invalid = new ValidatedUser();
      invalid.name = 'A'; // too short
      invalid.email = 'not-an-email';
      invalid.age = 15; // < 18
      invalid.code = 'wrong-pattern';
      invalid.website = 'not-a-url';
      invalid.bio = 'this contains forbidden stuff';

      const res = ValidationEngine.validate(invalid);
      expect(res.isValid).toBe(false);
      expect(res.errors.name).toContain('Name must be between 2 and 50 characters');
      expect(res.errors.email).toContain('Must be a valid email address');
      expect(res.errors.age).toContain('Must be at least 18 years old');
      expect(res.errors.code).toContain('Code must follow pattern AAA-1234');
      expect(res.errors.website).toContain('Website must be a valid URL');
      expect(res.errors.bio).toContain('Field contains forbidden word');
    });

    it('inherits validation rules from parent class', () => {
      const derived = new DerivedEntity();
      derived.tenantId = ''; // base rule fails
      derived.email = 'invalid-email'; // derived rule fails

      const res = ValidationEngine.validate(derived);
      expect(res.isValid).toBe(false);
      expect(res.errors.tenantId).toBeDefined();
      expect(res.errors.email).toBeDefined();
    });

    it('supports partial validation when updating specific fields', () => {
      const patch = { age: 30 }; // no name, email, code
      const res = ValidationEngine.validate(patch, ValidatedUser, { partial: true });
      expect(res.isValid).toBe(true);

      const invalidPatch = { age: 10 };
      const badRes = ValidationEngine.validate(invalidPatch, ValidatedUser, { partial: true });
      expect(badRes.isValid).toBe(false);
      expect(badRes.errors.age).toBeDefined();
      expect(badRes.errors.name).toBeUndefined(); // skipped because partial
    });
  });

  describe('ValidationEngine.validateOrThrow()', () => {
    it('throws EntityValidationException when invalid', () => {
      const invalid = new ValidatedUser();
      invalid.name = '';
      invalid.email = 'bad';

      expect(() => {
        ValidationEngine.validateOrThrow(invalid, ValidatedUser, 'ValidatedUser');
      }).toThrow(EntityValidationException);

      try {
        ValidationEngine.validateOrThrow(invalid, ValidatedUser, 'ValidatedUser');
      } catch (err: any) {
        expect(err).toBeInstanceOf(EntityValidationException);
        expect(err.name).toBe('EntityValidationException');
        expect(err.errors.name).toBeDefined();
      }
    });
  });

  describe('DbSet Integration (Pre-persist hooks)', () => {
    it('throws EntityValidationException before inserting invalid record into database', async () => {
      await expect(
        ctx.users.add({
          name: '',
          email: 'invalid-email',
          age: 12,
          code: 'bad',
        }),
      ).rejects.toThrow(EntityValidationException);
    });

    it('successfully persists valid record', async () => {
      const created = await ctx.users.add({
        name: 'Bob Ross',
        email: 'bob@ross.painting',
        age: 52,
        code: 'ART-9999',
        website: 'https://bobross.com',
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe('Bob Ross');
    });

    it('validates partial updates on existing record', async () => {
      const created = await ctx.users.add({
        name: 'Charlie Brown',
        email: 'charlie@peanuts.com',
        age: 30,
        code: 'SNO-1950',
      });

      // Invalid partial update: age < 18
      await expect(ctx.users.update(created.id, { age: 10 })).rejects.toThrow(
        EntityValidationException,
      );

      // Valid partial update
      const updated = await ctx.users.update(created.id, { age: 31 });
      expect(Number(updated.age)).toBe(31);
    });
  });
});
