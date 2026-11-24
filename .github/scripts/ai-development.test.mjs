import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NeedsHuman,
  runPipeline,
  reconcile,
  pullMarker,
  wakeDependents,
} from './ai-development/engine.mjs';
import { createGitHub, waitForCI } from './ai-development/github.mjs';
import {
  createModels,
  validateDevelopment,
  validateReview,
} from './ai-development/models.mjs';
import { resolveEdits } from './ai-development/workspace.mjs';
import { config } from './ai-development/config.mjs';

function createTestGitHub(options) {
  return createGitHub({
    ...options,
    async request(url, init) {
      const path = url.replace('https://api.github.com/repos/owner/repo', '');
      if (path === '') return Response.json({ owner: { type: 'User' } });
      if (path === '/actions/secrets?per_page=1')
        return Response.json({ total_count: 0, secrets: [] });
      if (path === '/environments/ai-development')
        return Response.json({
          name: 'ai-development',
          deployment_branch_policy: {
            protected_branches: false,
            custom_branch_policies: true,
          },
        });
      if (
        path ===
        '/environments/ai-development/deployment-branch-policies?per_page=100'
      )
        return Response.json({
          total_count: 1,
          branch_policies: [{ name: 'dev', type: 'branch' }],
        });
      if (path === '/environments/ai-development/secrets?per_page=100')
        return Response.json({
          secrets: [
            'OPENAI_API_KEY',
            'ANTHROPIC_API_KEY',
            'AI_AUTOMATION_TOKEN',
          ].map((name) => ({ name })),
        });
      if (path === '/environments?per_page=100')
        return Response.json({
          total_count: 1,
          environments: [{ name: 'ai-development' }],
        });
      return options.request(url, init);
    },
  });
}

const base = 'a'.repeat(40);
const heads = ['b', 'c', 'd', '1', '2', '3', '4', '5'].map((char) =>
  char.repeat(40),
);
const mergeCommit = 'e'.repeat(40);
const pass = { status: 'pass', findings: [], summary: '통과' };

test('dependency follow-up uses the same setup-node pin as the development workflow', () => {
  const pin = (filename) =>
    readFileSync(
      new URL(`../workflows/${filename}`, import.meta.url),
      'utf8',
    ).match(/uses: actions\/setup-node@([a-f0-9]{40})\b/)?.[1];
  const expected = pin('ai-development.yml');
  assert(expected);
  assert.equal(pin('ai-development-dependencies.yml'), expected);
});
const changes = (defect = '잘못된 값', line = 3) => ({
  status: 'changes_requested',
  summary: '수정 필요',
  findings: [
    {
      path: 'src/math.ts',
      line,
      defect,
      impact: '잘못된 결과',
      evidence: '빈 입력',
      fix: '기본값 추가',
    },
  ],
});

function fixture({
  label = 'ai:develop',
  results = [pass],
  ci = { ok: true, url: 'https://github.com/ci' },
} = {}) {
  const data = {
    issue: {
      number: 13,
      title: 'Fix math',
      body: 'Use the expected value',
      state: 'open',
      labels: [{ name: label }],
    },
    record: null,
    remote: null,
    pull: null,
    commits: [],
    events: [],
    notes: new Map(),
    reviews: new Map(),
    reviewChecks: [],
    readyRequests: [],
    mergeRequests: [],
  };
  const github = {
    issue: async () => structuredClone(data.issue),
    previewRequested: async () => false,
    previewCheck: async () => data.previewCheck,
    blockedBy: async () => [],
    hasMergedClosingPull: async () => false,
    hasActiveDevelopment: async () => false,
    loadState: async () => structuredClone(data.record),
    saveState: async (_, state) => {
      data.record = { id: 290, state: structuredClone(state) };
      data.events.push(state.status);
      return 290;
    },
    ref: async (branch) =>
      branch === 'dev' ? (data.base ?? base) : data.remote,
    findPull: async () => (data.pull ? [structuredClone(data.pull)] : []),
    async createBranch(_, sha, beforeWrite) {
      await beforeWrite();
      assert.equal(data.remote, null);
      data.remote = sha;
    },
    async commit(_, parent, files, message, beforeWrite) {
      await beforeWrite();
      assert.equal(parent, data.remote);
      const sha = heads[data.commits.length];
      data.remote = sha;
      if (data.pull) data.pull.head = sha;
      data.commits.push({ sha, parent, files, message });
      if (data.loseCommitResponse) {
        data.loseCommitResponse = false;
        throw new Error('응답 확인 불가');
      }
      return sha;
    },
    isOperation: async (sha, parent, op) =>
      data.commits.some(
        (commit) =>
          commit.sha === sha &&
          commit.parent === parent &&
          commit.message.body.includes(op),
      ),
    matchesCreatedPull: (pr, state) => pr.body === pullMarker(state.issue),
    createPull: async (state, _, beforeWrite) => {
      await beforeWrite();
      assert.equal(data.pull, null);
      data.pull = {
        number: 99,
        node_id: 'PR_fixture',
        title: state.title,
        body: pullMarker(state.issue),
        draft: true,
        state: 'open',
        base: 'dev',
        head: state.head,
      };
      if (data.losePullResponse) {
        data.losePullResponse = false;
        throw new Error('PR 응답 확인 불가');
      }
      return structuredClone(data.pull);
    },
    pull: async () => structuredClone(data.pull),
    pullAtHead: async () => structuredClone(data.pull),
    pullAfterMerge: async () => structuredClone(data.pull),
    changesAutomationPolicy: async () => false,
    matchesPull: (
      pr,
      state,
      baseRef,
      { allowReady = false, merged = false } = {},
    ) =>
      (merged
        ? pr.merged === true
        : pr.state === 'open' && (allowReady || pr.draft)) &&
      pr.base === baseRef &&
      pr.head === state.head,
    async markReady(id, head) {
      assert.equal(data.pull.node_id, id);
      assert.equal(data.pull.head, head);
      data.readyRequests.push(head);
      if (data.blockReady) return false;
      data.pull.draft = false;
      return true;
    },
    async closeIssue() {
      if (data.failClose) throw new Error('Issue close failed');
      Object.assign(data.issue, { state: 'closed', state_reason: 'completed' });
    },
    async squashMerge(state, baseRef, beforeWrite) {
      await beforeWrite();
      assert.equal(baseRef, 'dev');
      assert.equal(state.pull, data.pull.number);
      assert.equal(state.head, data.pull.head);
      assert.equal(data.pull.draft, false);
      data.mergeRequests.push(state.head);
      Object.assign(data.pull, {
        state: 'closed',
        merged: true,
        merge_commit_sha: mergeCommit,
      });
      data.issue.state = 'closed';
      data.base = mergeCommit;
      data.remote = null;
      if (data.loseMergeResponse) throw new Error('머지 응답 확인 불가');
      return mergeCommit;
    },
    baseAdvanced: async () => true,
    async advanceEmptyBranch(state, current, beforeWrite) {
      await beforeWrite();
      assert.equal(data.remote, state.head);
      assert.equal(data.pull, null);
      data.remote = current;
    },
    dispatchBaseRecovery: async (issue, ref, id) => {
      data.events.push({ recovery: id, issue, ref });
    },
    async updateBranch(state, beforeWrite) {
      await beforeWrite();
      assert.equal(state.head, data.pull.head);
      const sha = heads[data.commits.length];
      data.commits.push({ sha, parent: state.head, mergedBase: data.base });
      data.remote = sha;
      data.pull.head = sha;
      if (data.loseRefreshResponse) {
        data.loseRefreshResponse = false;
        throw new Error('갱신 응답 확인 불가');
      }
      return { head: sha, base: data.base };
    },
    mergedRefreshBase: async ({ head: previous, pendingRefresh }, sha) =>
      data.commits.find(
        (commit) =>
          commit.sha === sha &&
          commit.parent === previous &&
          commit.mergedBase === pendingRefresh,
      )?.mergedBase ?? null,
    async notice(number, message, key) {
      data.notes.set(`${number}:${key}`, message);
    },
    async publishReview(_, entry, reviewer) {
      data.reviews.set(entry.head, { entry, reviewer });
    },
    async setReviewCheck(_, check) {
      data.reviewChecks.push(check);
    },
  };
  const options = {
    github,
    config,
    issueNumber: 13,
    eventLabel: label,
    runId: 100,
    attempt: 1,
    async develop({ developer, feedback }) {
      data.events.push({ developer, feedback });
      return {
        title: '🐛 계산: 빈 값 수정',
        summary: '기본값 처리',
        changes: [{ path: 'src/math.ts', text: 'updated' }],
      };
    },
    async review({ reviewer, state }) {
      data.events.push({ reviewer, head: state.head });
      return results[state.reviews.length];
    },
    async recheckCI(state, guard) {
      await guard();
      return { ok: true };
    },
    async checkCI(state, guard) {
      await guard();
      data.events.push({ ci: state.head });
      return ci;
    },
    verifyConfiguration() {},
  };
  return {
    data,
    github,
    options,
    run: (overrides) => runPipeline({ ...options, ...overrides }),
  };
}

test('AI review is tracked per commit independently of the required CI result', async () => {
  const scenarios = [
    {
      result: pass,
      ci: { ok: false, reason: 'CI 승인 필요' },
      decision: 'success',
    },
    { result: { ...pass, status: 'needs_human' }, decision: 'action_required' },
    { decision: 'failure' },
  ];
  for (const { result, ci, decision } of scenarios) {
    const { data, run } = fixture({ ci });
    await run({
      async review() {
        if (!result) throw new Error('review provider failed');
        return result;
      },
    });
    assert.deepEqual(
      data.reviewChecks,
      ['queued', 'in_progress', decision].map((value) => ({
        head: heads[0],
        decision: value,
      })),
    );
    assert.deepEqual(data.mergeRequests, []);
  }
});

test('review check updates its own GitHub check and creates a new run when resumed', async () => {
  const head = heads[0];
  const calls = [];
  const github = createGitHub({
    repository: 'owner/repo',
    token: 'workflow-token',
    async request(url, init) {
      const path = new URL(url).pathname;
      assert.equal(init.headers.authorization, 'Bearer workflow-token');
      const body = init.body && JSON.parse(init.body);
      calls.push({ path, method: init.method, body });
      if (init.method === 'GET') {
        return Response.json({
          check_runs: [
            {
              id: 17,
              app: { slug: 'another-app' },
              name: 'AI review',
              external_id: `commit-trail-ai-review:13:${head}`,
              head_sha: head,
            },
          ],
        });
      }
      return Response.json({ id: 29, status: body.status });
    },
  });
  for (const decision of ['queued', 'in_progress', 'action_required', 'queued'])
    await github.setReviewCheck({ issue: 13 }, { head, decision });
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['GET', 'POST', 'PATCH', 'PATCH', 'POST'],
  );
  assert.equal(calls[1].body.head_sha, head);
  assert.match(calls[2].path, /\/check-runs\/29$/);
  assert.equal(calls[3].body.status, 'completed');
  assert.equal(calls[3].body.conclusion, 'action_required');
  assert.equal(calls[4].body.status, 'queued');
});

test('default Codex development and Claude review squash merge only after CI', async () => {
  const { data, run } = fixture();
  const state = await run();
  assert.equal(state.status, 'merged');
  assert.equal(state.mergeCommit, mergeCommit);
  assert.equal(state.branch, 'ai/issue-13-codex');
  assert.equal(state.pull, 99);
  assert.equal(data.pull.draft, false);
  assert.deepEqual(data.readyRequests, [heads[0]]);
  assert.deepEqual(data.mergeRequests, [heads[0]]);
  assert.match(
    data.commits[0].message.body,
    /Co-authored-by: Codex <noreply@openai\.com>/,
  );
  assert.deepEqual(
    data.events.filter((event) => typeof event === 'object'),
    [
      { developer: 'codex', feedback: undefined },
      { reviewer: 'claude', head: heads[0] },
      { ci: heads[0] },
    ],
  );
  assert.match(data.notes.get(`99:ready-${heads[0]}`), new RegExp(heads[0]));
  await run({ runId: 115 });
  assert.equal(data.commits.length, 1);
  assert.equal(data.reviews.size, 1);
});

test('a developer blocker explains the stop on the Issue without starting review', async () => {
  const { data, run } = fixture();
  const detail =
    '댓글 요청에는 검토할 변경이 없습니다. @example\n<!-- model text -->';
  const state = await run({
    async develop() {
      throw new NeedsHuman('사용자 판단이 필요합니다.', detail);
    },
  });
  assert.equal(state.status, 'needs_human');
  assert.equal(data.record.state.detail, detail);
  assert.equal(data.pull, null);
  assert.equal(data.reviews.size, 0);
  // The stop is announced once in its own comment, without the model-supplied detail.
  assert.deepEqual([...data.notes.keys()], ['13:stop-100-1']);
  assert.match(data.notes.get('13:stop-100-1'), /needs_human/);
  assert.match(data.notes.get('13:stop-100-1'), /사용자 판단이 필요합니다/);
  assert.doesNotMatch(data.notes.get('13:stop-100-1'), /@example/);

  let body;
  const github = createTestGitHub({
    repository: 'owner/repo',
    token: 'mock',
    async request(_url, options) {
      ({ body } = JSON.parse(options.body));
      return Response.json({ id: 1 });
    },
  });
  await github.saveState(13, state);
  assert.match(
    body,
    /개발 에이전트가 보고한 사유 · 댓글 요청에는 검토할 변경이 없습니다/,
  );
  assert.doesNotMatch(body, /@example|<!-- model text -->/);
});

test('Claude revises the existing PR using Codex feedback', async () => {
  const issue = changes();
  const { data, run } = fixture({
    label: 'ai:develop:claude',
    results: [issue, pass],
  });
  const state = await run();
  assert.equal(state.status, 'merged');
  assert.equal(state.pull, 99);
  assert.equal(state.head, heads[1]);
  assert.deepEqual(data.mergeRequests, [heads[1]]);
  assert.deepEqual(data.reviewChecks, [
    { head: heads[0], decision: 'queued' },
    { head: heads[0], decision: 'in_progress' },
    { head: heads[0], decision: 'neutral' },
    { head: heads[1], decision: 'queued' },
    { head: heads[1], decision: 'in_progress' },
    { head: heads[1], decision: 'success' },
  ]);
  assert.equal(data.commits.length, 2);
  assert.deepEqual(
    data.events.filter((item) => item?.developer),
    [
      { developer: 'claude', feedback: undefined },
      { developer: 'claude', feedback: issue },
    ],
  );
  assert.deepEqual(
    [...data.reviews.values()].map(({ reviewer }) => reviewer),
    ['codex', 'codex'],
  );
});

test('three different reviews and an unchanged finding stop at their respective bounds', async () => {
  const exhausted = fixture({
    results: [changes('일'), changes('이'), changes('삼')],
  });
  assert.equal((await exhausted.run()).status, 'needs_human');
  assert.equal(exhausted.data.commits.length, 3);
  assert.equal(exhausted.data.reviews.size, 3);
  const repeated = fixture({
    results: [changes('빈 값.'), changes('빈 값', 18)],
  });
  assert.match((await repeated.run()).reason, /같은 결함/);
  assert.equal(repeated.data.commits.length, 2);
});

test('conflicting labels block startup with a deduplicated notice; unlabeled and manual first runs do no work', async () => {
  const { data, run } = fixture();
  data.issue.labels.push({ name: 'ai:develop:codex' });
  await run();
  await run();
  assert.equal(data.notes.size, 1);
  assert.equal(data.record, null);
  assert.equal(data.commits.length, 0);
  assert.equal(await run({ eventLabel: 'bug' }), undefined);
  await assert.rejects(run({ resume: true }), /최초 실행은 실행 라벨/);
});

test('all explicitly blocked issues must have a merged dev PR before a manual resume can develop', async () => {
  const { data, github, run } = fixture();
  const merged = new Set([11]);
  github.blockedBy = async () => [
    { number: 11, local: true },
    { number: 12, local: true },
  ];
  github.hasMergedClosingPull = async (number, base) => {
    assert.equal(base, 'dev');
    return merged.has(number);
  };

  const paused = await run();
  assert.equal(paused.status, 'needs_human');
  assert.match(paused.reason, /#12/);
  assert.equal(data.remote, null);
  assert.equal(data.pull, null);
  assert.equal(
    data.events.some((event) => event?.developer),
    false,
  );

  merged.add(12);
  assert.equal((await run({ resume: true, runId: 101 })).status, 'merged');
  assert.equal(data.events.filter((event) => event?.developer).length, 1);
});

test('merged dependencies reserve a waiting run only once and a manual resume consumes it', async () => {
  for (const manualFirst of [false, true]) {
    const { github, data, run } = fixture();
    const merged = new Set([11]);
    const dispatched = [];
    github.blockedBy = async () => [
      { number: 11, local: true },
      { number: 12, local: true },
    ];
    github.hasMergedClosingPull = async (issue) => merged.has(issue);
    github.closingIssues = async (pr) => [pr === 31 ? 11 : 12];
    github.blocking = async () => [
      { number: 13, local: true },
      { number: 13, local: true },
    ];
    github.dispatchDependencyResume = async (issue, base, reservation) =>
      dispatched.push({ issue, base, reservation });
    await run();
    assert.equal(data.record.state.waitingForDependencies, true);
    await wakeDependents(github, { number: 31, sha: mergeCommit }, 'dev');
    assert.deepEqual(dispatched, []);
    merged.add(12);
    data.issue.labels.push({ name: 'ai:stop' });
    await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
    assert.deepEqual(dispatched, []);
    data.issue.labels.pop();
    github.hasActiveDevelopment = async () => true;
    await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
    assert.deepEqual(dispatched, []);
    github.hasActiveDevelopment = async () => false;
    await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
    await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
    assert.equal(dispatched.length, 1);
    const { issue, base, reservation } = dispatched[0];
    assert.deepEqual({ issue, base }, { issue: 13, base: 'dev' });
    assert.equal(
      await run({ resume: true, dependencyResume: 'wrong-reservation' }),
      undefined,
    );
    const automatic = {
      resume: true,
      dependencyResume: reservation,
      runId: 101,
    };
    const first = manualFirst ? { resume: true, runId: 101 } : automatic;
    assert.equal((await run(first)).status, 'merged');
    assert.equal(await run(automatic), undefined);
    assert.equal(data.commits.length, 1);
    assert.equal(data.record.state.dependencyDispatch, undefined);
  }
});

test('a chain reserves only the dependent whose immediate predecessor merged', async () => {
  const b = fixture();
  const c = fixture();
  const merged = new Set();
  const dependencies = new Map([
    [13, 12],
    [14, 13],
  ]);
  const blockedBy = async (issue) => [
    { number: dependencies.get(issue), local: true },
  ];
  for (const job of [b, c]) {
    job.github.blockedBy = blockedBy;
    job.github.hasMergedClosingPull = async (issue) => merged.has(issue);
  }
  await b.run();
  await c.run({ issueNumber: 14 });
  const jobs = new Map([
    [13, b],
    [14, c],
  ]);
  const dispatched = [];
  const github = {
    blockedBy,
    hasMergedClosingPull: async (issue) => merged.has(issue),
    closingIssues: async (pr) => (pr === 31 ? [12] : [13]),
    blocking: async (issue) => [{ number: issue + 1, local: true }],
    issue: (issue) => jobs.get(issue).github.issue(issue),
    loadState: (issue) => jobs.get(issue).github.loadState(issue),
    saveState: (issue, state, id) =>
      jobs.get(issue).github.saveState(issue, state, id),
    hasActiveDevelopment: async () => false,
    dispatchDependencyResume: async (issue) => dispatched.push(issue),
  };
  merged.add(12);
  await wakeDependents(github, { number: 31, sha: mergeCommit }, 'dev');
  assert.deepEqual(dispatched, [13]);
  merged.add(13);
  await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
  assert.deepEqual(dispatched, [13, 14]);
});

test('an uncertain dependency dispatch leaves a notice and allows manual resume', async () => {
  const { github, data, run } = fixture();
  let merged = false;
  let attempts = 0;
  github.blockedBy = async () => [{ number: 12, local: true }];
  github.hasMergedClosingPull = async () => merged;
  github.closingIssues = async () => [12];
  github.blocking = async () => [{ number: 13, local: true }];
  github.dispatchDependencyResume = async () => {
    attempts++;
    throw new Error('Response lost');
  };
  await run();
  merged = true;
  await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
  await wakeDependents(github, { number: 32, sha: mergeCommit }, 'dev');
  assert.equal(attempts, 1);
  assert.match(data.record.state.reason, /예약 결과를 확인하지 못했습니다/);
  assert(
    [...data.notes.keys()].some((key) =>
      key.startsWith('13:dependency-dispatch-'),
    ),
  );
  assert.equal((await run({ resume: true, runId: 101 })).status, 'merged');
});

test('dependency API failure does not start development', async () => {
  const { data, github, run } = fixture();
  github.blockedBy = async () => {
    throw new Error('HTTP 403');
  };
  const paused = await run();
  assert.equal(paused.status, 'needs_human');
  assert.match(paused.reason, /Blocked by/);
  assert.equal(data.remote, null);
  assert.equal(
    data.events.some((event) => event?.developer),
    false,
  );
});

test('a dependency added during CI blocks the normal and CI follow-up merge paths', async () => {
  for (const followUp of [false, true]) {
    const { data, github, run } = fixture({
      ci: { ok: false, reason: 'CI 승인 필요' },
    });
    let blocked = false;
    github.blockedBy = async () =>
      blocked ? [{ number: 12, local: true }] : [];
    if (followUp) {
      assert.equal((await run()).awaitingCI, true);
    }
    const state = await run({
      ...(followUp && {
        resume: true,
        runId: 101,
        ciCompletion: { head_sha: heads[0], head_branch: 'ai/issue-13-codex' },
      }),
      async checkCI() {
        blocked = true;
        return { ok: true, url: 'https://github.com/ci' };
      },
    });
    assert.equal(state.status, 'needs_human');
    assert.match(state.reason, /#12/);
    assert.equal(data.pull.draft, true);
    assert.deepEqual(data.mergeRequests, []);
  }
});

test('GitHub dependency lookup paginates and requires a closing PR merged into this repo dev', async () => {
  const calls = [];
  const github = createGitHub({
    repository: 'owner/repo',
    token: 'workflow-token',
    async request(url, init) {
      assert.equal(init.headers.authorization, 'Bearer workflow-token');
      const parsed = new URL(url);
      calls.push(parsed.pathname);
      if (init.method === 'GET') {
        const first = parsed.searchParams.get('page') === '1';
        return Response.json(
          Array.from({ length: first ? 100 : 1 }, (_, index) => ({
            number: first ? index + 1 : 101,
            repository_url: `https://api.github.com/repos/owner/${first ? 'repo' : 'other'}`,
          })),
        );
      }
      const { variables } = JSON.parse(init.body);
      const node = (merged, baseRefName, nameWithOwner = 'owner/repo') => ({
        merged,
        baseRefName,
        baseRepository: { nameWithOwner },
      });
      if (variables.issue === 3)
        return Response.json({ errors: [{ message: 'Unavailable' }] });
      const nodes = variables.after
        ? variables.issue === 2
          ? [node(true, 'dev')]
          : []
        : [
            node(false, 'dev'),
            node(true, 'main'),
            node(true, 'dev', 'owner/other'),
          ];
      return Response.json({
        data: {
          repository: {
            issue: {
              closedByPullRequestsReferences: {
                nodes,
                pageInfo: {
                  hasNextPage: !variables.after,
                  endCursor: 'next-page',
                },
              },
            },
          },
        },
      });
    },
  });
  const dependencies = await github.blockedBy(200);
  assert.equal(dependencies.length, 101);
  assert.deepEqual(dependencies.at(-1), { number: 101, local: false });
  assert.equal(await github.hasMergedClosingPull(1, 'dev'), false);
  assert.equal(await github.hasMergedClosingPull(2, 'dev'), true);
  await assert.rejects(
    github.hasMergedClosingPull(3, 'dev'),
    /could not be verified/,
  );
  assert.equal(calls.length, 7);
});

test('dependency merge lookup trusts only a verified same-repo merge and dispatches to dev', async () => {
  const calls = [];
  const github = createGitHub({
    repository: 'owner/repo',
    token: 'workflow-token',
    async request(url, init) {
      assert.equal(init.headers.authorization, 'Bearer workflow-token');
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      calls.push({ path, body });
      if (path === '/graphql') {
        const { pull, after } = body.variables;
        const local = { nameWithOwner: 'owner/repo' };
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                merged: true,
                baseRefName: pull === 31 ? 'dev' : 'main',
                mergeCommit: { oid: mergeCommit },
                closingIssuesReferences: {
                  nodes: after
                    ? [{ number: 12, repository: local }]
                    : [
                        { number: 11, repository: local },
                        {
                          number: 55,
                          repository: { nameWithOwner: 'owner/other' },
                        },
                      ],
                  pageInfo: { hasNextPage: !after, endCursor: 'next' },
                },
              },
            },
          },
        });
      }
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(
    await github.closingIssues(31, mergeCommit, 'dev'),
    [11, 12],
  );
  await assert.rejects(
    github.closingIssues(32, mergeCommit, 'dev'),
    /could not be verified/,
  );
  await assert.rejects(
    github.closingIssues(31, heads[0], 'dev'),
    /could not be verified/,
  );
  await github.dispatchDependencyResume(13, 'dev', 'reservation');
  assert.deepEqual(calls.at(-1), {
    path: '/repos/owner/repo/actions/workflows/ai-development.yml/dispatches',
    body: {
      ref: 'dev',
      inputs: { issue: '13', dependency_resume: 'reservation' },
    },
  });
});

test('approval removal or reassignment blocks publication and merge', async () => {
  const withdrawn = fixture();
  const first = await withdrawn.run({
    async develop(args) {
      withdrawn.data.issue.labels = [];
      return withdrawn.options.develop(args);
    },
  });
  assert.equal(first.reasonCode, 'approval_changed');
  assert.equal(withdrawn.data.commits.length, 0);

  const reassigned = fixture();
  const second = await reassigned.run({
    async review(args) {
      reassigned.data.issue.labels = [{ name: 'ai:develop:claude' }];
      return reassigned.options.review(args);
    },
  });
  assert.equal(second.reasonCode, 'approval_changed');
  assert.equal(reassigned.data.mergeRequests.length, 0);
});

test('an automation-policy PR reaches review but only a human can merge it', async () => {
  const { data, github, run } = fixture();
  github.changesAutomationPolicy = async () => true;
  const state = await run();
  assert.equal(state.status, 'needs_human');
  assert.match(state.reason, /검증 정책을 변경/);
  assert.equal(state.manualPolicyMerge, true);
  assert.equal(data.reviews.size, 1);
  assert.deepEqual(data.mergeRequests, []);
});

test('the policy comparison covers renamed files and changes to package scripts without blocking dependency updates', async () => {
  let files = [{ filename: 'package.json' }];
  let newTest = 'tsx --test';
  const github = createTestGitHub({
    repository: 'owner/repo',
    token: 'mock',
    async request(url) {
      if (url.includes('/pulls/99/files')) return Response.json(files);
      const sha = new URL(url).searchParams.get('ref');
      const manifest = {
        scripts: { test: sha === base ? 'tsx --test' : newTest },
        dependencies: sha === base ? {} : { react: '19.0.0' },
      };
      return Response.json({
        encoding: 'base64',
        content: Buffer.from(JSON.stringify(manifest)).toString('base64'),
      });
    },
  });
  const state = { pull: 99, base, head: heads[0] };
  const pr = { changed_files: 1 };
  assert.equal(await github.changesAutomationPolicy(state, pr), false);
  newTest = 'echo passed';
  assert.equal(await github.changesAutomationPolicy(state, pr), true);
  files = [
    { filename: 'docs/ci.yml', previous_filename: '.github/workflows/ci.yml' },
  ];
  assert.equal(await github.changesAutomationPolicy(state, pr), true);
});

test('a failed last-minute CI recheck keeps the current HEAD waiting', async () => {
  const { data, run } = fixture();
  const state = await run({
    recheckCI: async () => ({
      ok: false,
      failed: true,
      status: 'failure',
      reason: 'Build failed',
    }),
  });
  assert.equal(state.awaitingCI, true);
  assert.equal(state.ciFailed, true);
  assert.equal(state.reasonCode, 'failure');
  assert.deepEqual(data.mergeRequests, []);
});

test('model budget reservations survive failed runs and block additional calls', async () => {
  const { data, run } = fixture();
  let calls = 0;
  const develop = async ({ reserveModel }) => {
    await reserveModel();
    calls++;
    throw new Error('deliberate interruption');
  };
  const limits = { ...config, maxModelSessions: 1 };
  assert.equal((await run({ config: limits, develop })).status, 'failed');
  assert.equal(data.record.state.modelSessions, 1);
  const resumed = await run({ config: limits, develop, resume: true });
  assert.equal(resumed.reasonCode, 'model_budget_exhausted');
  assert.equal(calls, 1);
  assert.equal(data.commits.length, 0);
});

test('a preview-labeled Issue requires both a successful preview and a human confirmation for the current head', async () => {
  const { data, run } = fixture();
  data.issue.labels.push({ name: 'preview' });
  assert.equal((await run()).status, 'awaiting_preview');
  assert.equal(data.pull.draft, true);
  assert.equal(
    (await run({ resume: true, previewApprovedHead: heads[0] })).status,
    'awaiting_preview',
  );
  data.previewCheck = { conclusion: 'success' };
  data.record.state.status = 'needs_human';
  data.record.state.reason = 'Different blocker';
  await assert.rejects(
    run({ resume: true, previewApprovedHead: heads[1] }),
    /SHA가 현재 PR HEAD/,
  );
  assert.equal(data.record.state.status, 'needs_human');
  assert.equal(data.record.state.reason, 'Different blocker');
  assert.equal((await run({ resume: true })).status, 'awaiting_preview');
  assert.equal(
    (await run({ resume: true, previewApprovedHead: heads[0] })).status,
    'merged',
  );
  assert.deepEqual(data.mergeRequests, [heads[0]]);
});

test('a base refresh drops the preview confirmation and requires approval for the new head', async () => {
  const { data, run } = fixture({ results: [pass, pass] });
  data.issue.labels.push({ name: 'preview' });
  await run();
  data.previewCheck = { conclusion: 'success' };
  data.base = 'f'.repeat(40);
  const state = await run({ resume: true, previewApprovedHead: heads[0] });
  assert.equal(state.status, 'awaiting_preview');
  assert.equal(state.head, heads[1]);
  assert.deepEqual(data.mergeRequests, []);
  assert.equal(
    (await run({ resume: true, previewApprovedHead: heads[1] })).status,
    'merged',
  );
});

test('approval wait pauses merging and resumes CI without repeating the same review', async () => {
  const { data, run } = fixture({ ci: { ok: false, reason: 'CI 승인 필요' } });
  assert.equal((await run()).status, 'needs_human');
  // Only the stop is announced; the PR has no ready notice yet.
  assert.deepEqual([...data.notes.keys()], ['13:stop-100-1']);
  assert.match(data.notes.get('13:stop-100-1'), /CI 승인 필요/);
  assert.equal(data.mergeRequests.length, 0);
  const state = await run({
    resume: true,
    runId: 101,
    checkCI: async () => ({ ok: true, url: 'https://github.com/ci' }),
  });
  assert.equal(state.status, 'merged');
  assert.equal(data.events.filter((item) => item?.reviewer).length, 1);
  assert.equal((await run({ resume: true, runId: 102 })).status, 'merged');
  assert.deepEqual(data.mergeRequests, [heads[0]]);
  assert.deepEqual(
    [...data.notes.keys()],
    ['13:stop-100-1', `99:ready-${heads[0]}`],
  );
});

test('CI completion merges the verified PR without a manual run or another review', async () => {
  const { data, github, run } = fixture({
    ci: { ok: false, reason: 'CI 승인 필요' },
  });
  assert.equal((await run()).status, 'needs_human');
  assert.equal(data.record.state.awaitingCI, true);
  assert.equal(data.pull.draft, true);
  const completion = {
    github,
    config,
    issueNumber: 13,
    resume: true,
    ciCompletion: { head_sha: heads[0], head_branch: 'ai/issue-13-codex' },
    runId: 101,
    attempt: 1,
    checkCI: async () => ({ ok: true, url: 'https://github.com/ci' }),
  };
  assert.equal(
    await runPipeline({
      ...completion,
      ciCompletion: { ...completion.ciCompletion, head_sha: heads[1] },
    }),
    undefined,
  );
  assert.equal(data.readyRequests.length, 0);
  assert.equal((await runPipeline(completion)).status, 'merged');
  assert.equal(data.record.state.awaitingCI, undefined);
  assert.equal(data.pull.draft, false);
  assert.deepEqual(data.readyRequests, [heads[0]]);
  assert.equal(data.events.filter((item) => item?.reviewer).length, 1);
  assert.equal(await runPipeline(completion), undefined);
  assert.equal((await run({ resume: true })).status, 'merged');
  assert.deepEqual(data.mergeRequests, [heads[0]]);
  assert.equal(data.readyRequests.length, 1);
});

test('a successful CI event cannot merge a stopped or manually changed PR', async () => {
  for (const mutate of [
    (data) => {
      data.issue.labels.push({ name: 'ai:stop' });
    },
    (data) => {
      data.remote = heads[1];
      data.pull.head = heads[1];
    },
    (data) => {
      data.pull.base = 'main';
    },
  ]) {
    const { data, run } = fixture({
      ci: { ok: false, reason: 'CI 승인 필요' },
    });
    await run();
    mutate(data);
    const state = await run({
      resume: true,
      ciCompletion: { head_sha: heads[0], head_branch: 'ai/issue-13-codex' },
      checkCI: async () => ({ ok: true }),
    });
    assert.equal(state.status, 'needs_human');
    assert.equal(state.awaitingCI, undefined);
    assert.equal(data.pull.draft, true);
    assert.equal(data.readyRequests.length, 0);
    assert.equal(data.mergeRequests.length, 0);
  }
});

test('a Draft conversion denied by GitHub leaves manual instructions after successful checks', async () => {
  const { data, run } = fixture();
  data.blockReady = true;
  const state = await run();
  assert.equal(state.status, 'needs_human');
  assert.equal(data.pull.draft, true);
  assert.match(state.reason, /Ready for review/);
  assert.equal(data.mergeRequests.length, 0);
});

test('a lost merge response is reconciled without attempting a second merge', async () => {
  const { data, github, run } = fixture();
  data.loseMergeResponse = true;
  assert.equal((await run()).status, 'merged');
  assert.equal(data.record.state.mergeCommit, mergeCommit);
  assert.equal(data.issue.state, 'closed');

  data.record.state.status = 'merging';
  delete data.record.state.mergeCommit;
  await reconcile(
    github,
    {
      display_title: 'AI development for Issue #13',
      id: 100,
      run_attempt: 1,
      conclusion: 'cancelled',
    },
    config.base,
  );
  assert.equal(data.record.state.status, 'merged');
  assert.equal(data.record.state.mergeCommit, mergeCommit);
  assert.equal((await run({ resume: true })).status, 'merged');
  assert.deepEqual(data.mergeRequests, [heads[0]]);
});

test('a closed or manually edited PR stops without overwriting changes', async () => {
  for (const change of [
    (data) => {
      data.pull.state = 'closed';
    },
    (data) => {
      data.pull.title = 'Manual edit';
    },
    (data) => {
      data.pull.draft = false;
    },
  ]) {
    const { data, run, options } = fixture({ results: [changes()] });
    const state = await run({
      async review(args) {
        change(data);
        return options.review(args);
      },
    });
    assert.equal(state.status, 'needs_human');
    assert.equal(data.commits.length, 1);
    assert.equal(data.reviews.size, 0);
  }
});

test('CI completion reserves one recovery and rechecks only the new HEAD', async () => {
  const newerDev = 'f'.repeat(40);
  const { data, github, run } = fixture({
    results: [pass, pass],
    ci: { ok: false, reason: 'CI 승인 필요' },
  });
  // Issue A passes review, then leaves the queue while it waits for CI.
  assert.equal((await run()).status, 'needs_human');
  assert.equal(data.record.state.awaitingCI, true);
  // Another Issue merges into dev before the CI of A completes.
  data.base = newerDev;
  const completion = await runPipeline({
    github,
    config,
    issueNumber: 13,
    resume: true,
    ciCompletion: { head_sha: heads[0], head_branch: 'ai/issue-13-codex' },
    runId: 101,
    attempt: 1,
    checkCI: async () => ({ ok: true, url: 'https://github.com/ci' }),
  });
  assert.equal(completion.status, 'recovering_base');
  assert.equal(completion.awaitingCI, undefined);
  assert.deepEqual(
    data.events.filter((item) => item?.recovery),
    [{ issue: 13, ref: 'dev', recovery: completion.baseRecovery }],
  );
  const duplicate = {
    resume: true,
    ciCompletion: { head_sha: heads[0], head_branch: 'ai/issue-13-codex' },
  };
  assert.equal(await run(duplicate), undefined);
  assert.equal(data.mergeRequests.length, 0);
  assert.equal(data.commits.length, 1);

  const recovery = { resume: true, baseRecovery: completion.baseRecovery };
  const state = await run({
    ...recovery,
    runId: 102,
    checkCI: async (current, guard) => {
      await guard();
      data.events.push({ ci: current.head });
      return { ok: true, url: 'https://github.com/ci' };
    },
  });
  assert.equal(state.status, 'merged');
  assert.equal(await run(recovery), undefined);
  assert.equal(await run(duplicate), undefined);
  assert.equal(state.base, newerDev);
  assert.deepEqual(data.commits[1], {
    sha: heads[1],
    parent: heads[0],
    mergedBase: newerDev,
  });
  assert.deepEqual(
    data.events.filter((item) => item?.reviewer).map(({ head }) => head),
    [heads[0], heads[1]],
  );
  assert.deepEqual(
    data.events.filter((item) => item?.ci).map(({ ci }) => ci),
    [heads[0], heads[1]],
  );
  assert.deepEqual(data.mergeRequests, [heads[1]]);
});

test('a dev change before anything is published restarts from the new dev', async () => {
  const newerDev = 'f'.repeat(40);
  const { data, run } = fixture();
  await run({
    async develop() {
      throw new NeedsHuman('사용자 판단이 필요합니다.');
    },
  });
  data.base = newerDev;
  const state = await run({ resume: true, runId: 101 });
  assert.equal(state.status, 'merged');
  assert.equal(state.base, newerDev);
  assert.equal(data.commits[0].parent, newerDev);
  assert.equal(data.commits.length, 1);
});

test('a stale development plan is discarded before the first publication', async () => {
  const newerDev = 'f'.repeat(40);
  const { data, options, run } = fixture();
  const bases = [];
  const state = await run({
    async develop(args) {
      bases.push(args.state.base);
      const plan = await options.develop(args);
      if (args.state.base === base) {
        data.base = newerDev;
        plan.changes[0].text = 'stale candidate';
      }
      return plan;
    },
  });
  assert.equal(state.status, 'merged');
  assert.deepEqual(bases, [base, newerDev]);
  assert.equal(state.unpublishedRestarts, 1);
  assert.equal(data.commits.length, 1);
  assert.equal(data.commits[0].parent, newerDev);
  assert.equal(data.commits[0].files[0].text, 'updated');
});

test('a published empty branch fast-forwards before developing again', async () => {
  const { data, github, run } = fixture();
  const createBranch = github.createBranch;
  const newerDev = 'f'.repeat(40);
  github.createBranch = async (...args) => {
    await createBranch(...args);
    data.base = newerDev;
  };
  const state = await run();
  assert.equal(state.status, 'merged');
  assert.equal(state.baseRefreshes, 1);
  assert.equal(state.unpublishedRestarts, undefined);
  assert.equal(data.commits.length, 1);
  assert.equal(data.commits[0].parent, newerDev);
  assert.equal(data.events.filter((item) => item?.developer).length, 2);
});

test('a dev change after committing or just before creating the PR preserves the commit', async () => {
  for (const stage of ['commit', 'findPull']) {
    const { data, github, run } = fixture();
    const execute = github[stage];
    const newerDev = 'f'.repeat(40);
    github[stage] = async (...args) => {
      const result = await execute(...args);
      if (data.commits.length === 1) data.base = newerDev;
      return result;
    };
    const state = await run();
    assert.equal(state.status, 'merged');
    assert.equal(state.baseRefreshes, 1);
    assert.equal(data.commits.length, 2);
    assert.equal(data.commits[1].mergedBase, newerDev);
    assert.deepEqual([...data.reviews.keys()], [heads[1]]);
    assert.deepEqual(data.mergeRequests, [heads[1]]);
    assert.equal(data.events.filter((item) => item?.developer).length, 1);
  }
});

test('a base change during the final merge request triggers fresh checks', async () => {
  const { data, github, run } = fixture({ results: [pass, pass] });
  const merge = github.squashMerge;
  const newerDev = 'f'.repeat(40);
  github.squashMerge = (...args) => {
    data.base = newerDev;
    return merge(...args);
  };
  assert.equal((await run()).status, 'merged');
  assert.deepEqual([...data.reviews.keys()], [heads[0], heads[1]]);
  assert.deepEqual(data.mergeRequests, [heads[1]]);
  assert.deepEqual(data.readyRequests, [heads[0]]);
});

test('both recovery budgets persist across manual resume', async () => {
  const newer = ['f', '6', '7'].map((char) => char.repeat(40));
  const unpublished = fixture();
  let developmentCalls = 0;
  const develop = async (args) => {
    unpublished.data.base = newer[developmentCalls++];
    return unpublished.options.develop(args);
  };
  const early = await unpublished.run({ develop });
  assert.equal(early.status, 'needs_human');
  assert.equal(early.unpublishedRestarts, 1);
  assert.equal(unpublished.data.remote, null);
  assert.equal(
    (await unpublished.run({ resume: true, develop })).status,
    'needs_human',
  );
  assert.equal(developmentCalls, 2);

  const published = fixture({ results: [pass, pass, pass] });
  let ciCalls = 0;
  const late = await published.run({
    checkCI: async () => {
      published.data.base = newer[ciCalls++];
      return { ok: true };
    },
  });
  assert.equal(late.status, 'needs_human');
  assert.equal(late.baseRefreshes, 2);
  assert.equal((await published.run({ resume: true })).status, 'needs_human');
  assert.deepEqual(published.data.mergeRequests, []);
  assert.equal(published.data.commits.length, 3);
});

test('a failed CI can schedule recovery and a stopped or manually resumed Issue consumes it at most once', async () => {
  for (const stop of [false, true]) {
    const { data, run } = fixture({ results: [pass, pass] });
    const failure = {
      resume: true,
      ciCompletion: {
        head_sha: heads[0],
        head_branch: 'ai/issue-13-codex',
        conclusion: 'failure',
      },
      checkCI: async () => ({ ok: false, failed: true, reason: 'CI failed' }),
    };
    await run({ checkCI: failure.checkCI });
    assert.equal(data.record.state.ciFailed, true);
    data.base = 'f'.repeat(40);
    const reserved = await run(failure);
    assert.equal(reserved.status, 'recovering_base');
    assert.equal(await run(failure), undefined);
    const automatic = { resume: true, baseRecovery: reserved.baseRecovery };
    if (stop) {
      data.issue.labels.push({ name: 'ai:stop' });
      assert.equal((await run(automatic)).status, 'needs_human');
      assert.equal(data.commits.length, 1);
    } else {
      assert.equal((await run({ resume: true })).status, 'merged');
      assert.equal(data.commits.length, 2);
    }
    assert.equal(await run(automatic), undefined);
    assert.equal(data.events.filter((item) => item?.recovery).length, 1);
  }
});

test('an unconfirmed commit or PR is retried only after verifying the unchanged HEAD', async () => {
  for (const method of ['commit', 'createPull']) {
    const { data, github, run } = fixture();
    let calls = 0;
    const original = github[method];
    github[method] = async (...args) => {
      if (++calls === 1) throw new Error('response lost');
      return original(...args);
    };
    assert.equal((await run()).status, 'failed');
    data.base = 'f'.repeat(40);
    const resumed = await run({ resume: true });
    assert.equal(resumed.status, 'needs_human');
    assert.match(resumed.reason, /결과를 확인할 수 없습니다/);
    assert.equal(calls, 1);
    assert.equal(data.reviews.size, 0);
    const wrongHead = await run({ resume: true, confirmedHead: heads[5] });
    assert.equal(wrongHead.status, 'needs_human');
    assert.equal(calls, 1);
    const confirmed = await run({
      resume: true,
      confirmedHead: data.remote,
      checkCI: async () => ({ ok: true }),
    });
    assert.equal(confirmed.status, 'merged');
    assert.equal(calls, 2);
  }
});

test('a lost branch refresh response requires confirmation and never repeats the write', async () => {
  const newerDev = 'f'.repeat(40);
  const { data, run } = fixture({
    results: [pass, pass],
    ci: { ok: false, reason: 'CI 승인 필요' },
  });
  await run();
  data.base = newerDev;
  data.loseRefreshResponse = true;
  assert.equal((await run({ resume: true, runId: 101 })).status, 'failed');
  assert.equal(data.record.state.pendingRefresh, newerDev);
  const state = await run({ resume: true, runId: 102 });
  assert.equal(state.status, 'needs_human');
  assert.equal(state.baseRefreshes, 1);
  assert.equal(data.commits.length, 2);
  assert.deepEqual(data.mergeRequests, []);
  const resumed = await run({
    resume: true,
    confirmedHead: data.remote,
    checkCI: async () => ({ ok: true }),
  });
  assert.equal(resumed.status, 'merged');
  assert.equal(resumed.pendingRefresh, undefined);
  assert.equal(resumed.baseRefreshes, 1);
  assert.equal(data.commits.length, 2);
  assert.deepEqual(data.mergeRequests, [heads[1]]);
});

test('a lost commit or PR response is recovered on explicit resume without double publication', async () => {
  for (const flag of ['loseCommitResponse', 'losePullResponse']) {
    const { data, run } = fixture();
    data[flag] = true;
    assert.equal((await run()).status, 'failed');
    assert.equal((await run({ resume: true, runId: 101 })).status, 'merged');
    assert.equal(data.commits.length, 1);
    assert.equal(data.events.filter((item) => item?.developer).length, 1);
    assert.equal(data.pull.number, 99);
  }
});

test('cleanup stops only the matching reserved recovery that failed before startup', async () => {
  const { data, github, run } = fixture({
    results: [pass, pass],
    ci: { ok: false, reason: 'CI approval needed' },
  });
  await run();
  data.base = 'f'.repeat(40);
  const { baseRecovery: reservation } = await run({
    resume: true,
    ciCompletion: { head_sha: heads[0], head_branch: 'ai/issue-13-codex' },
    runId: 101,
  });
  const reservedRun = {
    display_title: `AI development for Issue #13 · base recovery ${reservation}`,
    actor: { login: 'github-actions[bot]' },
    id: 102,
    run_attempt: 1,
    conclusion: 'cancelled',
  };
  await reconcile(
    github,
    { ...reservedRun, actor: { login: 'contributor' } },
    'dev',
  );
  assert.equal(data.record.state.baseRecovery, reservation);
  await reconcile(github, reservedRun, 'dev');
  assert.equal(data.record.state.status, 'needs_human');
  assert.equal(data.record.state.baseRecovery, undefined);
  assert.match(
    data.notes.get('13:stop-102-1'),
    /복구가 시작 상태를 기록하기 전에/,
  );
  assert.equal(
    await run({ resume: true, baseRecovery: reservation }),
    undefined,
  );
  assert.equal(
    (await run({ resume: true, checkCI: async () => ({ ok: true }) })).status,
    'merged',
  );
  await reconcile(github, reservedRun, 'dev');
  assert.equal(data.record.state.status, 'merged');
});

test('a conflicting branch cannot be claimed even after explicit resume', async () => {
  const { data, run } = fixture();
  data.remote = base;
  assert.equal((await run()).status, 'needs_human');
  assert.equal((await run({ resume: true, runId: 101 })).status, 'needs_human');
  assert.equal(data.commits.length, 0);
});

test('a lost review response does not trigger a second charge for the same HEAD', async () => {
  const { data, run } = fixture();
  assert.equal(
    (
      await run({
        review: async () => {
          throw new Error('Provider response timed out');
        },
      })
    ).status,
    'failed',
  );
  assert.equal(data.record.state.reviewInProgress, heads[0]);
  assert.equal((await run({ resume: true, runId: 101 })).status, 'needs_human');
  assert.equal(data.reviews.size, 0);
});

test('manual resume retries a review that exhausted exploration or returned an invalid result', async () => {
  for (const reason of [
    '리뷰 상태와 지적 사항이 일치하지 않거나 결과가 너무 깁니다.',
    'AI의 저장소 탐색 최대 횟수에 도달했습니다. Issue 범위를 좁힌 뒤 수동 재개하세요.',
  ]) {
    const { data, run } = fixture();
    assert.equal(
      (
        await run({
          review: async () => {
            throw new Error(reason);
          },
        })
      ).status,
      'failed',
    );
    assert.equal(data.record.state.reviewInProgress, heads[0]);
    assert.equal(await run(), undefined);

    const state = await run({ resume: true, runId: 101 });
    assert.equal(state.status, 'merged');
    assert.equal(data.commits.length, 1);
    assert.equal(data.reviews.size, 1);
    assert.deepEqual(data.mergeRequests, [heads[0]]);
  }
});

test('an explicitly rejected review can resume after authentication is fixed', async () => {
  const { data, run } = fixture({ label: 'ai:develop:codex' });
  assert.equal(
    (
      await run({
        review: async () => {
          throw Object.assign(new Error('HTTP 401'), { requestRejected: true });
        },
      })
    ).status,
    'failed',
  );
  assert.equal(data.record.state.reviewInProgress, undefined);
  assert.equal((await run({ resume: true, runId: 101 })).status, 'merged');
  assert.equal(data.commits.length, 1);
  assert.equal(data.reviews.size, 1);
});

test('an uncertain initial state write does not repeat the Issue comment or start a second run', async () => {
  const { data, github, run } = fixture();
  const save = github.saveState;
  github.saveState = async (...args) => {
    await save(...args);
    throw new Error('GitHub response was lost');
  };
  await assert.rejects(run(), /response was lost/);
  assert.deepEqual(data.events, ['queued']);
  assert.equal(await run(), undefined);
});

test('cleanup only updates the exact interrupted attempt, and ai:stop halts work', async () => {
  const { data, github, run } = fixture();
  await run({
    async develop() {
      data.issue.labels.push({ name: 'ai:stop' });
      return { changes: [] };
    },
  });
  assert.equal(data.record.state.status, 'needs_human');
  data.record.state.status = 'reviewing';
  const event = {
    display_title: 'AI development for Issue #13',
    id: 100,
    run_attempt: 2,
    conclusion: 'cancelled',
  };
  data.notes.clear();
  await reconcile(github, event, config.base);
  assert.equal(data.record.state.status, 'reviewing');
  assert.equal(data.notes.size, 0);
  await reconcile(github, { ...event, run_attempt: 1 }, config.base);
  assert.equal(data.record.state.status, 'needs_human');
  assert.match(data.notes.get('13:stop-100-1'), /종료 상태를 기록하기 전에/);
});

test('a successful merge leaves no stop notice', async () => {
  const { data, run } = fixture();
  const state = await run();
  assert.equal(state.status, 'merged');
  assert.equal(
    [...data.notes.keys()].some((key) => key.includes(':stop-')),
    false,
  );
});

test('every AI development job shares one queued concurrency group', () => {
  const groups = [
    'ai-development.yml',
    'ai-development-cleanup.yml',
    'ai-development-ci-followup.yml',
  ]
    .map((name) =>
      readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'),
    )
    .flatMap((text) => [
      ...text.matchAll(
        /concurrency:\n\s+group: (.+)\n\s+queue: max\n\s+cancel-in-progress: false/g,
      ),
    ])
    .map((match) => match[1]);
  assert.deepEqual(groups, [
    'ai-development-${{ github.repository }}',
    'ai-development-${{ github.repository }}',
    'ai-development-${{ github.repository }}',
  ]);
});

test('AI follow-up triggers exclude ordinary CI before jobs are queued', () => {
  const cleanup = readFileSync(
    new URL('../workflows/ai-development-cleanup.yml', import.meta.url),
    'utf8',
  );
  const followup = readFileSync(
    new URL('../workflows/ai-development-ci-followup.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    cleanup,
    /workflow_run:\n\s+workflows: \[AI development\]\n\s+branches: \[dev\]\n\s+types: \[completed\]/,
  );
  assert.match(cleanup, /conclusion != 'success'/);
  assert.match(cleanup, /conclusion != 'skipped'/);
  assert.match(cleanup, /run\.mjs --reconcile/);
  assert.doesNotMatch(cleanup, /identify-ci-issue|complete-ci/);
  assert.match(
    followup,
    /workflow_run:\n\s+workflows: \[CI\]\n\s+branches: \['ai\/issue-\*'\]\n\s+types: \[completed\]/,
  );
  assert.match(followup, /workflow_run\.event == 'pull_request'/);
  assert.match(
    followup,
    /contains\(fromJSON\('\["success","failure"\]'\), github\.event\.workflow_run\.conclusion\)/,
  );
  assert.match(
    followup,
    /workflow_run\.head_repository\.full_name == github\.repository/,
  );
  assert.match(
    followup,
    /\^ai\/issue-\(\[1-9\]\[0-9\]\*\)-\(codex\|claude\)\$/,
  );
  assert.match(followup, /ref: refs\/heads\/dev/);
  assert.match(followup, /AI_AUTOMATION_TOKEN:/);
  assert.match(followup, /run\.mjs --complete-ci/);
});

test('provider requests use the configured turn, output and effort budget', async () => {
  const bodies = [];
  const limits = {
    turns: 1,
    reviewTurns: 2,
    outputTokens: 1234,
    edits: 80,
    idleTimeout: 1000,
    requestTimeout: 1000,
    codexEffort: 'high',
  };
  for (const agent of ['codex', 'claude']) {
    const models = createModels({
      keys: { codex: 'openai-mock', claude: 'anthropic-mock' },
      modelNames: config.models,
      limits,
      log() {},
      async request(_url, options) {
        bodies.push(JSON.parse(options.body));
        // Keep asking for a tool so the turn budget is what stops the loop.
        return agent === 'codex'
          ? Response.json({
              status: 'completed',
              output: [
                {
                  type: 'function_call',
                  name: 'read_diff',
                  arguments: '{"line":1}',
                  call_id: 'call_1',
                },
              ],
            })
          : Response.json({
              stop_reason: 'tool_use',
              content: [
                {
                  type: 'tool_use',
                  name: 'read_diff',
                  input: { line: 1 },
                  id: 'toolu_1',
                },
              ],
            });
      },
    });
    await assert.rejects(
      models.run({
        agent,
        mode: 'review',
        instructions: 'review',
        context: 'issue',
        inspect: () => 'diff',
      }),
      /최대 횟수/,
    );
  }
  assert.equal(bodies.length, 4);
  assert.equal(
    bodies.every((body) => body.stream === true),
    true,
  );
  assert.equal(bodies[0].max_output_tokens, 1234);
  assert.equal(bodies[0].reasoning.effort, 'high');
  assert.equal(bodies[2].max_tokens, 1234);
  assert.match(bodies[0].instructions, /including this one: 2/);
  assert.equal(bodies[2].system, bodies[3].system);
  assert.match(bodies[2].messages[0].content, /including this one: 2/);
  assert.match(bodies[1].instructions, /final structured result now/);
  assert.match(
    bodies[3].messages.at(-1).content.at(-1).text,
    /final structured result now/,
  );
  assert.deepEqual(
    bodies.map(({ tools }) => tools.length),
    [4, 4, 4, 4],
  );
  assert.equal(config.limits.turns >= 10, true);
});

test('an incomplete development plan continues in the same conversation before one format correction', async () => {
  const plan = {
    status: 'completed',
    title: '🐛 계산: 빈 값 수정',
    summary: '수정',
    edits: [{ path: 'src/math.ts', before: 'old', after: 'new' }],
  };
  const plans = [
    { ...plan, status: 'in_progress' },
    { ...plan, title: 'invalid' },
    plan,
  ];
  const requests = [];
  const models = createModels({
    keys: { codex: 'mock', claude: 'mock' },
    modelNames: config.models,
    limits: { ...config.limits, turns: 3 },
    log() {},
    async request(_, options) {
      requests.push(JSON.parse(options.body));
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: JSON.stringify(plans.shift()) },
            ],
          },
        ],
      });
    },
  });
  assert.deepEqual(
    await models.run({
      agent: 'codex',
      mode: 'development',
      instructions: 'Develop',
      context: 'Issue',
      inspect: () => '',
    }),
    plan,
  );
  assert.match(requests[1].input.at(-1).content, /No partial edits/);
  assert.match(requests[2].input.at(-1).content, /제목/);
  assert.equal(requests[2].tool_choice, 'none');
});

test('review format correction cannot change existing findings into an approval', async () => {
  const invalid = changes();
  invalid.findings[0].line = 0;
  const results = [invalid, pass];
  const models = createModels({
    keys: { codex: 'mock', claude: 'mock' },
    modelNames: config.models,
    log() {},
    async request() {
      return Response.json({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(results.shift()) }],
      });
    },
  });
  await assert.rejects(
    models.run({
      agent: 'claude',
      mode: 'review',
      instructions: 'Review',
      context: 'Issue',
      inspect: () => '',
    }),
    /형식 교정에서 기존/,
  );
});

test('CI requires the configured job to succeed on the specific PR HEAD', async () => {
  const fake = {
    async ciRun(state, workflow) {
      assert.equal(workflow, 'ci.yml');
      assert.equal(state.head, heads[0]);
      return {
        status: 'completed',
        conclusion: 'success',
        html_url: 'https://github.com/ci',
      };
    },
    ciJobs: async () => [{ name: 'Another job', conclusion: 'success' }],
  };
  const verify = () =>
    waitForCI(fake, config, { head: heads[0] }, () => {}, { attempts: 1 });
  assert.equal((await verify()).ok, false);
  fake.ciJobs = async () => [{ name: 'Test and build', conclusion: 'success' }];
  assert.equal((await verify()).ok, true);
  fake.ciRun = async () => undefined;
  assert.equal((await verify()).ok, false);
});

test('GitHub adapter requires exact CI identity and uses compare-and-swap for publishing', async () => {
  const seen = [];
  const github = createTestGitHub({
    repository: 'owner/repo',
    token: 'app-mock',
    publishingToken: 'pat-mock',
    async request(url, options) {
      seen.push({ url, options });
      return Response.json(
        url.endsWith('graphql')
          ? { data: { createCommitOnBranch: { commit: { oid: heads[0] } } } }
          : {
              workflow_runs: [
                {
                  id: 1,
                  head_sha: heads[1],
                  head_branch: 'ai/issue-13-codex',
                  head_repository: { full_name: 'owner/repo' },
                },
                {
                  id: 2,
                  head_sha: heads[0],
                  head_branch: 'ai/issue-13-codex',
                  head_repository: { full_name: 'fork/repo' },
                },
                {
                  id: 3,
                  head_sha: heads[0],
                  head_branch: 'ai/issue-13-codex',
                  head_repository: { full_name: 'owner/repo' },
                },
              ],
            },
      );
    },
  });
  assert.equal(
    await github.commit(
      'ai/issue-13-codex',
      base,
      [{ path: 'src/a.ts', text: 'hi' }],
      { headline: 'test' },
    ),
    heads[0],
  );
  assert.equal(
    JSON.parse(seen[0].options.body).variables.input.expectedHeadOid,
    base,
  );
  assert.equal(seen[0].options.headers.authorization, 'Bearer pat-mock');
  assert.equal(
    (
      await github.ciRun(
        { branch: 'ai/issue-13-codex', head: heads[0], pull: 99 },
        'ci.yml',
      )
    ).id,
    3,
  );
  assert.equal(seen[1].options.headers.authorization, 'Bearer app-mock');
});

test('GitHub branch refresh publishes with the exact HEAD and returns the merged base', async () => {
  const previous = 'b'.repeat(40);
  const merged = 'c'.repeat(40);
  const dev = 'f'.repeat(40);
  const state = { pull: 99, head: previous, branch: 'ai/issue-13-codex' };
  const requests = [];
  let polls = 0;
  let status = 202;
  const github = createTestGitHub({
    repository: 'owner/repo',
    token: 'workflow-token',
    publishingToken: 'publishing-token',
    sleep: async () => {},
    async request(url, options) {
      requests.push({ url, options });
      if (url.endsWith('/pulls/99/update-branch'))
        return Response.json({ message: 'Updating' }, { status });
      if (url.endsWith('/git/ref/heads/ai/issue-13-codex'))
        return Response.json({
          object: { sha: polls++ ? merged : previous },
        });
      return Response.json({ parents: [{ sha: previous }, { sha: dev }] });
    },
  });
  assert.deepEqual(await github.updateBranch(state), {
    head: merged,
    base: dev,
  });
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(
    requests[0].options.headers.authorization,
    'Bearer publishing-token',
  );
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    expected_head_sha: previous,
  });
  // A commit that is not a merge of the recorded HEAD is never treated as a refresh.
  assert.equal(
    await github.mergedRefreshBase({ ...state, head: dev }, merged, 'dev'),
    null,
  );
  status = 422;
  await assert.rejects(github.updateBranch(state), NeedsHuman);
});

test('GitHub readiness mutation must confirm the reviewed head is no longer a draft', async () => {
  let responseHead = heads[0];
  const github = createTestGitHub({
    repository: 'owner/repo',
    token: 'mock',
    async request(url, options) {
      assert.equal(url, 'https://api.github.com/graphql');
      const query = JSON.parse(options.body);
      assert.match(query.query, /markPullRequestReadyForReview/);
      assert.deepEqual(query.variables.input, { pullRequestId: 'PR_fixture' });
      return Response.json({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { isDraft: false, headRefOid: responseHead },
          },
        },
      });
    },
  });
  assert.equal(await github.markReady('PR_fixture', heads[0]), true);
  responseHead = heads[1];
  assert.equal(await github.markReady('PR_fixture', heads[0]), false);
});

test('GitHub squash merge uses the publishing token and exact reviewed HEAD', async () => {
  const requests = [];
  let conflict = false;
  const options = {
    repository: 'owner/repo',
    token: 'app-mock',
    async request(url, options) {
      requests.push({ url, options });
      return conflict
        ? new Response('', { status: 409 })
        : Response.json({ merged: true, sha: mergeCommit });
    },
  };
  const github = createTestGitHub({ ...options, publishingToken: 'pat-mock' });
  const state = {
    issue: 13,
    pull: 99,
    head: heads[0],
    developer: 'codex',
    title: '🐛 계산: 빈 값 수정',
    summary: '기본값 처리',
    revisionSummary: '경계값 보완',
  };
  await assert.rejects(github.squashMerge(state, 'main'), NeedsHuman);
  await assert.rejects(
    createGitHub(options).squashMerge(state, 'dev'),
    /AI_AUTOMATION_TOKEN/,
  );
  assert.equal(requests.length, 0);

  assert.equal(await github.squashMerge(state, 'dev'), mergeCommit);
  const [request] = requests;
  assert.equal(
    request.url,
    'https://api.github.com/repos/owner/repo/pulls/99/merge',
  );
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.options.headers.authorization, 'Bearer pat-mock');
  assert.deepEqual(JSON.parse(request.options.body), {
    sha: heads[0],
    merge_method: 'squash',
    commit_title: '🐛 계산: 빈 값 수정 (#99)',
    commit_message:
      '기본값 처리\n\n경계값 보완\n\nCloses #13\n\nCo-authored-by: Codex <noreply@openai.com>',
  });
  conflict = true;
  await assert.rejects(github.squashMerge(state, 'dev'), /HEAD가 변경/);
  assert.equal(requests.length, 2);
});

test('developer requires repository paths, regular files and a unique exact edit', () => {
  const context = {
    files: new Map([
      ['src/a.ts', '100644'],
      ['src/link', '120000'],
    ]),
    read: () => 'aaa\naaa\n',
  };
  assert.deepEqual(
    resolveEdits([{ path: 'src/b.ts', before: null, after: 'new' }], context),
    [{ path: 'src/b.ts', text: 'new' }],
  );
  for (const path of [
    '../outside',
    '/etc/passwd',
    'src/./a.ts',
    'src/../.github/ci.yml',
    '.git/config',
    '.GIT/config',
    'node_modules/package/index.js',
    '.env',
    '.env.production',
    'config/.env.local',
    'src/link/child',
    'src/link',
  ]) {
    assert.throws(
      () => resolveEdits([{ path, before: null, after: 'new' }], context),
      /수동/,
    );
  }
  assert.throws(
    () =>
      resolveEdits([{ path: 'src/a.ts', before: 'aa', after: 'new' }], context),
    /여러 곳/,
  );
});

test('developer can edit automation, configuration, instructions and environment examples', () => {
  const paths = [
    '.github/workflows/ai-development-cleanup.yml',
    '.github/scripts/ai-development.test.mjs',
    '.github/scripts/ai-development/config.mjs',
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    '.gitignore',
    'AGENTS.md',
    'docs/AGENTS.md',
    '.env.example',
  ];
  const context = {
    files: new Map(paths.map((path) => [path, '100644'])),
    read: () => 'original',
  };
  assert.deepEqual(
    resolveEdits(
      paths.map((path) => ({ path, before: 'original', after: 'updated' })),
      context,
    ),
    paths.map((path) => ({ path, text: 'updated' })),
  );
  assert.deepEqual(
    resolveEdits(
      [
        {
          path: '.github/workflows/ai-pr-ci-followup.yml',
          before: null,
          after: 'new workflow',
        },
      ],
      context,
    ),
    [
      {
        path: '.github/workflows/ai-pr-ci-followup.yml',
        text: 'new workflow',
      },
    ],
  );
});

test('review JSON rejects contradictory status or a missing finding field', () => {
  assert.throws(() =>
    validateReview({ ...pass, findings: changes().findings }),
  );
  assert.throws(() => validateReview({ ...changes(), findings: [] }));
  assert.throws(() =>
    validateReview({
      ...changes(),
      findings: [{ ...changes().findings[0], evidence: '' }],
    }),
  );
  assert.equal(validateReview(pass).status, 'pass');
});

for (const agent of ['codex', 'claude']) {
  test(`${agent} maps the native tool protocol and reports numeric usage`, async () => {
    const requests = [];
    const logs = [];
    const tools = [];
    const models = createModels({
      keys: { codex: 'openai-mock', claude: 'anthropic-mock' },
      modelNames: config.models,
      log: (line) => logs.push(JSON.parse(line)),
      async request(url, options) {
        requests.push({ url, options });
        if (agent === 'codex')
          return Response.json({
            status: 'completed',
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            output:
              requests.length === 1
                ? [
                    {
                      type: 'function_call',
                      name: 'read_diff',
                      arguments: '{"line":1}',
                      call_id: 'call_1',
                    },
                  ]
                : [
                    {
                      type: 'message',
                      content: [
                        { type: 'output_text', text: JSON.stringify(pass) },
                      ],
                    },
                  ],
          });
        return Response.json({
          stop_reason: requests.length === 1 ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 1, output_tokens: 2 },
          content:
            requests.length === 1
              ? [
                  {
                    type: 'tool_use',
                    name: 'read_diff',
                    input: { line: 1 },
                    id: 'toolu_1',
                  },
                ]
              : [{ type: 'text', text: JSON.stringify(pass) }],
        });
      },
    });
    models.verify();
    const result = await models.run({
      agent,
      mode: 'review',
      instructions: 'review',
      context: 'issue',
      inspect: (name, input) => {
        tools.push({ name, input });
        return 'diff';
      },
    });
    assert.deepEqual(result, pass);
    assert.deepEqual(tools, [{ name: 'read_diff', input: { line: 1 } }]);
    const second = JSON.parse(requests[1].options.body);
    assert.equal(
      agent === 'codex'
        ? second.input.at(-1).output
        : second.messages.at(-1).content[0].content,
      'diff',
    );
    assert.equal(logs[0].usage.input_tokens, 1);
    assert(Number.isFinite(logs[0].elapsedMs));
  });
}

// Splits the event text at fixed widths so events and multi-byte characters straddle chunks.
function eventStream(events, { width = 7, end = true } = {}) {
  const bytes = new TextEncoder().encode(
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join(''),
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += width)
          controller.enqueue(bytes.slice(offset, offset + width));
        if (end) controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

const streamLimits = {
  turns: 3,
  outputTokens: 1000,
  edits: 80,
  idleTimeout: 1000,
  requestTimeout: 5000,
  codexEffort: 'medium',
};

function streamingModels(respond, limits = streamLimits) {
  const logs = [];
  const models = createModels({
    keys: { codex: 'openai-mock', claude: 'anthropic-mock' },
    modelNames: config.models,
    limits,
    log: (line) => logs.push(JSON.parse(line)),
    request: async (_url, options) => respond(JSON.parse(options.body)),
  });
  const run = (agent, inspect = () => 'diff') =>
    models.run({
      agent,
      mode: 'review',
      instructions: 'review',
      context: 'issue',
      inspect,
    });
  return { run, logs };
}

test('Claude streams are rebuilt into tool calls, text, stop reason and cumulative usage', async () => {
  const review = { ...pass, summary: '통과 — 한글 요약' };
  const text = JSON.stringify(review);
  const turns = [
    [
      {
        type: 'message_start',
        message: {
          role: 'assistant',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 11, output_tokens: 1 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '확인합니다' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'ping' },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'read_diff',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"li' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: 'ne": 1}' },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 42 },
      },
      { type: 'message_stop' },
    ],
    [
      {
        type: 'message_start',
        message: {
          role: 'assistant',
          content: [],
          usage: { input_tokens: 20, output_tokens: 1 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: text.slice(0, 9) },
      },
      { type: 'unknown_future_event' },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: text.slice(9) },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 30 },
      },
      { type: 'message_stop' },
    ],
  ];
  const bodies = [];
  const tools = [];
  const { run, logs } = streamingModels((body) => {
    bodies.push(body);
    return eventStream(turns[bodies.length - 1]);
  });
  assert.deepEqual(
    await run('claude', (name, input) => {
      tools.push({ name, input });
      return 'diff';
    }),
    review,
  );
  assert.deepEqual(tools, [{ name: 'read_diff', input: { line: 1 } }]);
  // The assistant turn is replayed with the reassembled blocks, as a non-streaming reply would be.
  assert.deepEqual(bodies[1].messages[1].content, [
    { type: 'text', text: '확인합니다' },
    { type: 'tool_use', id: 'toolu_1', name: 'read_diff', input: { line: 1 } },
  ]);
  assert.equal(bodies[1].messages[2].content[0].tool_use_id, 'toolu_1');
  assert.deepEqual(logs[0].usage, { input_tokens: 11, output_tokens: 42 });
  assert.equal(bodies[0].stream, true);
});

test('Claude continuation preserves signed blocks and always sends a valid tool-result message', async () => {
  const signed = { type: 'thinking', thinking: '', signature: 'signed-value' };
  const redacted = { type: 'redacted_thinking', data: 'opaque-data' };
  const calls = [
    { type: 'tool_use', id: 'toolu_1', name: 'read_diff', input: { line: 1 } },
    { type: 'tool_use', id: 'toolu_2', name: 'read_diff', input: { line: 2 } },
  ];
  const { run } = streamingModels((body) => {
    if (body.messages.length === 1) {
      return Response.json({
        stop_reason: 'tool_use',
        content: [signed, redacted, { type: 'text', text: '' }, ...calls],
      });
    }
    assert.match(body.system, /^review/);
    assert.deepEqual(body.messages[1], {
      role: 'assistant',
      content: [signed, redacted, ...calls],
    });
    const result = body.messages[2];
    assert.equal(result.role, 'user');
    assert.deepEqual(result.content.slice(0, 2), [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'diff' },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_2',
        content: 'No matching lines.',
      },
    ]);
    assert.equal(result.content[2].type, 'text');
    return Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(pass) }],
    });
  });
  assert.deepEqual(
    await run('claude', (_name, { line }) => (line === 1 ? 'diff' : '')),
    pass,
  );
});

test('Codex streams return the response carried by the terminal event', async () => {
  const completed = (output) => [
    { type: 'response.created', response: { status: 'in_progress' } },
    { type: 'response.output_text.delta', delta: 'ignored' },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        usage: { input_tokens: 5, output_tokens: 6, total_tokens: 11 },
        output,
      },
    },
  ];
  const turns = [
    completed([
      {
        type: 'function_call',
        name: 'read_diff',
        arguments: '{"line":1}',
        call_id: 'call_1',
      },
    ]),
    completed([
      {
        type: 'message',
        content: [{ type: 'output_text', text: JSON.stringify(pass) }],
      },
    ]),
  ];
  let turn = 0;
  const { run, logs } = streamingModels(() => eventStream(turns[turn++]));
  assert.deepEqual(await run('codex'), pass);
  assert.equal(logs[1].usage.total_tokens, 11);

  const incomplete = streamingModels(() =>
    eventStream([
      {
        type: 'response.incomplete',
        response: { status: 'incomplete', output: [] },
      },
    ]),
  );
  await assert.rejects(incomplete.run('codex'), /완료되지 않았습니다/);
});

test('a stream error, an early end or a silent stream is an unknown outcome and is not retried', async () => {
  const cases = [
    [
      'claude',
      () =>
        eventStream([{ type: 'error', error: { type: 'overloaded_error' } }]),
    ],
    [
      'claude',
      () => eventStream([{ type: 'message_start', message: { content: [] } }]),
    ],
    ['codex', () => eventStream([{ type: 'error', message: 'failed' }])],
    ['codex', () => eventStream([{ type: 'response.created', response: {} }])],
  ];
  for (const [agent, respond] of cases) {
    let requests = 0;
    const { run } = streamingModels(() => {
      requests++;
      return respond();
    });
    await assert.rejects(run(agent), (error) => {
      assert.match(error.message, /응답을 확인할 수 없습니다/);
      assert.equal(error.requestRejected, undefined);
      return true;
    });
    assert.equal(requests, 1);
  }
  // No bytes for longer than the idle limit ends the wait even though the stream stays open.
  const silent = streamingModels(
    () => eventStream([{ type: 'ping' }], { end: false }),
    { ...streamLimits, idleTimeout: 30 },
  );
  const started = Date.now();
  await assert.rejects(
    silent.run('claude'),
    /리뷰 요청 1회차, 응답 대기 시간 초과/,
  );
  assert.equal(Date.now() - started < 2000, true);
});

test('a provider rejection records the failed turn and a fixed reason without leaking provider text', async () => {
  const replies = [
    Response.json({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'read_diff',
          input: { line: 1 },
        },
      ],
    }),
    Response.json(
      {
        error: {
          type: 'invalid_request_error',
          message:
            'messages.2.content.0.tool_use_id: tool_result private request data',
        },
      },
      { status: 400 },
    ),
  ];
  const { run } = streamingModels(() => replies.shift());
  await assert.rejects(run('claude'), (error) => {
    assert.match(
      error.message,
      /Claude API HTTP 400.*리뷰 요청 2회차, 도구 호출 형식, 필드 messages\.2\.content\.0\.tool_use_id/,
    );
    assert.doesNotMatch(error.message, /private request data/);
    assert.equal(error.requestRejected, true);
    return true;
  });
  assert.equal(replies.length, 0);
});

test('an incomplete Codex stream records the missing terminal event', async () => {
  const { run } = streamingModels(() =>
    eventStream([{ type: 'response.created', response: {} }]),
  );
  await assert.rejects(
    run('codex'),
    /리뷰 요청 1회차, 완료 이벤트 없이 스트림 종료/,
  );
});

test('development results accept up to the configured number of edits', () => {
  const plan = (count) => ({
    status: 'completed',
    title: '🐛 계산: 빈 값 수정',
    summary: '기본값 처리',
    edits: Array.from({ length: count }, (_, index) => ({
      path: `src/file-${index}.ts`,
      before: null,
      after: 'x',
    })),
  });
  assert.equal(validateDevelopment(plan(config.limits.edits)).edits.length, 80);
  assert.throws(() => validateDevelopment(plan(config.limits.edits + 1)));
});

test('provider rate limits retry at most once and HTTP authorization errors do not retry', async () => {
  for (const [http, expected] of [
    [429, 2],
    [401, 1],
  ]) {
    let attempts = 0;
    const models = createModels({
      keys: { codex: 'mock' },
      modelNames: config.models,
      sleep: async () => {},
      request: async () => {
        attempts++;
        return new Response('', { status: http });
      },
    });
    await assert.rejects(
      models.run({
        agent: 'codex',
        mode: 'review',
        instructions: 'review',
        context: '{}',
      }),
      new RegExp(`HTTP ${http}`),
    );
    assert.equal(attempts, expected);
  }
});

test('a merged PR whose issue could not be closed retries only issue closure', async () => {
  const { data, run } = fixture();
  data.failClose = true;
  assert.equal((await run()).status, 'needs_human');
  assert.equal(data.mergeRequests.length, 1);
  assert.match(
    data.notes.get('13:stop-100-1'),
    /Issue 종료를 확인하지 못했습니다/,
  );
  data.failClose = false;
  assert.equal((await run({ resume: true, runId: 101 })).status, 'merged');
  assert.equal(data.issue.state_reason, 'completed');
  assert.equal(data.mergeRequests.length, 1);
});
