// Nest 12 ships as ESM only, so tests run as native ES modules. The npm scripts
// start Node with --experimental-vm-modules, which Jest requires for this.
const shared = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
};

export default {
  // The e2e suites share one database, so test files must not run in parallel.
  maxWorkers: 1,
  projects: [
    { ...shared, displayName: 'unit', rootDir: 'src', testMatch: ['**/*.spec.ts'] },
    {
      ...shared,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
      globalSetup: '<rootDir>/test/support/global-setup.ts',
      globalTeardown: '<rootDir>/test/support/global-teardown.ts',
    },
  ],
};
