export const TOKEN_STORAGE_KEY = 'commit-trail.github-token';
export function readStoredToken() {
  try {
    return { token: localStorage.getItem(TOKEN_STORAGE_KEY) || '', error: '' };
  } catch {
    return {
      token: '',
      error: 'Browser storage is unavailable. A token can still be used for this tab.',
    };
  }
}
export function saveStoredToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
    return '';
  } catch {
    return token
      ? 'Could not save this token. It will be used for this tab only.'
      : 'Could not remove the saved token from browser storage. Please try again.';
  }
}
