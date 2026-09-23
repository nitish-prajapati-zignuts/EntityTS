import * as fs from 'fs';
import * as path from 'path';
import {
  DRIVER_REGISTRY,
  normalizeProvider,
  detectPackageManager,
  loadDriver,
} from '../src/adapters/DriverLoader';
import { ConnectionException } from '../src/errors';

describe('Database Driver Isolation', () => {
  describe('package.json peerDependencies', () => {
    it('does NOT contain database driver packages in peerDependencies to prevent unwanted auto-installs', () => {
      const pkgPath = path.resolve(__dirname, '../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      const peerDeps = pkg.peerDependencies || {};
      const peerKeys = Object.keys(peerDeps);

      // Verifying that drivers like pg, mysql2, mssql, better-sqlite3 are NOT in peerDependencies
      expect(peerKeys).not.toContain('pg');
      expect(peerKeys).not.toContain('mssql');
      expect(peerKeys).not.toContain('mysql2');
      expect(peerKeys).not.toContain('better-sqlite3');
      expect(peerKeys).not.toContain('@libsql/client');
      expect(peerKeys).not.toContain('@neondatabase/serverless');
      expect(peerKeys).not.toContain('@planetscale/database');
    });

    it('retains only framework integration peer dependencies', () => {
      const pkgPath = path.resolve(__dirname, '../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

      const peerDeps = pkg.peerDependencies || {};
      expect(peerDeps).toHaveProperty('express');
      expect(peerDeps).toHaveProperty('@nestjs/common');
    });
  });

  describe('Driver Registry', () => {
    it('registers mssql with package name mssql and explicit isolation warning against pg', () => {
      const info = DRIVER_REGISTRY['mssql'];
      expect(info).toBeDefined();
      expect(info.packageName).toBe('mssql');
      expect(info.typesPackage).toBe('@types/mssql');
      expect(info.exclusiveNotes).toContain("Do NOT install 'pg'");
    });

    it('registers postgres with package name pg and explicit isolation warning against mssql', () => {
      const info = DRIVER_REGISTRY['postgres'];
      expect(info).toBeDefined();
      expect(info.packageName).toBe('pg');
      expect(info.typesPackage).toBe('@types/pg');
      expect(info.exclusiveNotes).toContain("Do NOT install 'mssql'");
    });

    it('registers mysql with package name mysql2', () => {
      const info = DRIVER_REGISTRY['mysql'];
      expect(info).toBeDefined();
      expect(info.packageName).toBe('mysql2');
    });

    it('registers sqlite with package name better-sqlite3', () => {
      const info = DRIVER_REGISTRY['sqlite'];
      expect(info).toBeDefined();
      expect(info.packageName).toBe('better-sqlite3');
    });
  });

  describe('Provider Normalization', () => {
    it('normalizes various aliases to standard DbProvider names', () => {
      expect(normalizeProvider('mssql')).toBe('mssql');
      expect(normalizeProvider('sqlserver')).toBe('mssql');
      expect(normalizeProvider('sql-server')).toBe('mssql');
      expect(normalizeProvider('postgres')).toBe('postgres');
      expect(normalizeProvider('pg')).toBe('postgres');
      expect(normalizeProvider('postgresql')).toBe('postgres');
      expect(normalizeProvider('mysql')).toBe('mysql');
      expect(normalizeProvider('mariadb')).toBe('mysql');
      expect(normalizeProvider('sqlite')).toBe('sqlite');
      expect(normalizeProvider('better-sqlite3')).toBe('sqlite');
      expect(normalizeProvider('turso')).toBe('turso');
      expect(normalizeProvider('neon')).toBe('neon');
      expect(normalizeProvider('planetscale')).toBe('planetscale');
    });

    it('returns undefined for invalid provider names', () => {
      expect(normalizeProvider('oracle')).toBeUndefined();
      expect(normalizeProvider('unknown_db')).toBeUndefined();
    });
  });

  describe('detectPackageManager', () => {
    it('detects package manager in directory or defaults to npm', () => {
      const pm = detectPackageManager();
      expect(['npm', 'pnpm', 'yarn', 'bun']).toContain(pm);
    });
  });

  describe('loadDriver error formatting', () => {
    it('throws ConnectionException with isolated install instructions when a driver cannot be found', async () => {
      // Simulate loading an uninstalled mock driver specifier
      await expect(loadDriver('mssql', 'non_existent_mssql_driver_package_12345')).rejects.toThrow(
        ConnectionException,
      );

      try {
        await loadDriver('mssql', 'non_existent_mssql_driver_package_12345');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConnectionException);
        expect(err.message).toContain("Database driver 'mssql' is not installed");
        expect(err.message).toContain('entityts add mssql');
        expect(err.message).toContain("Do NOT install 'pg'");
      }
    });

    it('postgres driver failure tells user to install pg and not mssql', async () => {
      try {
        await loadDriver('postgres', 'non_existent_pg_driver_package_12345');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConnectionException);
        expect(err.message).toContain("Database driver 'pg' is not installed");
        expect(err.message).toContain('entityts add postgres');
        expect(err.message).toContain("Do NOT install 'mssql'");
      }
    });
  });
});
