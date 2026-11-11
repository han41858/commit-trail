const REPOSITORY = 'han41858/commit-trail';
const VERCEL_BOT_ID = 35613825;
const TEAM = 'han-janghyuns-projects';
const PROJECT = 'commit-trail';
const PRODUCTION_URL = 'https://commit-trail-view.vercel.app/';
const TAG = /^rel-\d{14}$/;
const SHA = /^[a-f0-9]{40}$/;
const params = (context) => ({
  owner: context.repo.owner,
  repo: context.repo.repo,
});
const vercelBot = (user) =>
  user?.id === VERCEL_BOT_ID &&
  user.login === 'vercel[bot]' &&
  user.type === 'Bot';

export function releaseTag(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime()))
    throw new Error('Invalid deployment success timestamp.');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return (
    'rel-' +
    ['year', 'month', 'day', 'hour', 'minute', 'second']
      .map((type) => parts.find((part) => part.type === type).value)
      .join('')
  );
}

function dashboardUrl(status) {
  for (const value of [status.log_url, status.target_url]) {
    try {
      const url = new URL(value);
      const path = url.pathname.split('/').filter(Boolean);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'vercel.com' &&
        !url.port &&
        !url.username &&
        !url.password &&
        path.length === 3 &&
        path[0] === TEAM &&
        path[1] === PROJECT &&
        /^(?:dpl_)?[A-Za-z0-9]+$/.test(path[2])
      )
        return url.href;
    } catch {
      /* Try the other GitHub status link. */
    }
  }
  return null;
}

function deploymentUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    !(
      url.hostname === new URL(PRODUCTION_URL).hostname ||
      /^commit-trail-[a-z0-9]+-han-janghyuns-projects\.vercel\.app$/.test(
        url.hostname,
      )
    )
  ) {
    throw new Error('Unexpected deployment URL.');
  }
  return url.href;
}

export async function inspectDeployment({ github, context, core }) {
  if (`${context.repo.owner}/${context.repo.repo}` !== REPOSITORY)
    throw new Error('Unexpected repository.');
  const manual = context.eventName === 'workflow_dispatch';
  if (!manual && context.eventName !== 'deployment_status')
    throw new Error('Unexpected workflow event.');
  if (
    manual &&
    context.ref !== `refs/heads/${context.payload.repository.default_branch}`
  ) {
    throw new Error('Manual recovery must use the protected default branch.');
  }
  if (
    !manual &&
    (context.payload.deployment_status?.state !== 'success' ||
      !vercelBot(context.payload.sender))
  ) {
    return { eligible: false, reason: 'Not a Vercel success event.' };
  }
  const id = manual
    ? String(context.payload.inputs?.deployment_id || '')
    : String(context.payload.deployment?.id || '');
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw new Error('Invalid GitHub deployment ID.');
  const scope = { ...params(context), deployment_id: Number(id) };
  const { data: deployment } = await github.rest.repos.getDeployment(scope);
  if (!vercelBot(deployment.creator))
    throw new Error('Deployment was not created by Vercel.');
  // Vercel can label a deployment Production while leaving GitHub's optional
  // production_environment flag false. Verify its label, bot, project and SHA.
  if (
    deployment.environment?.toLowerCase() !== 'production' ||
    deployment.transient_environment
  ) {
    core?.info('Preview or non-production deployment: no release.');
    return { eligible: false, reason: 'Not a Production deployment.' };
  }
  if (
    !SHA.test(deployment.sha) ||
    !['main', 'refs/heads/main', deployment.sha].includes(deployment.ref)
  ) {
    throw new Error('Production deployment does not identify a main commit.');
  }
  let status;
  if (manual) {
    const { data } = await github.rest.repos.listDeploymentStatuses({
      ...scope,
      per_page: 100,
    });
    if (!data.length || !['success', 'inactive'].includes(data[0].state)) {
      return {
        eligible: false,
        reason: 'Deployment is not successfully completed.',
      };
    }
    status = data.find(
      (item) => item.state === 'success' && vercelBot(item.creator),
    );
    if (!status)
      return { eligible: false, reason: 'No Vercel success status.' };
  } else {
    const statusId = context.payload.deployment_status?.id;
    if (!Number.isSafeInteger(statusId) || statusId < 1)
      throw new Error('Invalid deployment status ID.');
    ({ data: status } = await github.rest.repos.getDeploymentStatus({
      ...scope,
      status_id: statusId,
    }));
  }
  if (status.state !== 'success' || !vercelBot(status.creator))
    throw new Error('Deployment success was not confirmed by Vercel.');
  let dashboard = dashboardUrl(status);
  if (!dashboard) {
    // Vercel's deployment status links point to the deployment itself. The
    // authenticated commit status supplies the team/project dashboard link.
    const commitStatuses = await github.paginate(
      github.rest.repos.listCommitStatusesForRef,
      {
        ...params(context),
        ref: deployment.sha,
        per_page: 100,
      },
    );
    for (const commitStatus of commitStatuses) {
      if (
        commitStatus.state === 'success' &&
        commitStatus.context === 'Vercel' &&
        vercelBot(commitStatus.creator)
      ) {
        dashboard = dashboardUrl(commitStatus);
        if (dashboard) break;
      }
    }
  }
  if (!dashboard)
    throw new Error(
      'Deployment status does not identify the expected Vercel team and project.',
    );
  const url = deploymentUrl(status.environment_url);
  releaseTag(status.created_at);
  const { data: comparison } = await github.rest.repos.compareCommits({
    ...params(context),
    base: deployment.sha,
    head: 'main',
  });
  if (!['identical', 'ahead'].includes(comparison.status))
    throw new Error('Deployed commit is not on main.');
  return {
    eligible: true,
    sha: deployment.sha,
    deploymentId: deployment.id,
    successAt: status.created_at,
    deploymentUrl: url,
    dashboardUrl: dashboard,
  };
}

async function commitForRef(github, scope, ref) {
  let object = ref.object;
  const seen = new Set();
  while (object.type === 'tag') {
    if (seen.has(object.sha) || seen.size >= 8)
      throw new Error('Invalid annotated tag chain.');
    seen.add(object.sha);
    ({
      data: { object },
    } = await github.rest.git.getTag({ ...scope, tag_sha: object.sha }));
  }
  return object.type === 'commit' ? object.sha : null;
}

export async function publishRelease({ github, context, core }) {
  const deployment = await inspectDeployment({ github, context, core });
  if (!deployment.eligible) return deployment;
  const scope = params(context),
    sha = deployment.sha;
  const dryRun =
    context.eventName === 'workflow_dispatch' &&
    String(context.payload.inputs?.dry_run ?? 'true') !== 'false';
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...scope,
    per_page: 100,
  });
  const refs = await github.paginate(github.rest.git.listMatchingRefs, {
    ...scope,
    ref: 'tags/rel-',
  });
  const matching = [];
  for (const ref of refs.filter((ref) =>
    TAG.test(ref.ref.slice('refs/tags/'.length)),
  )) {
    if ((await commitForRef(github, scope, ref)) === sha)
      matching.push(ref.ref.slice('refs/tags/'.length));
  }
  matching.sort();
  for (const tag of matching) {
    const existing = releases.find((release) => release.tag_name === tag);
    if (existing) {
      if (existing.draft || existing.prerelease)
        throw new Error('Matching tag is reserved by a draft or prerelease.');
      return { reused: true, tag, sha, url: existing.html_url };
    }
  }
  let tag = matching[0];
  if (!tag) {
    for (let offset = 0; offset < 60; offset++) {
      const candidate = releaseTag(
        new Date(Date.parse(deployment.successAt) + offset * 1000),
      );
      const occupied = refs.find((ref) => ref.ref === `refs/tags/${candidate}`);
      if (occupied) continue;
      if (dryRun) {
        tag = candidate;
        break;
      }
      try {
        await github.rest.git.createRef({
          ...scope,
          ref: `refs/tags/${candidate}`,
          sha,
        });
        tag = candidate;
        break;
      } catch (error) {
        if (error.status !== 422) throw error;
        let ref;
        try {
          ({ data: ref } = await github.rest.git.getRef({
            ...scope,
            ref: `tags/${candidate}`,
          }));
        } catch {
          throw error;
        }
        if ((await commitForRef(github, scope, ref)) === sha) {
          tag = candidate;
          break;
        }
      }
    }
  }
  if (!tag)
    throw new Error('No free release timestamp; existing tags were preserved.');
  if (dryRun)
    return { dryRun: true, tag, sha, deploymentId: deployment.deploymentId };
  const { data: notes } = await github.rest.repos.generateReleaseNotes({
    ...scope,
    tag_name: tag,
    target_commitish: sha,
  });
  const body = [
    `<!-- commit-trail-production-release:${sha} -->`,
    `<!-- commit-trail-deployment:${deployment.deploymentId} -->`,
    '## Production deployment',
    `- Commit: [\`${sha.slice(0, 7)}\`](https://github.com/${REPOSITORY}/commit/${sha})`,
    `- Production: ${PRODUCTION_URL}`,
    `- Deployment: ${deployment.deploymentUrl}`,
    `- Build logs: ${deployment.dashboardUrl}`,
    `- Successful deployment: ${new Date(deployment.successAt).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false })} (Asia/Seoul)`,
    '',
    notes.body,
  ].join('\n');
  const latestTag = releases
    .filter(
      (release) =>
        !release.draft && !release.prerelease && TAG.test(release.tag_name),
    )
    .map((release) => release.tag_name)
    .sort()
    .at(-1);
  try {
    const { data: release } = await github.rest.repos.createRelease({
      ...scope,
      tag_name: tag,
      target_commitish: sha,
      name: tag,
      body,
      draft: false,
      prerelease: false,
      make_latest: !latestTag || tag > latestTag ? 'true' : 'false',
    });
    return { created: true, tag, sha, url: release.html_url };
  } catch (error) {
    if (error.status !== 422) throw error;
    const { data: existing } = await github.rest.repos.getReleaseByTag({
      ...scope,
      tag,
    });
    const { data: ref } = await github.rest.git.getRef({
      ...scope,
      ref: `tags/${tag}`,
    });
    if (
      existing.draft ||
      existing.prerelease ||
      (await commitForRef(github, scope, ref)) !== sha
    )
      throw error;
    return { reused: true, tag, sha, url: existing.html_url };
  }
}
