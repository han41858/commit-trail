import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { config } from './ai-development/config.mjs';
import { createGitHub, checkRequiredCI } from './ai-development/github.mjs';

const shaPattern = /^[a-f0-9]{40}$/;
const deploymentPattern = /^dpl_[A-Za-z0-9]+$/;
const reservationPattern = /^reserved:([a-f0-9-]{36})$/;

function workPull(pr, repository) {
  return (
    pr?.state === 'open' &&
    pr.base?.ref === config.base &&
    pr.base.repo?.full_name === repository &&
    pr.head?.repo?.full_name === repository &&
    !['main', config.base].includes(pr.head.ref) &&
    shaPattern.test(pr.head.sha)
  );
}

export async function deployPreview({
  github,
  vercel,
  repository,
  pull,
  ciRun,
  suppliedDeployment,
  retry = false,
  sleep = () => wait(5000),
  attempts = 60,
}) {
  if (!workPull(pull, repository)) return;
  const state = {
    pull: pull.number,
    head: pull.head.sha,
    branch: pull.head.ref,
  };
  if (
    ciRun &&
    (state.head !== ciRun.head_sha ||
      state.branch !== ciRun.head_branch ||
      (ciRun.pull_requests?.length &&
        !ciRun.pull_requests.some(({ number }) => number === state.pull)))
  )
    return;

  async function eligible() {
    const current = await github.pull(state.pull);
    return (
      workPull(current, repository) &&
      current.head.sha === state.head &&
      current.head.ref === state.branch &&
      (await github.previewRequested(state.pull))
    );
  }

  if (!(await eligible())) return;
  const ci = await checkRequiredCI(github, config, state, async () => {});
  if (!ci.ok) return;
  async function notifyReady(url) {
    await github.notice(
      state.pull,
      `커밋 ${state.head}의 [Vercel 프리뷰](${url})가 준비됐습니다. AI PR은 확인 후 AI development의 preview_approved_head에 이 SHA를 입력해 주세요.`,
      `vercel-preview-${state.head}`,
    );
  }

  let check = await github.previewCheck(state);
  if (check?.conclusion === 'success') {
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(check.details_url || ''))
      await notifyReady(check.details_url);
    return;
  }
  vercel.verifyConfiguration();
  const recorded = check?.output?.text;
  const failed = check?.conclusion === 'failure';
  if (failed && !retry && !suppliedDeployment)
    throw new Error(
      '기존 Vercel 프리뷰가 실패했습니다. 원인을 확인한 뒤 수동 실행에서 retry를 선택하세요.',
    );
  if (
    suppliedDeployment &&
    (!deploymentPattern.test(suppliedDeployment) ||
      (deploymentPattern.test(recorded || '') &&
        suppliedDeployment !== recorded &&
        !failed))
  )
    throw new Error('현재 PR에 기록된 프리뷰 배포 ID를 확인하세요.');

  // Verify an adopted deployment before replacing a durable record.
  if (suppliedDeployment) await vercel.get(suppliedDeployment, state.head);
  let deployment =
    suppliedDeployment ||
    (deploymentPattern.test(recorded || '') && !(failed && retry)
      ? recorded
      : undefined);
  if (!deployment && check && !failed && recorded !== 'not-started') {
    deployment = await vercel.find(
      state,
      recorded?.match(reservationPattern)?.[1],
    );
    if (!deployment && !retry)
      throw new Error(
        '이전 프리뷰 요청의 배포를 찾지 못했습니다. Vercel을 확인한 뒤 수동 실행에서 retry를 선택하세요.',
      );
  }
  if (!(await eligible())) return;
  const reservation = randomUUID();
  if (!check || !deployment || check.status === 'completed') {
    check = await github.setPreviewCheck(state, {
      id: check?.status === 'completed' ? undefined : check?.id,
      deployment: deployment ?? `reserved:${reservation}`,
      summary: '현재 HEAD의 프리뷰 배포를 예약했습니다.',
    });
  }
  const id = check.id;
  if (!deployment) {
    if (!(await eligible())) {
      await github.setPreviewCheck(state, {
        id,
        conclusion: 'neutral',
        summary: 'PR의 HEAD 또는 프리뷰 요청이 변경됐습니다.',
        deployment: 'not-started',
      });
      return;
    }
    try {
      deployment = await vercel.create(
        {
          repoId: pull.head.repo.id,
          ref: state.branch,
          sha: state.head,
        },
        { pull: state.pull, reservation },
      );
    } catch (error) {
      if (error.rejected)
        await github.setPreviewCheck(state, {
          id,
          conclusion: 'action_required',
          summary: error.message,
          deployment: 'not-started',
        });
      throw error;
    }
    if (!deploymentPattern.test(deployment))
      throw new Error('Vercel 응답에서 배포 ID를 확인하지 못했습니다.');
  }
  await github.setPreviewCheck(state, {
    id,
    deployment,
    summary: 'Vercel 프리뷰 배포를 확인하고 있습니다.',
  });
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await vercel.get(deployment, state.head);
    if (result.readyState === 'READY') {
      await github.setPreviewCheck(state, {
        id,
        deployment,
        url: result.url,
        conclusion: 'success',
        summary: 'Details에서 이 커밋의 Vercel 프리뷰를 열 수 있습니다.',
      });
      await notifyReady(result.url);
      return;
    }
    if (['CANCELED', 'ERROR'].includes(result.readyState)) {
      await github.setPreviewCheck(state, {
        id,
        deployment,
        url: result.url,
        conclusion: 'failure',
        summary: 'Vercel 프리뷰 배포에 실패했습니다.',
      });
      throw new Error('Vercel 프리뷰 배포에 실패했습니다.');
    }
    if (attempt + 1 < attempts) await sleep();
  }
  throw new Error(
    'Vercel 프리뷰가 대기 중입니다. 워크플로를 다시 실행하면 기존 배포를 확인합니다.',
  );
}

export function createVercel({ token, project, team, request = fetch }) {
  function verifyConfiguration() {
    if (!token || !project?.startsWith('prj_') || !team?.startsWith('team_'))
      throw new Error(
        'vercel-preview Environment에 VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID를 설정하세요.',
      );
  }

  async function api(path, payload, query = {}) {
    const url = new URL(path, 'https://api.vercel.com');
    for (const [key, value] of Object.entries(query))
      url.searchParams.set(key, value);
    url.searchParams.set('teamId', team);
    const response = await request(url, {
      method: payload ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw Object.assign(
        new Error(`Vercel 프리뷰 API 요청 실패 (HTTP ${response.status}).`),
        { rejected: [400, 401, 403, 404, 422, 429].includes(response.status) },
      );
    return response.json();
  }

  return {
    verifyConfiguration,
    async create(source, { pull, reservation } = {}) {
      const result = await api('/v13/deployments', {
        name: 'commit-trail',
        project,
        gitSource: { type: 'github', ...source },
        ...(pull
          ? {
              meta: {
                commitTrailPreviewPull: String(pull),
                commitTrailPreviewRequest: reservation,
              },
            }
          : {}),
      });
      return result.id;
    },
    async find({ pull, head, branch }, reservation) {
      const { deployments, pagination } = await api(
        '/v7/deployments',
        undefined,
        {
          projectId: project,
          sha: head,
          branch,
          limit: 100,
        },
      );
      if (!Array.isArray(deployments) || !pagination)
        throw new Error('Vercel 배포 목록을 확인할 수 없습니다.');
      const matching = deployments.filter(
        (deployment) =>
          deployment.projectId === project &&
          deployment.target === null &&
          deployment.meta?.commitTrailPreviewPull === String(pull) &&
          (!reservation ||
            deployment.meta.commitTrailPreviewRequest === reservation) &&
          deploymentPattern.test(deployment.uid),
      );
      if (
        matching.length > 1 ||
        (matching.length === 0 && pagination.next != null)
      )
        throw new Error(
          '기존 프리뷰를 하나로 확인할 수 없습니다. 배포 ID를 입력하세요.',
        );
      return matching[0]?.uid;
    },
    async get(id, head) {
      const result = await api(`/v13/deployments/${id}`);
      const sha = result.gitSource?.sha || result.meta?.githubCommitSha;
      if (
        result.id !== id ||
        result.projectId !== project ||
        result.target !== null ||
        sha !== head ||
        !/^[a-z0-9-]+\.vercel\.app$/.test(result.url || '')
      ) {
        throw new Error(
          'Vercel 배포가 요청한 프로젝트·프리뷰·HEAD와 일치하지 않습니다.',
        );
      }
      return { readyState: result.readyState, url: `https://${result.url}` };
    },
  };
}

async function main() {
  const env = process.env;
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const repository = env.GITHUB_REPOSITORY;
  if (
    env.GITHUB_REF !== `refs/heads/${config.base}` ||
    event.repository?.full_name !== repository ||
    event.repository.default_branch !== config.base ||
    !env.GH_TOKEN
  )
    return;
  const github = createGitHub({ repository, token: env.GH_TOKEN });

  const run = event.workflow_run;
  let pull;
  let suppliedDeployment;
  let retry = false;
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    if (
      run?.path !== `.github/workflows/${config.ciWorkflow}` ||
      run.event !== 'pull_request' ||
      run.status !== 'completed' ||
      run.conclusion !== 'success' ||
      run.head_repository?.full_name !== repository ||
      !run.head_branch ||
      !shaPattern.test(run.head_sha)
    )
      return;
    const pulls = (await github.findPull(run.head_branch)).filter(
      (pr) =>
        workPull(pr, repository) &&
        pr.head.sha === run.head_sha &&
        (!run.pull_requests?.length ||
          run.pull_requests.some(({ number }) => number === pr.number)),
    );
    if (pulls.length !== 1) return;
    [pull] = pulls;
  } else if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    const number = Number(event.inputs?.pull);
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      !event.sender?.login ||
      !(await github.canStart(event.sender.login))
    )
      return;
    pull = await github.pull(number);
    suppliedDeployment = event.inputs?.deployment;
    retry = event.inputs?.retry === 'true';
  } else return;

  if (!workPull(pull, repository)) return;
  if (process.argv.includes('--identify')) {
    if (!(await github.previewRequested(pull.number))) return;
    appendFileSync(env.GITHUB_OUTPUT, `head=${pull.head.sha}\n`);
    return;
  }
  if (pull.head.sha !== env.PREVIEW_HEAD) return;
  await deployPreview({
    github,
    repository,
    pull,
    ciRun: run,
    suppliedDeployment,
    retry,
    vercel: createVercel({
      token: env.VERCEL_TOKEN,
      project: env.VERCEL_PROJECT_ID,
      team: env.VERCEL_TEAM_ID,
    }),
  });
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
