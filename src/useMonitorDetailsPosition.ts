import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { monitorDetailsFrame } from './monitorDetailsPosition';

// Fixed positioning escapes each column's clipping while retaining DOM ownership.
export function useMonitorDetailsPosition(
  pane: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  enabled: boolean,
  selection: string,
  order: number,
) {
  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!enabled) return;
    const element = pane.current,
      stage = element?.closest('.monitor-stage');
    if (!element || !stage) return;
    const viewport = window.visualViewport;
    const update = () => {
      const anchor = element.getBoundingClientRect(),
        area = stage.getBoundingClientRect();
      if (!anchor.width) return;
      const left = viewport?.offsetLeft ?? 0,
        top = viewport?.offsetTop ?? 0;
      const frame = monitorDetailsFrame(anchor, {
        left: Math.max(area.left, left),
        right: Math.min(
          area.right,
          left + (viewport?.width ?? document.documentElement.clientWidth),
        ),
        top: Math.max(area.top, top),
        bottom: Math.min(area.bottom, top + (viewport?.height ?? window.innerHeight)),
      });
      const next = {
        left: frame.left,
        width: frame.width,
        bottom: Math.max(0, window.innerHeight - frame.bottom),
        maxHeight: frame.maxHeight,
      };
      setPosition((previous) =>
        previous?.left === next.left &&
        previous.width === next.width &&
        previous.bottom === next.bottom &&
        previous.maxHeight === next.maxHeight
          ? previous
          : next,
      );
    };
    update();
    panel.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(stage);
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
    };
  }, [pane, panel, enabled, selection, order]);
  return enabled ? position : undefined;
}
