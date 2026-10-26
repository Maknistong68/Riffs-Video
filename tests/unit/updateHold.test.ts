import { describe, expect, it } from 'vitest';
import { holdUpdates, updatesHeld } from '../../src/app/updateHold';

describe('updateHold', () => {
  it('holds updates while any export runs; releasing twice is harmless', () => {
    expect(updatesHeld()).toBe(false);
    const a = holdUpdates();
    const b = holdUpdates();
    a();
    a();
    expect(updatesHeld()).toBe(true);
    b();
    expect(updatesHeld()).toBe(false);
  });
});
