import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  NeedsHuman,
  runPipeline,
  reconcile,
  pullMarker,
} from './ai-development/engine.mjs';
import { createGitHub, waitForCI } from './ai-development/github.mjs';
import { createModels, validateReview } from './ai-development/models.mjs';
import { resolveEdits } from './ai-development/workspace.mjs';
import { config } from './ai-development/config.mjs';

const base = 'a'.repeat(40);
const heads = ['b', 'c', 'd'].map((char) => char.repeat(40));
const mergeCommit = 'e'.repeat(40);
const pass = { status: 'pass', findings: [], summary: '통과' };
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
    readyRequests: [],
    mergeRequests: [],
  };
  const github = {
    issue: async () => structuredClone(data.issue),
    loadState: async () => structuredClone(data.record),
    saveState: async (_, state) => {
      data.record = { id: 290, state: structuredClone(state) };
      data.events.push(state.status);
      return 290;
    },
    ref: async (branch) =>
      branch === 'dev' ? (data.base ?? base) : data.remote,
    findPull: async () => (data.pull ? [structuredClone(data.pull)] : []),
    async createBranch(_, sha) {
      assert.equal(data.remote, null);
      data.remote = sha;
    },
    async commit(_, parent, files, message) {
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
    createPull: async (state) => {
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
    async squashMerge(state, baseRef) {
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
    async notice(number, message, key) {
      data.notes.set(`${number}:${key}`, message);
    },
    async publishReview(_, entry, reviewer) {
      data.reviews.set(entry.head, { entry, reviewer });
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
  const github = createGitHub({
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

test('Claude revises the existing PR using Codex feedback; later labels do not replace the roles', async () => {
  const issue = changes();
  const { data, run, options } = fixture({
    label: 'ai:develop:claude',
    results: [issue, pass],
  });
  const state = await run({
    async review(args) {
      data.issue.labels = [{ name: 'ai:develop:codex' }];
      return options.review(args);
    },
  });
  assert.equal(state.status, 'merged');
  assert.equal(state.pull, 99);
  assert.equal(state.head, heads[1]);
  assert.deepEqual(data.mergeRequests, [heads[1]]);
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

test('a closed or manually edited PR and a newer dev stop without overwriting changes', async () => {
  for (const change of [
    (data) => {
      data.pull.state = 'closed';
    },
    (data) => {
      data.pull.title = 'Manual edit';
    },
    (data) => {
      data.base = heads[2];
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
  const groups = ['ai-development.yml', 'ai-development-cleanup.yml']
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

test('provider requests use the configured turn, output and effort budget', async () => {
  const bodies = [];
  const limits = {
    turns: 2,
    outputTokens: 1234,
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
  assert.equal(bodies[0].max_output_tokens, 1234);
  assert.equal(bodies[0].reasoning.effort, 'high');
  assert.equal(bodies[2].max_tokens, 1234);
  assert.equal(config.limits.turns >= 10, true);
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
  const github = createGitHub({
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

test('GitHub readiness mutation must confirm the reviewed head is no longer a draft', async () => {
  let responseHead = heads[0];
  const github = createGitHub({
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
  const github = createGitHub({ ...options, publishingToken: 'pat-mock' });
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

test('developer writes only allowed regular paths and requires a unique exact edit', () => {
  const context = {
    files: new Map([
      ['src/a.ts', '100644'],
      ['src/link', '120000'],
    ]),
    read: () => 'aaa\naaa\n',
    editablePaths: ['src/', 'docs/'],
  };
  assert.deepEqual(
    resolveEdits([{ path: 'src/b.ts', before: null, after: 'new' }], context),
    [{ path: 'src/b.ts', text: 'new' }],
  );
  for (const path of [
    '.github/workflows/ci.yml',
    'src/../.github/ci.yml',
    'docs/AGENTS.md',
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
  });
}

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
