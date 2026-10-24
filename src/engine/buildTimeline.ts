/**
 * Score → Timeline. Uses alphaTab's own tick lookup (play order, repeats expanded) for note
 * positions and the generated MIDI file's tempo events + note-offs for timing and durations,
 * i.e. the very data the synthesizer plays. Lead-in is applied here and only here.
 */
import { alphaTab, firstStringedStaff, prepareScore, type PreparedScore, type Score } from '../import/alphatab';
import { alphaTabStringToIdx } from './strings';
import { bendSemitonesOf, fingerOf, pickOf, techniquesOf } from './techniques';
import { buildTempoSegments, tickToMs, type TempoSegment } from './tempo';
import type { NoteEvent, Timeline } from './timeline';

export type BuildOptions = {
  trackIndex: number;
  leadInMs: number;
  tailMs: number;
  title?: string;
};

export const DEFAULT_BUILD: Omit<BuildOptions, 'trackIndex'> = { leadInMs: 1000, tailMs: 1200 };

export type BuildResult = {
  timeline: Timeline;
  prepared: PreparedScore;
  /** Problems found while cross-checking the score against the generated MIDI. */
  warnings: string[];
};

type MidiNote = { tick: number; key: number; offTick: number; used: boolean };

const { MidiEventType } = alphaTab.midi;

export function buildTimeline(score: Score, opts: BuildOptions, prepared: PreparedScore = prepareScore(score)): BuildResult {
  const track = score.tracks[opts.trackIndex];
  if (!track) throw new Error(`Track ${opts.trackIndex} does not exist`);
  const staff = firstStringedStaff(track);
  if (!staff) throw new Error(`Track "${track.name}" has no tablature staff`);
  const stringCount = staff.tuning.length;
  const { midi, tickLookup } = prepared;
  const division = midi.division;
  const warnings: string[] = [];

  // Tempo exactly as the sequencer sees it.
  const tempoEvents: { tick: number; bpm: number }[] = [];
  for (const e of midi.events) {
    if (e.type === MidiEventType.TempoChange) {
      tempoEvents.push({ tick: e.tick, bpm: (e as alphaTab.midi.TempoChangeEvent).beatsPerMinute });
    }
  }
  const segments: TempoSegment[] = buildTempoSegments(tempoEvents, division);
  const lead = opts.leadInMs;
  const ms = (tick: number) => lead + tickToMs(segments, division, tick);

  // Note-on/off pairs for this track's channels.
  const channels = new Set([track.playbackInfo.primaryChannel, track.playbackInfo.secondaryChannel]);
  const midiNotes = new Map<string, MidiNote[]>();
  const open = new Map<string, MidiNote[]>();
  for (const e of midi.events) {
    if (e.type !== MidiEventType.NoteOn && e.type !== MidiEventType.NoteOff) continue;
    const ev = e as alphaTab.midi.NoteOnEvent;
    if (!channels.has(ev.channel)) continue;
    const ck = `${ev.channel}:${ev.noteKey}`;
    if (e.type === MidiEventType.NoteOn) {
      const n: MidiNote = { tick: e.tick, key: ev.noteKey, offTick: e.tick, used: false };
      const k = `${e.tick}:${ev.noteKey}`;
      midiNotes.set(k, [...(midiNotes.get(k) ?? []), n]);
      open.set(ck, [...(open.get(ck) ?? []), n]);
    } else {
      const n = open.get(ck)?.shift();
      if (n) n.offTick = e.tick;
    }
  }

  const events: NoteEvent[] = [];
  let playIndex = 0;
  for (const mb of tickLookup.masterBars) {
    const seen = new Set<number>();
    for (let b = mb.firstBeat; b; b = b === mb.lastBeat ? null : b.nextBeat) {
      for (const item of b.highlightedBeats) {
        const beat = item.beat;
        if (beat.voice.bar.staff !== staff || seen.has(beat.id)) continue;
        seen.add(beat.id);
        const tick = mb.start + item.playbackStart;
        const notes = beat.notes.filter((n) => !n.isTieDestination);
        const chordId = notes.length > 1 ? `c${playIndex}-${beat.id}` : undefined;
        for (const note of notes) {
          const stringIdx = alphaTabStringToIdx(note.string, stringCount);
          const midiKey = note.realValue;
          const candidates = midiNotes.get(`${tick}:${midiKey}`) ?? [];
          const m = candidates.find((c) => !c.used);
          const tech = techniquesOf(note);
          let endTick: number;
          let legato = false;
          if (m) {
            m.used = true;
            endTick = m.offTick;
          } else {
            // Not struck in the MIDI (e.g. slide destination): sounds for the beat's length.
            endTick = tick + beat.playbackDuration;
            legato = true;
            if (!tech.includes('slide')) {
              warnings.push(`No MIDI note for ${describe(note, beat)}; using beat length`);
            }
          }
          const ev: NoteEvent = {
            id: `p${playIndex}-b${beat.id}-n${note.id}`,
            startMs: ms(tick),
            durationMs: Math.max(1, ms(endTick) - ms(tick)),
            stringIdx,
            fret: note.fret,
            midi: staff.tuning[stringIdx]! + staff.capo + note.fret,
            tech,
          };
          const finger = fingerOf(note);
          if (finger !== undefined) ev.finger = finger;
          const pick = pickOf(beat);
          if (pick) ev.pick = pick;
          if (chordId) ev.chordId = chordId;
          if (legato) ev.legato = true;
          const bend = bendSemitonesOf(note);
          if (bend !== undefined) ev.bendSemitones = bend;
          if (ev.midi !== note.realValue && !tech.includes('harmonic')) {
            warnings.push(`Pitch disagreement for ${describe(note, beat)}: ${ev.midi} vs alphaTab ${note.realValue}`);
          }
          events.push(ev);
        }
      }
    }
    playIndex++;
  }

  for (const list of midiNotes.values()) {
    for (const n of list) if (!n.used) warnings.push(`MIDI note ${n.key} at tick ${n.tick} has no tab note`);
  }

  events.sort((a, b) => a.startMs - b.startMs || a.stringIdx - b.stringIdx);
  const lastBar = tickLookup.masterBars[tickLookup.masterBars.length - 1];
  const musicEnd = Math.max(lastBar ? ms(lastBar.end) : lead, ...events.map((e) => e.startMs + e.durationMs));

  const timeline: Timeline = {
    version: 1,
    title: opts.title ?? (score.title || 'Untitled riff'),
    tuning: [...staff.tuning],
    capo: staff.capo,
    tempoMap: [
      { ms: 0, bpm: segments[0]!.bpm },
      ...segments.map((s) => ({ ms: lead + s.ms, bpm: s.bpm })),
    ].filter((t, i, arr) => i === 0 || t.ms !== arr[i - 1]!.ms || t.bpm !== arr[i - 1]!.bpm),
    leadInMs: lead,
    durationMs: musicEnd + opts.tailMs,
    events,
    bars: tickLookup.masterBars.map((mb) => ({ index: mb.masterBar.index, startMs: ms(mb.start) })),
  };
  return { timeline, prepared, warnings };
}

function describe(note: alphaTab.model.Note, beat: alphaTab.model.Beat): string {
  return `bar ${beat.voice.bar.index + 1}, string ${note.string}, fret ${note.fret}`;
}
