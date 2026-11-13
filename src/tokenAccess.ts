import { github, GitHubError } from './api';

export const tokenFeatures = [
  {
    key: 'contents',
    description: 'Commits, branches, tags & releases',
    permission: 'Contents',
    path: '/branches?per_page=1',
  },
  {
    key: 'pulls',
    description: 'PR-based branch suggestions',
    permission: 'Pull requests',
    path: '/pulls?state=closed&per_page=1',
  },
  {
    key: 'actions',
    description: 'Workflow runs & jobs',
    permission: 'Actions',
    path: '/actions/runs?per_page=1',
  },
] as const;
export type AccessStatus =
  'unchecked' | 'available' | 'denied' | 'invalid' | 'limited' | 'unknown';
export type AccessCheck = {
  status: AccessStatus;
  message: string;
  retryAt?: number;
};
export type TokenAccess = {
  login: string;
  scopes?: string[];
  privateRepo: boolean | null;
  checks: Record<(typeof tokenFeatures)[number]['key'], AccessCheck>;
  message: string;
  retryAt: number;
};
export function uncheckedAccess(): TokenAccess {
  return {
    login: '',
    privateRepo: null,
    checks: {
      contents: { status: 'unchecked', message: '' },
      pulls: { status: 'unchecked', message: '' },
      actions: { status: 'unchecked', message: '' },
    },
    message: '',
    retryAt: 0,
  };
}
function failure(error: unknown): AccessCheck {
  if (error instanceof GitHubError) {
    if (error.retryAt)
      return {
        status: 'limited',
        message: 'GitHub request limit reached.',
        retryAt: error.retryAt,
      };
    if (error.status === 401)
      return { status: 'invalid', message: 'The token is invalid or expired.' };
    if (error.status === 403)
      return {
        status: 'denied',
        message: 'Check permissions and repository policies.',
      };
    if (error.status === 404)
      return {
        status: 'denied',
        message: 'Repository unavailable to this token.',
      };
  }
  return {
    status: 'unknown',
    message: 'Could not verify access. Please retry.',
  };
}
function allFailed(report: TokenAccess, error: unknown): TokenAccess {
  const check = failure(error);
  return {
    ...report,
    checks: { contents: check, pulls: check, actions: check },
    message: check.message,
    retryAt: check.retryAt || 0,
  };
}
export async function checkTokenAccess(
  repo: string,
  token: string,
  signal: AbortSignal,
): Promise<TokenAccess> {
  let report = uncheckedAccess();
  if (!token) return report;
  try {
    const user = await github<{ login: string }>('/user', token, signal);
    signal.throwIfAborted();
    if (typeof user.data.login !== 'string' || !user.data.login)
      throw new Error('No authenticated user.');
    report = { ...report, login: user.data.login, scopes: user.oauthScopes };
  } catch (error) {
    signal.throwIfAborted();
    return allFailed(report, error);
  }
  if (!repo) return report;
  try {
    const { data } = await github<{ private: boolean }>(
      `/repos/${repo}`,
      token,
      signal,
    );
    signal.throwIfAborted();
    report.privateRepo =
      typeof data.private === 'boolean' ? data.private : null;
  } catch (error) {
    signal.throwIfAborted();
    return allFailed(report, error);
  }
  await Promise.all(
    tokenFeatures.map(async (feature) => {
      try {
        await github(`/repos/${repo}${feature.path}`, token, signal);
        signal.throwIfAborted();
        report.checks[feature.key] = { status: 'available', message: '' };
      } catch (error) {
        signal.throwIfAborted();
        const check = failure(error);
        report.checks[feature.key] = check;
        report.retryAt = Math.max(report.retryAt, check.retryAt || 0);
      }
    }),
  );
  signal.throwIfAborted();
  return report;
}
