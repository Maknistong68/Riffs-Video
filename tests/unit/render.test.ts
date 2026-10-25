import { describe, expect, it } from 'vitest';
import { defaultFrameSettings } from '../../src/render/drawFrame';
import { cameraCenter, CLOSEUP_SPAN, HEADER, layoutGeometry, riffFretWindow, visibleFrets } from '../../src/render/layouts';
import { bendProgress, dotPosition, dotRadius, fretX, neckRow, noteProbe, popScale, POP_MS, stringY, vibrationAmplitude } from '../../src/render/neck2d';
import { laneLineY } from '../../src/render/tabLane';
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
    expect(fretX(neck, neck.fromFret)).toBeCloseTo(neck.x0);
    expect(fretX(neck, neck.toFret)).toBeCloseTo(neck.x1);
  });

  it("neck is the player's view: low E on top, high e at the bottom — inverse of the tab lane (P5)", () => {
    expect(dotPosition(neck, 5, 1).y).toBeLessThan(dotPosition(neck, 0, 1).y);
    for (let s = 1; s < 6; s++) expect(stringY(neck, s)).toBeLessThan(stringY(neck, s - 1));
    expect(neckRow(5, 6)).toBe(0);
    expect(neckRow(0, 6)).toBe(5);
    // The tab lane keeps high e on top.
    const lane = layoutGeometry(defaultFrameSettings(30), t, 0).lane!;
    expect(laneLineY(lane, 0, 6)).toBeLessThan(laneLineY(lane, 5, 6));
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
    expect(vibrationAmplitude(0, 300)).toBe(16);
  });

  it('hit pop: bigger on the attack, back to normal after POP_MS', () => {
    expect(popScale(-1)).toBe(1);
    expect(popScale(0)).toBeCloseTo(1.35);
    expect(popScale(POP_MS / 2)).toBeGreaterThan(1);
    expect(popScale(POP_MS)).toBe(1);
  });

  it('neck window hugs the riff: its frets ±1, at least 5 wide, nut shown for open strings or low riffs', () => {
    const ev = (fret: number) => ({ ...t.events[0]!, fret });
    expect(riffFretWindow({ events: [ev(5), ev(8), ev(7)] })).toEqual({ from: 3.4, to: 8.6 });
    expect(riffFretWindow({ events: [ev(2), ev(3)] })).toEqual({ from: 0, to: 5 });
    expect(riffFretWindow({ events: [ev(0), ev(9)] }).from).toBe(0);
    const w = riffFretWindow({ events: [ev(12), ev(12)] });
    expect(w.to - w.from).toBeGreaterThanOrEqual(5);
    expect(w.from).toBeLessThan(11);
    expect(w.to).toBeGreaterThan(12);
    expect(riffFretWindow({ events: [ev(23), ev(24)] }).to).toBe(24);
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
    // Alone on the neck: beside the number, along the string towards the nut.
    expect(p.y).toBeCloseTo(d.y);
    expect(p.x).toBeLessThan(d.x);
  });

  it('Sync Report probe stays clear of every other dot lit at that moment (h/p partner, chord neighbours)', () => {
    const base = { ...t.events[1]!, chordId: undefined, legato: false, tech: [] as typeof t.events[number]['tech'] };
    const prev = { ...base, id: 'prev', startMs: 1000, durationMs: 1000, stringIdx: 2, fret: 5 };
    const next = { ...base, id: 'next', startMs: 1500, durationMs: 500, stringIdx: 2, fret: 6 };
    const above = { ...base, id: 'above', startMs: 1500, durationMs: 500, stringIdx: 3, fret: 6 };
    const below = { ...base, id: 'below', startMs: 1500, durationMs: 500, stringIdx: 1, fret: 6 };
    const tl = { ...t, events: [prev, next, above, below] };
    const p = noteProbe(neck, next, tl)!;
    const r = dotRadius(neck) * 1.35;
    for (const o of [prev, above, below]) {
      const q = dotPosition(neck, o.stringIdx, o.fret);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(r);
    }
    const d = dotPosition(neck, next.stringIdx, next.fret);
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
          // Open-string dots sit outside the nut; a neck zoomed past the nut only happens without open strings.
          for (let str = 0; str < (g.neck.fromFret <= 0 ? g.neck.strings : 0); str++) {
            const open = dotPosition(g.neck, str, 0);
            expect(open.x + r).toBeLessThanOrEqual(right);
            expect(open.x - r).toBeGreaterThanOrEqual(0);
          }
          expect(g.neck.y1 + 60).toBeLessThan(bottom); // fret numbers below the neck
          expect(g.neck.y0).toBeGreaterThan(s.safeZones.topPx + HEADER.sectionCenter + 28); // below hook, title, chips + teach caption
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

  it('never leaves a sounding note outside the window, even on big jumps', () => {
    const jumpy = { ...t, events: t.events.map((e, i) => ({ ...e, fret: i % 2 ? 1 : 14, midi: (t.tuning[e.stringIdx] ?? 0) + (i % 2 ? 1 : 14), durationMs: 200 })) };
    const s = defaultFrameSettings(30, { layout: 'closeup' });
    for (const e of jumpy.events) {
      for (const ms of [e.startMs, e.startMs + 100]) {
        const n = layoutGeometry(s, jumpy, ms).neck;
        expect(e.fret - 1).toBeGreaterThanOrEqual(n.fromFret - 1e-9);
        expect(e.fret).toBeLessThanOrEqual(n.toFret + 1e-9);
      }
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
