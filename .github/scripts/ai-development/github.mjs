import { setTimeout as wait } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { NeedsHuman, pullMarker, reviewMarker } from './engine.mjs';
import { agents, config } from './config.mjs';
import { verifyCredentialIsolation } from './credentials.mjs';

const bot = 'github-actions[bot]';
const stateMarker = /<!-- commit-trail-ai-state:([a-zA-Z0-9+/=]+) -->/;
const shaPattern = /^[a-f0-9]{40}$/;

function plain(value) {
  return String(value)
    .replaceAll('@', '@\u200b')
    .replace(/[\\\n\r<>\u202a-\u202e]/g, ' ')
    .replace(/[[\]\x60*_#!~|]/g, '\\$&');
}

function stateBody(state) {
  const encoded = Buffer.from(JSON.stringify(state)).toString('base64');
  const status = `**AI 개발 상태** · ` + '`' + state.status + '`';
  const head = `기록된 커밋 ` + '`' + state.head + '`';
  const pull = state.pull ? ` · PR #${state.pull}` : '';
  const detail = state.detail
    ? `\n\n개발 에이전트가 보고한 사유 · ${plain(state.detail)}`
    : '';
  return `${status}\n\n${head}${pull} · Actions 실행 ${state.runId}\n\n${state.reason}${detail}\n\n<!-- commit-trail-ai-state:${encoded} -->`;
}

export function createGitHub({
  repository,
  token,
  publishingToken,
  request = fetch,
  sleep = wait,
}) {
  const repo = `https://api.github.com/repos/${repository}`;
  const [owner, repoName] = repository.split('/');
  const reviewChecks = new Map();

  async function verifyCredentials() {
    if (!publishingToken)
      throw new NeedsHuman(
        '게시 전에 ai-development Environment에 AI_AUTOMATION_TOKEN을 설정하세요.',
      );
    await verifyCredentialIsolation(
      (target) => api(target, { credentialCheck: true }),
      { environment: config.credentialsEnvironment, base: config.base },
    );
  }

  async function api(
    path,
    {
      method = 'GET',
      payload,
      publish = false,
      credentialCheck = false,
      beforeWrite,
    } = {},
  ) {
    try {
      if (publish) await verifyCredentials();
      await beforeWrite?.();
    } catch (error) {
      throw Object.assign(error, { writeRejected: true });
    }
    const url =
      path === '/graphql' ? 'https://api.github.com/graphql' : `${repo}${path}`;
    let response;
    for (let attempt = 0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
      try {
        response = await request(url, {
          method,
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${(publish || credentialCheck) && publishingToken ? publishingToken : token}`,
            'content-type': 'application/json',
            'user-agent': 'commit-trail-ai-development',
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(20_000),
          body: payload === undefined ? undefined : JSON.stringify(payload),
        });
      } catch {
        if (method !== 'GET' || attempt) {
          throw new Error(
            `GitHub ${method} 요청의 응답을 확인할 수 없습니다. Actions 로그를 확인하고 수동 재개하세요.`,
          );
        }
        continue;
      }
      if (method !== 'GET' || response.status < 500 || attempt) break;
      await response.body?.cancel();
      await wait(1000);
    }
    if (!response.ok) {
      throw Object.assign(
        new Error(
          `GitHub ${method} 요청에 실패했습니다 (HTTP ${response.status}). Actions 설정과 토큰 권한을 확인하세요.`,
        ),
        {
          status: response.status,
          writeRejected: [400, 401, 403, 404, 409, 422].includes(
            response.status,
          ),
        },
      );
    }
    return response.status === 204 ? undefined : response.json();
  }

  async function findComment(number, predicate) {
    for (let page = 1; ; page++) {
      const comments = await api(
        `/issues/${number}/comments?per_page=100&page=${page}`,
      );
      const comment = comments.find(
        (item) => item.user?.login === bot && predicate(item.body),
      );
      if (comment || comments.length < 100) return comment;
    }
  }

  // The second parent of a merge of `previous` and the base branch, or null for anything else.
  async function refreshedBase(sha, previous) {
    const commit = await api(`/commits/${sha}`);
    const [first, second] = commit.parents;
    return commit.parents.length === 2 &&
      first.sha === previous &&
      shaPattern.test(second.sha)
      ? second.sha
      : null;
  }

  async function baseAdvanced(previous, current) {
    const comparison = await api(
      `/compare/${previous}...${current}?per_page=1`,
    );
    return comparison.status === 'ahead';
  }

  async function mergedRefreshBase(state, head, baseRef) {
    const base = await refreshedBase(head, state.head);
    const target =
      state.pendingRefresh === true ? state.base : state.pendingRefresh;
    if (!base || base === state.base) return null;
    if (!target || base === target) return base;
    const live = await branchHead(baseRef);
    return live &&
      (await baseAdvanced(target, base)) &&
      (base === live || (await baseAdvanced(base, live)))
      ? base
      : null;
  }

  async function branchHead(branch) {
    try {
      const ref = await api(`/git/ref/heads/${branch}`);
      return ref.object.sha;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  const addComment = (number, body) =>
    api(`/issues/${number}/comments`, {
      method: 'POST',
      payload: { body },
    });

  function pullBody(state) {
    return [
      '## 변경 배경',
      `Closes #${state.issue} · 개발 담당 ${agents[state.developer].name}`,
      '## 변경 내용',
      plain(state.summary),
      '## 검증',
      '격리 환경에서 변경 범위에 필요한 검사를 통과했습니다. 문서만 변경하면 포맷을 검사하며, 그 외에는 테스트와 빌드도 실행합니다. 교차 리뷰와 필수 GitHub CI 결과는 후속 기록을 확인하세요.',
      pullMarker(state.issue),
      `Generated by ${agents[state.developer].name}`,
    ].join('\n\n');
  }

  async function issueDependencies(issue, direction) {
    const dependencies = [];
    for (let page = 1; ; page++) {
      const issues = await api(
        `/issues/${issue}/dependencies/${direction}?per_page=100&page=${page}`,
      );
      if (!Array.isArray(issues))
        throw new Error('Invalid issue dependency list');
      for (const item of issues) {
        if (
          !Number.isSafeInteger(item?.number) ||
          item.number < 1 ||
          typeof item.repository_url !== 'string'
        )
          throw new Error('Invalid issue dependency');
        dependencies.push({
          number: item.number,
          local: item.repository_url.toLowerCase() === repo.toLowerCase(),
        });
      }
      if (issues.length < 100) return dependencies;
    }
  }

  async function* graphPages(query, parameters, select) {
    let after = null;
    const seen = new Set();
    for (;;) {
      const response = await api('/graphql', {
        method: 'POST',
        payload: {
          query,
          variables: { owner, repo: repoName, ...parameters, after },
        },
      });
      if (response.errors?.length)
        throw new Error('GraphQL connection could not be verified');
      const connection = select(response.data?.repository);
      if (
        !Array.isArray(connection?.nodes) ||
        typeof connection.pageInfo?.hasNextPage !== 'boolean'
      )
        throw new Error('GraphQL connection could not be verified');
      yield connection.nodes;
      if (!connection.pageInfo.hasNextPage) return;
      after = connection.pageInfo.endCursor;
      if (typeof after !== 'string' || !after || seen.has(after))
        throw new Error('Invalid GraphQL cursor');
      seen.add(after);
    }
  }

  return {
    verifyCredentials,
    issue(number) {
      return api(`/issues/${number}`);
    },
    blockedBy: (issue) => issueDependencies(issue, 'blocked_by'),
    blocking: (issue) => issueDependencies(issue, 'blocking'),
    async closeIssue(number) {
      const issue = await api(`/issues/${number}`);
      if (issue.state === 'closed' && issue.state_reason === 'completed')
        return;
      if (issue.state !== 'open')
        throw new NeedsHuman(
          'Issue가 completed 이외의 사유로 닫혀 있습니다. 현재 종료 상태를 확인하세요.',
        );
      let closed;
      try {
        closed = await api(`/issues/${number}`, {
          method: 'PATCH',
          payload: { state: 'closed', state_reason: 'completed' },
        });
      } catch (error) {
        closed = await api(`/issues/${number}`);
        if (closed.state !== 'closed' || closed.state_reason !== 'completed')
          throw error;
      }
      if (closed.state !== 'closed' || closed.state_reason !== 'completed')
        throw new Error('Issue 종료 상태를 확인할 수 없습니다.');
    },

    async hasMergedClosingPull(issue, base) {
      for await (const nodes of graphPages(
        `query ClosingPulls($owner: String!, $repo: String!, $issue: Int!, $after: String) {
          repository(owner: $owner, name: $repo) {
            issue(number: $issue) {
              closedByPullRequestsReferences(first: 50, after: $after) {
                nodes { merged baseRefName baseRepository { nameWithOwner } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        { issue },
        (repo) => repo?.issue?.closedByPullRequestsReferences,
      )) {
        if (
          nodes.some(
            (pr) =>
              pr?.merged === true &&
              pr.baseRefName === base &&
              pr.baseRepository?.nameWithOwner?.toLowerCase() ===
                repository.toLowerCase(),
          )
        )
          return true;
      }
      return false;
    },
    async closingIssues(pull, sha, base) {
      const issues = new Set();
      for await (const nodes of graphPages(
        `query ClosingIssues($owner: String!, $repo: String!, $pull: Int!, $after: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pull) {
              merged
              baseRefName
              mergeCommit { oid }
              closingIssuesReferences(first: 50, after: $after) {
                nodes { number repository { nameWithOwner } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        { pull },
        (repo) => {
          const pr = repo?.pullRequest;
          if (
            pr?.merged !== true ||
            pr.baseRefName !== base ||
            pr.mergeCommit?.oid !== sha
          )
            throw new Error('Merged pull request could not be verified');
          return pr.closingIssuesReferences;
        },
      )) {
        for (const issue of nodes) {
          if (
            Number.isSafeInteger(issue?.number) &&
            issue.number > 0 &&
            issue.repository?.nameWithOwner?.toLowerCase() ===
              repository.toLowerCase()
          )
            issues.add(issue.number);
        }
      }
      return [...issues];
    },
    async previewRequested(pull) {
      for await (const nodes of graphPages(
        `query PreviewIssues($owner: String!, $repo: String!, $pull: Int!, $after: String) {
          repository(owner: $owner, name: $repo) {
            pullRequest(number: $pull) {
              closingIssuesReferences(first: 50, after: $after) {
                nodes { state repository { nameWithOwner } labels(first: 100) { nodes { name } pageInfo { hasNextPage } } }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        }`,
        { pull },
        (repo) => repo?.pullRequest?.closingIssuesReferences,
      )) {
        for (const issue of nodes) {
          if (
            issue.state !== 'OPEN' ||
            issue.repository?.nameWithOwner?.toLowerCase() !==
              repository.toLowerCase()
          )
            continue;
          if (!issue.labels || issue.labels.pageInfo?.hasNextPage)
            throw new Error('연결된 Issue의 라벨을 모두 확인할 수 없습니다.');
          const labels = issue.labels.nodes.map(({ name }) => name);
          if (labels.includes('preview') && !labels.includes('ai:stop'))
            return true;
        }
      }
      return false;
    },
    async previewCheck({ pull, head }) {
      for (let page = 1; ; page++) {
        const { check_runs: checks } = await api(
          `/commits/${head}/check-runs?check_name=Vercel+Preview&filter=all&per_page=100&page=${page}`,
        );
        const check = checks.find(
          (entry) =>
            entry.app?.slug === 'github-actions' &&
            entry.head_sha === head &&
            entry.external_id === `commit-trail-vercel-preview:${pull}:${head}`,
        );
        if (check || checks.length < 100) return check;
      }
    },
    setPreviewCheck(
      { pull, head },
      { id, deployment, url, conclusion, summary },
    ) {
      const payload = {
        name: 'Vercel Preview',
        external_id: `commit-trail-vercel-preview:${pull}:${head}`,
        status: conclusion ? 'completed' : 'in_progress',
        ...(conclusion ? { conclusion } : {}),
        ...(url ? { details_url: url } : {}),
        output: {
          title: 'Vercel Preview',
          summary,
          text: deployment ?? 'reserved',
        },
      };
      return id
        ? api(`/check-runs/${id}`, { method: 'PATCH', payload })
        : api('/check-runs', {
            method: 'POST',
            payload: { ...payload, head_sha: head },
          });
    },
    dispatchDependencyResume(issue, ref, dependencyResume) {
      return api('/actions/workflows/ai-development.yml/dispatches', {
        method: 'POST',
        payload: {
          ref,
          inputs: { issue: String(issue), dependency_resume: dependencyResume },
        },
      });
    },
    dispatchBaseRecovery(issue, ref, reservation) {
      return api('/actions/workflows/ai-development.yml/dispatches', {
        method: 'POST',
        payload: {
          ref,
          inputs: { issue: String(issue), base_recovery: reservation },
        },
      });
    },
    async hasActiveDevelopment(issue, base, { runId, attempt }) {
      const title = `AI development for Issue #${issue}`;
      const active = [
        'queued',
        'pending',
        'waiting',
        'requested',
        'in_progress',
      ];
      const matches = await Promise.all(
        active.map(async (status) => {
          for (let page = 1; ; page++) {
            const query = new URLSearchParams({
              branch: base,
              status,
              per_page: '100',
              page: String(page),
            });
            const { workflow_runs: runs } = await api(
              `/actions/workflows/ai-development.yml/runs?${query}`,
            );
            if (!Array.isArray(runs))
              throw new Error('Invalid active run list');
            if (
              runs.some(
                (run) =>
                  (run.display_title === title ||
                    run.display_title?.startsWith(
                      `${title} · base recovery `,
                    )) &&
                  // The run that already saved the waiting state may still be closing.
                  (run.id !== runId || run.run_attempt !== attempt),
              )
            )
              return true;
            if (runs.length < 100) return false;
          }
        }),
      );
      return matches.some(Boolean);
    },
    pull(number) {
      return api(`/pulls/${number}`);
    },
    async pullAtHead(number, previous) {
      let pr = await api(`/pulls/${number}`);
      for (
        let retry = 0;
        retry < 2 && pr.state === 'open' && pr.head?.sha === previous;
        retry++
      ) {
        await sleep(1000);
        pr = await api(`/pulls/${number}`);
      }
      return pr;
    },
    async pullAfterMerge(number) {
      let pr = await api(`/pulls/${number}`);
      for (
        let retry = 0;
        retry < 5 && pr.state === 'open' && !pr.merged;
        retry++
      ) {
        await sleep(2000);
        pr = await api(`/pulls/${number}`);
      }
      return pr;
    },
    async changesAutomationPolicy(state, pr) {
      const policy =
        /^(?:AGENTS\.md|\.npmrc|\.nvmrc|(?:\.github\/(?:workflows|rulesets|scripts)\/)(?!.*\.test\.mjs$).+|\.prettierignore|prettier\.config\.mjs|package-lock\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|vercel\.json)$/;
      let scanned = 0;
      let packageChanged = false;
      if (
        !Number.isSafeInteger(pr.changed_files) ||
        pr.changed_files < 1 ||
        pr.changed_files > 3000
      )
        throw new NeedsHuman('PR의 정책 변경 범위를 모두 확인할 수 없습니다.');
      for (let page = 1; scanned < pr.changed_files; page++) {
        const files = await api(
          `/pulls/${state.pull}/files?per_page=100&page=${page}`,
        );
        if (!files.length)
          throw new NeedsHuman(
            'PR의 정책 변경 범위를 모두 확인할 수 없습니다.',
          );
        scanned += files.length;
        for (const { filename, previous_filename } of files) {
          if (
            [filename, previous_filename].some(
              (path) => path && policy.test(path),
            )
          )
            return true;
          if ([filename, previous_filename].includes('package.json'))
            packageChanged = true;
        }
      }
      if (!packageChanged) return false;
      const verificationSettings = async (sha) => {
        const file = await api(`/contents/package.json?ref=${sha}`);
        if (file.encoding !== 'base64')
          throw new NeedsHuman(
            'package.json의 검증 명령과 의존성을 확인할 수 없습니다.',
          );
        const {
          scripts,
          dependencies,
          devDependencies,
          optionalDependencies,
          peerDependencies,
          overrides,
        } = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
        return {
          scripts,
          dependencies,
          devDependencies,
          optionalDependencies,
          peerDependencies,
          overrides,
        };
      };
      return !isDeepStrictEqual(
        await verificationSettings(state.base),
        await verificationSettings(state.head),
      );
    },
    async canStart(actor) {
      const { permission } = await api(
        `/collaborators/${encodeURIComponent(actor)}/permission`,
      );
      return ['admin', 'maintain', 'write'].includes(permission);
    },
    ref: branchHead,
    mergedRefreshBase,
    baseAdvanced,
    async advanceEmptyBranch(state, current, beforeWrite) {
      const ref = await api(`/git/refs/heads/${state.branch}`, {
        method: 'PATCH',
        publish: true,
        beforeWrite,
        payload: { sha: current, force: false },
      });
      if (ref.object?.sha !== current)
        throw new Error(
          '빈 작업 브랜치의 기준 갱신 결과를 확인할 수 없습니다.',
        );
    },
    async updateBranch(state, beforeWrite) {
      // The publishing token makes the new HEAD start the regular pull_request CI.
      await api(`/pulls/${state.pull}/update-branch`, {
        method: 'PUT',
        publish: true,
        beforeWrite,
        payload: { expected_head_sha: state.head },
      }).catch((error) => {
        if (error.status === 422)
          throw Object.assign(
            new NeedsHuman(
              '최신 기준 브랜치를 작업 브랜치에 반영할 수 없습니다. 충돌이 있거나 브랜치가 변경되었습니다. PR을 수동으로 확인하세요.',
            ),
            { writeRejected: true },
          );
        throw error;
      });
      // GitHub merges in the background and answers before the branch moves.
      for (let attempt = 0; attempt < 15; attempt++) {
        await sleep(2000);
        const head = await branchHead(state.branch);
        if (!head || head === state.head) continue;
        const base = await mergedRefreshBase(state, head, config.base);
        if (base) return { head, base };
        throw new NeedsHuman(
          '작업 브랜치에 예상하지 못한 커밋이 있습니다. PR을 수동으로 확인하세요.',
        );
      }
      throw new Error(
        '작업 브랜치 갱신 결과를 확인할 수 없습니다. Actions 로그를 확인하고 수동 재개하세요.',
      );
    },
    createBranch(branch, sha, beforeWrite) {
      return api('/git/refs', {
        method: 'POST',
        publish: true,
        beforeWrite,
        payload: { ref: `refs/heads/${branch}`, sha },
      });
    },
    async commit(branch, expectedHeadOid, changes, message, beforeWrite) {
      const workflowChange = changes.some(({ path }) =>
        path.startsWith('.github/workflows/'),
      );
      const workflowPermission = () =>
        Object.assign(
          new NeedsHuman(
            '워크플로 커밋이 거부되었습니다. 게시 토큰의 Contents·Pull requests·Workflows 쓰기 권한(classic PAT는 workflow scope)을 확인한 뒤 기존 Issue 번호로 재개하세요.',
          ),
          { writeRejected: true },
        );
      const operation = await api('/graphql', {
        method: 'POST',
        publish: true,
        beforeWrite,
        payload: {
          query: `mutation Commit($input: CreateCommitOnBranchInput!) {
            createCommitOnBranch(input: $input) { commit { oid } }
          }`,
          variables: {
            input: {
              branch: {
                repositoryNameWithOwner: repository,
                branchName: branch,
              },
              expectedHeadOid,
              message,
              fileChanges: {
                additions: changes
                  .filter(({ text }) => text !== null)
                  .map(({ path, text }) => ({
                    path,
                    contents: Buffer.from(text).toString('base64'),
                  })),
                deletions: changes
                  .filter(({ text }) => text === null)
                  .map(({ path }) => ({ path })),
              },
            },
          },
        },
      }).catch((error) => {
        if (workflowChange && [403, 404].includes(error.status))
          throw workflowPermission();
        throw error;
      });
      const oid = operation.data?.createCommitOnBranch?.commit?.oid;
      if (!shaPattern.test(oid || '')) {
        if (operation.errors?.some(({ type }) => type === 'STALE_DATA'))
          throw Object.assign(
            new NeedsHuman(
              '커밋 직전에 브랜치가 변경되었습니다. PR을 수동으로 확인하세요.',
            ),
            { writeRejected: true },
          );
        if (
          workflowChange &&
          operation.errors?.some(
            ({ type, message }) =>
              type === 'FORBIDDEN' ||
              /workflow|permission|not accessible|not permitted/i.test(message),
          )
        )
          throw workflowPermission();
        throw new Error(
          'GraphQL 커밋 결과를 확인할 수 없습니다. 브랜치 권한을 확인하고 기존 상태에서 수동 재개하세요.',
        );
      }
      return oid;
    },
    async isOperation(sha, parent, operation) {
      const commit = await api(`/commits/${sha}`);
      return (
        commit.parents.length === 1 &&
        commit.parents[0].sha === parent &&
        commit.commit.message.split('\n').includes(`AI-Operation: ${operation}`)
      );
    },
    findPull(branch) {
      return api(
        `/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=100`,
      );
    },
    matchesCreatedPull(pr, state) {
      return pr.body === pullBody(state);
    },
    createPull(state, base, beforeWrite) {
      return api('/pulls', {
        method: 'POST',
        publish: true,
        beforeWrite,
        payload: {
          head: state.branch,
          base,
          title: state.title,
          draft: true,
          body: pullBody(state),
        },
      });
    },
    matchesPull(pr, state, base, { allowReady = false, merged = false } = {}) {
      return (
        (merged
          ? pr.merged === true && shaPattern.test(pr.merge_commit_sha || '')
          : pr.state === 'open' && (allowReady || pr.draft === true)) &&
        pr.base.ref === base &&
        pr.base.repo.full_name === repository &&
        pr.head.repo?.full_name === repository &&
        pr.head.ref === state.branch &&
        pr.head.sha === state.head
      );
    },
    async markReady(pullRequestId, head) {
      const response = await api('/graphql', {
        method: 'POST',
        payload: {
          query: `mutation MarkReady($input: MarkPullRequestReadyForReviewInput!) {
            markPullRequestReadyForReview(input: $input) {
              pullRequest { isDraft headRefOid }
            }
          }`,
          variables: { input: { pullRequestId } },
        },
      });
      const pr = response.data?.markPullRequestReadyForReview?.pullRequest;
      return pr?.isDraft === false && pr.headRefOid === head;
    },
    async squashMerge(state, base, beforeWrite) {
      if (base !== 'dev')
        throw new NeedsHuman('자동 스쿼시 머지는 dev 대상 PR에만 적용됩니다.');
      if (!publishingToken)
        throw new NeedsHuman(
          '자동 머지에는 기존 dev 푸시 CI를 시작할 AI_AUTOMATION_TOKEN이 필요합니다. 토큰을 설정하거나 PR을 수동으로 머지하세요.',
        );
      const { name, email } = agents[state.developer];
      const message = [
        plain(state.summary),
        state.revisionSummary && plain(state.revisionSummary),
        `Closes #${state.issue}`,
        `Co-authored-by: ${name} <${email}>`,
      ]
        .filter(Boolean)
        .join('\n\n');
      const result = await api(`/pulls/${state.pull}/merge`, {
        method: 'PUT',
        publish: true,
        beforeWrite,
        payload: {
          sha: state.head,
          merge_method: 'squash',
          commit_title: `${state.title} (#${state.pull})`,
          commit_message: message,
        },
      }).catch((error) => {
        if (error.status === 409)
          throw new NeedsHuman(
            '머지 요청 직전에 PR의 HEAD가 변경되었습니다. PR을 다시 검토하세요.',
          );
        if ([403, 405, 422].includes(error.status))
          throw Object.assign(
            new NeedsHuman(
              `GitHub가 자동 스쿼시 머지를 거부했습니다 (HTTP ${error.status}). PR의 필수 검사, 머지 조건과 토큰 권한을 확인하세요.`,
            ),
            { writeRejected: true },
          );
        throw error;
      });
      if (result.merged !== true || !shaPattern.test(result.sha || ''))
        throw new Error('GitHub 스쿼시 머지 결과를 확인할 수 없습니다.');
      return result.sha;
    },
    async loadState(issue) {
      const comment = await findComment(issue, (body) =>
        stateMarker.test(body),
      );
      if (!comment) return null;
      const state = JSON.parse(
        Buffer.from(comment.body.match(stateMarker)[1], 'base64').toString(),
      );
      if (
        state.version !== 1 ||
        state.issue !== issue ||
        !shaPattern.test(state.base) ||
        !shaPattern.test(state.head) ||
        !agents[state.developer] ||
        state.branch !== `ai/issue-${issue}-${state.developer}` ||
        !Array.isArray(state.reviews)
      )
        throw new Error(
          'Issue의 자동화 상태를 읽을 수 없습니다. 상태 댓글을 확인하세요.',
        );
      return { id: comment.id, state };
    },
    async saveState(issue, state, comment) {
      const body = stateBody(state);
      const saved = comment
        ? await api(`/issues/comments/${comment}`, {
            method: 'PATCH',
            payload: { body },
          })
        : await addComment(issue, body);
      return saved.id;
    },
    async notice(issue, message, key) {
      const marker = `<!-- commit-trail-ai-notice:${key} -->`;
      if (!(await findComment(issue, (body) => body.includes(marker))))
        await addComment(issue, `${message}\n\n${marker}`);
    },
    async setReviewCheck(state, { head, decision }) {
      const name = 'AI review';
      const externalId = `commit-trail-ai-review:${state.issue}:${head}`;
      const summary = {
        queued: '현재 커밋의 교차 리뷰를 기다리고 있습니다.',
        in_progress: '교차 리뷰 또는 지적 사항 수정이 진행 중입니다.',
        success: '현재 커밋의 교차 리뷰를 통과했습니다.',
        failure:
          '교차 리뷰 자동화가 실패했습니다. 연결된 Issue의 상태를 확인하세요.',
        action_required:
          '교차 리뷰를 완료하려면 확인 또는 조치가 필요합니다. PR 댓글과 연결된 Issue를 확인하세요.',
        neutral: '새 커밋이 올라와 이 커밋의 리뷰를 종료했습니다.',
      }[decision];
      if (!shaPattern.test(head) || !summary)
        throw new Error('Invalid review check');
      const active = ['queued', 'in_progress'].includes(decision);
      const payload = {
        name,
        external_id: externalId,
        details_url: `https://github.com/${repository}/issues/${state.issue}`,
        status: active ? decision : 'completed',
        ...(active ? {} : { conclusion: decision }),
        output: { title: name, summary },
      };
      let check = reviewChecks.get(externalId);
      if (!check) {
        for (let page = 1; ; page++) {
          const { check_runs: checks } = await api(
            `/commits/${head}/check-runs?check_name=AI+review&filter=all&per_page=100&page=${page}`,
          );
          check = checks.find(
            (check) =>
              check.app?.slug === 'github-actions' &&
              check.head_sha === head &&
              check.name === name &&
              check.external_id === externalId,
          );
          if (check || checks.length < 100) break;
        }
      }
      const saved =
        check && !(active && check.status === 'completed')
          ? await api(`/check-runs/${check.id}`, { method: 'PATCH', payload })
          : await api('/check-runs', {
              method: 'POST',
              payload: { ...payload, head_sha: head },
            });
      reviewChecks.set(externalId, { id: saved.id, status: saved.status });
    },
    async publishReview(state, { head, result }, reviewer) {
      const marker = reviewMarker(head);
      if (await findComment(state.pull, (body) => body.includes(marker)))
        return;
      const findings = result.findings.map(
        (finding) =>
          `- ${plain(finding.path)}:${finding.line} · ${plain(finding.defect)}\n  - 영향 · ${plain(finding.impact)}\n  - 재현 근거 · ${plain(finding.evidence)}\n  - 수정 방향 · ${plain(finding.fix)}`,
      );
      await addComment(
        state.pull,
        [
          `**AI 리뷰** · ${result.status} · ${head}`,
          plain(result.summary),
          findings.join('\n'),
          marker,
          `Generated by ${agents[reviewer].name}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
    },
    async ciRun(state, workflow) {
      const query = new URLSearchParams({
        branch: state.branch,
        head_sha: state.head,
        event: 'pull_request',
        per_page: '100',
      });
      const { workflow_runs: runs } = await api(
        `/actions/workflows/${encodeURIComponent(workflow)}/runs?${query}`,
      );
      return runs.find(
        (run) =>
          run.head_sha === state.head &&
          run.head_branch === state.branch &&
          run.head_repository?.full_name === repository &&
          (!run.pull_requests?.length ||
            run.pull_requests.some(({ number }) => number === state.pull)),
      );
    },
    async ciJobs(run) {
      const { jobs } = await api(
        `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
      );
      return jobs;
    },
    async ciLocations(job) {
      const id = job?.check_run_url?.match(/\/check-runs\/(\d+)$/)?.[1];
      if (!id) return [];
      const annotations = await api(
        `/check-runs/${id}/annotations?per_page=20`,
      );
      return annotations
        .filter(
          ({ annotation_level, path, start_line }) =>
            annotation_level === 'failure' &&
            /^[\p{L}\p{N}_.\/-]{1,160}$/u.test(path) &&
            Number.isSafeInteger(start_line) &&
            start_line > 0,
        )
        .slice(0, 3)
        .map(({ path, start_line }) => `${plain(path)}:${start_line}`);
    },
  };
}

export async function checkRequiredCI(github, config, state, guard) {
  await guard();
  const run = await github.ciRun(state, config.ciWorkflow);
  if (run?.conclusion === 'action_required' || run?.status === 'waiting')
    return {
      ok: false,
      status: 'approval_required',
      reason:
        '필수 CI 실행에 승인이 필요합니다. PR에서 Approve workflows to run을 누르면 CI 통과 후 자동으로 이어집니다.',
    };
  if (run?.status === 'completed') {
    const jobs = await github.ciJobs(run);
    const job = jobs.find(({ name }) => name === config.requiredJob);
    if (run.conclusion === 'success' && job?.conclusion === 'success')
      return { ok: true, url: run.html_url };
    const canceled =
      run.conclusion === 'cancelled' || job?.conclusion === 'cancelled';
    const step = job?.steps?.find(({ conclusion }) => conclusion === 'failure');
    const stage =
      step?.name && /^[a-zA-Z0-9 ._()-]{1,80}$/.test(step.name)
        ? ` 실패 단계 ${plain(step.name)}.`
        : '';
    const reason = canceled
      ? '현재 HEAD의 필수 CI가 취소되었습니다.'
      : '현재 HEAD의 필수 CI가 통과하지 못했습니다.';
    const result =
      !canceled &&
      /^[a-z_]{1,30}$/.test(run.conclusion ?? '') &&
      !['success', 'failure'].includes(run.conclusion)
        ? ` 워크플로 결과 ${plain(run.conclusion)}.`
        : '';
    const locations = canceled
      ? []
      : ((await github.ciLocations?.(job).catch(() => [])) ?? []);
    const evidence = locations.length
      ? ` GitHub가 기록한 위치 ${locations.join(', ')}.`
      : '';
    return {
      ok: false,
      failed: !canceled,
      status: canceled ? 'cancelled' : 'failure',
      reason: `${reason}${result}${stage}${evidence} CI가 이 커밋에서 통과하면 자동으로 이어집니다. ${job?.html_url ?? run.html_url}`,
    };
  }
  if (run)
    return {
      ok: false,
      status: 'pending',
      reason: `현재 HEAD의 필수 CI가 진행 중입니다. 완료 이벤트에서 자동으로 이어집니다. ${run.html_url}`,
    };
  return {
    ok: false,
    status: 'unconfirmed',
    reason:
      '현재 HEAD의 필수 CI 실행을 확인하지 못했습니다. PR에서 실행·승인 상태를 확인하고 필요할 때 수동 재개하세요. 같은 HEAD의 CI 완료 이벤트로도 이어갈 수 있습니다.',
  };
}
