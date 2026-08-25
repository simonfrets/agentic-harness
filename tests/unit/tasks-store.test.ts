import fs from 'node:fs';
import path from 'node:path';

import { HarnessError } from '../../src/core/errors';
import { harnessPaths, type HarnessPaths } from '../../src/core/paths';
import {
  createTask,
  findTask,
  nextTaskId,
  readTasksFile,
  updateTasksFile,
  writeTasksFile,
} from '../../src/core/tasks/store';
import { cleanupTempDirs, read, tempDir } from '../helpers/fixture';

afterAll(cleanupTempDirs);

const SEED = `version: 1
pipeline: [specifier, coder, cleaner, architect, hardener, qa]
tasks:
  - id: T-001
    title: Add password reset
    intent: users forget passwords
    status: coding
    owner: coder
    handoffs: []
`;

function seed(contents = SEED): HarnessPaths {
  const root = tempDir();
  const paths = harnessPaths(root);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.tasks, contents);
  return paths;
}

describe('readTasksFile', () => {
  it('parses tasks and their pipeline', () => {
    const file = readTasksFile(seed());
    expect(file.pipeline).toEqual(['specifier', 'coder', 'cleaner', 'architect', 'hardener', 'qa']);
    expect(file.tasks).toHaveLength(1);
    expect(file.tasks[0]?.id).toBe('T-001');
    expect(file.tasks[0]?.status).toBe('coding');
  });

  it('rejects an unknown status instead of silently accepting it', () => {
    const paths = seed(SEED.replace('status: coding', 'status: vibing'));
    expect(() => readTasksFile(paths)).toThrow(HarnessError);
  });

  it('reports SCHEMA_INVALID for malformed YAML', () => {
    const paths = seed('version: 1\ntasks: [oops\n');
    try {
      readTasksFile(paths);
      throw new Error('expected a parse failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('SCHEMA_INVALID');
    }
  });

  it('reports NO_TASKS_FILE when the file is absent', () => {
    const root = tempDir();
    const paths = harnessPaths(root);
    fs.mkdirSync(paths.dir, { recursive: true });
    try {
      readTasksFile(paths);
      throw new Error('expected a missing-file failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('NO_TASKS_FILE');
    }
  });
});

describe('writeTasksFile', () => {
  it('round-trips through YAML', () => {
    const paths = seed();
    const file = readTasksFile(paths);
    file.tasks[0]!.status = 'hardening';
    writeTasksFile(paths, file);
    expect(readTasksFile(paths).tasks[0]?.status).toBe('hardening');
  });

  it('leaves no temp file behind', () => {
    const paths = seed();
    writeTasksFile(paths, readTasksFile(paths));
    const strays = fs.readdirSync(paths.dir).filter((f) => f.includes('.tmp'));
    expect(strays).toEqual([]);
  });

  it('omits empty optional fields rather than writing nulls', () => {
    const paths = seed();
    writeTasksFile(paths, readTasksFile(paths));
    expect(read(paths.tasks)).not.toMatch(/null/);
  });
});

describe('updateTasksFile', () => {
  it('persists the mutation', () => {
    const paths = seed();
    updateTasksFile(paths, (file) => {
      findTask(file, 'T-001').owner = 'hardener';
    });
    expect(readTasksFile(paths).tasks[0]?.owner).toBe('hardener');
  });

  it('leaves the file untouched when the mutator throws', () => {
    const paths = seed();
    const before = read(paths.tasks);
    expect(() =>
      updateTasksFile(paths, () => { throw new Error('mutator exploded'); }),
    ).toThrow('mutator exploded');
    expect(read(paths.tasks)).toBe(before);
  });

  it('releases the lock so a following update succeeds', () => {
    const paths = seed();
    updateTasksFile(paths, (file) => { findTask(file, 'T-001').status = 'qa'; });
    updateTasksFile(paths, (file) => { findTask(file, 'T-001').status = 'done'; });
    expect(readTasksFile(paths).tasks[0]?.status).toBe('done');
    expect(fs.existsSync(path.join(paths.locks, 'tasks.lock'))).toBe(false);
  });
});

describe('nextTaskId', () => {
  it('starts at T-001 for an empty file', () => {
    const paths = seed('version: 1\ntasks: []\n');
    expect(nextTaskId(readTasksFile(paths))).toBe('T-001');
  });

  it('continues past the highest existing id, not the count', () => {
    const paths = seed(SEED.replace('id: T-001', 'id: T-042'));
    expect(nextTaskId(readTasksFile(paths))).toBe('T-043');
  });

  it('pads to three digits', () => {
    const paths = seed(SEED.replace('id: T-001', 'id: T-009'));
    expect(nextTaskId(readTasksFile(paths))).toBe('T-010');
  });
});

describe('createTask', () => {
  it('starts a task as a draft owned by the first pipeline stage', () => {
    const paths = seed();
    const file = readTasksFile(paths);
    const task = createTask(file, { title: 'Add SSO', intent: 'enterprise wants SSO' });
    expect(task.id).toBe('T-002');
    expect(task.status).toBe('draft');
    expect(task.owner).toBe('specifier');
    expect(file.tasks).toHaveLength(2);
  });
});

describe('findTask', () => {
  it('reports TASK_NOT_FOUND for an unknown id', () => {
    const file = readTasksFile(seed());
    try {
      findTask(file, 'T-999');
      throw new Error('expected a lookup failure');
    } catch (err) {
      expect((err as HarnessError).code).toBe('TASK_NOT_FOUND');
    }
  });
});
