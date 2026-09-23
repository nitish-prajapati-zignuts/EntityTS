import * as path from 'path';
import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'EntityTS',
  tagline: 'Enterprise TypeScript ORM inspired by EF Core & LINQ',
  favicon: 'img/favicon.ico',

  url: 'https://nitish-prajapati-zignuts.github.io',
  baseUrl: process.env.DOCUSAURUS_BASE_URL || '/EntityTS/',

  organizationName: 'nitish-prajapati-zignuts',
  projectName: 'EntityTS',
  trailingSlash: false,

  onBrokenLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/nitish-prajapati-zignuts/EntityTS/tree/main/website/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-typedoc',
      {
        id: 'api',
        entryPoints: [path.resolve(__dirname, '../src/index.ts')],
        tsconfig: path.resolve(__dirname, '../tsconfig.json'),
        out: path.resolve(__dirname, 'docs/api'),
        readme: 'none',
        indexFormat: 'table',
        parametersFormat: 'table',
        enumMembersFormat: 'table',
        typeDeclarationFormat: 'table',
      },
    ],
  ],

  themeConfig: {
    image: 'img/entityts-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'EntityTS',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/docs/api',
          position: 'left',
          label: 'API Reference',
        },
        {
          to: '/docs/querying/linq-fluent-api',
          position: 'left',
          label: 'LINQ Querying',
        },
        {
          to: '/docs/advanced/stored-procedures',
          position: 'left',
          label: 'Stored Procedures',
        },
        {
          href: 'https://github.com/nitish-prajapati-zignuts/EntityTS',
          label: 'GitHub',
          position: 'right',
        },
        {
          href: 'https://www.npmjs.com/package/entityts',
          label: 'npm',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started/quickstart',
            },
            {
              label: 'DbContext & DbSet',
              to: '/docs/core/dbcontext',
            },
            {
              label: 'LINQ Fluent Query API',
              to: '/docs/querying/linq-fluent-api',
            },
            {
              label: 'API Reference',
              to: '/docs/api',
            },
          ],
        },
        {
          title: 'Enterprise Features',
          items: [
            {
              label: 'Unit of Work & Transactions',
              to: '/docs/advanced/transactions',
            },
            {
              label: 'Stored Procedures',
              to: '/docs/advanced/stored-procedures',
            },
            {
              label: 'Keyset & Cursor Pagination',
              to: '/docs/querying/pagination',
            },
            {
              label: 'Vector Embeddings (pgvector)',
              to: '/docs/advanced/vector-embeddings',
            },
          ],
        },
        {
          title: 'Community & Ecosystem',
          items: [
            {
              label: 'GitHub Repository',
              href: 'https://github.com/nitish-prajapati-zignuts/EntityTS',
            },
            {
              label: 'Report an Issue',
              href: 'https://github.com/nitish-prajapati-zignuts/EntityTS/issues',
            },
            {
              label: 'npm Package',
              href: 'https://www.npmjs.com/package/entityts',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} EntityTS. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['sql', 'bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
