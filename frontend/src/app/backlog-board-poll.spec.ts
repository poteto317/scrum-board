import { describe, expect, it } from 'vitest';
import { mergeBacklogBoardPoll } from './backlog-board-poll';

describe('mergeBacklogBoardPoll (304 skip contract)', () => {
  it('returns null when both legs are notModified so apply can be skipped', () => {
    expect(
      mergeBacklogBoardPoll(
        { items: [1], columns: ['a'] },
        { status: 'notModified', etag: '"b"' },
        { status: 'notModified', etag: '"c"' },
      ),
    ).toBeNull();
  });
});
