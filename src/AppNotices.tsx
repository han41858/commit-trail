import { useLayoutEffect, useRef, type ReactNode } from 'react';

// Measure every notice, including children positioned outside normal flow.
// Consumers update geometry without remounting or refocusing commit details.
export function AppNotices({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const app = element?.closest<HTMLElement>('.app');
    if (!element || !app) return;
    const update = () => {
      const tops = [element, ...element.children]
        .filter((child) => !['hidden', 'collapse'].includes(getComputedStyle(child).visibility))
        .map((child) => child.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => rect.top);
      const clearance = tops.length
        ? Math.max(0, window.innerHeight - Math.min(...tops) + 8)
        : 0;
      const value = `${Math.ceil(clearance)}px`;
      if (app.style.getPropertyValue('--notices-clearance') === value) return;
      app.style.setProperty('--notices-clearance', value);
      app.dispatchEvent(new Event('noticeschange'));
    };
    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
      update();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    observe();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      app.style.removeProperty('--notices-clearance');
    };
  }, []);
  return (
    <div className="app-notices" ref={ref}>
      {children}
    </div>
  );
}
