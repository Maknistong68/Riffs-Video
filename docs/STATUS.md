# Status

## Phase 3 — Understanding music from text and audio ✅ in emulation · ⏳ waiting for real-device check

### Acceptance
| Criterion | Result |
|---|---|
| 10 test ASCII tabs parse to the expected note lists | ✅ `tests/fixtures/ascii/01–10` vs hand-written `expected.json` (h/p, slides, bends + release, vibrato, PM lines, dead notes, harmonics, 2-digit frets, chords, drop D / E♭ from labels or text, capo, repeats, reversed line order) |
| Clean-guitar clips transcribe with ≥ 90 % note accuracy | ✅ in emulation: `npm run accuracy` — 6 recording-like clips (detuned, humanised, noisy, reverb), mean F1 0.970, worst ≥ 0.90. ⚠️ Synthetic clips; 2 of the 6 were looked at while tuning the cleanup rules. Real recordings on a phone are the real test |
| e2e (iPhone 15 + Pixel 7) | ✅ paste ASCII → tap rhythm → export 6/6; upload audio → transcribe → review → export 17/17; Silent timing-only export (silence verified) |
| Golden renders unchanged | ✅ 5/5 |
| Real-device check | ⏳ needs the user |

### What exists
- **Paste text tab** (`#/paste`, `src/import/asciiTab.ts`): rule-based parser → columns of notes without rhythm; first
  guess from character spacing (`spacingRhythm`), warnings shown before Review.
- **Rhythm** (`src/import/rhythm.ts`): tap each note or tap the beat in Riff Review (`TapRhythm`), quantised to a 16th grid
  with a tempo prior; the tab is rewritten as alphaTex (`alphatexWriter.ts`) and re-parsed by alphaTab, so audio and
  timeline still come from one score.
- **Audio import** (`#/audio`): record (MediaRecorder, processing off) or upload → 48 kHz mono → Basic Pitch in the
  worker → cleanup (`transcribeRiff.ts`: onset snapping, overtone/ghost removal, re-trigger merge, envelope-based
  bend/slide detection) → fingering optimizer → tempo estimate + quantise → Riff Review with per-note confidence
  (amber < 0.7) and the original recording to compare against.
- **Silent / timing-only mode**: video with a silent audio track, start offset + BPM; optional local reference audio
  for alignment preview only (never exported). Sync Report checks the track is really silent.

### Decisions / notes
- Text tabs and transcriptions both become alphaTex, so every import path goes through the same alphaTab → Timeline →
  Review gate.
- Re-tapping the rhythm regenerates the score and resets note edits (the editor says so).
- Polyphonic strumming transcribes worse than single-note lines; Review is where that gets fixed.

## Phase 2 — Make it good ✅ in emulation · ⏳ waiting for real-device check

### Acceptance
| Criterion | Result |
|---|---|
| All screens screenshot-reviewed (390×844, 412×915) | ✅ Review, note editor, fingering sheet, Studio tabs, all layouts/skins |
| Sync Report ✅ including slow-mo exports | ✅ golden: overlay+slow-mo 39/39, split 60 fps 25/25, close-up+slow-mo+loop 162/162, left-handed+loop 60 fps 41/41, slow-mo+loop 81/81 |
| e2e (iPhone 15 + Pixel 7) | ✅ write → review → edit note → Close-up + slow-mo → export; GP5 → review → Split/Les Paul/left-handed → 60 fps |
| Real-device check | ⏳ needs the user |

### What exists
- **Riff Review (S4)** — accuracy gate before the Studio: tab view per bar, red (impossible) / amber (unsure or very wide
  stretch) flags, tap-to-edit note editor (string/fret, same pitch elsewhere, duration, hammer/pull, slide, bend amount, PM,
  vibrato, harmonic, dead, finger, delete), undo/reset, “Better fingering”.
- **Edits are applied to the alphaTab score** (`src/engine/edits.ts`) and replayed after parsing, so the regenerated
  MIDI/audio always matches the edited tab. Events carry stable refs (bar/voice/beat/note).
- **Fingering optimizer** (`src/engine/fingering.ts`): Viterbi over all positions, hand movement + 4-fret span, hammer/slide
  stay on the string; look-ahead one-finger-per-fret assignment fills `finger` in the timeline.
- **Teach arrangements** (`src/engine/arrange.ts`): slow-mo 50 → 75 → 100 % (tempo scaled *on the score*) and loop the
  hardest bar ×3 (alphaTab playback range). Passes sit on whole-sample offsets shared by timeline and audio; captions via
  `timeline.sections`. Fades remove the click where alphaTab hard-stops voices.
- **Render**: 6 skins, left-handed mirror, Classic / Neck-Overlay / Split (tab + staff notation, Bravura) / Close-up (pure,
  smooth camera that never leaves a sounding note off-screen), technique glyphs + animations (bend arrow with rising dot,
  sliding dot, h/p arcs, vibrato, PM, harmonic diamond, dead X; tab-lane h/p, slides, bends, ~, PM bracket, pick strokes),
  finger numbers, note names, look-ahead ghosts, difficulty badge (with suggestion) and credit.
- **Studio**: all of the above wired; tuning presets and capo are score edits (the sound follows); optimistic UI state.
- **Bundle guard**: a unit test fails if UI code ever imports alphaTab / TF.js / Basic Pitch (they belong in the worker).

### Decisions / notes
- Chord stretches > 5 frets are amber warnings, > 9 frets red: wide-but-playable shapes must not block the gate.
- Dead/harmonic notes are checked for attack only; slide destinations (legato) are not re-picked so no attack is expected.
- Imported tracks with 24 frets make full-neck layouts crowded — use Close-up.

## Phase 0 — Spike ✅ (emulation) · real-device check still pending
See git history. The spike page has been replaced by the Phase 1 app; its findings (AAC priming
compensation, WASM AAC fallback) live on in `src/export/`.

## Phase 1 — Core engine + MVP UI ✅ in emulation · ⏳ waiting for real-device check

### Acceptance
| Criterion | Result |
|---|---|
| 5 golden riffs pass (`npm run golden`) | ✅ timeline JSON + drawFrame pixel hashes stable across runs |
| Sync Report ✅ on all golden riffs | ✅ 13/13, 25/25, 47/47, 20/20, 19/19 notes; max onset error 2.7–5.0 ms |
| e2e passes (`npm run e2e`, iPhone 15 + Pixel 7 emulation) | ✅ write alphaTex → export 30 fps; open .gp5 → export 60 fps |
| Real-device check | ⏳ needs the user (checklist below) |

### What exists
- **Import** (`src/import/alphatab.ts`): alphaTex, Guitar Pro 3–7/GPX, MusicXML → alphaTab Score; readable line/col errors.
- **Timeline** (`src/engine/buildTimeline.ts`): positions from alphaTab's tick lookup (repeats and alternate endings
  expanded), timing from the generated MIDI's tempo events with the sequencer's exact formula, durations from MIDI
  note-offs. Ties, tempo changes, chords, capo, techniques (hammer/pull, slide, bend, PM, vibrato, harmonic, dead),
  fingers, pick strokes. Every note is cross-checked against the MIDI (warnings shown in the Studio).
- **P5**: one conversion `alphaTabStringToIdx` (alphaTab string 1 = lowest); verified against alphaTab's own GP5/GP7 fixtures.
- **Audio**: offline alphaTab synth (Sonivox SoundFont) from the same MidiFile; BS.1770 loudness → -14 LUFS, true peak ≤ -1 dBTP.
- **Render**: pure `drawFrame` (Classic layout, Strat colours, 12/15/19/24 visible frets, bundled Inter font).
- **Export** (worker): H.264 + AAC MP4; encoder priming measured and compensated via edit list; frame count aligned so the
  AAC stream needs no padding (audio and video end within 0 ms).
- **Sync Report** (runs after every export): decodes the MP4 →
  spectral-flux onsets (±1 frame) + Basic Pitch pitches (same semitone; bends accept range), stream durations,
  5 decoded frames vs drawFrame (PSNR ≥ 30 dB), finger dot appears on each note's exact first frame.
- **UI**: compatibility check, Library (demo riffs, search, sort, long-press/⋯ rename/duplicate/delete), Import sheet
  (write alphaTex / open file / track picker), alphaTex editor with live errors, Studio (preview on the audio clock,
  scrub, 0.5/0.75/1×, Guitar/Sound/Layout/Text/Teach tabs), Export sheet (copyright notice), Rendering (wake lock,
  background warning, cancel), Result (player, Sync Report with “jump to note”, Share/Save), Exports, Settings
  (default fps, storage meter, persistence, clear videos, install help, licences).
- **Storage**: Dexie (riffs, exportsMeta, settings) + OPFS for MP4s (IndexedDB fallback); `persist()` on first export.
- **PWA**: installable, offline after first load (verified: offline reload + full export with Sync Report).

### Decisions / deviations worth knowing
- Sync Report frame check uses **PSNR**, not exact hashes: H.264 is lossy, so decoded frames can never hash-match.
  Exact pixel hashes are checked where they can be: on `drawFrame` output in `npm run golden`.
- Onsets come from a spectral-flux detector; Basic Pitch confirms pitches. Basic Pitch alone has ~12 ms frames with
  up to ~50 ms onset smear, too coarse for ±1 frame at 60 fps.
- alphaTab is aliased to its side-effect-free core build (`vite.config.ts`): the package entry hijacks `onmessage`
  inside Web Workers.
- TF.js 3.x WebGL in a worker needs a `window` shim (see `render.worker.ts`).
- Only the selected guitar track is audible in exports, so the Sync Report checks exactly what is drawn.
- Phase 2 items intentionally not built: Riff Review gate (S4), onboarding (S1), other skins/layouts/Teach options.
  Imports currently go straight to the Studio.

### Known limitations
- 24-fret riffs make the Classic neck crowded (Close-up preset in phase 2).
- Basic Pitch runs on CPU if WebGL is unavailable in the worker (slower verification).
- Export resumes are not chunked/checkpointed yet (P15): backgrounding on iOS may stall an export.
