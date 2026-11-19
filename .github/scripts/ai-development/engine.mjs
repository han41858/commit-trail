import { createHash, randomUUID } from 'node:crypto';
import { agents } from './config.mjs';

export const executionLabels = new Map([
  ['ai:develop', 'codex'],
  ['ai:develop:codex', 'codex'],
  ['ai:develop:claude', 'claude'],
]);

export const activeStates = new Set([
  'queued',
  'developing',
  'reviewing',
  'revising',
  'merging',
]);

export class NeedsHuman extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail;
  }
}

const digest = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fingerprint = ({ title, body }) => digest([title, body ?? '']);
const labelNames = (issue) => issue.labels.map(({ name }) => name);
const otherAgent = (developer) => (developer === 'codex' ? 'claude' : 'codex');
const hasPassingReview = (state) => {
  const latest = state.reviews.at(-1);
  return latest?.head === state.head && latest.result.status === 'pass';
};

export const pullMarker = (issue) => `<!-- commit-trail-ai-issue:${issue} -->`;
export const reviewMarker = (sha) => `<!-- commit-trail-ai-review:${sha} -->`;

function defectSignatures({ findings }) {
  const normalize = (value) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return findings.map(({ path, defect }) => `${path}\0${normalize(defect)}`);
}

function commitMessage(plan, developer, operation) {
  const { name, email } = agents[developer];
  return {
    headline: plan.title,
    body: `AI-Operation: ${operation}\n\nCo-authored-by: ${name} <${email}>`,
  };
}

async function confirmedMerge(github, state, base) {
  const pr = await github.pull(state.pull);
  if (
    github.matchesPull(pr, state, base, { merged: true }) &&
    fingerprint(pr) === state.pullFingerprint
  )
    return pr.merge_commit_sha;
}

// Editing the state comment sends no notification, so a stop also gets its own comment.
async function notifyStop(github, issue, state) {
  try {
    await github.notice(
      issue,
      `**AI 개발 중단** · ` +
        '`' +
        state.status +
        '`' +
        `\n\n${state.reason}\n\n상태 댓글과 Actions 실행 ${state.runId}을 확인하세요.`,
      `stop-${state.runId}-${state.attempt}`,
    );
  } catch (error) {
    console.warn(`중단 알림 댓글을 남기지 못했습니다. ${error.message}`);
  }
}

function mergedMessage(state, base) {
  return `PR #${state.pull}이 ${base}에 머지되었습니다. 머지 커밋 ${state.mergeCommit}.`;
}

export async function runPipeline({
  github,
  develop,
  review,
  checkCI,
  verifyConfiguration,
  config,
  issueNumber,
  eventLabel,
  resume,
  ciCompletion,
  runId,
  attempt,
}) {
  const existing = await github.loadState(issueNumber);
  if (ciCompletion) {
    const previous = existing?.state;
    if (
      !previous?.awaitingCI ||
      !['needs_human', 'failed'].includes(previous.status) ||
      !previous.pull ||
      previous.head !== ciCompletion.head_sha ||
      previous.branch !== ciCompletion.head_branch ||
      !hasPassingReview(previous)
    )
      return;
  }
  if (existing && !resume) return;
  if (!existing && resume)
    throw new NeedsHuman(
      '이 Issue에 재개할 기존 실행이 없습니다. 최초 실행은 실행 라벨로 시작하세요.',
    );

  const issue = await github.issue(issueNumber);
  if (issue.pull_request || (ciCompletion && issue.state !== 'open')) return;

  const labels = labelNames(issue);
  const selected = labels.filter((label) => executionLabels.has(label));
  if (
    !existing &&
    (!executionLabels.has(eventLabel) || !selected.includes(eventLabel))
  )
    return;
  if (!existing && selected.length > 1) {
    await github.notice(
      issueNumber,
      '실행 라벨이 여러 개라 개발을 시작할 수 없습니다. 실행 라벨을 제거한 뒤 원하는 라벨 하나를 다시 추가하세요.',
      'label-conflict',
    );
    return;
  }
  if (!existing && (issue.state !== 'open' || labels.includes('ai:stop')))
    return;

  const developer =
    existing?.state.developer ?? executionLabels.get(eventLabel);
  const reviewer = otherAgent(developer);
  const branch = `ai/issue-${issueNumber}-${developer}`;
  const initialBase = existing?.state.base ?? (await github.ref(config.base));
  if (!initialBase)
    throw new Error(`기본 브랜치 ${config.base}를 조회할 수 없습니다.`);
  const state = existing?.state ?? {
    version: 1,
    issue: issueNumber,
    issueFingerprint: fingerprint(issue),
    developer,
    branch,
    base: initialBase,
    head: initialBase,
    pull: null,
    reviews: [],
  };
  let recordId = existing?.id;
  let awaitingCI = false;

  async function save(status, reason, detail) {
    Object.assign(state, { status, reason, detail, runId, attempt });
    recordId = await github.saveState(issueNumber, state, recordId);
  }

  async function guard({ recovering = false, staleBase = false } = {}) {
    const currentIssue = await github.issue(issueNumber);
    if (
      currentIssue.state !== 'open' ||
      labelNames(currentIssue).includes('ai:stop')
    )
      throw new NeedsHuman(
        'Issue가 닫혔거나 ai:stop 라벨이 적용되었습니다. 재개하려면 Issue를 열고 중지 라벨을 제거하세요.',
      );
    if (fingerprint(currentIssue) !== state.issueFingerprint)
      throw new NeedsHuman(
        'Issue 제목 또는 본문이 변경되었습니다. 기존 작업을 확인하고 변경된 요청은 새 Issue에서 시작하세요.',
      );

    const remote = await github.ref(branch);
    if (!remote && state.branchCreated)
      throw new NeedsHuman(
        '작업 브랜치가 삭제되었습니다. 기존 PR과 브랜치를 수동으로 확인하세요.',
      );
    if (
      remote !== state.head &&
      (remote || state.head !== state.base || state.pull)
    ) {
      // A base update whose response was lost left a merge of the recorded HEAD and dev.
      const refreshed =
        recovering && state.pendingRefresh && remote
          ? await github.refreshedBase(remote, state.head)
          : null;
      if (refreshed) {
        applyRefresh({ head: remote, base: refreshed });
        await save(state.status, '직전 실행의 브랜치 갱신을 복구했습니다.');
      } else if (
        !recovering ||
        !state.pendingCommit ||
        !remote ||
        !(await github.isOperation(remote, state.head, state.pendingCommit))
      ) {
        throw new NeedsHuman(
          `작업 브랜치 HEAD가 변경되었거나 브랜치가 삭제되었습니다. 확인한 HEAD ${remote ?? '없음'}. 현재 PR을 수동으로 검토하세요.`,
        );
      } else {
        state.head = remote;
        state.branchCreated = true;
        delete state.pendingCommit;
        await save(state.status, '직전 실행이 기록한 커밋을 복구했습니다.');
      }
    }
    if (remote === state.base && !state.branchCreated)
      throw new NeedsHuman(
        '같은 이름의 작업 브랜치를 자동 실행이 생성했는지 확인할 수 없습니다. 기존 브랜치를 확인하세요.',
      );

    let pr;
    if (state.pull) {
      pr = await github.pull(state.pull);
      if (
        !github.matchesPull(pr, state, config.base, {
          allowReady: hasPassingReview(state) || state.readied === true,
        }) ||
        fingerprint(pr) !== state.pullFingerprint
      ) {
        throw new NeedsHuman(
          'PR이 닫혔거나 제목·본문·초안·대상 브랜치·HEAD가 변경되었습니다. 기존 PR을 수동으로 확인하세요.',
        );
      }
    }
    if (!staleBase && (await github.ref(config.base)) !== state.base)
      throw new NeedsHuman(
        `${config.base} 브랜치가 작업 시작 후 변경되었습니다. AI development를 이 Issue 번호로 다시 실행하면 최신 ${config.base}를 반영한 뒤 리뷰와 CI를 다시 진행합니다.`,
      );
    return { remote, pr };
  }

  function applyRefresh({ head, base }) {
    state.base = base;
    state.head = head;
    state.branchCreated = true;
    delete state.pendingRefresh;
    delete state.awaitingCI;
  }

  // Runs only between development and review steps, never while a snapshot of the old HEAD is in use.
  async function refreshBase() {
    const current = await github.ref(config.base);
    if (!current)
      throw new Error(`기본 브랜치 ${config.base}를 조회할 수 없습니다.`);
    if (current === state.base) return;
    if (state.head === state.base && !state.branchCreated && !state.pull) {
      state.base = current;
      state.head = current;
      await save(
        state.status,
        `${config.base}의 새 커밋을 기준으로 시작합니다.`,
      );
      return;
    }
    if (!state.pull)
      throw new NeedsHuman(
        `${config.base} 브랜치가 변경되었지만 갱신할 PR이 없습니다. 작업 브랜치를 수동으로 확인하세요.`,
      );
    state.pendingRefresh = true;
    await save(
      state.status,
      `${config.base}의 새 커밋을 작업 브랜치에 반영하고 있습니다.`,
    );
    applyRefresh(await github.updateBranch(state));
    await save(
      'reviewing',
      `최신 ${config.base}를 작업 브랜치에 반영했습니다. 새 HEAD의 리뷰와 CI를 다시 진행합니다.`,
    );
  }

  async function recordMerge(sha) {
    state.mergeCommit = sha;
    delete state.awaitingCI;
    await save('merged', mergedMessage(state, config.base));
  }

  async function completeMerge(ci) {
    let { pr } = await guard();
    if (pr.mergeable === false)
      throw new NeedsHuman(
        '현재 PR에 머지 충돌이 있습니다. PR을 수동으로 확인하세요.',
      );

    let converted = !pr.draft;
    if (pr.draft) {
      try {
        converted = await github.markReady(pr.node_id, state.head);
      } catch (error) {
        console.warn(`GitHub Draft 해제에 실패했습니다. ${error.message}`);
      }
      ({ pr } = await guard());
    }
    await github.notice(
      state.pull,
      `교차 리뷰와 필수 CI가 커밋 ${state.head}에서 통과했습니다. 새 커밋에는 별도 검증이 필요합니다.\n\n${ci.url}`,
      `ready-${state.head}`,
    );
    if (!pr.draft) state.readied = true;
    if (pr.draft && !converted)
      throw new NeedsHuman(
        '교차 리뷰와 필수 CI를 통과했습니다. PR의 Draft 해제를 확인하지 못했습니다. PR에서 Ready for review를 누른 뒤 확인하세요.',
      );
    delete state.awaitingCI;
    state.mergeAttempted = true;
    await save(
      'merging',
      `같은 HEAD의 교차 리뷰와 필수 CI를 통과했습니다. ${config.base} 스쿼시 머지를 요청합니다. ${ci.url}`,
    );
    ({ pr } = await guard());
    if (pr.draft)
      throw new NeedsHuman('PR이 Draft 상태입니다. PR 상태를 확인하세요.');

    let sha;
    try {
      sha = await github.squashMerge(state, config.base);
    } catch (error) {
      sha = await confirmedMerge(github, state, config.base);
      if (!sha) throw error;
    }
    await recordMerge(sha);
  }

  async function ensurePull() {
    if (state.pull) return;
    const found = await github.findPull(branch);
    if (found.length > 1)
      throw new NeedsHuman(
        '같은 작업 브랜치에 PR이 여러 개 있습니다. 기존 PR을 확인하세요.',
      );
    const pr = found[0] ?? (await github.createPull(state, config.base));
    if (
      !github.matchesPull(pr, state, config.base) ||
      !pr.body?.includes(pullMarker(issueNumber)) ||
      pr.title !== state.title
    )
      throw new NeedsHuman(
        '기존 PR이 이 실행에서 만든 열린 Draft PR과 일치하지 않습니다. PR을 수동으로 확인하세요.',
      );
    state.pull = pr.number;
    state.pullFingerprint = fingerprint(pr);
    await save('reviewing', 'Draft PR을 확인했습니다.');
  }

  async function implement(feedback) {
    await guard();
    const phase = feedback ? 'revising' : 'developing';
    await save(
      phase,
      feedback
        ? '리뷰 지적을 수정하고 있습니다.'
        : 'Issue 요구사항을 구현하고 있습니다.',
    );
    const plan = await develop({ developer, issue, state, feedback, guard });
    const { remote } = await guard();
    if (!plan.changes.length)
      throw new NeedsHuman(
        '개발 에이전트가 적용할 변경을 만들지 못했습니다. Issue와 실행 로그를 확인하세요.',
      );
    state.title ??= plan.title;
    state.summary ??= plan.summary;
    if (feedback) state.revisionSummary = plan.summary;
    state.pendingCommit = randomUUID();
    await save(phase, '검증된 변경의 커밋 결과를 기록하고 있습니다.');
    if (!remote) {
      if ((await github.ref(config.base)) !== state.base)
        throw new NeedsHuman(
          `${config.base} 브랜치에 새 커밋이 있습니다. AI development를 이 Issue 번호로 다시 실행하세요.`,
        );
      await github.createBranch(branch, state.base);
      state.branchCreated = true;
      await save(phase, '작업 브랜치를 생성했습니다.');
    }
    await guard();
    state.head = await github.commit(
      branch,
      state.head,
      plan.changes,
      commitMessage(plan, developer, state.pendingCommit),
    );
    delete state.pendingCommit;
    await save(phase, '작업 브랜치의 최신 커밋을 기록했습니다.');
    await ensurePull();
  }

  if (!existing)
    await save('queued', 'Issue와 작업 브랜치를 확인하고 있습니다.');
  try {
    if (state.status === 'merged') return state;
    if (state.mergeAttempted) {
      const sha = await confirmedMerge(github, state, config.base);
      if (sha) {
        await recordMerge(sha);
        return state;
      }
    }
    if (!existing) {
      if ((await github.ref(branch)) || (await github.findPull(branch)).length)
        throw new NeedsHuman(
          '시작 전에 같은 이름의 작업 브랜치 또는 PR이 발견되었습니다. 기존 작업을 확인하세요.',
        );
    }
    // The CI follow-up has no models to review a refreshed HEAD, so it keeps the strict check.
    await guard({ recovering: !ciCompletion, staleBase: !ciCompletion });
    if (ciCompletion) {
      const ci = await checkCI(state, guard);
      if (ci.ok) await completeMerge(ci);
      return state;
    }
    if (state.status === 'ready') return state;
    if (state.reviewInProgress)
      throw new NeedsHuman(
        '직전 리뷰가 결과를 기록하기 전에 중단되었습니다. 동일 커밋에 자동 리뷰를 다시 청구하지 않으므로 PR을 직접 검토하세요.',
      );
    if (state.head !== state.base) await ensurePull();
    await refreshBase();
    if (state.head === state.base) {
      await verifyConfiguration();
      await implement();
    }

    for (;;) {
      await refreshBase();
      await guard();
      let entry = state.reviews.at(-1);
      if (entry?.head !== state.head) {
        if (state.reviews.length >= config.maxReviews)
          throw new NeedsHuman(
            '최대 리뷰 횟수에 도달했습니다. PR의 지적 사항을 확인하세요.',
          );
        await verifyConfiguration();
        state.reviewInProgress = state.head;
        await save(
          'reviewing',
          `리뷰 ${state.reviews.length + 1}/${config.maxReviews}를 진행하고 있습니다.`,
        );
        let result;
        try {
          result = await review({ reviewer, issue, state });
        } catch (error) {
          if (error.requestRejected === true) delete state.reviewInProgress;
          throw error;
        }
        entry = { head: state.head, result };
        state.reviews.push(entry);
        delete state.reviewInProgress;
        await save('reviewing', '현재 HEAD의 리뷰 결과를 기록했습니다.');
        await guard();
      }
      await github.publishReview(state, entry, reviewer);
      const { result } = entry;
      if (result.status === 'needs_human')
        throw new NeedsHuman(
          '리뷰어가 사용자 판단을 요청했습니다. PR의 리뷰 댓글을 확인하세요.',
        );
      if (result.status === 'pass') {
        const ci = await checkCI(state, guard);
        if (!ci.ok) {
          awaitingCI = true;
          throw new NeedsHuman(ci.reason);
        }
        await completeMerge(ci);
        return state;
      }
      if (state.reviews.length >= config.maxReviews)
        throw new NeedsHuman(
          '최대 리뷰 횟수에 도달했습니다. PR의 지적 사항을 확인하세요.',
        );
      const defects = new Set(defectSignatures(result));
      if (
        state.reviews
          .slice(0, -1)
          .some(
            ({ result: previous }) =>
              previous.status === 'changes_requested' &&
              defectSignatures(previous).some((defect) => defects.has(defect)),
          )
      )
        throw new NeedsHuman(
          '같은 결함이 다시 보고되었습니다. PR의 지적 사항을 확인하세요.',
        );
      await verifyConfiguration();
      await implement(result);
    }
  } catch (error) {
    const needsHuman = error instanceof NeedsHuman;
    if (awaitingCI) state.awaitingCI = true;
    else if (needsHuman) delete state.awaitingCI;
    await save(
      needsHuman ? 'needs_human' : 'failed',
      error.message,
      needsHuman ? error.detail : undefined,
    );
    await notifyStop(github, issueNumber, state);
    return state;
  }
}

export async function reconcile(github, run, base) {
  const match = /^AI development for Issue #([1-9]\d*)$/.exec(
    run.display_title,
  );
  if (!match || !run.id || !run.run_attempt) return;
  const issue = Number(match[1]);
  const record = await github.loadState(issue);
  if (
    !record ||
    !activeStates.has(record.state.status) ||
    record.state.runId !== run.id ||
    record.state.attempt !== run.run_attempt
  )
    return;
  const state = record.state;
  if (state.mergeAttempted) {
    const sha = await confirmedMerge(github, state, base);
    if (sha) {
      state.mergeCommit = sha;
      state.status = 'merged';
      state.reason = mergedMessage(state, base);
      await github.saveState(issue, state, record.id);
      return;
    }
  }
  const stopped = {
    ...record.state,
    status: run.conclusion === 'cancelled' ? 'needs_human' : 'failed',
    reason:
      '워크플로가 종료 상태를 기록하기 전에 중단되었습니다. Actions 로그와 현재 커밋을 확인한 뒤 수동 재개하세요.',
  };
  await github.saveState(issue, stopped, record.id);
  await notifyStop(github, issue, stopped);
}
