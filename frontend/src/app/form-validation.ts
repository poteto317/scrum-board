import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

// Match the API's Unicode code-point limits, including emoji.
export const textLimit =
  (max: number, required = false): ValidatorFn =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    if (required && !value.trim()) return { required: true };
    return [...(required ? value.trim() : value)].length > max ? { maxlength: true } : null;
  };
