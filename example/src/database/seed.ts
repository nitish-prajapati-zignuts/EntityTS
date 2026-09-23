import { User, Profile, Post, Comment, Product } from '../entities';
import type { AppDbContext } from './AppDbContext';

export async function seedDatabase(db: AppDbContext): Promise<void> {
  const existingCount = await db.users.count();
  if (existingCount > 0) {
    return; // Already seeded
  }

  console.log('[SEED] Seeding initial database records...');

  // 1. Seed Users
  const alice = await db.users.add({
    name: 'Alice Johnson',
    email: 'alice@example.com',
    role: 'admin',
    score: 95,
  });

  const bob = await db.users.add({
    name: 'Bob Smith',
    email: 'bob@example.com',
    role: 'editor',
    score: 82,
  });

  const charlie = await db.users.add({
    name: 'Charlie Brown',
    email: 'charlie@example.com',
    role: 'user',
    score: 68,
  });

  const diana = await db.users.add({
    name: 'Diana Prince',
    email: 'diana@example.com',
    role: 'user',
    score: 89,
  });

  // 2. Seed Profiles
  await db.profiles.add({
    userId: alice.id,
    bio: 'Lead System Architect & Admin',
    website: 'https://alice.dev',
  });

  await db.profiles.add({
    userId: bob.id,
    bio: 'Tech Editor & Content Specialist',
    website: 'https://bob.tech',
  });

  // 3. Seed Posts
  const post1 = await db.posts.add({
    userId: alice.id,
    title: 'Getting Started with entityts in TypeScript',
    content: 'An in-depth guide on Entity Framework Core-style DbContext and DbSet in Node.js.',
  });

  const post2 = await db.posts.add({
    userId: alice.id,
    title: 'Advanced CRUD and Querying Patterns',
    content: 'Explore LINQ-style chaining, keyset pagination, and eager loading.',
  });

  const post3 = await db.posts.add({
    userId: bob.id,
    title: 'High-Performance Bulk Operations in Databases',
    content: 'How bulkInsert, bulkUpdate, and bulkUpsert bypass per-row latency.',
  });

  // 4. Seed Comments
  await db.comments.add({
    postId: post1.id,
    author: 'Bob Smith',
    text: 'Great overview, especially the stored procedure builder!',
  });

  await db.comments.add({
    postId: post1.id,
    author: 'Charlie Brown',
    text: 'Very helpful decorators for soft delete and auditing.',
  });

  await db.comments.add({
    postId: post2.id,
    author: 'Diana Prince',
    text: 'The cursor pagination example is super clean.',
  });

  // 5. Seed Products
  await db.products.addRange([
    {
      sku: 'PROD-001',
      name: 'Ergonomic Mechanical Keyboard',
      category: 'Electronics',
      price: 149.99,
      stock: 45,
    },
    {
      sku: 'PROD-002',
      name: 'Wireless Precision Mouse',
      category: 'Electronics',
      price: 79.5,
      stock: 120,
    },
    {
      sku: 'PROD-003',
      name: 'UltraWide 34-inch Monitor',
      category: 'Electronics',
      price: 599.0,
      stock: 15,
    },
    {
      sku: 'PROD-004',
      name: 'Standing Desk Converter',
      category: 'Furniture',
      price: 229.0,
      stock: 30,
    },
    {
      sku: 'PROD-005',
      name: 'Noise-Canceling Studio Headphones',
      category: 'Audio',
      price: 299.99,
      stock: 60,
    },
  ]);

  console.log('[SEED] Database seed completed successfully.');
}
