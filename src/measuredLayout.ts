import { debug } from './debug';
import { layout } from './model';

// model.ts stays a pure DAG calculation: timing is recorded here, by the caller.
export function measuredLayout(...args: Parameters<typeof layout>) {
  const started = debug.startTime();
  const result = layout(...args);
  debug.layout(started, args[0]);
  return result;
}
