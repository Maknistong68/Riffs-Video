/**
 * Teach arrangements (phase 2): slow-mo passes 50 → 75 → 100 % and "loop the hardest bar ×3".
 * Each pass is built from its own score (tempo scaled on the score, or an alphaTab playback
 * range), so audio and visuals stay generated from the same data. Passes are laid out on
 * whole-sample boundaries; the composite timeline and the concatenated audio use the very
 * same offsets.
 */
import { alphaTab, createSettings, prepareScore, type PreparedScore, type Score } from '../import/alphatab';
import { buildTimeline, type TickRange } from './buildTimeline';
import { hardestBar } from './difficulty';
import { AUDIO_SAMPLE_RATE, msToSample, sampleToMs } from './time';
import type { NoteEvent, Timeline } from './timeline';

export type TeachOptions = { slowMo: boolean; loopHardest: boolean };
export const NO_TEACH: TeachOptions = { slowMo: false, loopHardest: false };

export const SLOW_SPEEDS = [0.5, 0.75] as const;
export const LOOP_COUNT = 3;
/** Silence between passes (lets the last note ring, gives the viewer a breath). */
export const PASS_GAP_MS = 800;

export type ArrangementPart = {
  label: string;
  speed: number;
  range?: TickRange;
  prepared: PreparedScore;
  startSample: number;
  /** Music length of this part (excludes the gap after it). */
  lengthSamples: number;
  /** Samples the synth may ring on after the music (into the gap / tail). */
  ringSamples: number;
};

export type Arrangement = { timeline: Timeline; parts: ArrangementPart[]; warnings: string[] };

export type ArrangeOptions = {
  trackIndex: number;
  leadInMs: number;
  tailMs: number;
  title?: string;
  teach: TeachOptions;
};

/** Multiply every tempo marking (alphaTab regenerates MIDI at the new speed). */
export function scaleTempo(score: Score, factor: number): void {
  const first = score.masterBars[0];
  if (first && first.tempoAutomations.length === 0) {
    first.tempoAutomations.push(alphaTab.model.Automation.buildTempoAutomation(false, 0, score.tempo || 120, 2));
  }
  for (const mb of score.masterBars) for (const a of mb.tempoAutomations) a.value *= factor;
  score.finish(createSettings());
}

type Plan = { label: string; speed: number; range?: TickRange; gapAfterMs: number };

export function buildArrangement(makeScore: () => Score, opts: ArrangeOptions, sampleRate = AUDIO_SAMPLE_RATE): Arrangement {
  const baseScore = makeScore();
  const basePrepared = prepareScore(baseScore);
  const build = (score: Score, prepared: PreparedScore, range?: TickRange) =>
    buildTimeline(score, { trackIndex: opts.trackIndex, leadInMs: 0, tailMs: 0, ...(range ? { range } : {}) }, prepared);
  const base = build(baseScore, basePrepared);

  const plans: Plan[] = [];
  const teaching = opts.teach.slowMo || opts.teach.loopHardest;
  if (opts.teach.slowMo) for (const sp of SLOW_SPEEDS) plans.push({ label: `Slow · ${sp * 100}%`, speed: sp, gapAfterMs: PASS_GAP_MS });
  if (opts.teach.loopHardest) {
    const hb = hardestBar(base.timeline);
    const mb = hb ? basePrepared.tickLookup.masterBars[hb.playIndex] : undefined;
    if (hb && mb) {
      for (let k = 1; k <= LOOP_COUNT; k++) {
        plans.push({
          label: `Loop ${k}/${LOOP_COUNT} · bar ${hb.barIndex + 1}`,
          speed: 1,
          range: { startTick: mb.start, endTick: mb.end },
          gapAfterMs: k === LOOP_COUNT ? PASS_GAP_MS : 0,
        });
      }
    }
  }
  plans.push({ label: teaching ? 'Full speed' : '', speed: 1, gapAfterMs: 0 });

  const byspeed = new Map<number, { score: Score; prepared: PreparedScore }>([[1, { score: baseScore, prepared: basePrepared }]]);
  const sourceFor = (speed: number) => {
    let v = byspeed.get(speed);
    if (!v) {
      const score = makeScore();
      scaleTempo(score, speed);
      v = { score, prepared: prepareScore(score) };
      byspeed.set(speed, v);
    }
    return v;
  };

  const events: NoteEvent[] = [];
  const bars: Timeline['bars'] = [];
  const tempoMap: Timeline['tempoMap'] = [];
  const sections: NonNullable<Timeline['sections']> = [];
  const parts: ArrangementPart[] = [];
  const warnings = [...base.warnings];
  let cursor = msToSample(opts.leadInMs, sampleRate);

  plans.forEach((plan, k) => {
    const { score, prepared } = sourceFor(plan.speed);
    const part = plan.speed === 1 && !plan.range ? base : build(score, prepared, plan.range);
    if (part !== base) warnings.push(...part.warnings.map((w) => `${plan.label}: ${w}`));
    const startMs = sampleToMs(cursor, sampleRate);
    const lengthSamples = msToSample(part.timeline.durationMs, sampleRate);
    const prefix = plans.length > 1 ? `s${k}:` : '';
    for (const e of part.timeline.events) {
      const ev: NoteEvent = { ...e, id: prefix + e.id, startMs: e.startMs + startMs };
      if (e.chordId) ev.chordId = prefix + e.chordId;
      events.push(ev);
    }
    for (const b of part.timeline.bars) bars.push({ index: b.index, startMs: b.startMs + startMs });
    for (const t of part.timeline.tempoMap) {
      const entry = { ms: t.ms + startMs, bpm: t.bpm };
      const last = tempoMap[tempoMap.length - 1];
      if (!last || last.bpm !== entry.bpm) tempoMap.push(entry);
    }
    if (plan.label) sections.push({ startMs, endMs: startMs + sampleToMs(lengthSamples, sampleRate), label: plan.label });
    const gap = msToSample(plan.gapAfterMs, sampleRate);
    const isLast = k === plans.length - 1;
    parts.push({
      label: plan.label,
      speed: plan.speed,
      ...(plan.range ? { range: plan.range } : {}),
      prepared,
      startSample: cursor,
      lengthSamples,
      ringSamples: isLast ? msToSample(opts.tailMs, sampleRate) : gap,
    });
    cursor += lengthSamples + gap;
  });

  if (tempoMap[0] && tempoMap[0].ms > 0) tempoMap.unshift({ ms: 0, bpm: tempoMap[0].bpm });
  const timeline: Timeline = {
    version: 1,
    title: opts.title ?? (baseScore.title || 'Untitled riff'),
    tuning: base.timeline.tuning,
    capo: base.timeline.capo,
    tempoMap,
    leadInMs: opts.leadInMs,
    durationMs: sampleToMs(cursor, sampleRate) + opts.tailMs,
    events,
    bars,
    ...(sections.length ? { sections } : {}),
  };
  return { timeline, parts, warnings };
}
