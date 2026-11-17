import type { BeforeSendEvent } from '@vercel/analytics/react';

/**
 * Vercel analytics should count one document visit, not URL-only navigation.
 * Repository and branch names may identify private GitHub work; never forward
 * these or any other query-string / fragment values to analytics.
 */
export function createAnalyticsBeforeSend() {
  let recordedPageview = false;

  return (event: BeforeSendEvent): BeforeSendEvent | null => {
    if (event.type === 'pageview' && recordedPageview) return null;

    let url: URL;
    try {
      url = new URL(event.url);
      if (!['https:', 'http:'].includes(url.protocol)) return null;
    } catch {
      // An invalid URL must not be forwarded without redaction.
      return null;
    }

    url.search = '';
    url.hash = '';
    url.username = '';
    url.password = '';

    if (event.type === 'pageview') recordedPageview = true;
    return { ...event, url: url.toString() };
  };
}

// Defined once per loaded document, independently of React re-renders.
export const analyticsBeforeSend = createAnalyticsBeforeSend();
