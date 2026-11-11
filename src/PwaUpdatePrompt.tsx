import { useState, useSyncExternalStore } from 'react';
import { pwaUpdates } from './pwa';

export function PwaUpdatePrompt() {
  const state = useSyncExternalStore(
    pwaUpdates.subscribe,
    pwaUpdates.getSnapshot,
  );
  const [buttonSize, setButtonSize] = useState<{
    width: number;
    height: number;
  }>();
  if (!state.visible) return null;
  return (
    <section
      className="pwa-update"
      data-pwa-ui
      role="status"
      aria-label="App update"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          pwaUpdates.dismiss();
        }
      }}
    >
      <span>{state.error || 'A new version of Commit Trail is ready.'}</span>
      <button
        className="pwa-update-apply primary"
        type="button"
        style={state.applying ? buttonSize : undefined}
        disabled={state.applying}
        onClick={(event) => {
          const { width, height } = event.currentTarget.getBoundingClientRect();
          setButtonSize({ width, height });
          void pwaUpdates.apply();
        }}
      >
        {state.applying ? 'Updating…' : 'Update app'}
      </button>
      <button
        className="pwa-update-later"
        type="button"
        disabled={state.applying}
        aria-label="Dismiss app update"
        onClick={pwaUpdates.dismiss}
      >
        Later
      </button>
    </section>
  );
}
