import { MigrationBuilder } from 'entityts';

export const id = '1790169480948';
export const name = 'AddedSurname';

export async function up(schema: MigrationBuilder): Promise<void> {
  await schema.executeSql(
    'CREATE TABLE "benchmark_users" (\n  "id" SERIAL PRIMARY KEY,\n  "name" VARCHAR(100) NOT NULL,\n  "role" VARCHAR(50) NOT NULL,\n  "score" INTEGER NOT NULL,\n  "email" VARCHAR(150) NOT NULL\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "comments" (\n  "id" SERIAL PRIMARY KEY,\n  "post_id" INTEGER NOT NULL,\n  "author" VARCHAR(100) NOT NULL,\n  "text" TEXT,\n  "createdAt" VARCHAR(255) NOT NULL\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "posts" (\n  "id" SERIAL PRIMARY KEY,\n  "user_id" INTEGER NOT NULL,\n  "title" VARCHAR(200) NOT NULL,\n  "content" TEXT,\n  "createdAt" VARCHAR(255) NOT NULL,\n  "updatedAt" VARCHAR(255) NOT NULL,\n  "deleted_at" VARCHAR(255)\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "profiles" (\n  "id" SERIAL PRIMARY KEY,\n  "user_id" INTEGER NOT NULL,\n  "bio" VARCHAR(255) NOT NULL,\n  "website" VARCHAR(100)\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "users" (\n  "id" SERIAL PRIMARY KEY,\n  "name" VARCHAR(100) NOT NULL,\n  "email" VARCHAR(150) NOT NULL,\n  "role" VARCHAR(50) NOT NULL DEFAULT \'user\',\n  "score" INTEGER NOT NULL DEFAULT 0,\n  "phone" VARCHAR(20),\n  "surname" VARCHAR(20),\n  "createdAt" VARCHAR(255) NOT NULL,\n  "updatedAt" VARCHAR(255) NOT NULL,\n  "deleted_at" VARCHAR(255)\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "products" (\n  "id" SERIAL PRIMARY KEY,\n  "sku" VARCHAR(50) NOT NULL,\n  "name" VARCHAR(150) NOT NULL,\n  "category" VARCHAR(50) NOT NULL,\n  "price" DECIMAL(10, 2) NOT NULL,\n  "stock" INTEGER NOT NULL DEFAULT 0,\n  "version" INTEGER NOT NULL DEFAULT 1,\n  "createdAt" VARCHAR(255) NOT NULL,\n  "updatedAt" VARCHAR(255) NOT NULL\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "audit_logs" (\n  "id" SERIAL PRIMARY KEY,\n  "action" VARCHAR(50) NOT NULL,\n  "entity_name" VARCHAR(50) NOT NULL,\n  "entity_id" INTEGER,\n  "details" TEXT,\n  "createdAt" VARCHAR(255) NOT NULL\n);',
  );
  await schema.executeSql(
    'CREATE TABLE "documents" (\n  "id" SERIAL PRIMARY KEY,\n  "title" VARCHAR(200) NOT NULL,\n  "content" TEXT,\n  "category" VARCHAR(50) NOT NULL,\n  "embedding" TEXT,\n  "createdAt" VARCHAR(255) NOT NULL,\n  "updatedAt" VARCHAR(255) NOT NULL\n);',
  );
}

export async function down(schema: MigrationBuilder): Promise<void> {
  await schema.dropTableIfExists('benchmark_users');
  await schema.dropTableIfExists('comments');
  await schema.dropTableIfExists('posts');
  await schema.dropTableIfExists('profiles');
  await schema.dropTableIfExists('users');
  await schema.dropTableIfExists('products');
  await schema.dropTableIfExists('audit_logs');
  await schema.dropTableIfExists('documents');
}
