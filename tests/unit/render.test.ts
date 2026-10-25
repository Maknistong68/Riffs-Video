import { describe, expect, it } from 'vitest';
import { defaultFrameSettings } from '../../src/render/drawFrame';
import { cameraCenter, CLOSEUP_SPAN, layoutGeometry, visibleFrets } from '../../src/render/layouts';
import { bendProgress, dotPosition, dotRadius, fretX, noteProbe, vibrationAmplitude } from '../../src/render/neck2d';
import { staffStep } from '../../src/render/notation';
import { SKIN_IDS } from '../../src/render/skins';
import { LAYOUTS } from '../../src/render/style';
import { demoTimeline } from './helpers/demoTimeline';

const t = demoTimeline();

describe('neck view', () => {
  const geo = layoutGeometry(defaultFrameSettings(30), t, 0);
  const neck = geo.neck;

  it('fret spacing shrinks towards the body', () => {
    const w1 = fretX(neck, 1) - fretX(neck, 0);
    const w12 = fretX(neck, 12) - fretX(neck, 11);
    expect(w1).toBeGreaterThan(w12);
    expect(fretX(neck, 0)).toBeCloseTo(neck.x0);
    expect(fretX(neck, 12)).toBeCloseTo(neck.x1);
  });

  it('high e is drawn on top (P5)', () => {
    expect(dotPosition(neck, 0, 1).y).toBeLessThan(dotPosition(neck, 5, 1).y);
  });

  it('left-handed mirrors the neck: nut on the right', () => {
    const lefty = layoutGeometry(defaultFrameSettings(30, { leftHanded: true }), t, 0).neck;
    expect(fretX(lefty, 0)).toBeCloseTo(lefty.x1);
    const same = { ...lefty, mirror: false };
    expect(dotPosition(lefty, 2, 3).x).toBeCloseTo(lefty.x0 + lefty.x1 - dotPosition(same, 2, 3).x);
  });

  it('string vibration is deterministic and only while the note sounds', () => {
    expect(vibrationAmplitude(-1, 300)).toBe(0);
    expect(vibrationAmplitude(300, 300)).toBe(0);
    expect(vibrationAmplitude(0, 300)).toBe(12);
  });

  it('bend progress rises 0 → 1, release falls', () => {
    const e = { ...t.events[0]!, tech: ['bend' as const], bendSemitones: 2, durationMs: 1000 };
    expect(bendProgress(e, e.startMs)).toBe(0);
    expect(bendProgress(e, e.startMs + 1000)).toBe(1);
    expect(bendProgress({ ...e, tech: ['release'] }, e.startMs + 1000)).toBe(0);
  });

  it('probes skip notes not drawn as a plain dot on their first frame', () => {
    expect(noteProbe(neck, { ...t.events[1]!, legato: true })).toBeNull();
    expect(noteProbe(neck, { ...t.events[1]!, tech: ['dead'] })).toBeNull();
    const p = noteProbe(neck, t.events[1]!)!;
    const d = dotPosition(neck, t.events[1]!.stringIdx, t.events[1]!.fret);
    expect(Math.hypot(p.x - d.x, p.y - d.y)).toBeLessThan(dotRadius(neck));
  });
});

describe('every layout × skin respects the TikTok safe zones (P17)', () => {
  for (const { id: layout } of LAYOUTS) {
    for (const [skin, leftHanded] of [...SKIN_IDS.map((k) => [k, false] as const), ['strat', true] as const]) {
      it(`${layout} / ${skin}${leftHanded ? ' / left-handed' : ''}`, () => {
        const s = defaultFrameSettings(30, { layout, skin, leftHanded });
        for (const ms of [0, 1500, 3000]) {
          const g = layoutGeometry(s, t, ms);
          const right = s.width - s.safeZones.rightPx;
          const bottom = s.height - s.safeZones.bottomPx;
          const r = dotRadius(g.neck);
          expect(g.neck.x1 + r).toBeLessThanOrEqual(right);
          for (let str = 0; str < g.neck.strings; str++) {
            const open = dotPosition(g.neck, str, 0);
            expect(open.x + r).toBeLessThanOrEqual(right);
            expect(open.x - r).toBeGreaterThanOrEqual(0);
          }
          expect(g.neck.y1 + 60).toBeLessThan(bottom); // fret numbers below the neck
          expect(g.neck.y0).toBeGreaterThan(s.safeZones.topPx + 340); // below title + caption
          for (const box of [g.lane, g.notation]) {
            if (!box) continue;
            expect(box.x1).toBeLessThanOrEqual(right);
            expect(box.y1).toBeLessThan(bottom);
            expect(box.y0).toBeGreaterThan(g.neck.y1 + 40);
          }
        }
      });
    }
  }
});

describe('close-up camera', () => {
  it('shows a fixed window that follows the notes and moves smoothly', () => {
    const s = defaultFrameSettings(30, { layout: 'closeup' });
    let prev: number | null = null;
    for (let ms = 0; ms < t.durationMs; ms += 1000 / 30) {
      const n = layoutGeometry(s, t, ms).neck;
      expect(n.toFret - n.fromFret).toBeCloseTo(CLOSEUP_SPAN);
      if (prev !== null) expect(Math.abs(n.fromFret - prev)).toBeLessThan(0.25); // no jumps between frames
      prev = n.fromFret;
    }
  });

  it('centres on the frets being played', () => {
    const high = { ...t, events: t.events.map((e) => ({ ...e, fret: e.fret + 10, midi: e.midi + 10 })) };
    expect(cameraCenter(high, high.events[3]!.startMs)).toBeGreaterThan(9);
    expect(cameraCenter(t, t.events[3]!.startMs)).toBeLessThan(4);
  });
});

describe('notation', () => {
  it('guitar is written an octave up: low E (40) sits below the staff, high e (64) in the top space', () => {
    expect(staffStep(40)).toEqual({ step: 3 * 7 + 2, sharp: false }); // written E3
    expect(staffStep(64)).toEqual({ step: 5 * 7 + 2, sharp: false }); // written E5
    expect(staffStep(66)).toEqual({ step: 5 * 7 + 3, sharp: true }); // F#
  });
});

describe('visible frets', () => {
  it('grows with the highest fret', () => {
    expect(visibleFrets({ events: [{ ...t.events[0]!, fret: 11 }] })).toBe(12);
    expect(visibleFrets({ events: [{ ...t.events[0]!, fret: 12 }] })).toBe(15);
    expect(visibleFrets({ events: [{ ...t.events[0]!, fret: 22 }] })).toBe(24);
  });
});
