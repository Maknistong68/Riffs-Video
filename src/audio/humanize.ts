/**
 * Velocity humanizing (P8): a real player never hits two notes exactly as hard. Each note's
 * velocity gets a small variation that depends only on (tick, pitch) — seeded, so the same riff
 * always sounds the same and preview, export and Sync Report hear identical audio. Timing is
 * never touched (accuracy first). Notes on a beat get a slight accent.
 */

/** Deterministic 0..1 from integers (32-bit mix, no state). */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** ±12 % variation, +6 % on the beat, kept in 1..127. */
export function humanVelocity(velocity: number, tick: number, key: number, ticksPerQuarter: number): number {
  if (velocity <= 0) return velocity;
  const jitter = (hash01(tick, key) * 2 - 1) * 0.12;
  const accent = ticksPerQuarter > 0 && tick % ticksPerQuarter === 0 ? 0.06 : 0;
  return Math.max(1, Math.min(127, Math.round(velocity * (1 + jitter + accent))));
}

type NoteOnLike = { type: number; tick: number; noteKey?: number; noteVelocity?: number };
const NOTE_ON = 128;

/**
 * Applies humanVelocity to every note-on of the given MIDI tracks and returns a function that
 * restores the original velocities (the MidiFile is shared and cached, so it is changed only for
 * the duration of one render).
 */
export function humanizeMidi(tracks: { events: NoteOnLike[] }[], ticksPerQuarter: number): () => void {
  const saved: [NoteOnLike, number][] = [];
  for (const t of tracks) {
    for (const e of t.events) {
      if (e.type !== NOTE_ON || e.noteVelocity === undefined || e.noteKey === undefined) continue;
      saved.push([e, e.noteVelocity]);
      e.noteVelocity = humanVelocity(e.noteVelocity, e.tick, e.noteKey, ticksPerQuarter);
    }
  }
  return () => {
    for (const [e, v] of saved) e.noteVelocity = v;
  };
}
