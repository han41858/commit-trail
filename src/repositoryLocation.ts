import { monitorRepository, MONITOR_LIMIT } from './MonitorRepositories';
import { branchName } from './branchName';

export type RepositoryLocation = {
  mode: 'single' | 'monitor';
  repositories: readonly string[];
  branches?: readonly (string | undefined)[];
};
function normalize(
  repositories: readonly string[],
  branches: readonly (string | undefined)[] = [],
) {
  const names: string[] = [],
    selected: (string | undefined)[] = [];
  for (const [index, value] of repositories.entries()) {
    let name: string;
    try {
      name = monitorRepository(value);
    } catch {
      continue;
    }
    if (names.includes(name)) continue;
    names.push(name);
    selected.push(branchName(branches[index]));
    if (names.length === MONITOR_LIMIT) break;
  }
  while (selected.length && !selected.at(-1)) selected.pop();
  return { repositories: names, ...(selected.length ? { branches: selected } : {}) };
}
export function readRepositoryLocation(value: string): RepositoryLocation {
  const url = new URL(value),
    input = url.searchParams.getAll('repo'),
    configuration = normalize(input, url.searchParams.getAll('branch'));
  return {
    mode:
      configuration.repositories.length &&
      (input.length > 1 || url.searchParams.get('mode') === 'monitor')
        ? 'monitor'
        : 'single',
    ...configuration,
  };
}
export const repositoryLocationKey = (configuration: RepositoryLocation) =>
  JSON.stringify([
    configuration.mode,
    normalize(configuration.repositories, configuration.branches),
  ]);
export function repositoryLocationURL(
  value: string,
  configuration: RepositoryLocation,
  share = false,
) {
  const url = new URL(value),
    normalized = normalize(configuration.repositories, configuration.branches),
    repositories = normalized.repositories.slice(
      0,
      configuration.mode === 'single' ? 1 : undefined,
    ),
    branches = normalized.branches?.slice(0, repositories.length);
  if (share && !['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported app URL.');
  if (share) {
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
  } else {
    url.searchParams.delete('repo');
    url.searchParams.delete('mode');
    url.searchParams.delete('branch');
  }
  for (const repository of repositories) url.searchParams.append('repo', repository);
  for (const branch of branches || []) url.searchParams.append('branch', branch || '');
  if (configuration.mode === 'monitor' && repositories.length === 1)
    url.searchParams.set('mode', 'monitor');
  return url;
}
export function monitorShareURL(
  value: string,
  repositories: readonly string[],
  branches?: readonly (string | undefined)[],
) {
  if (!normalize(repositories).repositories.length)
    throw new Error('Select a repository to share.');
  return repositoryLocationURL(value, { mode: 'monitor', repositories, branches }, true).href;
}
