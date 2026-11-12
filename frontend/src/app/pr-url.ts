import { ValidatorFn } from '@angular/forms';

// Keep the accepted URL grammar in sync with the API; never normalize a different target.
export const validPrUrl = (raw: string): boolean => {
  const value = raw.trim();
  if (!value) return true;
  if (value.length > 2048) return false;
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/[1-9][0-9]*$/.exec(value);
  return (
    !!match &&
    match[0] === value &&
    !['.', '..'].includes(match[1]) &&
    !['.', '..'].includes(match[2])
  );
};

export const prUrlValidator: ValidatorFn = (control) =>
  validPrUrl(String(control.value ?? '')) ? null : { prUrl: true };
