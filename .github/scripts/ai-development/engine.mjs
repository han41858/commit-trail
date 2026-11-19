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
  const base = existing?.state.base ?? (await github.ref(config.base));
  if (!base)
    throw new Error(`기본 브랜치 ${config.base}를 조회할 수 없습니다.`);
  const state = existing?.state ?? {
    version: 1,
    issue: issueNumber,
    issueFingerprint: fingerprint(issue),
    developer,
    branch,
    base,
    head: base,
    pull: null,
    reviews: [],
  };
  let recordId = existing?.id;
  let awaitingCI = false;

  async function save(status, reason, detail) {
    Object.assign(state, { status, reason, detail, runId, attempt });
    recordId = await github.saveState(issueNumber, state, recordId);
  }

  async function guard({ recovering = false } = {}) {
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
      (remote || state.head !== base || state.pull)
    ) {
      if (
        !recovering ||
        !state.pendingCommit ||
        !remote ||
        !(await github.isOperation(remote, state.head, state.pendingCommit))
      ) {
        throw new NeedsHuman(
          `작업 브랜치 HEAD가 변경되었거나 브랜치가 삭제되었습니다. 확인한 HEAD ${remote ?? '없음'}. 현재 PR을 수동으로 검토하세요.`,
        );
      }
      state.head = remote;
      state.branchCreated = true;
      delete state.pendingCommit;
      await save(state.status, '직전 실행이 기록한 커밋을 복구했습니다.');
    }
    if (remote === base && !state.branchCreated)
      throw new NeedsHuman(
        '같은 이름의 작업 브랜치를 자동 실행이 생성했는지 확인할 수 없습니다. 기존 브랜치를 확인하세요.',
      );

    let pr;
    if (state.pull) {
      pr = await github.pull(state.pull);
      if (
        !github.matchesPull(pr, state, config.base, {
          allowReady: hasPassingReview(state),
        }) ||
        fingerprint(pr) !== state.pullFingerprint
      ) {
        throw new NeedsHuman(
          'PR이 닫혔거나 제목·본문·초안·대상 브랜치·HEAD가 변경되었습니다. 기존 PR을 수동으로 확인하세요.',
        );
      }
    }
    if ((await github.ref(config.base)) !== base)
      throw new NeedsHuman(
        `${config.base} 브랜치가 작업 시작 후 변경되었습니다. 브랜치 보호 정책에 맞춰 현재 PR을 수동으로 확인하세요.`,
      );
    return { remote, pr };
  }

  async function completeReady(ci) {
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
    const action =
      pr.draft && !converted
        ? 'PR에서 Ready for review를 누른 뒤 최종 검토해 주세요.'
        : 'PR에서 변경을 최종 검토한 뒤 스쿼시 머지할 수 있습니다.';
    const result = `교차 리뷰와 필수 CI가 커밋 ${state.head}에서 통과했습니다. ${action} 새 커밋에는 별도 검증이 필요합니다.`;
    await github.notice(
      state.pull,
      `${result}\n\n${ci.url}`,
      `ready-${state.head}`,
    );
    delete state.awaitingCI;
    await save('ready', `${result} ${ci.url}`);
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
    state.pendingCommit = randomUUID();
    await save(phase, '검증된 변경의 커밋 결과를 기록하고 있습니다.');
    if (!remote) {
      if ((await github.ref(config.base)) !== base)
        throw new NeedsHuman(
          `${config.base} 브랜치에 새 커밋이 있습니다. 새 기준에서 다시 작업하세요.`,
        );
      await github.createBranch(branch, base);
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
    if (!existing) {
      if ((await github.ref(branch)) || (await github.findPull(branch)).length)
        throw new NeedsHuman(
          '시작 전에 같은 이름의 작업 브랜치 또는 PR이 발견되었습니다. 기존 작업을 확인하세요.',
        );
    }
    await guard({ recovering: !ciCompletion });
    if (ciCompletion) {
      const ci = await checkCI(state, guard);
      if (ci.ok) await completeReady(ci);
      return state;
    }
    if (state.status === 'ready') return state;
    if (state.reviewInProgress)
      throw new NeedsHuman(
        '직전 리뷰가 결과를 기록하기 전에 중단되었습니다. 동일 커밋에 자동 리뷰를 다시 청구하지 않으므로 PR을 직접 검토하세요.',
      );
    if (state.head !== base) await ensurePull();
    if (state.head === base) {
      await verifyConfiguration();
      await implement();
    }

    for (;;) {
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
        await completeReady(ci);
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
    return state;
  }
}

export async function reconcile(github, run) {
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
  await github.saveState(
    issue,
    {
      ...record.state,
      status: run.conclusion === 'cancelled' ? 'needs_human' : 'failed',
      reason:
        '워크플로가 종료 상태를 기록하기 전에 중단되었습니다. Actions 로그와 현재 커밋을 확인한 뒤 수동 재개하세요.',
    },
    record.id,
  );
}
