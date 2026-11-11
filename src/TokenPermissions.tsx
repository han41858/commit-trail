import { useEffect, useState } from 'react';
import {
  checkTokenAccess,
  tokenFeatures,
  uncheckedAccess,
  type AccessStatus,
} from './tokenAccess';
import { useRetryCountdown, retryLabel } from './useRetryCountdown';

const labels: Record<AccessStatus, string> = {
  unchecked: 'Not checked',
  available: 'Available',
  denied: 'Access blocked',
  invalid: 'Invalid token',
  limited: 'Rate limited',
  unknown: 'Not verified',
};
const icons: Record<AccessStatus, string> = {
  unchecked: '—',
  available: '✅',
  denied: '🚫',
  invalid: '🚫',
  limited: '⏳',
  unknown: '❔',
};
export function TokenPermissions({
  repo,
  token,
  pending,
  revision,
}: {
  repo: string;
  token: string;
  pending: boolean;
  revision: number;
}) {
  const [report, setReport] = useState(uncheckedAccess),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const retrySeconds = useRetryCountdown(report.retryAt || null);
  useEffect(() => {
    const controller = new AbortController();
    setReport(uncheckedAccess());
    if (!token || pending) {
      setBusy(false);
      return () => controller.abort();
    }
    setBusy(true);
    void checkTokenAccess(repo, token, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setReport(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setReport({
            ...uncheckedAccess(),
            message: 'Could not verify access. Please retry.',
          });
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [repo, token, pending, revision, attempt]);
  const message = pending
    ? 'Apply to check this token.'
    : !token
      ? 'Apply a token to check access.'
      : !repo
        ? 'Choose a repository to check access.'
        : report.message;
  return (
    <section
      className="token-access"
      aria-label="Token permissions"
      aria-busy={busy}
    >
      <div className="token-access-heading">
        <h3>Permissions</h3>
        <button
          type="button"
          disabled={!token || pending || busy || retrySeconds > 0}
          onClick={() => setAttempt((value) => value + 1)}
        >
          {retrySeconds ? retryLabel(retrySeconds) : 'Recheck'}
        </button>
      </div>
      {message && (
        <p className="token-access-summary" role="status">
          {message}
        </p>
      )}
      <table className="token-permissions" aria-label="Feature permissions">
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Permission</th>
            <th scope="col">Access</th>
          </tr>
        </thead>
        <tbody>
          {tokenFeatures.map((feature) => {
            const check = report.checks[feature.key];
            return (
              <tr key={feature.key}>
                <th scope="row">
                  {feature.name}
                  <small>{feature.description}</small>
                </th>
                <td>
                  {feature.permission}
                  <small>Read-only</small>
                </td>
                <td>
                  {busy ? (
                    <span
                      className="loading-spinner"
                      role="status"
                      aria-label="Checking access"
                    />
                  ) : (
                    <span
                      className={`permission-state permission-${check.status}`}
                      role="img"
                      aria-label={labels[check.status]}
                      title={check.message || labels[check.status]}
                    >
                      {icons[check.status]}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
