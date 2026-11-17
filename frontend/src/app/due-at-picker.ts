import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { DueAtLocalParts, fromLocalParts, toLocalParts } from './due-at';
import { dueAtYearOptions } from './due-at-year';

type DueAtUnit = 'year' | 'month' | 'day' | 'hour' | 'minute';

/** Scroll position → option index for a wheel of known item height. */
export function wheelIndex(scrollTop: number, itemHeight: number, length: number): number {
  if (itemHeight <= 0 || length <= 0) return 0;
  return Math.min(Math.max(Math.round(scrollTop / itemHeight), 0), length - 1);
}

@Component({
  selector: 'app-due-at-picker',
  templateUrl: './due-at-picker.html',
  styleUrl: './due-at-picker.css',
})
export class DueAtPicker {
  readonly parts = input.required<DueAtLocalParts>();
  readonly disabled = input(false);
  readonly partsChange = output<DueAtLocalParts>();
  private readonly injector = inject(Injector);
  private readonly wheels = viewChildren<ElementRef<HTMLElement>>('wheel');

  readonly months = Array.from({ length: 12 }, (_, i) => i + 1);
  readonly hours = Array.from({ length: 24 }, (_, i) => i);
  readonly minutes = Array.from({ length: 60 }, (_, i) => i);

  constructor() {
    afterNextRender(() => this.scrollSelectedIntoView(), { injector: this.injector });
  }

  years(): number[] {
    return dueAtYearOptions();
  }

  days(): number[] {
    const p = this.parts();
    const count = new Date(p.year, p.month, 0).getDate();
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  select(unit: DueAtUnit, value: number) {
    if (this.disabled()) return;
    this.emitClamped({ ...this.parts(), [unit]: value });
  }

  onWheelScroll(unit: DueAtUnit, event: Event) {
    if (this.disabled()) return;
    const el = event.target as HTMLElement;
    const itemHeight = this.itemHeight(el);
    if (itemHeight <= 0) return;
    const options = this.optionsFor(unit);
    const value = options[wheelIndex(el.scrollTop, itemHeight, options.length)];
    if (value === this.parts()[unit]) return;
    this.emitClamped({ ...this.parts(), [unit]: value });
  }

  /**
   * Read centered values from all wheels (confirm after scroll inertia).
   * Returns null when layout height is unavailable (jsdom / pre-layout) so draft wins.
   */
  readPartsFromWheels(): DueAtLocalParts | null {
    const refs = this.wheels();
    if (refs.length === 0 || refs.some((ref) => this.itemHeight(ref.nativeElement) <= 0)) {
      return null;
    }
    const next = { ...this.parts() };
    for (const ref of refs) {
      const el = ref.nativeElement;
      const unit = el.dataset['unit'] as DueAtUnit | undefined;
      if (!unit) continue;
      const itemHeight = this.itemHeight(el);
      const options = this.optionsFor(unit);
      next[unit] = options[wheelIndex(el.scrollTop, itemHeight, options.length)];
    }
    return toLocalParts(fromLocalParts(next));
  }

  pad2(n: number): string {
    return String(n).padStart(2, '0');
  }

  private emitClamped(next: DueAtLocalParts) {
    const clamped = toLocalParts(fromLocalParts(next));
    this.partsChange.emit(clamped);
    // Calendar clamp may change day when year/month changes — sync every wheel.
    afterNextRender(() => this.scrollSelectedIntoView(), { injector: this.injector });
  }

  private optionsFor(unit: DueAtUnit): number[] {
    switch (unit) {
      case 'year':
        return this.years();
      case 'month':
        return this.months;
      case 'day':
        return this.days();
      case 'hour':
        return this.hours;
      case 'minute':
        return this.minutes;
    }
  }

  private scrollSelectedIntoView() {
    for (const ref of this.wheels()) {
      const el = ref.nativeElement;
      const unit = el.dataset['unit'] as DueAtUnit | undefined;
      if (!unit) continue;
      const itemHeight = this.itemHeight(el) || 40;
      const index = this.optionsFor(unit).indexOf(this.parts()[unit]);
      if (index < 0) continue;
      el.scrollTop = index * itemHeight;
    }
  }

  /** Real layout height only — 0 in jsdom so confirm keeps draft instead of index-0. */
  private itemHeight(wheel: HTMLElement): number {
    const item = wheel.querySelector<HTMLElement>('.due-at-wheel-item');
    return item?.offsetHeight ?? 0;
  }
}
