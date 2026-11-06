import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { OwnerRepositories } from './OwnerRepositories';
import { ownerFromInput } from './repoInput';

// Each input owns its popup lifetime; the app shares only the query/cache model.
export function useOwnerRepositoryPicker(
  model: OwnerRepositories,
  value: string,
  container: RefObject<HTMLElement | null>,
  input: RefObject<HTMLInputElement | null>,
  enabled = true,
) {
  const snapshot = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const owner = useRef('');
  const [requested, setRequested] = useState('');
  const showing =
    enabled && !!requested && snapshot.owner === requested && ownerFromInput(value) === requested;
  const close = useCallback(
    (restoreFocus = false) => {
      if (!owner.current) return;
      owner.current = '';
      setRequested('');
      model.close();
      if (restoreFocus) input.current?.focus({ preventScroll: true });
    },
    [model, input],
  );
  useEffect(() => {
    if (owner.current && (!enabled || ownerFromInput(value) !== owner.current)) close();
  }, [value, enabled, close]);
  useEffect(
    () => () => {
      if (owner.current) model.close();
    },
    [model],
  );
  useEffect(() => {
    if (!showing) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [showing, container, close]);

  function submit(value: string) {
    const next = ownerFromInput(value);
    if (!enabled || !next) return false;
    owner.current = next;
    setRequested(next);
    void model.open(next);
    return true;
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showing || event.nativeEvent.isComposing) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      container.current?.querySelector<HTMLInputElement>('[data-owner-filter]')?.focus();
      return true;
    }
    return false;
  }
  return { showing, submit, close, keyDown };
}
