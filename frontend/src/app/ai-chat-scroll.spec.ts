import { describe, expect, it } from 'vitest';
import {
  AI_CHAT_STICK_THRESHOLD_PX,
  canScheduleStickScroll,
  isNearBottom,
  scrollElementToBottom,
} from './ai-chat-scroll';

describe('ai-chat-scroll', () => {
  describe('isNearBottom', () => {
    const box = (scrollTop: number, scrollHeight: number, clientHeight: number) => ({
      scrollTop,
      scrollHeight,
      clientHeight,
    });

    it('is true when distance is 0', () => {
      expect(isNearBottom(box(100, 200, 100))).toBe(true);
    });

    it('is true when distance equals the default threshold', () => {
      expect(isNearBottom(box(52, 200, 100))).toBe(true);
      expect(200 - 52 - 100).toBe(AI_CHAT_STICK_THRESHOLD_PX);
    });

    it('is false when distance is just past the default threshold', () => {
      expect(isNearBottom(box(51, 200, 100))).toBe(false);
      expect(200 - 51 - 100).toBe(AI_CHAT_STICK_THRESHOLD_PX + 1);
    });

    it('respects an explicit threshold boundary', () => {
      expect(isNearBottom(box(90, 200, 100), 10)).toBe(true);
      expect(isNearBottom(box(89, 200, 100), 10)).toBe(false);
    });
  });

  describe('scrollElementToBottom', () => {
    it('sets scrollTop to scrollHeight', () => {
      const el = { scrollTop: 0, scrollHeight: 480 };
      scrollElementToBottom(el);
      expect(el.scrollTop).toBe(480);
    });
  });

  describe('canScheduleStickScroll', () => {
    it('is false while loading or failed or unstuck', () => {
      expect(
        canScheduleStickScroll({ loading: true, loadFailed: false, stickToBottom: true }),
      ).toBe(false);
      expect(
        canScheduleStickScroll({ loading: false, loadFailed: true, stickToBottom: true }),
      ).toBe(false);
      expect(
        canScheduleStickScroll({ loading: false, loadFailed: false, stickToBottom: false }),
      ).toBe(false);
    });

    it('is true when ready and stuck', () => {
      expect(
        canScheduleStickScroll({ loading: false, loadFailed: false, stickToBottom: true }),
      ).toBe(true);
    });
  });
});
