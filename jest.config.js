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
        isolatedModules: true,
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
  // Run tests in-band with 1 worker to prevent native C++ module (better-sqlite3)
  // SIGSEGV worker crashes caused by multi-process native memory recycling in Jest
  maxWorkers: 1,
};
