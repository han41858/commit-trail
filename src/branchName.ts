// Git ref rules, without changing branch-name case or decoding URL values twice.
export function branchName(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value ||
    value === '@' ||
    value.startsWith('-') ||
    /[\x00-\x20\x7f~^:?*\[\\]/.test(value) ||
    value.includes('..') ||
    value.includes('@{')
  )
    return;
  if (
    value
      .split('/')
      .some(
        (part) =>
          !part ||
          part.startsWith('.') ||
          part.endsWith('.') ||
          part.endsWith('.lock'),
      )
  )
    return;
  return value;
}
