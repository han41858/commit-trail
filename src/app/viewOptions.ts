export const VIEW_OPTIONS_KEY = 'commit-trail.view-options';
export type ViewOptionValues = {
  theme: string;
  autoRefresh: boolean;
  // null follows the default for the current authentication state.
  interval: number | null;
};
const THEMES = ['system', 'dark', 'light'],
  INTERVALS = [30, 60, 300];
export const defaultViewOptions = (): ViewOptionValues => ({
  theme: 'system',
  autoRefresh: true,
  interval: null,
});

// Each field is validated on its own; anything unknown falls back to its default.
export function parseViewOptions(raw: string | null): ViewOptionValues {
  const options = defaultViewOptions();
  if (!raw) return options;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return options;
  }
  if (!saved || typeof saved !== 'object') return options;
  const { theme, autoRefresh, interval } = saved as Record<string, unknown>;
  if (typeof theme === 'string' && THEMES.includes(theme))
    options.theme = theme;
  if (typeof autoRefresh === 'boolean') options.autoRefresh = autoRefresh;
  if (typeof interval === 'number' && INTERVALS.includes(interval))
    options.interval = interval;
  return options;
}
export function readViewOptions() {
  try {
    return parseViewOptions(localStorage.getItem(VIEW_OPTIONS_KEY));
  } catch {
    return defaultViewOptions();
  }
}
// Storage failures keep the choice for this tab only; options hold nothing sensitive.
export function saveViewOptions(options: ViewOptionValues) {
  try {
    localStorage.setItem(VIEW_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* The in-memory choice still applies. */
  }
}
