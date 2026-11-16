import { useRef, type ReactNode } from 'react';

export function PopupBackdrop({
  children,
  className,
  onClose,
}: {
  children: ReactNode;
  className: string;
  onClose: () => void;
}) {
  const gesture = useRef<{
    pointerId: number;
    endedOnBackdrop: boolean;
  } | null>(null);
  return (
    <div
      className={`popup-backdrop ${className}`}
      onPointerDown={(event) => {
        gesture.current =
          event.isPrimary &&
          event.button === 0 &&
          event.target === event.currentTarget
            ? { pointerId: event.pointerId, endedOnBackdrop: false }
            : null;
        // Keep keyboard focus in the popup while a backdrop gesture completes.
        if (gesture.current) event.preventDefault();
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) return;
        // Touch capture can retarget pointerup; check the actual release position.
        current.endedOnBackdrop =
          event.currentTarget.ownerDocument.elementFromPoint(
            event.clientX,
            event.clientY,
          ) === event.currentTarget;
      }}
      onPointerCancel={() => {
        gesture.current = null;
      }}
      onClick={(event) => {
        const dismiss =
          gesture.current?.endedOnBackdrop &&
          event.target === event.currentTarget;
        gesture.current = null;
        if (dismiss) onClose();
      }}
    >
      {children}
    </div>
  );
}
