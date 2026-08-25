import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { REPO_ROOT } from './fixture';

/**
 * Shell tests drive the real CLI the way a project would -- as a compiled
 * binary. Building once here keeps every test honest about what ships.
 */
export default function build(): void {
  execFileSync('npx', ['tsc', '-p', path.join(REPO_ROOT, 'tsconfig.build.json')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
}
