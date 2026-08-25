/** @type {import('jest').Config} */
const transform = {
  '^.+\\.ts$': ['@swc/jest', { jsc: { target: 'es2022', parser: { syntax: 'typescript' } } }],
};

export default {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      transform,
    },
    {
      displayName: 'shell',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/shell/**/*.test.ts'],
      transform,
      // The shell layer drives the compiled CLI, so build it once up front.
      globalSetup: '<rootDir>/tests/helpers/globalSetup.ts',
    },
  ],
  // Shell tests spawn real processes in temp fixtures; jest only honours this
  // at the top level, not per project.
  testTimeout: 30_000,
  // src/cli is driven out-of-process by the shell suite, so in-process
  // instrumentation cannot see it. Measuring it here would report a number that
  // means nothing; the core is where the logic -- and the threshold -- lives.
  collectCoverageFrom: ['src/core/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  // json-summary is what `harness tdd ratchet` reads.
  coverageReporters: ['text-summary', 'json', 'json-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
