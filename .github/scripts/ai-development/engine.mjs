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
  'recovering_base',
]);

// These failures mean verification rejected a returned result or exploration
// ended normally. Transport failures may still have a billable review in flight.
const retryableReviewFailures = new Set([
  '리뷰 상태와 지적 사항이 일치하지 않거나 결과가 너무 깁니다.',
  '리뷰 지적에 유효한 파일·줄·결함·영향·근거·수정 방향이 필요합니다.',
  'AI의 저장소 탐색 최대 횟수에 도달했습니다. Issue 범위를 좁힌 뒤 수동 재개하세요.',
]);

export class NeedsHuman extends Error {
  constructor(message, detail, reasonCode) {
    super(message);
    this.detail = detail;
    this.reasonCode = reasonCode;
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

function reviewCheck(state) {
  if (!state.pull || state.head === state.base) return null;
  let decision = 'queued';
  if (hasPassingReview(state)) decision = 'success';
  else if (state.status === 'needs_human') decision = 'action_required';
  else if (state.status === 'failed') decision = 'failure';
  else if (
    state.reviewInProgress === state.head ||
    state.reviews.at(-1)?.head === state.head
  )
    decision = 'in_progress';
  return { head: state.head, decision };
}

async function syncReviewCheck(github, state, check) {
  if (!check) return true;
  try {
    await github.setReviewCheck(state, check);
    return true;
  } catch {
    // Display failures must not overwrite the saved review or block recovery.
    console.warn('PR의 AI review 검사 상태를 갱신할 수 없습니다.');
    return false;
  }
}

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

async function confirmedMerge(github, state, base, expected) {
  const pr = expected
    ? await github.pullAfterMerge(state.pull)
    : await github.pull(state.pull);
  if (
    github.matchesPull(pr, state, base, { merged: true }) &&
    fingerprint(pr) === state.pullFingerprint &&
    (!expected || pr.merge_commit_sha === expected)
  )
    return pr.merge_commit_sha;
}

// Editing the state comment sends no notification, so a stop also gets its own comment.
async function notifyStop(
  github,
  issue,
  state,
  key = `stop-${state.runId}-${state.attempt}`,
) {
  try {
    await github.notice(
      issue,
      `**AI 개발 중단** · ` +
        '`' +
        state.status +
        '`' +
        `\n\n${state.reason}\n\n상태 댓글과 Actions 실행 ${state.runId}을 확인하세요.`,
      key,
    );
  } catch (error) {
    console.warn(`중단 알림 댓글을 남기지 못했습니다. ${error.message}`);
  }
}

function mergedMessage(state, base) {
  return `PR #${state.pull}이 ${base}에 머지되었습니다. 머지 커밋 ${state.mergeCommit}.`;
}

async function finishMerge(github, state, base, save) {
  delete state.awaitingCI;
  delete state.ciFailed;
  delete state.ciStatus;
  const message = mergedMessage(state, base);
  try {
    await github.closeIssue(state.issue);
  } catch (error) {
    console.warn(`Issue 종료 실패. ${error.message}`);
    await save(
      'needs_human',
      `${message} Issue 종료를 확인하지 못했습니다. 같은 Issue를 수동 재개하면 종료를 다시 시도합니다.`,
      undefined,
      'issue_close_failed',
    );
    await notifyStop(github, state.issue, state);
    return;
  }
  await save('merged', message);
}

export function pipelineExitCode(state) {
  if (state?.status === 'failed') return 1;
  if (
    state?.status === 'needs_human' &&
    state.reasonCode !== 'manual_policy_merge' &&
    !state.waitingForDependencies &&
    (!state.awaitingCI || state.ciFailed)
  )
    return 1;
  return 0;
}

class DependencyWait extends NeedsHuman {}
class PreviewWait extends NeedsHuman {}
class BaseChanged extends Error {}
class CIWait extends Error {
  constructor(ci) {
    super(ci.reason);
    this.ci = ci;
  }
}

function canWake(issue, state) {
  const labels = labelNames(issue);
  const selected = labels.filter((label) => executionLabels.has(label));
  return (
    issue.state === 'open' &&
    !issue.pull_request &&
    !labels.includes('ai:stop') &&
    selected.length === 1 &&
    executionLabels.get(selected[0]) === state.developer &&
    state.status === 'needs_human' &&
    fingerprint(issue) === state.issueFingerprint
  );
}

async function requireMergedDependencies(github, issueNumber, base) {
  let dependencies;
  try {
    dependencies = await github.blockedBy(issueNumber);
  } catch {
    throw new DependencyWait(
      '이 Issue의 Blocked by 목록을 확인할 수 없어 대기합니다. GitHub 조회 상태를 확인한 뒤 수동 재개하세요.',
    );
  }
  const waiting = [];
  for (const { number, local } of dependencies) {
    if (!local) {
      waiting.push(`#${number} (다른 저장소)`);
      continue;
    }
    try {
      if (!(await github.hasMergedClosingPull(number, base)))
        waiting.push(`#${number} (머지 확인 안 됨)`);
    } catch {
      waiting.push(`#${number} (연결 PR 조회 실패)`);
    }
  }
  if (waiting.length)
    throw new DependencyWait(
      `선행 작업 대기: ${waiting.join(', ')}. 연결된 PR이 ${base}에 머지된 뒤 수동 재개하세요.`,
    );
}

export async function wakeDependents(github, { number, sha }, base) {
  const closingIssues = await github.closingIssues(number, sha, base);
  const dependents = new Set();
  for (const issue of closingIssues) {
    const record = await github.loadState(issue);
    const state = record?.state;
    if (
      state?.manualPolicyMerge &&
      state.issue === issue &&
      state.pull === number &&
      state.status !== 'merged' &&
      (await confirmedMerge(github, state, base, sha))
    ) {
      state.mergeCommit = sha;
      await finishMerge(
        github,
        state,
        base,
        async (status, reason, detail, reasonCode) => {
          Object.assign(state, { status, reason, detail, reasonCode });
          await github.saveState(issue, state, record.id);
        },
      );
    }
    for (const dependency of await github.blocking(issue)) {
      if (dependency.local) dependents.add(dependency.number);
    }
  }
  for (const issueNumber of dependents) {
    const record = await github.loadState(issueNumber);
    const state = record?.state;
    if (!state?.waitingForDependencies || state.dependencyDispatch) continue;
    const issue = await github.issue(issueNumber);
    if (!canWake(issue, state)) continue;
    try {
      await requireMergedDependencies(github, issueNumber, base);
      if (await github.hasActiveDevelopment(issueNumber, base, state)) continue;
    } catch (error) {
      const reason =
        error instanceof DependencyWait
          ? error.message
          : '기존 AI 실행의 대기 상태를 확인할 수 없어 자동 재개하지 못했습니다. Actions를 확인한 뒤 필요하면 수동 재개하세요.';
      if (state.reason !== reason) {
        state.reason = reason;
        await github.saveState(issueNumber, state, record.id);
      }
      continue;
    }
    // Persist the reservation first. An uncertain dispatch is safe to recover manually.
    state.dependencyDispatch = randomUUID();
    state.reason =
      '선행 PR의 머지를 확인해 기존 Actions 큐에 재개를 예약합니다.';
    await github.saveState(issueNumber, state, record.id);
    try {
      await github.dispatchDependencyResume(
        issueNumber,
        base,
        state.dependencyDispatch,
      );
    } catch {
      state.reason =
        '선행 PR은 머지됐지만 자동 재개 예약 결과를 확인하지 못했습니다. Actions를 확인한 뒤 필요하면 수동 재개하세요.';
      await github.saveState(issueNumber, state, record.id);
      await notifyStop(
        github,
        issueNumber,
        state,
        `dependency-dispatch-${state.dependencyDispatch}`,
      );
    }
  }
}

export async function runPipeline({
  github,
  develop,
  review,
  checkCI,
  recheckCI = checkCI,
  verifyConfiguration,
  config,
  issueNumber,
  eventLabel,
  resume,
  ciCompletion,
  dependencyResume,
  baseRecovery,
  confirmedHead,
  previewApprovedHead,
  runId,
  attempt,
}) {
  const existing = await github.loadState(issueNumber);
  if (ciCompletion) {
    const previous = existing?.state;
    if (
      !previous?.awaitingCI ||
      !['awaiting_ci', 'needs_human', 'failed'].includes(previous.status) ||
      !previous.pull ||
      previous.reviewInProgress ||
      previous.head !== ciCompletion.head_sha ||
      previous.branch !== ciCompletion.head_branch ||
      (ciCompletion.pull_requests?.length &&
        !ciCompletion.pull_requests.some(
          ({ number }) => number === previous.pull,
        )) ||
      !hasPassingReview(previous)
    )
      return;
  }
  if (existing && !resume) return;
  if (
    baseRecovery &&
    (!resume ||
      existing?.state.status !== 'recovering_base' ||
      existing.state.baseRecovery !== baseRecovery)
  )
    return;
  if (!existing && resume)
    throw new NeedsHuman(
      '이 Issue에 재개할 기존 실행이 없습니다. 최초 실행은 실행 라벨로 시작하세요.',
    );

  if (previewApprovedHead && previewApprovedHead !== existing?.state.head)
    throw new NeedsHuman(
      '확인한 프리뷰의 SHA가 현재 PR HEAD와 다릅니다. 현재 커밋의 프리뷰를 확인하세요.',
    );

  const issue = await github.issue(issueNumber);
  if (issue.pull_request || (ciCompletion && issue.state !== 'open')) return;
  if (
    dependencyResume &&
    (!resume ||
      !existing?.state.waitingForDependencies ||
      existing.state.dependencyDispatch !== dependencyResume ||
      !canWake(issue, existing.state))
  )
    return;

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
  let displayedCheck;
  let previousCheck = reviewCheck(state);
  const manualConfirmation =
    resume && !ciCompletion && !dependencyResume && !baseRecovery
      ? confirmedHead
      : undefined;
  const confirmationHelp =
    'Actions 실행과 작업 브랜치·PR을 확인한 뒤, 수동 재개의 confirmed_head에 현재 작업 브랜치의 전체 SHA를 입력하세요.';

  async function save(status, reason, detail, reasonCode) {
    Object.assign(state, {
      status,
      reason,
      detail,
      reasonCode,
      runId,
      attempt,
    });
    recordId = await github.saveState(issueNumber, state, recordId);
    const check = reviewCheck(state);
    if (
      previousCheck &&
      check &&
      previousCheck.head !== check.head &&
      ['queued', 'in_progress'].includes(previousCheck.decision)
    )
      await syncReviewCheck(github, state, {
        head: previousCheck.head,
        decision: 'neutral',
      });
    previousCheck = check;
    const key = check && `${check.head}:${check.decision}`;
    if (
      key &&
      key !== displayedCheck &&
      (await syncReviewCheck(github, state, check))
    )
      displayedCheck = key;
  }

  async function guard({ recovering = false, staleBase = false } = {}) {
    const currentIssue = await github.issue(issueNumber);
    const currentLabels = labelNames(currentIssue);
    if (currentIssue.state !== 'open' || currentLabels.includes('ai:stop'))
      throw new NeedsHuman(
        'Issue가 닫혔거나 ai:stop 라벨이 적용되었습니다. 재개하려면 Issue를 열고 중지 라벨을 제거하세요.',
        undefined,
        currentLabels.includes('ai:stop') ? 'stopped' : 'issue_closed',
      );
    if (fingerprint(currentIssue) !== state.issueFingerprint)
      throw new NeedsHuman(
        'Issue 제목 또는 본문이 변경되었습니다. 기존 작업을 확인하고 변경된 요청은 새 Issue에서 시작하세요.',
      );
    if (currentIssue.pull_request)
      throw new NeedsHuman('자동 개발 대상 Issue를 확인할 수 없습니다.');
    const execution = currentLabels.filter((label) =>
      executionLabels.has(label),
    );
    if (
      execution.length !== 1 ||
      executionLabels.get(execution[0]) !== developer
    )
      throw new NeedsHuman(
        'Issue의 실행 라벨이 제거되었거나 승인한 개발 역할이 변경되었습니다.',
        undefined,
        'approval_changed',
      );

    const remote = await github.ref(branch);
    if (!remote && state.branchCreated)
      throw new NeedsHuman(
        '작업 브랜치가 삭제되었습니다. 기존 PR과 브랜치를 수동으로 확인하세요.',
      );
    const confirmed = recovering && remote && remote === manualConfirmation;
    let recoveredCommit = false;
    let refreshedBase;
    if (
      remote !== state.head &&
      (remote || state.head !== state.base || state.pull)
    ) {
      if (confirmed && state.pendingRefresh) {
        refreshedBase =
          state.head === state.base && !state.pull
            ? remote === state.pendingRefresh && remote
            : await github.mergedRefreshBase(state, remote, config.base);
      } else if (recovering && state.pendingCommit && remote) {
        recoveredCommit = await github.isOperation(
          remote,
          state.head,
          state.pendingCommit,
        );
      }
      if (!refreshedBase && !recoveredCommit)
        throw new NeedsHuman(
          state.pendingRefresh && !confirmed && remote
            ? `직전 브랜치 갱신 결과를 확인해야 합니다. ${confirmationHelp}`
            : `작업 브랜치 HEAD가 변경되었거나 브랜치가 삭제되었습니다. 확인한 HEAD ${remote ?? '없음'}. 현재 PR을 수동으로 검토하세요.`,
        );
    }
    const unfinishedWrite =
      recovering && (state.pendingCommit || state.pendingRefresh);
    if (unfinishedWrite && !confirmed && !recoveredCommit)
      throw new NeedsHuman(
        `직전 커밋 게시 또는 브랜치 갱신 결과를 확인할 수 없습니다. ${confirmationHelp}`,
      );
    if (remote === state.base && !state.branchCreated)
      throw new NeedsHuman(
        '같은 이름의 작업 브랜치를 자동 실행이 생성했는지 확인할 수 없습니다. 기존 브랜치를 확인하세요.',
      );

    let pr;
    if (state.pull) {
      const previous =
        state.previousPublishedHead ??
        (recoveredCommit || refreshedBase ? state.head : undefined);
      pr = previous
        ? await github.pullAtHead(state.pull, previous)
        : await github.pull(state.pull);
      if (
        !github.matchesPull(pr, { ...state, head: remote }, config.base, {
          allowReady: state.readied === true,
        }) ||
        (state.readied && pr.draft) ||
        fingerprint(pr) !== state.pullFingerprint
      ) {
        throw new NeedsHuman(
          'PR이 닫혔거나 제목·본문·초안·대상 브랜치·HEAD가 변경되었습니다. 기존 PR을 수동으로 확인하세요.',
        );
      }
      delete state.previousPublishedHead;
    }
    if (refreshedBase) {
      applyRefresh({ head: remote, base: refreshedBase });
      await save(
        'reviewing',
        '사람이 확인한 브랜치 갱신을 복구했습니다. 새 HEAD의 리뷰와 CI를 진행합니다.',
      );
    } else if (recoveredCommit) {
      state.head = remote;
      state.branchCreated = true;
      delete state.pendingCommit;
      await save(state.status, '직전 실행이 기록한 커밋을 복구했습니다.');
    } else if (unfinishedWrite) {
      delete state.pendingCommit;
      delete state.pendingRefresh;
      await save(
        state.status,
        '확인한 작업 브랜치 HEAD에서 이전 게시 예약을 해제했습니다.',
      );
    }
    const currentBase = await github.ref(config.base);
    if (!currentBase)
      throw new Error(`기본 브랜치 ${config.base}를 조회할 수 없습니다.`);
    if (!staleBase && currentBase !== state.base) throw new BaseChanged();
    return { remote, pr, currentBase, issue: currentIssue };
  }

  function applyRefresh({ head, base }) {
    if (state.pull && head !== state.head)
      state.previousPublishedHead = state.head;
    state.base = base;
    state.head = head;
    state.branchCreated = true;
    state.baseReviewStart = state.reviews.length;
    delete state.pendingRefresh;
    delete state.awaitingCI;
    delete state.ciFailed;
    delete state.ciStatus;
    delete state.mergeAttempted;
    delete state.previewApprovedHead;
  }

  function requireRecoveryBudget(counter, limit) {
    if ((state[counter] ?? 0) >= limit)
      throw new NeedsHuman(
        `${config.base} 변경 자동 복구 한도(${limit}회)에 도달했습니다. 현재 Issue와 작업 브랜치를 직접 확인하세요.`,
      );
  }

  async function recoverBase() {
    await requireMergedDependencies(github, issueNumber, config.base);
    const { currentBase: current } = await guard({ staleBase: true });
    if (current === state.base) return;
    const unpublished =
      !state.branchCreated && state.head === state.base && !state.pull;
    const counter = unpublished ? 'unpublishedRestarts' : 'baseRefreshes';
    const limit = unpublished
      ? config.maxUnpublishedRestarts
      : config.maxBaseRefreshes;
    requireRecoveryBudget(counter, limit);
    if (!(await github.baseAdvanced(state.base, current)))
      throw new NeedsHuman(
        `${config.base} 이력이 바뀌었습니다. 기존 기준 커밋을 포함하는지 직접 확인하세요.`,
      );
    const emptyBranch = state.head === state.base && !state.pull;
    if (!emptyBranch) await ensurePull({ staleBase: true });
    const beforeWrite = async () => {
      const { currentBase } = await guard({ staleBase: true });
      if (currentBase !== current) throw new BaseChanged();
    };
    state[counter] = (state[counter] ?? 0) + 1;
    if (unpublished) {
      state.base = current;
      state.head = current;
      delete state.title;
      delete state.summary;
      await save(
        'developing',
        `최신 ${config.base}에서 개발과 검증을 다시 시작합니다.`,
      );
      return;
    }
    state.pendingRefresh = current;
    await save(
      'recovering_base',
      `작업 브랜치에 반영할 기준 커밋 ${current}을 예약했습니다.`,
    );
    try {
      if (emptyBranch) {
        delete state.title;
        delete state.summary;
        await github.advanceEmptyBranch(state, current, beforeWrite);
        applyRefresh({ head: current, base: current });
      } else {
        applyRefresh(await github.updateBranch(state, beforeWrite));
      }
    } catch (error) {
      if (error.writeRejected) delete state.pendingRefresh;
      throw error;
    }
    await save(
      'reviewing',
      `최신 ${config.base}를 작업 브랜치에 반영했습니다. 새 HEAD의 리뷰와 CI를 다시 진행합니다.`,
    );
  }

  async function recordMerge(sha) {
    state.mergeCommit = sha;
    await finishMerge(github, state, config.base, save);
  }

  async function requirePreview(currentIssue) {
    if (
      !labelNames(currentIssue).includes('preview') &&
      !(await github.previewRequested(state.pull))
    )
      return;
    const check = await github.previewCheck(state);
    if (check?.conclusion !== 'success')
      throw new PreviewWait(
        '현재 HEAD의 Vercel Preview 검사가 성공하기를 기다립니다. PR의 검사 상태를 확인하세요.',
      );
    if (
      resume &&
      !ciCompletion &&
      !dependencyResume &&
      !baseRecovery &&
      previewApprovedHead === state.head
    )
      state.previewApprovedHead = state.head;
    if (state.previewApprovedHead !== state.head)
      throw new PreviewWait(
        `PR Checks에서 프리뷰를 확인한 뒤 AI development를 수동 실행하고 preview_approved_head에 ${state.head}를 입력하세요.`,
      );
  }

  async function completeMerge(ci) {
    let { pr, issue: currentIssue } = await guard();
    await requirePreview(currentIssue);
    if (await github.changesAutomationPolicy(state, pr)) {
      state.manualPolicyMerge = true;
      throw new NeedsHuman(
        '이 PR은 자동화 또는 검증 정책을 변경합니다. PR의 정책 변경을 사람이 검토하고 머지하세요.',
        undefined,
        'manual_policy_merge',
      );
    }
    if (pr.mergeable === false)
      throw new NeedsHuman(
        '현재 PR에 머지 충돌이 있습니다. PR을 수동으로 확인하세요.',
      );
    await requireMergedDependencies(github, issueNumber, config.base);

    let converted = !pr.draft;
    if (pr.draft) {
      try {
        converted = await github.markReady(pr.node_id, state.head);
      } catch (error) {
        console.warn(`GitHub Draft 해제에 실패했습니다. ${error.message}`);
      }
      if (converted) state.readied = true;
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
    await requireMergedDependencies(github, issueNumber, config.base);
    delete state.awaitingCI;
    delete state.ciFailed;
    delete state.ciStatus;
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
      sha = await github.squashMerge(state, config.base, async () => {
        await guard();
        await requireMergedDependencies(github, issueNumber, config.base);
        if (!hasPassingReview(state))
          throw new NeedsHuman(
            '머지 직전 현재 HEAD의 교차 리뷰 성공을 확인할 수 없습니다.',
          );
        const currentCI = await recheckCI(state, guard);
        if (!currentCI.ok) throw new CIWait(currentCI);
        const { issue: liveIssue } = await guard();
        await requirePreview(liveIssue);
      });
    } catch (error) {
      if (
        error instanceof BaseChanged ||
        error instanceof PreviewWait ||
        error instanceof CIWait
      )
        throw error;
      sha = await confirmedMerge(github, state, config.base);
      if (!sha) {
        if (error.writeRejected) await guard();
        throw error;
      }
    }
    if (!(await confirmedMerge(github, state, config.base, sha)))
      throw new NeedsHuman(
        '머지 응답은 받았지만 실제 PR의 대상·HEAD·머지 커밋을 확인하지 못했습니다. 수동 재개에서 머지 상태를 다시 확인합니다.',
      );
    await recordMerge(sha);
  }

  async function ensurePull({ staleBase = false } = {}) {
    if (state.pull) return;
    await guard({ staleBase });
    const found = await github.findPull(branch);
    if (found.length > 1)
      throw new NeedsHuman(
        '같은 작업 브랜치에 PR이 여러 개 있습니다. 기존 PR을 확인하세요.',
      );
    let pr = found[0];
    if (pr && !state.pendingPull)
      throw new NeedsHuman(
        '기록되지 않은 작업 브랜치의 PR을 발견했습니다. 기존 PR을 직접 확인하세요.',
      );
    if (!pr) {
      if (state.pendingPull && manualConfirmation !== state.head)
        throw new NeedsHuman(
          `직전 PR 생성 결과를 확인할 수 없습니다. ${confirmationHelp}`,
        );
      await guard({ staleBase });
      state.pendingPull = true;
      await save('reviewing', '작업 브랜치의 Draft PR 생성을 예약했습니다.');
      try {
        pr = await github.createPull(state, config.base, () =>
          guard({ staleBase }),
        );
      } catch (error) {
        if (error.writeRejected) delete state.pendingPull;
        throw error;
      }
    }
    if (
      !github.matchesPull(pr, state, config.base) ||
      !pr.body?.includes(pullMarker(issueNumber)) ||
      pr.title !== state.title ||
      !github.matchesCreatedPull(pr, state)
    )
      throw new NeedsHuman(
        '기존 PR이 이 실행에서 만든 열린 Draft PR과 일치하지 않습니다. PR을 수동으로 확인하세요.',
      );
    state.pull = pr.number;
    state.pullFingerprint = fingerprint(pr);
    delete state.pendingPull;
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
    const plan = await develop({
      developer,
      issue,
      state,
      feedback,
      guard,
      reserveModel,
    });
    const { remote } = await guard();
    if (!plan.changes.length)
      throw new NeedsHuman(
        '개발 에이전트가 적용할 변경을 만들지 못했습니다. Issue와 실행 로그를 확인하세요.',
      );
    if (!remote) {
      await github.createBranch(branch, state.base, guard);
      state.branchCreated = true;
      await save(phase, '작업 브랜치를 생성했습니다.');
    }
    await guard();
    state.title ??= plan.title;
    state.summary ??= plan.summary;
    state.pendingCommit = randomUUID();
    await save(phase, '검증된 변경의 커밋 게시를 예약했습니다.');
    try {
      await guard();
    } catch (error) {
      delete state.pendingCommit;
      throw error;
    }
    try {
      const previous = state.head;
      state.head = await github.commit(
        branch,
        state.head,
        plan.changes,
        commitMessage(plan, developer, state.pendingCommit),
        guard,
      );
      if (state.pull) state.previousPublishedHead = previous;
    } catch (error) {
      if (error.writeRejected) delete state.pendingCommit;
      throw error;
    }
    if (feedback) state.revisionSummary = plan.summary;
    delete state.pendingCommit;
    await save(phase, '작업 브랜치의 최신 커밋을 기록했습니다.');
    await ensurePull();
  }

  async function reserveModel() {
    // Older state comments had only the number of completed reviews.
    const used = state.modelSessions ?? state.reviews.length;
    if (used >= config.maxModelSessions)
      throw new NeedsHuman(
        '이 Issue의 전체 모델 호출 한도에 도달했습니다. 현재 PR과 상태 댓글을 확인하세요.',
        undefined,
        'model_budget_exhausted',
      );
    state.modelSessions = used + 1;
    await save(state.status, state.reason);
  }

  if (!existing)
    await save('queued', 'Issue와 작업 브랜치를 확인하고 있습니다.');
  try {
    if (state.status === 'merged') return state;
    if (state.mergeAttempted || state.manualPolicyMerge) {
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
    await guard({ recovering: !ciCompletion, staleBase: true });
    if (!ciCompletion && state.baseRecovery) {
      delete state.baseRecovery;
      await save('queued', '기준 브랜치 자동 복구를 시작합니다.');
    }
    if (state.waitingForDependencies || state.dependencyDispatch) {
      delete state.waitingForDependencies;
      delete state.dependencyDispatch;
      await save('queued', '선행 작업을 확인하고 기존 실행을 재개합니다.');
    }
    await requireMergedDependencies(github, issueNumber, config.base);
    if (ciCompletion) {
      const canceled = ciCompletion.conclusion === 'cancelled';
      const ciGuard = canceled ? () => guard({ staleBase: true }) : guard;
      try {
        await ciGuard();
        if (state.ciFailed && ciCompletion.conclusion === 'failure') return;
        const ci = await checkCI(state, ciGuard);
        await ciGuard();
        if (canceled && ci.status !== 'cancelled') return state;
        if (!ci.ok) throw new CIWait(ci);
        await completeMerge(ci);
      } catch (error) {
        if (!(error instanceof BaseChanged)) throw error;
        await guard({ staleBase: true });
        requireRecoveryBudget('baseRefreshes', config.maxBaseRefreshes);
        delete state.awaitingCI;
        state.baseRecovery = randomUUID();
        await save(
          'recovering_base',
          `${config.base}가 변경되어 작업 브랜치 갱신과 새 HEAD의 리뷰·CI를 기존 Actions 큐에 예약합니다.`,
        );
        try {
          await github.dispatchBaseRecovery(
            issueNumber,
            config.base,
            state.baseRecovery,
          );
        } catch {
          throw new NeedsHuman(
            '기준 브랜치 자동 복구 예약의 결과를 확인할 수 없습니다. Actions를 확인한 뒤 필요하면 수동 재개하세요.',
          );
        }
      }
      return state;
    }
    if (state.status === 'ready') return state;
    if (state.reviewInProgress) {
      if (
        !resume ||
        state.status !== 'failed' ||
        state.reviewInProgress !== state.head ||
        !retryableReviewFailures.has(state.reason)
      )
        throw new NeedsHuman(
          '직전 리뷰가 결과를 기록하기 전에 중단되었습니다. 동일 커밋에 자동 리뷰를 다시 청구하지 않으므로 PR을 직접 검토하세요.',
        );
      delete state.reviewInProgress;
      await save(
        'reviewing',
        '수동 재개 요청에 따라 실패한 교차 리뷰를 다시 진행합니다.',
      );
    }
    let recoveringBase = false;
    for (;;) {
      try {
        if (recoveringBase) {
          await recoverBase();
          recoveringBase = false;
        }
        await guard();
        if (state.head === state.base) {
          await verifyConfiguration();
          await implement();
        }
        await ensurePull();
        const reviewStart = state.baseReviewStart ?? 0;
        const reviewCount = state.reviews.length - reviewStart;
        let entry = state.reviews.at(-1);
        if (entry?.head !== state.head) {
          if (reviewCount >= config.maxReviews)
            throw new NeedsHuman(
              '최대 리뷰 횟수에 도달했습니다. PR의 지적 사항을 확인하세요.',
            );
          await verifyConfiguration();
          await guard();
          state.reviewInProgress = state.head;
          await save(
            'reviewing',
            `리뷰 ${reviewCount + 1}/${config.maxReviews}를 진행하고 있습니다.`,
          );
          const beforeReview = async () => {
            try {
              await guard();
            } catch (error) {
              delete state.reviewInProgress;
              throw error;
            }
          };
          let result;
          try {
            await beforeReview();
            result = await review({
              reviewer,
              issue,
              state,
              guard: beforeReview,
              reserveModel,
            });
          } catch (error) {
            if (
              error.requestRejected === true ||
              error.outputLimitReached === true ||
              error instanceof NeedsHuman
            )
              delete state.reviewInProgress;
            throw error;
          }
          entry = { head: state.head, result };
          state.reviews.push(entry);
          delete state.reviewInProgress;
          await save('reviewing', '현재 HEAD의 리뷰 결과를 기록했습니다.');
        }
        const { result } = entry;
        if (result.status === 'needs_human') {
          await guard({ staleBase: true });
          await github.publishReview(state, entry, reviewer);
          throw new NeedsHuman(
            '리뷰어가 사용자 판단을 요청했습니다. PR의 리뷰 댓글을 확인하세요.',
          );
        }
        await guard();
        await github.publishReview(state, entry, reviewer);
        if (result.status === 'pass') {
          const ci = await checkCI(state, guard);
          await guard();
          if (!ci.ok) throw new CIWait(ci);
          await completeMerge(ci);
          return state;
        }
        if (state.reviews.length - reviewStart >= config.maxReviews)
          throw new NeedsHuman(
            '최대 리뷰 횟수에 도달했습니다. PR의 지적 사항을 확인하세요.',
          );
        const defects = new Set(defectSignatures(result));
        if (
          state.reviews
            .slice(reviewStart, -1)
            .some(
              ({ result: previous }) =>
                previous.status === 'changes_requested' &&
                defectSignatures(previous).some((defect) =>
                  defects.has(defect),
                ),
            )
        )
          throw new NeedsHuman(
            '같은 결함이 다시 보고되었습니다. PR의 지적 사항을 확인하세요.',
          );
        await verifyConfiguration();
        await implement(result);
      } catch (error) {
        if (!(error instanceof BaseChanged)) throw error;
        recoveringBase = true;
      }
    }
  } catch (error) {
    if (error instanceof CIWait) {
      const { ci } = error;
      const pending = ci.status === 'pending';
      const notify =
        !pending &&
        (state.status !== 'needs_human' ||
          state.ciStatus !== ci.status ||
          state.reason !== ci.reason);
      state.awaitingCI = true;
      state.ciFailed = !!ci.failed;
      state.ciStatus = ci.status;
      await save(
        pending ? 'awaiting_ci' : 'needs_human',
        ci.reason,
        undefined,
        ci.status,
      );
      if (notify) await notifyStop(github, issueNumber, state);
      return state;
    }
    if (error instanceof PreviewWait) {
      delete state.awaitingCI;
      delete state.ciFailed;
      delete state.mergeAttempted;
      await save('awaiting_preview', error.message);
      return state;
    }
    const needsHuman = error instanceof NeedsHuman;
    if (error instanceof DependencyWait) state.waitingForDependencies = true;
    else delete state.waitingForDependencies;
    delete state.dependencyDispatch;
    if (needsHuman) delete state.awaitingCI;
    await save(
      needsHuman ? 'needs_human' : 'failed',
      error.message,
      needsHuman ? error.detail : undefined,
      error.reasonCode ||
        (error instanceof DependencyWait
          ? 'waiting_dependency'
          : needsHuman
            ? 'action_required'
            : 'automation_error'),
    );
    await notifyStop(github, issueNumber, state);
    return state;
  }
}

export async function reconcile(github, run, base) {
  const match =
    /^AI development for Issue #([1-9]\d*)(?: · base recovery ([0-9a-f-]{36}))?$/.exec(
      run.display_title,
    );
  if (!match || !run.id || !run.run_attempt) return;
  const issue = Number(match[1]);
  const record = await github.loadState(issue);
  const reservation = match[2];
  if (
    reservation &&
    run.actor?.login === 'github-actions[bot]' &&
    record?.state.status === 'recovering_base' &&
    record.state.baseRecovery === reservation
  ) {
    const state = record.state;
    delete state.baseRecovery;
    Object.assign(state, {
      status: run.conclusion === 'cancelled' ? 'needs_human' : 'failed',
      reasonCode: run.conclusion === 'cancelled' ? 'stopped' : 'interrupted',
      reason:
        '예약된 기준 브랜치 복구가 시작 상태를 기록하기 전에 중단되었습니다. Actions 로그를 확인한 뒤 수동 재개하세요.',
      runId: run.id,
      attempt: run.run_attempt,
    });
    await github.saveState(issue, state, record.id);
    await syncReviewCheck(github, state, reviewCheck(state));
    await notifyStop(github, issue, state);
    return;
  }
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
      await finishMerge(github, state, base, async (status, reason) => {
        Object.assign(state, { status, reason });
        await github.saveState(issue, state, record.id);
      });
      await syncReviewCheck(github, state, reviewCheck(state));
      return;
    }
  }
  const stopped = {
    ...record.state,
    status: run.conclusion === 'cancelled' ? 'needs_human' : 'failed',
    reasonCode: run.conclusion === 'cancelled' ? 'stopped' : 'interrupted',
    reason:
      '워크플로가 종료 상태를 기록하기 전에 중단되었습니다. Actions 로그와 현재 커밋을 확인한 뒤 수동 재개하세요.',
  };
  await github.saveState(issue, stopped, record.id);
  await syncReviewCheck(github, stopped, reviewCheck(stopped));
  await notifyStop(github, issue, stopped);
}
