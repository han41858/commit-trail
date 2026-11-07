import { lowercaseRepoInput } from './model';

// Only bare GitHub logins enter owner discovery. Repository paths and URLs keep
// using their existing parser, including its validation and normalization rules.
export function ownerFromInput(value: string) {
  const owner = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/.test(owner) ? owner : null;
}

type TextField = {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  setSelectionRange(start: number, end: number): void;
};

// Lowercase the field in place before React reconciles it. A controlled input whose DOM value
// differs from the next state value gets reset by React, which moves the caret to the end.
export function lowercaseField(field: TextField) {
  const value = lowercaseRepoInput(field.value);
  if (value !== field.value) {
    const { selectionStart: start, selectionEnd: end } = field;
    field.value = value;
    if (start !== null && end !== null)
      field.setSelectionRange(Math.min(start, value.length), Math.min(end, value.length));
  }
  return value;
}
