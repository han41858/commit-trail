import { Component, lazy, Suspense, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { debug } from './debug';

const DebugUI = lazy(() => import('./DebugPanel'));

// A failed panel download must not unmount the app: keep the error inside the debug UI.
// Browsers cache a failed dynamic import for the page, so recovery needs a reload rather than an in-page retry.
class DebugLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.debug(
      '[Commit Trail debug] panel failed to load',
      error instanceof Error ? error.name : 'error',
    );
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="debug-load-error" data-debug-ui role="alert">
        Debug panel failed to load.
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
        <button type="button" onClick={() => debug.setMode('off')}>
          Close
        </button>
      </div>
    );
  }
}

// Stays in the main bundle: only the activation shortcut and mode wiring. The UI loads when debug mode turns on.
export function DebugRoot({ developer }: { developer: boolean }) {
  const mode = useSyncExternalStore(debug.subscribeMode, debug.getMode);
  useEffect(() => {
    if (!developer) return;
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
        event.preventDefault();
        debug.toggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [developer]);
  useEffect(() => {
    if (mode === 'off') return;
    const visibility = () => debug.setHidden(document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [mode === 'off']);
  if (mode === 'off') return null;
  return (
    <DebugLoadBoundary>
      <Suspense fallback={null}>
        <DebugUI mode={mode} />
      </Suspense>
    </DebugLoadBoundary>
  );
}
