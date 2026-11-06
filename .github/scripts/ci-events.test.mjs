import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
const lines = workflow.split('\n');

// Lines of the test-build job body, up to its first step list.
function jobBody() {
  const start = lines.indexOf('  test-build:');
  assert.notEqual(start, -1, 'Expected the test-build job');
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line) || line.startsWith('    steps:')) break;
    body.push(line);
  }
  return body;
}

test('the required check keeps a static name on every event', () => {
  const names = jobBody().filter((line) => line.startsWith('    name:'));
  assert.deepEqual(names, ['    name: Test and build']);
});

test('the required job is never skipped by a job-level condition', () => {
  assert.ok(jobBody().every((line) => !line.startsWith('    if:')));
});

test('the job name matches the dev and main required checks', () => {
  for (const base of ['dev', 'main']) {
    const ruleset = JSON.parse(readFileSync(new URL(`../rulesets/${base}.json`, import.meta.url)));
    const required = ruleset.rules.find((rule) => rule.type === 'required_status_checks')
      .parameters.required_status_checks;
    assert.ok(required.some((check) => check.context === 'Test and build'));
  }
});

test('pull-request edits stay enabled so retargeting is revalidated', () => {
  assert.match(workflow, /types: \[opened, synchronize, reopened, edited\]/);
});
