import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { verifyCredentialIsolation } from './ai-development/credentials.mjs';
import { NeedsHuman } from './ai-development/engine.mjs';
import { createGitHub } from './ai-development/github.mjs';

function metadata() {
  const target = {
    name: 'ai-development',
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  };
  return new Map([
    ['', { owner: { type: 'User' } }],
    ['/actions/secrets?per_page=1', { total_count: 0, secrets: [] }],
    ['/environments/ai-development', target],
    [
      '/environments/ai-development/deployment-branch-policies?per_page=100',
      {
        total_count: 1,
        branch_policies: [{ name: 'dev', type: 'branch' }],
      },
    ],
    [
      '/environments/ai-development/secrets?per_page=100',
      {
        secrets: [
          'OPENAI_API_KEY',
          'ANTHROPIC_API_KEY',
          'AI_AUTOMATION_TOKEN',
        ].map((name) => ({ name })),
      },
    ],
    [
      '/environments?per_page=100',
      { total_count: 2, environments: [target, { name: 'Preview' }] },
    ],
    [
      '/environments/Preview/secrets?per_page=1',
      { total_count: 0, secrets: [] },
    ],
  ]);
}

const settings = { environment: 'ai-development', base: 'dev' };

test('credential isolation accepts a dev-only Environment with no repository secrets', async () => {
  const values = metadata();
  const seen = [];
  await verifyCredentialIsolation(async (path) => {
    seen.push(path);
    assert(values.has(path));
    return structuredClone(values.get(path));
  }, settings);
  assert(seen.includes('/actions/secrets?per_page=1'));
  assert(seen.includes('/environments/Preview/secrets?per_page=1'));
});

test('unsafe or unverifiable credentials stop publication instead of trusting repository defaults', async () => {
  const cases = [
    (values) =>
      values.set('/actions/secrets?per_page=1', {
        total_count: 1,
        secrets: [{ name: 'PRIVATE' }],
      }),
    (values) => {
      values.get('/environments/ai-development').deployment_branch_policy =
        null;
    },
    (values) => {
      values.get(
        '/environments/ai-development/deployment-branch-policies?per_page=100',
      ).branch_policies[0].name = '*';
    },
    (values) => {
      values.get(
        '/environments/ai-development/deployment-branch-policies?per_page=100',
      ).branch_policies[0].type = 'tag';
    },
    (values) => {
      values
        .get('/environments/ai-development/secrets?per_page=100')
        .secrets.pop();
    },
    (values) => {
      values.get('/environments?per_page=100').total_count++;
    },
    (values) => {
      values.get('/environments/Preview/secrets?per_page=1').total_count = 1;
    },
    (values) => {
      values.get('').owner.type = 'Organization';
    },
  ];
  for (const mutate of cases) {
    const values = metadata();
    mutate(values);
    await assert.rejects(
      verifyCredentialIsolation(async (path) => {
        if (!values.has(path))
          throw Object.assign(new Error('not found'), { status: 404 });
        return structuredClone(values.get(path));
      }, settings),
      NeedsHuman,
    );
  }
  await assert.rejects(
    verifyCredentialIsolation(async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 });
    }, settings),
    /Actions·Secrets·Environments 읽기 권한/,
  );
});

test('the adapter rechecks isolation before each mutation and never sends a rejected commit', async () => {
  const values = metadata();
  const writes = [];
  let checks = 0;
  const github = createGitHub({
    repository: 'owner/repo',
    token: 'workflow-mock',
    publishingToken: 'publishing-mock',
    async request(url, options) {
      const path = url.replace('https://api.github.com/repos/owner/repo', '');
      if (options.method === 'GET') {
        checks++;
        assert.equal(options.headers.authorization, 'Bearer publishing-mock');
        assert(values.has(path));
        return Response.json(values.get(path));
      }
      writes.push(url);
      return Response.json({
        data: { createCommitOnBranch: { commit: { oid: 'b'.repeat(40) } } },
      });
    },
  });
  const args = [
    'ai/issue-13-codex',
    'a'.repeat(40),
    [{ path: '.github/workflows/example.yml', text: 'example' }],
    { headline: 'example' },
  ];
  assert.equal(await github.commit(...args), 'b'.repeat(40));
  assert.equal(writes.length, 1);
  const previousChecks = checks;
  values.set('/actions/secrets?per_page=1', {
    total_count: 1,
    secrets: [{ name: 'PRIVATE' }],
  });
  await assert.rejects(github.commit(...args), /Repository Secrets/);
  assert(checks > previousChecks);
  assert.equal(writes.length, 1);
});

test('workflow permission failures explain the required publishing token scope', async () => {
  for (const status of [200, 403]) {
    const values = metadata();
    const github = createGitHub({
      repository: 'owner/repo',
      token: 'workflow-mock',
      publishingToken: 'publishing-mock',
      async request(url, options) {
        if (options.method === 'GET')
          return Response.json(
            values.get(
              url.replace('https://api.github.com/repos/owner/repo', ''),
            ),
          );
        return Response.json(
          {
            errors: [
              { type: 'FORBIDDEN', message: 'Workflow permission required' },
            ],
          },
          { status },
        );
      },
    });
    await assert.rejects(
      github.commit(
        'ai/issue-13-codex',
        'a'.repeat(40),
        [{ path: '.github/workflows/example.yml', text: 'example' }],
        { headline: 'example' },
      ),
      /Workflows 쓰기 권한/,
    );
  }
});

test('AI jobs that use publishing or provider secrets bind the protected Environment', () => {
  const directory = new URL('../workflows/', import.meta.url);
  const workflows = readdirSync(directory).filter((name) =>
    /^ai-development.*\.yml$/.test(name),
  );
  let jobs = 0;
  for (const name of workflows) {
    const text = readFileSync(new URL(name, directory), 'utf8');
    for (const role of ['pipeline', 'complete-ci']) {
      const job = text.match(
        new RegExp(`\\n  ${role}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:|$)`),
      );
      if (!job) continue;
      jobs++;
      assert.match(job[1], /environment: ai-development/);
    }
  }
  assert.equal(jobs, 2);
});
