import assert from 'node:assert/strict';
import test from 'node:test';
import { createVercel, deployPreview } from './vercel-preview.mjs';

const repository = 'owner/repo';
const head = 'a'.repeat(40);
const repo = { full_name: repository, id: 123 };
const pull = {
  number: 17,
  state: 'open',
  base: { ref: 'dev', repo },
  head: { ref: 'feature/graph', sha: head, repo },
};

function fixture() {
  const data = {
    current: structuredClone(pull),
    requested: true,
    requiredJob: 'success',
    check: null,
    notices: new Map(),
    calls: [],
  };
  const github = {
    pull: async () => data.current,
    previewRequested: async () => data.requested,
    ciRun: async () => ({ status: 'completed', conclusion: 'success' }),
    ciJobs: async () => [
      { name: 'Test and build', conclusion: data.requiredJob },
    ],
    previewCheck: async () => data.check,
    notice: async (_, body, key) => data.notices.set(key, body),
    setPreviewCheck: async (_, { deployment, conclusion, url }) => {
      data.check = {
        id: 14,
        status: conclusion ? 'completed' : 'in_progress',
        conclusion,
        details_url: url,
        output: { text: deployment ?? 'reserved' },
      };
      return data.check;
    },
  };
  const vercel = {
    verifyConfiguration() {},
    async create(source) {
      data.calls.push(source);
      assert.match(data.check.output.text, /^reserved:/);
      return 'dpl_test';
    },
    find: async () => undefined,
    get: async () => ({
      readyState: 'READY',
      url: 'https://preview.vercel.app',
    }),
  };
  return {
    data,
    github,
    vercel,
    run: (options) =>
      deployPreview({
        github,
        vercel,
        repository,
        pull,
        attempts: 1,
        ...options,
      }),
  };
}

test('deploys only the labeled PR head after required CI and deduplicates its success', async () => {
  const { data, run } = fixture();
  data.requested = false;
  await run();
  data.requested = true;
  data.requiredJob = 'skipped';
  await run();
  data.requiredJob = 'success';
  await run({
    ciRun: { head_sha: 'b'.repeat(40), head_branch: pull.head.ref },
  });
  assert.deepEqual(data.calls, []);
  await run();
  await run();
  assert.deepEqual(data.calls, [
    { repoId: repo.id, ref: pull.head.ref, sha: head },
  ]);
  assert.equal(data.check.conclusion, 'success');
  assert.equal(data.check.details_url, 'https://preview.vercel.app');
  assert.equal(data.notices.size, 1);
});

test('a lost response cannot duplicate a deployment and can be recovered by ID', async () => {
  const { data, run, vercel } = fixture();
  vercel.create = async () => {
    throw new Error('connection lost');
  };
  await assert.rejects(run(), /connection lost/);
  await assert.rejects(run(), /찾지 못했습니다/);
  assert.match(data.check.output.text, /^reserved:/);
  await run({ suppliedDeployment: 'dpl_test' });
  assert.equal(data.check.conclusion, 'success');
});

test('a rejected request can be retried after correcting the configuration', async () => {
  const { data, run, vercel } = fixture();
  const create = vercel.create;
  vercel.create = async () => {
    throw Object.assign(new Error('HTTP 429'), { rejected: true });
  };
  await assert.rejects(run(), /HTTP 429/);
  assert.equal(data.check.conclusion, 'action_required');
  vercel.create = create;
  await run();
  assert.equal(data.check.conclusion, 'success');
});

test('an uncertain response reuses its reservation and requires explicit retry if no deployment exists', async () => {
  const { data, run, vercel } = fixture();
  const create = vercel.create;
  vercel.create = async () => {
    throw new Error('HTTP 503');
  };
  await assert.rejects(run(), /503/);
  const reservation = data.check.output.text.split(':')[1];
  vercel.find = async (state, request) => {
    assert.equal(state.head, head);
    assert.equal(request, reservation);
  };
  await assert.rejects(run(), /찾지 못했습니다/);
  vercel.create = create;
  await run({ retry: true });
  assert.equal(data.check.conclusion, 'success');
  assert.equal(data.calls.length, 1);
});

test('a terminal build can be retried or replaced by a verified deployment', async () => {
  for (const suppliedDeployment of [undefined, 'dpl_replacement']) {
    const { data, run, vercel } = fixture();
    const get = vercel.get;
    vercel.get = async () => ({ readyState: 'ERROR' });
    await assert.rejects(run(), /배포에 실패/);
    await assert.rejects(run(), /수동 실행/);
    vercel.get = get;
    await run({ retry: !suppliedDeployment, suppliedDeployment });
    assert.equal(data.check.conclusion, 'success');
    assert.equal(data.check.output.text, suppliedDeployment ?? 'dpl_test');
    assert.equal(data.calls.length, suppliedDeployment ? 1 : 2);
  }
});

test('Vercel uses the exact source SHA and accepts only a matching Preview result', async () => {
  let target = null;
  let sha = head;
  const vercel = createVercel({
    project: 'prj_test',
    team: 'team_test',
    token: 'test',
    async request(url, options) {
      assert.equal(url.origin, 'https://api.vercel.com');
      assert.equal(url.searchParams.get('teamId'), 'team_test');
      if (options.method === 'POST') {
        assert.deepEqual(JSON.parse(options.body), {
          name: 'commit-trail',
          project: 'prj_test',
          gitSource: {
            type: 'github',
            repoId: repo.id,
            ref: pull.head.ref,
            sha: head,
          },
        });
        return Response.json({ id: 'dpl_test' });
      }
      return Response.json({
        id: 'dpl_test',
        projectId: 'prj_test',
        target,
        gitSource: { sha },
        readyState: 'READY',
        url: 'preview.vercel.app',
      });
    },
  });
  assert.equal(
    await vercel.create({ repoId: repo.id, ref: pull.head.ref, sha: head }),
    'dpl_test',
  );
  assert.equal((await vercel.get('dpl_test', head)).readyState, 'READY');
  target = 'production';
  await assert.rejects(vercel.get('dpl_test', head), /일치하지/);
  target = null;
  sha = 'b'.repeat(40);
  await assert.rejects(vercel.get('dpl_test', head), /일치하지/);
});
