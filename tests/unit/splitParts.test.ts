import { describe, expect, it } from 'vitest';
import { partRanges } from '../../src/export/splitParts';

describe('partRanges', () => {
  it('splits bars into consecutive parts covering everything', () => {
    expect(partRanges(8, 4)).toEqual([{ fromBar: 0, toBar: 3 }, { fromBar: 4, toBar: 7 }]);
    expect(partRanges(10, 4)).toEqual([{ fromBar: 0, toBar: 3 }, { fromBar: 4, toBar: 7 }, { fromBar: 8, toBar: 9 }]);
  });
  it('a single leftover bar joins the previous part', () => {
    expect(partRanges(9, 4)).toEqual([{ fromBar: 0, toBar: 3 }, { fromBar: 4, toBar: 8 }]);
  });
  it('short riffs give one part (nothing to split)', () => {
    expect(partRanges(3, 4)).toEqual([{ fromBar: 0, toBar: 2 }]);
    expect(partRanges(0, 4)).toEqual([]);
  });
});
