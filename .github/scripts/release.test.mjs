import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  inspectDeployment,
  publishRelease,
  pruneProductionReleases,
  releaseTag,
} from './release.mjs';

const targetBranch = process.env.GITHUB_BASE_REF || process.env.GITHUB_REF_NAME;

test(
  'automatic release entrypoint exists only on main',
  {
    skip: !['dev', 'main'].includes(targetBranch),
  },
  () => {
    assert.equal(
      existsSync(
        new URL('../workflows/production-release.yml', import.meta.url),
      ),
      targetBranch === 'main',
      'Keep the automatic entrypoint on main; dev must only expose manual recovery.',
    );
  },
);

const SHA = 'a'.repeat(40),
  OTHER = 'b'.repeat(40);
const bot = { id: 35613825, login: 'vercel[bot]', type: 'Bot' };
const error = (status) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

function fixture() {
  const state = {
    deployment: {
      id: 42,
      sha: SHA,
      ref: 'main',
      environment: 'Production',
      production_environment: true,
      transient_environment: false,
      creator: bot,
    },
    status: {
      id: 99,
      state: 'success',
      creator: bot,
      created_at: '2026-10-30T14:45:12Z',
      environment_url:
        'https://commit-trail-abc-han-janghyuns-projects.vercel.app',
      log_url: 'https://commit-trail-abc-han-janghyuns-projects.vercel.app',
      target_url: 'https://commit-trail-abc-han-janghyuns-projects.vercel.app',
    },
    commitStatuses: [
      {
        state: 'success',
        context: 'Vercel',
        creator: bot,
        target_url:
          'https://vercel.com/han-janghyuns-projects/commit-trail/Abc123',
      },
    ],
    comparison: 'ahead',
    refs: [],
    releases: [],
    calls: [],
    failNotes: false,
    failRelease: false,
    failDelete: false,
    nextReleaseId: 1,
  };
  const context = {
    repo: { owner: 'han41858', repo: 'commit-trail' },
    eventName: 'deployment_status',
    ref: 'refs/heads/main',
    payload: {
      sender: bot,
      deployment: { id: 42, sha: SHA },
      deployment_status: { id: 99, state: 'success' },
      repository: { default_branch: 'dev' },
    },
  };
  const wrap = (name, fn) => async (args) => {
    state.calls.push({ name, args });
    return { data: await fn(args) };
  };
  const repos = {
    getDeployment: wrap('getDeployment', () => state.deployment),
    getDeploymentStatus: wrap('getDeploymentStatus', () => state.status),
    listDeploymentStatuses: wrap(
      'listDeploymentStatuses',
      () => state.statuses || [state.status],
    ),
    compareCommits: wrap('compareCommits', () => ({
      status: state.comparison,
    })),
    listCommitStatusesForRef: wrap(
      'listCommitStatusesForRef',
      () => state.commitStatuses,
    ),
    listReleases: wrap('listReleases', () => state.releases),
    generateReleaseNotes: wrap('generateReleaseNotes', () => {
      if (state.failNotes) throw error(503);
      return { body: '## Changes\n- Verified application changes' };
    }),
    createRelease: wrap('createRelease', (args) => {
      if (state.failRelease) throw error(503);
      if (state.releaseRace) {
        state.releases.push({
          ...args,
          id: state.nextReleaseId++,
          html_url:
            'https://github.com/han41858/commit-trail/releases/existing',
        });
        state.releaseRace = false;
        throw error(422);
      }
      const release = {
        ...args,
        id: state.nextReleaseId++,
        html_url: `https://github.com/han41858/commit-trail/releases/tag/${args.tag_name}`,
      };
      state.releases.push(release);
      return release;
    }),
    getReleaseByTag: wrap('getReleaseByTag', ({ tag }) => {
      const release = state.releases.find((r) => r.tag_name === tag);
      if (!release) throw error(404);
      return release;
    }),
    deleteRelease: wrap('deleteRelease', ({ release_id }) => {
      if (state.failDelete || state.failDeleteId === release_id)
        throw error(503);
      const index = state.releases.findIndex(
        (release) => release.id === release_id,
      );
      if (index < 0) throw error(404);
      state.releases.splice(index, 1);
      return {};
    }),
  };
  const git = {
    listMatchingRefs: wrap('listMatchingRefs', () => state.refs),
    getRef: wrap('getRef', ({ ref }) => {
      const item = state.refs.find((item) => item.ref === `refs/${ref}`);
      if (!item) throw error(404);
      return item;
    }),
    createRef: wrap('createRef', ({ ref, sha }) => {
      if (state.protectedTag) throw error(422);
      if (state.tagRace) {
        state.refs.push({
          ref,
          object: { type: 'commit', sha: state.tagRace },
        });
        state.tagRace = null;
        throw error(422);
      }
      const item = { ref, object: { type: 'commit', sha } };
      state.refs.push(item);
      return item;
    }),
    getTag: wrap('getTag', ({ tag_sha }) => ({
      object: state.annotated[tag_sha],
    })),
  };
  const github = {
    rest: { repos, git },
    paginate: async (fn, args) => (await fn(args)).data,
  };
  const core = { info() {} };
  const api = { github, context, core };
  return {
    state,
    context,
    api,
    writes: () =>
      state.calls.filter((call) =>
        ['createRef', 'createRelease', 'deleteRelease'].includes(call.name),
      ),
  };
}

test('Korean release timestamps preserve seconds and roll over midnight and year', () => {
  assert.equal(releaseTag('2026-10-30T14:45:12Z'), 'rel-20261030234512');
  assert.equal(releaseTag('2026-10-30T15:00:00Z'), 'rel-20261031000000');
  assert.equal(releaseTag('2026-12-31T15:00:00Z'), 'rel-20270101000000');
});

test('a verified Vercel Production success creates a tag on the deployed SHA and release notes', async () => {
  const f = fixture();
  f.context.payload.deployment.sha = OTHER;
  const result = await publishRelease(f.api);
  assert.equal(result.created, true);
  assert.equal(result.tag, 'rel-20261030234512');
  assert.equal(f.state.refs[0].object.sha, SHA);
  const release = f.state.releases[0];
  assert.equal(release.target_commitish, SHA);
  assert.equal(release.make_latest, 'true');
  assert.match(release.body, /commit-trail-view\.vercel\.app/);
  assert.match(release.body, /Verified application changes/);
  assert.match(release.body, /commit-trail-deployment:42/);
});

test('Preview success never creates tags or releases', async () => {
  const f = fixture();
  f.state.deployment.environment = 'Preview';
  f.state.deployment.production_environment = false;
  assert.equal((await publishRelease(f.api)).eligible, false);
  assert.equal(f.writes().length, 0);
});

test('the renamed public Production domain is accepted and recorded in release notes', async () => {
  const f = fixture();
  f.state.status.environment_url = 'https://commit-trail-view.vercel.app/';
  const result = await publishRelease(f.api);
  assert.equal(result.created, true);
  assert.match(
    f.state.releases[0].body,
    /Production: https:\/\/commit-trail-view\.vercel\.app\//,
  );
  assert.match(
    f.state.releases[0].body,
    /github\.com\/han41858\/commit-trail\/commit\//,
  );
});

test('Vercel Production succeeds even when GitHub production_environment is false', async () => {
  const f = fixture();
  f.state.deployment.production_environment = false;
  const result = await publishRelease(f.api);
  assert.equal(result.created, true);
  assert.equal(result.sha, SHA);
  assert.equal(f.state.releases.length, 1);
});

test('failure events and another sender cannot request release writes', async () => {
  for (const change of [
    (f) => {
      f.context.payload.deployment_status.state = 'failure';
    },
    (f) => {
      f.context.payload.sender = { id: 1, login: 'other', type: 'User' };
    },
  ]) {
    const f = fixture();
    change(f);
    assert.equal((await publishRelease(f.api)).eligible, false);
    assert.equal(f.state.calls.length, 0);
  }
});

test('persisted deployment and success status must both belong to the Vercel bot', async () => {
  for (const key of ['deployment', 'status']) {
    const f = fixture();
    f.state[key].creator = { ...bot, id: 1 };
    await assert.rejects(publishRelease(f.api), /Vercel/);
    assert.equal(f.writes().length, 0);
  }
});

test('another project or team cannot publish this repository release', async () => {
  for (const url of [
    'https://vercel.com/other/commit-trail/Abc123',
    'https://vercel.com/han-janghyuns-projects/other/Abc123',
    'https://vercel.com.attacker.example/han-janghyuns-projects/commit-trail/Abc123',
  ]) {
    const f = fixture();
    f.state.commitStatuses[0].target_url = url;
    await assert.rejects(
      publishRelease(f.api),
      /expected Vercel team and project/,
    );
    assert.equal(f.writes().length, 0);
  }
});

test('the real Vercel deployment-status URL shape is cross-checked against its authenticated commit status', async () => {
  const f = fixture();
  assert.equal(
    (await inspectDeployment(f.api)).dashboardUrl,
    f.state.commitStatuses[0].target_url,
  );
  assert.equal(
    f.state.calls.find((call) => call.name === 'listCommitStatusesForRef').args
      .ref,
    SHA,
  );
  f.state.commitStatuses[0].creator = { ...bot, id: 1 };
  await assert.rejects(
    inspectDeployment(f.api),
    /expected Vercel team and project/,
  );
});

test('lookalike project and team deployment hosts are rejected even with a valid project commit status', async () => {
  for (const url of [
    'https://commit-trail-other-abc-han-janghyuns-projects.vercel.app',
    'https://commit-trail-abc-other-team.vercel.app',
  ]) {
    const f = fixture();
    f.state.status.environment_url = url;
    await assert.rejects(publishRelease(f.api), /Unexpected deployment URL/);
    assert.equal(f.writes().length, 0);
  }
});

test('a production-looking event with a feature ref or a commit outside main cannot write', async () => {
  const f = fixture();
  f.state.deployment.ref = 'feature/other';
  await assert.rejects(publishRelease(f.api), /main commit/);
  for (const comparison of ['behind', 'diverged']) {
    const other = fixture();
    other.state.comparison = comparison;
    await assert.rejects(publishRelease(other.api), /not on main/);
    assert.equal(other.writes().length, 0);
  }
});

test('a SHA ref is accepted only when it equals the verified deployed main SHA', async () => {
  const f = fixture();
  f.state.deployment.ref = SHA;
  assert.equal((await inspectDeployment(f.api)).sha, SHA);
});

test('unsafe deployment URLs, timestamps, and IDs fail before any tag write', async () => {
  for (const change of [
    (f) => {
      f.state.status.environment_url = 'https://attacker.example';
    },
    (f) => {
      f.state.status.created_at = 'not a date';
    },
    (f) => {
      f.context.payload.deployment.id = '../../other';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(publishRelease(f.api));
    assert.equal(f.writes().length, 0);
  }
});

test('a duplicate event reuses its release without moving or recreating a tag', async () => {
  const f = fixture();
  const first = await publishRelease(f.api);
  f.state.calls = [];
  const second = await publishRelease(f.api);
  assert.equal(second.reused, true);
  assert.equal(second.tag, first.tag);
  assert.equal(f.writes().length, 0);
});

test('a failed release request is retried using the original orphan tag', async () => {
  const f = fixture();
  f.state.failRelease = true;
  await assert.rejects(publishRelease(f.api), /503/);
  assert.equal(f.state.refs.length, 1);
  f.state.failRelease = false;
  f.state.status.created_at = '2026-10-30T16:00:00Z';
  f.state.calls = [];
  const retried = await publishRelease(f.api);
  assert.equal(retried.tag, 'rel-20261030234512');
  assert.equal(f.state.refs.length, 1);
  assert.deepEqual(
    f.writes().map((call) => call.name),
    ['createRelease'],
  );
});

test('a failed release-notes request leaves a recoverable tag and never claims a release', async () => {
  const f = fixture();
  f.state.failNotes = true;
  await assert.rejects(publishRelease(f.api), /503/);
  assert.equal(f.state.releases.length, 0);
  f.state.failNotes = false;
  assert.equal((await publishRelease(f.api)).created, true);
  assert.equal(f.state.refs.length, 1);
});

test('timestamp collisions allocate the next second and preserve the other commit tag', async () => {
  const f = fixture();
  f.state.refs.push({
    ref: 'refs/tags/rel-20261030234512',
    object: { type: 'commit', sha: OTHER },
  });
  assert.equal((await publishRelease(f.api)).tag, 'rel-20261030234513');
  assert.equal(f.state.refs[0].object.sha, OTHER);
});

test('atomic tag creation races recover the same SHA or allocate another second', async () => {
  for (const sha of [SHA, OTHER]) {
    const f = fixture();
    f.state.tagRace = sha;
    const result = await publishRelease(f.api);
    assert.equal(
      result.tag,
      sha === SHA ? 'rel-20261030234512' : 'rel-20261030234513',
    );
    assert.equal(f.state.releases.length, 1);
  }
});

test('a tag-policy error is surfaced instead of evading the rule with another tag', async () => {
  const f = fixture();
  f.state.protectedTag = true;
  await assert.rejects(publishRelease(f.api), /422/);
  assert.equal(f.writes().length, 1);
  assert.equal(f.state.releases.length, 0);
});

test('delayed success events do not replace a newer Latest release', async () => {
  const f = fixture();
  f.state.releases.push({
    tag_name: 'rel-20261031010000',
    draft: false,
    prerelease: false,
  });
  await publishRelease(f.api);
  assert.equal(f.state.releases.at(-1).make_latest, 'false');
});

test('manual recovery defaults to dry run and cannot use an unprotected branch', async () => {
  const f = fixture();
  f.context.eventName = 'workflow_dispatch';
  f.context.ref = 'refs/heads/dev';
  f.context.payload.inputs = { deployment_id: '42' };
  assert.equal((await publishRelease(f.api)).dryRun, true);
  assert.equal(f.writes().length, 0);
  f.context.ref = 'refs/heads/feature/unreviewed';
  await assert.rejects(publishRelease(f.api), /protected default branch/);
});

test('manual recovery can explicitly publish a verified successful production deployment', async () => {
  const f = fixture();
  f.context.eventName = 'workflow_dispatch';
  f.context.ref = 'refs/heads/dev';
  f.context.payload.inputs = { deployment_id: '42', dry_run: 'false' };
  assert.equal((await publishRelease(f.api)).created, true);
});

test('manual retry rejects a failed deployment while allowing an inactive historical success', async () => {
  const f = fixture();
  f.context.eventName = 'workflow_dispatch';
  f.context.ref = 'refs/heads/dev';
  f.context.payload.inputs = { deployment_id: '42' };
  f.state.statuses = [{ ...f.state.status, state: 'failure' }];
  assert.equal((await publishRelease(f.api)).eligible, false);
  assert.equal(f.writes().length, 0);
  f.state.statuses = [{ ...f.state.status, state: 'inactive' }, f.state.status];
  assert.equal((await publishRelease(f.api)).dryRun, true);
});

test('annotated tags resolve to the deployed commit without being rewritten', async () => {
  const f = fixture();
  f.state.refs.push({
    ref: 'refs/tags/rel-20261030230000',
    object: { type: 'tag', sha: OTHER },
  });
  f.state.annotated = { [OTHER]: { type: 'commit', sha: SHA } };
  assert.equal((await publishRelease(f.api)).tag, 'rel-20261030230000');
  assert.equal(f.state.refs[0].object.type, 'tag');
});

test('draft releases are not published or overwritten by this automation', async () => {
  const f = fixture();
  f.state.refs.push({
    ref: 'refs/tags/rel-20261030230000',
    object: { type: 'commit', sha: SHA },
  });
  f.state.releases.push({ tag_name: 'rel-20261030230000', draft: true });
  await assert.rejects(publishRelease(f.api), /reserved/);
  assert.equal(f.writes().length, 0);
});

test('a simultaneous release creation is recovered without changing its tag', async () => {
  const f = fixture();
  f.state.releaseRace = true;
  assert.equal((await publishRelease(f.api)).reused, true);
  assert.equal(f.state.refs.length, 1);
});

test('fork repositories and unrelated events cannot use release write permissions', async () => {
  const f = fixture();
  f.context.repo.owner = 'other';
  await assert.rejects(publishRelease(f.api), /Unexpected repository/);
  const other = fixture();
  other.context.eventName = 'push';
  await assert.rejects(publishRelease(other.api), /Unexpected workflow event/);
});

function managedRelease(tag, id, marker = 'commit-trail') {
  return {
    id,
    tag_name: tag,
    body: `<!-- ${marker}-production-release:${OTHER} -->`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/han41858/commit-trail/releases/tag/${tag}`,
  };
}

test('production publication and cleanup share one repository concurrency group', () => {
  const workflow = readFileSync(
    new URL('../workflows/release.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /group: production-release-\$\{\{ github\.repository \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
});

test('a successful publication keeps one release while preserving all older Git tags', async () => {
  const f = fixture();
  for (const [tag, id, marker] of [
    ['rel-20261030234000', 100, 'gitstream'],
    ['rel-20261030234100', 101, 'commit-trail'],
  ]) {
    f.state.releases.push(managedRelease(tag, id, marker));
    f.state.refs.push({
      ref: `refs/tags/${tag}`,
      object: { type: 'commit', sha: OTHER },
    });
  }
  const refs = structuredClone(f.state.refs);
  const result = await publishRelease(f.api);
  assert.equal(result.created, true);
  assert.equal(result.pruned, 2);
  assert.deepEqual(
    f.state.releases.map((release) => release.tag_name),
    [result.tag],
  );
  assert.deepEqual(f.state.refs.slice(0, refs.length), refs);
  assert.equal(f.state.refs.length, refs.length + 1);
  const writes = f.writes().map((call) => call.name);
  assert(writes.indexOf('createRelease') < writes.indexOf('deleteRelease'));
});

test('cleanup preserves drafts, prereleases, manual releases and unrelated tag namespaces', async () => {
  const f = fixture();
  const newest = managedRelease('rel-20261031010000', 100);
  const untouched = [
    { ...managedRelease('rel-20261031020000', 101), draft: true },
    { ...managedRelease('rel-20261031030000', 102), prerelease: true },
    { ...managedRelease('rel-20261031040000', 103), body: 'Manual release' },
    managedRelease('v1.0.0', 104),
  ];
  f.state.releases.push(
    newest,
    managedRelease('rel-20261030230000', 105, 'gitstream'),
    ...untouched,
  );
  const result = await pruneProductionReleases(f.api);
  assert.equal(result.kept.tag, newest.tag_name);
  assert.deepEqual(result.deleted, [{ id: 105, tag: 'rel-20261030230000' }]);
  assert.deepEqual(f.state.releases, [newest, ...untouched]);
});

test('cleanup dry run returns the exact release plan without writes', async () => {
  const f = fixture();
  f.state.releases.push(
    managedRelease('rel-20261031010000', 100),
    managedRelease('rel-20261030230000', 101),
  );
  const result = await pruneProductionReleases({ ...f.api, dryRun: true });
  assert.equal(result.kept.id, 100);
  assert.deepEqual(result.planned, [{ id: 101, tag: 'rel-20261030230000' }]);
  assert.deepEqual(result.deleted, []);
  assert.equal(f.state.releases.length, 2);
  assert.equal(f.writes().length, 0);
});

test('manual dry run does not prune an already published matching release', async () => {
  const f = fixture();
  const tag = 'rel-20261030234512';
  f.state.releases.push(
    managedRelease(tag, 100),
    managedRelease('rel-20261030230000', 101),
  );
  f.state.refs.push({
    ref: `refs/tags/${tag}`,
    object: { type: 'commit', sha: SHA },
  });
  f.context.eventName = 'workflow_dispatch';
  f.context.ref = 'refs/heads/dev';
  f.context.payload.inputs = { deployment_id: '42' };
  const result = await publishRelease(f.api);
  assert.equal(result.dryRun, true);
  assert.equal(result.reused, true);
  assert.equal(f.state.releases.length, 2);
  assert.equal(f.writes().length, 0);
});

test('failed notes and publication requests never delete existing releases', async () => {
  for (const failure of ['failNotes', 'failRelease']) {
    const f = fixture();
    f.state.releases.push(
      managedRelease('rel-20261030230000', 100),
      managedRelease('rel-20261030231000', 101),
    );
    f.state[failure] = true;
    await assert.rejects(publishRelease(f.api), /503/);
    assert.deepEqual(
      f.state.releases.map((release) => release.id),
      [100, 101],
    );
    assert.equal(
      f.writes().filter((call) => call.name === 'deleteRelease').length,
      0,
    );
  }
});

test('a retry completes partially failed cleanup without creating another tag or release', async () => {
  const f = fixture();
  f.state.releases.push(
    managedRelease('rel-20261030230000', 100),
    managedRelease('rel-20261030231000', 101),
  );
  f.state.failDeleteId = 100;
  await assert.rejects(publishRelease(f.api), /503/);
  assert.deepEqual(
    f.state.releases.map((release) => release.id),
    [100, 1],
  );
  f.state.failDeleteId = null;
  f.state.calls = [];
  const result = await publishRelease(f.api);
  assert.equal(result.reused, true);
  assert.equal(result.pruned, 1);
  assert.deepEqual(
    f.writes().map((call) => call.name),
    ['deleteRelease'],
  );
  assert.deepEqual(
    f.state.releases.map((release) => release.id),
    [1],
  );
});

test('delayed old production events preserve the newer release without recreating history', async () => {
  const f = fixture();
  const latest = managedRelease('rel-20261031010000', 100);
  f.state.releases.push(latest);
  const first = await publishRelease(f.api);
  assert.equal(first.skipped, true);
  assert.equal(first.latestTag, latest.tag_name);
  assert.deepEqual(f.state.releases, [latest]);
  assert.equal(f.state.refs.length, 1);
  assert.equal(
    f.state.calls.some((call) => call.name === 'createRelease'),
    false,
  );
  f.state.calls = [];
  assert.equal((await publishRelease(f.api)).skipped, true);
  assert.equal(f.writes().length, 0);
});

test('cleanup re-lists releases and preserves a newer publication racing the first snapshot', async () => {
  const f = fixture();
  const list = f.api.github.rest.repos.listReleases;
  const latest = managedRelease('rel-20261031010000', 100);
  let reads = 0;
  f.api.github.rest.repos.listReleases = async (args) => {
    if (++reads === 2) f.state.releases.push(latest);
    return list(args);
  };
  const result = await publishRelease(f.api);
  assert.equal(result.skipped, true);
  assert.equal(result.latestTag, latest.tag_name);
  assert.equal(result.url, latest.html_url);
  assert.deepEqual(f.state.releases, [latest]);
  assert.equal(f.state.refs.length, 1);
});

test('cleanup tolerates a release already removed by another request', async () => {
  const f = fixture();
  f.state.releases.push(
    managedRelease('rel-20261031010000', 100),
    managedRelease('rel-20261030230000', 101),
  );
  const remove = f.api.github.rest.repos.deleteRelease;
  f.api.github.rest.repos.deleteRelease = async (args) => {
    await remove(args);
    throw error(404);
  };
  assert.deepEqual((await pruneProductionReleases(f.api)).deleted, [
    { id: 101, tag: 'rel-20261030230000' },
  ]);
  assert.equal(f.state.releases.length, 1);
});

test('cleanup validates all managed release IDs and repository before deleting anything', async () => {
  const f = fixture();
  f.state.releases.push(
    managedRelease('rel-20261031010000', 100),
    managedRelease('rel-20261030230000', 0),
  );
  await assert.rejects(pruneProductionReleases(f.api), /release ID/);
  assert.equal(f.writes().length, 0);
  f.context.repo.owner = 'other';
  await assert.rejects(pruneProductionReleases(f.api), /Unexpected repository/);
  assert.equal(f.writes().length, 0);
});
