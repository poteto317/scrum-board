import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { textLimit } from './form-validation';

describe('Unicode text validation', () => {
  it('accepts 200 emoji and rejects 201 without counting UTF-16 units', () => {
    const validate = textLimit(200, true);
    expect(validate(new FormControl('🧪'.repeat(200)))).toBeNull();
    expect(validate(new FormControl('🧪'.repeat(201)))).toEqual({ maxlength: true });
  });
  it('requires non-whitespace titles, trims their edges, but counts all description whitespace', () => {
    expect(textLimit(3, true)(new FormControl('　 '))).toEqual({ required: true });
    expect(textLimit(3, true)(new FormControl('  abc　'))).toBeNull();
    expect(textLimit(3)(new FormControl(' abc '))).toEqual({ maxlength: true });
    expect(textLimit(10000)(new FormControl(''))).toBeNull();
  });
});
