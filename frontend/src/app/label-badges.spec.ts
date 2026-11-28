import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { LabelBadges } from './label-badges';

describe('LabelBadges', () => {
  it('renders nothing when empty', () => {
    const fx = TestBed.createComponent(LabelBadges);
    fx.componentRef.setInput('labels', []);
    fx.detectChanges();
    expect(fx.nativeElement.querySelectorAll('.label-badge')).toHaveLength(0);
  });

  it('renders label names and CSS color custom properties sorted id ASC', () => {
    const fx = TestBed.createComponent(LabelBadges);
    fx.componentRef.setInput('labels', [
      { id: 5, name: 'API', color: '#3b82f6' },
      { id: 2, name: 'Bug', color: '#ef4444' },
    ]);
    fx.detectChanges();
    const badges = Array.from<HTMLElement>(fx.nativeElement.querySelectorAll('.label-badge'));
    expect(badges.map((el) => el.textContent?.trim())).toEqual(['Bug', 'API']);
    expect(badges[0].style.getPropertyValue('--label-color')).toBe('#ef4444');
    expect(badges[1].style.getPropertyValue('--label-color')).toBe('#3b82f6');
  });
});
