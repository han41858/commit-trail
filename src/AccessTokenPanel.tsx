import { useRef, type RefObject } from 'react';
import { TokenPermissions } from './TokenPermissions';

export function AccessTokenPanel({
  panelRef,
  repository,
  appliedToken,
  token,
  revision,
  storageError,
  onTokenChange,
  onApply,
  onRemove,
  onClose,
  onCreate,
}: {
  panelRef: RefObject<HTMLElement | null>;
  repository: string;
  appliedToken: string;
  token: string;
  revision: number;
  storageError: string;
  onTokenChange: (token: string) => void;
  onApply: () => void;
  onRemove: () => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const backdropGesture = useRef<{
    pointerId: number;
    endedOnBackdrop: boolean;
  } | null>(null);
  return (
    <div
      className="auth-backdrop"
      onPointerDown={(event) => {
        backdropGesture.current =
          event.isPrimary &&
          event.button === 0 &&
          event.target === event.currentTarget
            ? { pointerId: event.pointerId, endedOnBackdrop: false }
            : null;
      }}
      onPointerUp={(event) => {
        const gesture = backdropGesture.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        // Touch capture can retarget pointerup; check the actual release position.
        gesture.endedOnBackdrop =
          event.currentTarget.ownerDocument.elementFromPoint(
            event.clientX,
            event.clientY,
          ) === event.currentTarget;
      }}
      onPointerCancel={() => {
        backdropGesture.current = null;
      }}
      onClick={(event) => {
        const dismiss =
          backdropGesture.current?.endedOnBackdrop &&
          event.target === event.currentTarget;
        backdropGesture.current = null;
        if (dismiss) onClose();
      }}
    >
      <section
        className="auth floating-panel"
        ref={panelRef}
        aria-label="GitHub access token"
      >
        <button
          className="close"
          aria-label="Close access token"
          onClick={onClose}
        >
          ×
        </button>
        <h2>GitHub access token</h2>
        <p>60 requests/hour · 5,000 with a token</p>
        <TokenPermissions
          repo={repository}
          token={appliedToken}
          pending={token.trim() !== appliedToken}
          revision={revision}
        />
        <a
          className="create-token primary"
          aria-label="Create a fine-grained GitHub token"
          onClick={onCreate}
          href="https://github.com/settings/personal-access-tokens/new?name=Commit%20Trail&amp;contents=read&amp;pull_requests=read&amp;actions=read"
          target="_blank"
          rel="noreferrer"
        >
          Create token
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M15 3h6v6M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
          </svg>
        </a>
        <form
          className="token-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.currentTarget.querySelector('input')?.blur();
            onApply();
          }}
        >
          <input
            aria-label="Access token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            placeholder="Paste your token"
          />
          <button className="primary" type="submit">
            Apply token
          </button>
        </form>
        <small>Saved in this browser until you remove it.</small>
        {storageError && <p role="alert">{storageError}</p>}
        <button className="remove-token" onClick={onRemove}>
          Remove token & clear history
        </button>
      </section>
    </div>
  );
}
