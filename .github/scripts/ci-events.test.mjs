import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8');

// Read the scalar at its expected indentation, including folded expressions.
// Ambiguous matches fail so a future workflow restructure cannot test the wrong job.
function scalar(name, indentation) {
  const lines = workflow.split('\n');
  const pattern = new RegExp(`^ {${indentation}}${name}: (.+)$`);
  const matches = lines.flatMap((line, index) => {
    const match = line.match(pattern);
    return match ? [{ index, value: match[1] }] : [];
  });
  assert.equal(matches.length, 1, `Expected one ${name} at indentation ${indentation}`);
  const { index, value } = matches[0];
  if (value !== '>-') return value;

  const folded = [];
  for (const line of lines.slice(index + 1)) {
    if (!line.trim()) break;
    if (!line.startsWith(' '.repeat(indentation + 2))) break;
    folded.push(line.trim());
  }
  assert.ok(folded.length, `Empty folded ${name}`);
  return folded.join(' ');
}

// These workflow expressions use only property lookups, strings and boolean
// operators shared with JavaScript. Normalize missing lookups as Actions does;
// reject other syntax instead of pretending to implement all Actions expressions.
function evaluate(expression, github) {
  const remainder = expression
    .replace(/'[^']*'/g, '')
    .replace(/\bgithub(?:\.[A-Za-z_][A-Za-z_0-9]*)+/g, '')
    .replace(/[\s()!&|=]/g, '');
  assert.equal(remainder, '', `Unsupported expression syntax: ${expression}`);
  const translated = expression.replace(
    /'[^']*'|\bgithub(?:\.[A-Za-z_][A-Za-z_0-9]*)+/g,
    (token) => (token.startsWith('github.') ? `lookup('${token}')` : token),
  );
  const lookup = (path) => {
    const value = path.split('.').slice(1).reduce((object, key) => object?.[key], github);
    return value === undefined ? '' : value;
  };
  return Function('lookup', `"use strict"; return (${translated});`)(lookup);
}

function render(template, github) {
  return template.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) =>
    String(evaluate(expression, github)),
  );
}

const condition = scalar('if', 4).match(/^\$\{\{([\s\S]*)\}\}$/)?.[1];
assert.ok(condition, 'The job condition must be an explicit Actions expression');
const jobName = scalar('name', 4);
const concurrencyGroup = scalar('group', 2);

function configuredRun(github) {
  return {
    runs: Boolean(evaluate(condition, github)),
    name: render(jobName, github),
    group: render(concurrencyGroup, github),
  };
}

function pullRequest(action, changes, base = 'dev') {
  return {
    event_name: 'pull_request',
    ref: 'refs/pull/42/merge',
    event: { action, changes, pull_request: { number: 42, base: { ref: base } } },
  };
}

const metadataChanges = [
  { title: { from: 'Original title' } },
  { body: { from: 'Original description' } },
  { body: { from: '' } },
  { body: { from: null } },
  { title: { from: 'Original title' }, body: { from: 'Original description' } },
];

test('title and body edits skip the runner using a separate check name', () => {
  for (const base of ['dev', 'main']) {
    for (const changes of metadataChanges) {
      const run = configuredRun(pullRequest('edited', changes, base));
      assert.equal(run.runs, false, JSON.stringify(changes));
      assert.equal(run.name, 'PR metadata only');
    }
  }
});

test('retargeting keeps validation even when title or body also changes', () => {
  for (const base of ['dev', 'main']) {
    for (const metadata of [{}, ...metadataChanges]) {
      const changes = { ...metadata, base: { ref: { from: base === 'dev' ? 'main' : 'dev' } } };
      const run = configuredRun(pullRequest('edited', changes, base));
      assert.equal(run.runs, true, JSON.stringify(changes));
      assert.equal(run.name, 'Test and build');
    }
  }
});

test('missing and unrecognized edit metadata falls back to validation', () => {
  for (const changes of [undefined, null, {}, { unknown: { from: 'old' } }]) {
    const run = configuredRun(pullRequest('edited', changes));
    assert.equal(run.runs, true);
    assert.equal(run.name, 'Test and build');
  }
});

test('opened, synchronize, reopened and protected branch pushes run validation', () => {
  for (const action of ['opened', 'synchronize', 'reopened']) {
    for (const changes of [undefined, ...metadataChanges]) {
      const run = configuredRun(pullRequest(action, changes));
      assert.equal(run.runs, true);
      assert.equal(run.name, 'Test and build');
    }
  }
  for (const base of ['dev', 'main']) {
    const run = configuredRun({ event_name: 'push', ref: `refs/heads/${base}`, event: {} });
    assert.equal(run.runs, true);
    assert.equal(run.name, 'Test and build');
    assert.equal(run.group, `ci-refs/heads/${base}-validation`);
  }
});

test('metadata job names cannot satisfy dev or main required checks', () => {
  const validation = configuredRun(pullRequest('synchronize'));
  for (const base of ['dev', 'main']) {
    const ruleset = JSON.parse(readFileSync(new URL(`../rulesets/${base}.json`, import.meta.url)));
    const required = ruleset.rules.find((rule) => rule.type === 'required_status_checks')
      .parameters.required_status_checks;
    assert.ok(required.some((check) => check.context === validation.name));

    for (const changes of metadataChanges) {
      const metadata = configuredRun(pullRequest('edited', changes, base));
      assert.ok(required.every((check) => check.context !== metadata.name));
    }
  }
});

test('metadata edits cannot cancel running or pending validation through concurrency', () => {
  assert.equal(scalar('cancel-in-progress', 2), 'true');
  const validation = configuredRun(pullRequest('synchronize'));
  assert.equal(validation.group, 'ci-42-validation');
  for (const changes of metadataChanges) {
    const metadata = configuredRun(pullRequest('edited', changes));
    assert.equal(metadata.group, 'ci-42-metadata');
    assert.notEqual(metadata.group, validation.group);
  }
  const retarget = configuredRun(pullRequest('edited', { base: { ref: { from: 'dev' } } }, 'main'));
  assert.equal(retarget.group, validation.group);
});
