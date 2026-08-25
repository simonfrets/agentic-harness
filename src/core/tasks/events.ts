import fs from 'node:fs';
import path from 'node:path';

import type { HarnessPaths } from '../paths';
import { taskEventLog } from '../paths';

/**
 * Append-only history per task. tasks.yaml holds current state; this holds how
 * it got there -- every handoff, gate result and rejection, in order.
 */
export interface HarnessEvent {
  at: string;
  task: string;
  type: string;
  agent?: string;
  [key: string]: unknown;
}

export type EventInput = Omit<HarnessEvent, 'at' | 'task'> & { type: string };

export function appendEvent(paths: HarnessPaths, taskId: string, event: EventInput): HarnessEvent {
  const file = taskEventLog(paths, taskId);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const record: HarnessEvent = { at: new Date().toISOString(), task: taskId, ...event };
  // JSON.stringify escapes newlines, so one event is always exactly one line.
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

export function readEvents(paths: HarnessPaths, taskId: string): HarnessEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(taskEventLog(paths, taskId), 'utf8');
  } catch {
    return [];
  }

  const events: HarnessEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line) as HarnessEvent);
    } catch {
      // A truncated write must not cost us the rest of the history.
    }
  }
  return events;
}
