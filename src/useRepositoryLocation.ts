import { useCallback, useEffect, useState } from 'react';
import {
  readRepositoryLocation,
  repositoryLocationKey,
  repositoryLocationURL,
  type RepositoryLocation,
} from './repositoryLocation';

// Browser history is the source of configuration. No router or API work lives here.
export function useRepositoryLocation() {
  const [configuration, setConfiguration] = useState(() => readRepositoryLocation(location.href));
  const accept = useCallback(
    (next: RepositoryLocation) =>
      setConfiguration((previous) =>
        repositoryLocationKey(previous) === repositoryLocationKey(next) ? previous : next,
      ),
    [],
  );
  useEffect(() => {
    const restore = () => accept(readRepositoryLocation(location.href));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [accept]);
  useEffect(() => {
    const url = repositoryLocationURL(location.href, configuration);
    if (url.href !== location.href) window.history.replaceState(window.history.state, '', url);
  }, [configuration]);
  const navigate = useCallback(
    (next: RepositoryLocation, { replace = false }: { replace?: boolean } = {}) => {
      const url = repositoryLocationURL(location.href, next);
      if (
        repositoryLocationKey(readRepositoryLocation(location.href)) !== repositoryLocationKey(next)
      ) {
        if (replace) window.history.replaceState(window.history.state, '', url);
        else window.history.pushState(null, '', url);
      } else if (url.href !== location.href)
        window.history.replaceState(window.history.state, '', url);
      accept(next);
    },
    [accept],
  );
  return { configuration, navigate };
}
