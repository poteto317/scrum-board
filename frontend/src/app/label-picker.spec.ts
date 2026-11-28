import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LabelPicker } from './label-picker';
import { Label } from './label';

function makeLabels(n: number): Label[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `Label-${i + 1}`,
    color: '#3b82f6',
  }));
}

describe('LabelPicker', () => {
  it('toggles label selection and emits ordered ids', () => {
    const fx = TestBed.createComponent(LabelPicker);
    fx.componentRef.setInput('availableLabels', makeLabels(3));
    fx.componentRef.setInput('selectedIds', [1]);
    const emitted: number[][] = [];
    fx.componentInstance.selectedIdsChange.subscribe((v) => emitted.push(v));
    fx.detectChanges();

    const buttons = Array.from<HTMLButtonElement>(
      fx.nativeElement.querySelectorAll('.picker-option'),
    );
    buttons[2].click();
    expect(emitted).toEqual([[1, 3]]);

    fx.componentRef.setInput('selectedIds', [1, 3]);
    fx.detectChanges();
    buttons[0].click();
    expect(emitted).toEqual([
      [1, 3],
      [3],
    ]);
  });

  it('disables unselected labels once 20 labels are selected', () => {
    const fx = TestBed.createComponent(LabelPicker);
    const labels = makeLabels(21);
    fx.componentRef.setInput('availableLabels', labels);
    fx.componentRef.setInput(
      'selectedIds',
      labels.slice(0, 20).map((l) => l.id),
    );
    fx.detectChanges();

    const buttons = Array.from<HTMLButtonElement>(
      fx.nativeElement.querySelectorAll('.picker-option'),
    );
    expect(buttons[0].disabled).toBe(false); // selected can still be unchecked
    expect(buttons[20].disabled).toBe(true); // 21st unselected disabled
  });

  it('shows retry UI when load failed before first catalog load', () => {
    const fx = TestBed.createComponent(LabelPicker);
    fx.componentRef.setInput('loaded', false);
    fx.componentRef.setInput('loading', false);
    fx.componentRef.setInput('loadError', '読込失敗');
    let retried = false;
    fx.componentInstance.retryLoad.subscribe(() => (retried = true));
    fx.detectChanges();

    expect(fx.nativeElement.textContent).toContain('読込失敗');
    (fx.nativeElement.querySelector('.picker-retry') as HTMLButtonElement).click();
    expect(retried).toBe(true);
  });

  it('drops unknown/deleted selectedIds on toggle when catalogLoaded is true', () => {
    const fx = TestBed.createComponent(LabelPicker);
    fx.componentRef.setInput('availableLabels', makeLabels(2));
    fx.componentRef.setInput('selectedIds', [1, 999]);
    fx.componentRef.setInput('catalogLoaded', true);
    const emitted: number[][] = [];
    fx.componentInstance.selectedIdsChange.subscribe((v) => emitted.push(v));
    fx.detectChanges();

    const buttons = Array.from<HTMLButtonElement>(
      fx.nativeElement.querySelectorAll('.picker-option'),
    );
    buttons[1].click();
    expect(emitted).toEqual([[1, 2]]);
  });
});
