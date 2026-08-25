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
    },
  ],
  // Shell tests spawn real processes in temp fixtures; jest only honours this
  // at the top level, not per project.
  testTimeout: 30_000,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'json', 'lcov'],
  coverageThreshold: {
    global: { statements: 80, branches: 80, functions: 80, lines: 80 },
  },
};
