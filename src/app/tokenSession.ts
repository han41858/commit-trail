import type { MonitorRepositories } from '../monitor/MonitorRepositories';
import type { MonitorSession } from '../monitor/MonitorSession';
import type { BranchSelections } from '../repository/BranchSelections';
import type { OwnerRepositories } from '../repository/OwnerRepositories';
import type { RecentRepositories } from '../repository/RecentRepositories';
import { saveStoredToken } from '../token/tokenStorage';

type TokenSession = {
  authToken: { current: string };
  monitor: Pick<MonitorSession, 'authenticationChanged'>;
  branchSelections: Pick<BranchSelections, 'authenticationChanged'>;
  monitorRepositories: Pick<
    MonitorRepositories,
    'authenticationChanged' | 'reconcile'
  >;
  recent: Pick<RecentRepositories, 'authenticationChanged' | 'reload'>;
  ownerRepositories: Pick<OwnerRepositories, 'setToken'>;
};

export function updateTokenSession(
  {
    authToken,
    monitor,
    branchSelections,
    monitorRepositories,
    recent,
    ownerRepositories,
  }: TokenSession,
  previous: string,
  next: string,
  cancelPendingOpen?: () => void,
) {
  // Clear data for the previous credential while its storage context is still active.
  monitor.authenticationChanged(previous, next);
  branchSelections.authenticationChanged(previous, next);
  monitorRepositories.authenticationChanged(previous, next);
  recent.authenticationChanged(previous, next);
  cancelPendingOpen?.();

  const error = saveStoredToken(next);
  authToken.current = next;
  ownerRepositories.setToken(next);
  recent.reload();
  monitorRepositories.reconcile();
  return error;
}
