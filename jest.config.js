/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  setupFiles: ['reflect-metadata'],
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  verbose: true,
  // Limit parallelism to prevent SIGSEGV crashes from concurrent better-sqlite3
  // native bindings being loaded across too many Jest worker processes simultaneously.
  maxWorkers: process.env.CI ? 2 : '50%',
};
