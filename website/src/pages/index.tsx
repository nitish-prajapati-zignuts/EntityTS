import * as React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';

interface FeatureItem {
  title: string;
  icon: string;
  description: string;
}

const FeatureList: FeatureItem[] = [
  {
    title: 'EF Core & LINQ Fluent API',
    icon: '⚡',
    description:
      'Intuitive DbContext & DbSet patterns with fluent type-safe query chaining, typed selectors, and dynamic filters.',
  },
  {
    title: 'Multi-Database Dialect Support',
    icon: '🌐',
    description:
      'First-class support for PostgreSQL (Neon/CockroachDB), SQLite (LibSQL/Turso), MySQL (PlanetScale), and SQL Server.',
  },
  {
    title: 'First-Class Stored Procedures',
    icon: '⚙️',
    description:
      'Type-safe stored procedure and user-defined function execution with input/output parameters, multiple result sets, and table types.',
  },
  {
    title: 'Enterprise Concurrency & Locking',
    icon: '🔒',
    description:
      'Built-in optimistic concurrency via @Version/@ConcurrencyCheck and pessimistic row-level locking (FOR UPDATE, UPDLOCK).',
  },
  {
    title: 'AI Vector Search & Embeddings',
    icon: '🧠',
    description:
      'Native pgvector embeddings with cosine, euclidean, and inner product distance indexing and nearest-neighbor search.',
  },
  {
    title: 'Reliability: Idempotency & Outbox',
    icon: '🛡️',
    description:
      'Transactional outbox pattern and distributed idempotency keys for rock-solid microservices and event-driven architectures.',
  },
];

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary')}>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            className="button button--primary button--lg"
            to="/docs/getting-started/quickstart"
            style={{ fontWeight: 600, padding: '0.85rem 2rem' }}
          >
            Get Started →
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/api"
            style={{ fontWeight: 600, padding: '0.85rem 2rem' }}
          >
            API Reference
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} — Enterprise TypeScript ORM`}
      description="Enterprise EF Core-inspired ORM, DbContext, DbSet, and Stored Procedure Execution for TypeScript & Node.js"
    >
      <HomepageHeader />
      <main style={{ padding: '4rem 0' }}>
        <div className="container">
          <div className="row" style={{ rowGap: '2rem' }}>
            {FeatureList.map((feature, idx) => (
              <div key={idx} className="col col--4">
                <div className="featureCard">
                  <div className="featureIcon">{feature.icon}</div>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>{feature.title}</h3>
                  <p style={{ color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Example Section */}
          <div style={{ marginTop: '5rem', textAlign: 'center' }}>
            <h2>Quick Installation</h2>
            <div style={{ maxWidth: '600px', margin: '1.5rem auto 0' }}>
              <pre style={{ textAlign: 'left', padding: '1rem 1.5rem', borderRadius: '8px' }}>
                <code>npm install entityts reflect-metadata</code>
              </pre>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
