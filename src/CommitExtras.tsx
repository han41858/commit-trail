import type { InfoSnapshot } from './CommitInfoStore';
import { useEffect, useState } from 'react';
import {
  activeRun,
  attempt,
  runStatus,
  runElapsed,
  actionsElapsed,
  completedJobCount,
} from './CommitInfo';
import { ActionStatusIcon } from './ActionStatusIcon';
const link = (url: string) =>
  url.startsWith('https://github.com/') ? url : '#';
const date = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString()
    : null;
export function CommitExtras({
  sha,
  info,
}: {
  sha: string;
  info: InfoSnapshot;
}) {
  const data = info.bySha.get(sha),
    summary = data?.actions;
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!data?.runs.some(
    (run) =>
      activeRun(run) && Number.isFinite(Date.parse(run.run_started_at || '')),
  );
  useEffect(() => {
    if (!ticking) return;
    const update = () => {
      if (!document.hidden) setNow(Date.now());
    };
    update();
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [ticking]);
  const elapsed = actionsElapsed(data?.runs || [], now);
  return (
    <div className="commit-extras">
      {!!data?.tags.length && (
        <section className="version-row" aria-label="Git tags">
          <span className="version-icon" aria-hidden="true">
            🏷️
          </span>
          <div className="tag-list">
            {data.tags.map((tag) => (
              <a
                href={link(tag.url)}
                key={tag.name}
                target="_blank"
                rel="noreferrer"
              >
                {tag.name}
              </a>
            ))}
          </div>
        </section>
      )}
      {!!data?.releases.length && (
        <section aria-label="GitHub releases">
          {data.releases.map((release) => {
            const name = release.name?.trim() || release.tag_name,
              meta = [
                name !== release.tag_name ? release.tag_name : '',
                release.draft
                  ? 'Draft'
                  : release.prerelease
                    ? 'Pre-release'
                    : '',
                date(release.published_at),
              ]
                .filter(Boolean)
                .join(' · ');
            return (
              <div className="release-info" key={release.id}>
                <div className="version-row">
                  <span className="version-icon" aria-hidden="true">
                    🚀
                  </span>
                  <a
                    href={link(release.html_url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {name}
                  </a>
                </div>
                {meta && <small className="release-meta">{meta}</small>}
              </div>
            );
          })}
        </section>
      )}
      <section aria-label="GitHub Actions">
        <h3 className="actions-heading">
          Actions
          {summary &&
            ['running', 'queued'].includes(summary.state) &&
            summary.ratio !== null && (
              <span
                className="actions-job-summary"
                aria-label={`${summary.done} of ${summary.total} jobs completed`}
              >
                {summary.done}/{summary.total} jobs (
                {Math.floor(summary.ratio * 100)}%)
              </span>
            )}
          {elapsed && (
            <span
              className="actions-elapsed"
              aria-label={`Total Actions elapsed time: ${elapsed}`}
              title="Total Actions elapsed time"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.5V8l2.5 1.5" />
              </svg>
              {elapsed}
            </span>
          )}
        </h3>
        {data?.runs.map((run) => {
          const jobs = completedJobCount(run, info.jobs),
            status = runStatus(run),
            name = run.name || `Workflow ${run.workflow_id}`,
            duration = runElapsed(run, now) || '—',
            runAttempt = attempt(run),
            jobLabel = jobs
              ? `${jobs.completed} of ${jobs.total} jobs completed`
              : 'Job counts not confirmed';
          return (
            <div className="run-info" key={run.id}>
              <div className="run-heading">
                <ActionStatusIcon status={status} />
                <a
                  href={link(run.html_url)}
                  title={name}
                  target="_blank"
                  rel="noreferrer"
                >
                  {name}
                </a>
                {activeRun(run) && (
                  <span
                    className="run-job-count"
                    aria-label={jobLabel}
                    title={jobLabel}
                  >
                    {jobs ? `${jobs.completed}/${jobs.total}` : '?/?'}
                  </span>
                )}
              </div>
              <small
                className="run-elapsed"
                title={`Elapsed ${duration} · Attempt ${runAttempt}`}
              >
                {duration} · Attempt {runAttempt}
              </small>
            </div>
          );
        })}
        {!data?.runs.length && !info.errors.actions && (
          <p className="metadata-note">
            {info.checked.has(sha)
              ? 'No retained runs returned for this commit.'
              : info.busy
                ? 'Checking Actions…'
                : 'Actions history not fully checked.'}
          </p>
        )}
      </section>
      {Object.entries(info.errors).map(([kind, error]) => (
        <p className="metadata-error" key={kind}>
          {kind}: {error}
        </p>
      ))}
    </div>
  );
}
