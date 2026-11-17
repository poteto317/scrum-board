import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

// Match the API's Unicode code-point limits, including emoji.
export const textLimit =
  (max: number, required = false): ValidatorFn =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    if (required && !value.trim()) return { required: true };
    return [...(required ? value.trim() : value)].length > max ? { maxlength: true } : null;
  };

/** Max length after trim (matches server NormalizeCloseReason). Empty allowed. */
export const trimmedTextLimit =
  (max: number): ValidatorFn =>
  (control: AbstractControl): ValidationErrors | null =>
    [...String(control.value ?? '').trim()].length > max ? { maxlength: true } : null;
