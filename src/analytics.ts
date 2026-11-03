/**
 * Record one anonymous page view per document load.
 *
 * GitStream navigates within the same document by updating ?repo= and ?branch=.
 * Those values may reveal private repository names, and a change of selection
 * is not a new visit. Do not send either the query or extra SPA page views.
 */
type AnalyticsEvent = { url: string; [key: string]: unknown };
type AnalyticsCommand = (...args: unknown[]) => void;

declare global {
  interface Window {
    va?: AnalyticsCommand;
    vaq?: unknown[][];
  }
}

export function analyticsPageviewFilter() {
  let recorded = false;
  return (event: AnalyticsEvent): AnalyticsEvent | null => {
    if (recorded) return null;

    try {
      const url = new URL(event.url);
      url.search = '';
      url.hash = '';
      url.username = '';
      url.password = '';
      recorded = true;
      return { ...event, url: url.toString() };
    } catch {
      // Never fall back to submitting an unfiltered URL.
      return null;
    }
  };
}

if (typeof window !== 'undefined' && import.meta.env.PROD) {
  window.va ??= (...args: unknown[]) => {
    (window.vaq ??= []).push(args);
  };
  window.va('beforeSend', analyticsPageviewFilter());

  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.append(script);
}
