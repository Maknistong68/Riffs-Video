# Status

## Famous riffs + sound pack picker ✅ in emulation · ⏳ real-device check

- **Famous riffs** (Create › 🎸 Famous riffs): 20 melodies everyone knows that are in the public domain —
  Für Elise, Ode to Joy, In the Hall of the Mountain King, Greensleeves, Spanish Romance, Moonlight Sonata,
  Canon in D, Korobeiniki (Tetris), House of the Rising Sun, Bach's Bourrée, Toccata in D minor, Rondo alla
  Turca, Amazing Grace, Jingle Bells, Carol of the Bells, When the Saints, Chopin's Funeral March, Flight of
  the Bumblebee, Minuet in G, Happy Birthday. Each opens straight in the Studio with a matching look
  (classical = nylon, Mountain King/Toccata/Carol = metal…), the composer credit, and optionally the
  "Guess the song?" opener. Caption says "Public-domain melody"; no copyright warning on export.
  Copyrighted songs are not shipped (CLAUDE.md §4): users bring their own Guitar Pro file + Silent mode.
- Accuracy: written as pitch names on a chosen string and converted to frets in one place
  (`famousAlphaTex`); unit tests check every riff parses, validates, sounds exactly the written pitches,
  and that every bar is exactly full for its time signature.
- **Sound pack picker** (Studio › Sound): Studio guitars (recorded, default) or Sonivox (classic). Saved
  per riff; preview, Riff Review, export and Sync Report all use the chosen pack.

## Reviewer's top 3 — done ✅ in emulation · ⏳ listen on real phones

1. **Hook first is the default.** New riffs (and older ones that never set it) play the riff at full speed
   within 150 ms, then "3 · 2 · 1" over the neck leads into the next pass; the teach caption names the pass
   that's coming. Toggle: Studio › Teach › Hook first.
2. **Real guitar sound.** Default pack "Studio guitars": multi-sampled nylon / steel / jazz / clean electric /
   fingered bass (+ the GM kit for the click), cut from FluidR3Mono GM (MIT) — 1.5 MB SF3, precached.
   The original samples start up to 57 ms before the pluck (notes sounded late; the Sync Report caught it):
   `scripts/trim-soundfont-attacks.py` trims every sample to 1 ms before its attack, and a unit test keeps
   every sample's attack within 10 ms. Velocity is humanized (seeded ±12 %, beat accent); timing never is.
   Sonivox stays as the classic pack.
3. **Series format.** Text › Series badge ("RIFF #N", the number counts up with each export that shows it) and
   Teach › Speed-up ending (full speed → 125 % → 150 %). The caption starts with the series and ends with
   "What BPM can you play it at? 👇".

Verified: unit tests 472 ✅ · golden 8/8 ✅ (new `p6-speedup-series` 80/80; 03-repeats max error 31.4 ms, close
to the 33.3 ms one-frame limit at 30 fps) · e2e 38/38 ✅ on iPhone 15 + Pixel 7 emulation, every Sync Report ✅.
Sync Report gained two narrow rules for sampled guitars: a re-struck identical pitch is accepted when its attack
is heard and the detector reports one long note; a chord root is accepted through its octave only when that
octave is itself in the chord.

**Real-phone listening checklist:** (1) open a demo riff → hook plays within a blink, then 3·2·1; (2) the
guitar sounds like a guitar on speaker and headphones, no late or clicky notes; (3) export twice with Series on
→ the second shows RIFF #N+1; (4) speed-up ending stays readable at 150 %; (5) Sync Report ✅ on the device.

## Video look — redesign for TikTok (after Phase 6) ✅ in emulation · ⏳ real-device check

**Neck orientation fixed:** the neck is now drawn as the player sees it looking down at the guitar: low E on
top, high e at the bottom. The tab lane keeps high e on top, as printed tab does. One conversion function
(`neckRow()` in `render/neck2d.ts`) used by 2D, 3D and the Sync Report probes; unit-tested (P5).

**Independent review:** a reviewer agent (motion/UI designer + TikTok growth brief) scored exported frames
before and after each round, with concrete px/ms fixes each time:

| Dimension | Before | R2 | R3 | Final |
|---|---|---|---|---|
| Scroll-stopping hook | 2 | 5 | 6 | 6 |
| Readability at phone size | 4 | 6 | 7 | 8 |
| Visual polish | 4 | 6 | 6 | 7 |
| Motion / satisfying feel | 3 | 6 | 7 | 7 |
| 9:16 canvas & safe zones | 4 | 6 | 6 | 7 |
| Brand / shareability | 2 | 4 | 5 | 5 |

Attention estimate went from "low" to "low–medium; medium with the hook audio first".
Before/after: `docs/visuals/redesign-before-after.png`.

What changed (all still a pure function of time — same frame in preview, export and Sync Report):
- Hook line ("Can you play this?", editable in Text) from frame 0, steps back after 2.5 s; last 1.2 s ask
  "What BPM can you play it at?". Chips for BPM / difficulty / non-standard tuning; bar ticks on the progress bar.
- Neck zoomed to the riff's frets (±1), bigger, dark rosewood board with depth; every fret numbered when zoomed.
- One accent colour per theme (dot, playhead, progress); upcoming notes in white so they never look "lit".
- Hits: pop (160 ms), glow, expanding ring (250 ms), glowing vibrating string; background light pulses per attack.
- Approach rings close onto the next notes; past notes fade as dim, shrinking dots (the hand's path).
- Count-in: whole riff ghosted on the board + big 3·2·1; the ghosted riff returns after the last note so the
  end matches frame 0 (loops).
- Tab lane: full width, string letters (e B G D A E), bigger digits, white pill for the next note, glowing
  playhead, edge fades. Neck-Overlay gets a big "e string · fret 8" readout.
- Sync Report highlight probe moved beside the dot's centre (towards the nut) so a chord's neighbouring dot
  can never cover it.

Reviewer's top remaining moves (not done — owner's call): play the riff at full speed before the count-in
(the optional "Hook first" teach pass could become the default; it makes videos longer), a more realistic
guitar SoundFont, and a repeatable series format (Riff #N, speed-up ending).

## Phase 6 — Creative extras ✅ in emulation (whole backlog) · ⏳ real-device check

| Backlog item | Where | Checked by |
|---|---|---|
| Hook-first intro (full speed, then teach) | Studio › Teach; `engine/arrange.ts` | unit, golden `p6-metal-overlays`, e2e (68/68 in sync) |
| Difficulty auto-score | Text › Difficulty "Auto"; `engine/difficulty` | unit |
| Camera zoom follows hand | 3D camera "Follow" + Close-up layout (Phase 5) | unit, golden |
| Genre themes (rock / metal / blues / funk / lo-fi / acoustic) | Layout › Genre: colours + tone + drums | unit (dot contrast), golden, e2e |
| "Guess the song?" opener + outro reveal | Text › Opener | golden, e2e (52/52) |
| Original riff generator + riff of the day | 🎲 in the Create sheet (`#/generate`); `engine/generate.ts` | unit (21: playable, in scale, deterministic, every genre × difficulty), e2e → Review → export in sync |
| AI-generated original riff | Generate › "AI (Claude)"; edge function `mode: "generate"` | unit (function + client), e2e with mocked endpoint |
| Same riff in 3 positions | Teach; `engine/positions.ts` | unit, golden `p6-lofi-positions`, e2e |
| Drum / metronome backing | Sound › Drums (mixed after amp FX) | unit, golden |
| End-of-video fretboard heatmap | Layout › Heatmap | golden, e2e |
| Bar counter + progress | Layout › Bar counter (in the header) | golden |
| Auto title / caption / hashtags | Result › Caption card; passed to Web Share | unit, e2e |
| Batch export queue | Library ⋯ › Add to export queue; Exports › Queue (survives reloads, wake lock) | e2e (2 riffs, both in sync) |
| Part 1 / Part 2 end cards | Teach › Split into parts (queues Part videos) + Text › End card | unit, e2e |
| Split screen with standard notation | Split layout (Phase 2) | golden |
| Practice link page | Text › Practice link; `#/p/<data>` (riff in the link, no server): slower, loop, save | unit (round-trips all goldens), e2e |

Generator accuracy: 40 generated riffs (metal/rock/acoustic, medium/hard) exported through the real
pipeline matched every note after the generator learned to avoid what can't be confirmed by ear: fast repeats of
one pitch, chains of hammer-ons/slides, techniques out of chords, slides with open strings, short palm mutes and
16ths under 125 ms. A unit sweep checks those rules over 2,700 riffs. A tempo the user picks by hand is kept, so
very fast riffs can still get a labelled Sync Report.

Verification (emulation, after the redesign): unit 450 ✅ · golden 7/7 ✅ · e2e 38/38 ✅ every export in sync. Earlier round: unit 447 ✅ · e2e 38/38 ✅ on iPhone 15 + Pixel 7 (every export ✅ in
sync: write 39/39, generate 24/24, gp5 20/20, metal genre 52/52, 3 positions 68/68, audio 17/17, 3D tone 25/25,
ASCII, silent) · golden 7/7 ✅ (5 riffs incl. 3D + slow-mo/loop, 2 phase 6 variants; frame snapshots refreshed for the phase 6 theme/playhead changes, timelines unchanged) · screenshots of the new screens reviewed at 390×844 and 412×915.

Fixes found on the way: Basic Pitch now falls back to the CPU when the WebGL backend fails mid-run
(seen as "Failed to compile fragment shader" on a long export in software GL).

## Phase 5 — 3D ✅ in emulation · ⏳ mid-range Android speed check

| Criterion | Result |
|---|---|
| Procedural three.js neck (fretboard, frets, inlays, strings, shaped headstock + tuners), no model files | ✅ `render/three/neck3d.ts`, lazy chunk |
| Camera rigs: front, low angle, follow hand, slow orbit (+ angled, from above, player's view, down the neck), drag to turn | ✅ same `drawFrame` contract; golden 3D variants |
| 3D export passes Sync Report | ✅ golden 02/03/05 in 3D (software WebGL) |
| ≥ 0.5× real time on a mid-range Android | ⏳ the app measures it on first 3D use (Settings › Speed shows the ratio) — please report it |
| Automatic 2D fallback on slow devices | ✅ below 0.5× the Studio switches to Flat 2D with "Use 3D anyway"; export ETA uses the measured speed |

## Phase 4 — AI import ✅ in emulation · ⏳ needs the user's Supabase project + key, and a real-device check

### Acceptance
| Criterion | Result |
|---|---|
| Malformed model output never crashes the app | ✅ unit: 10 model-failure shapes (refusal, truncated, non-JSON, wrong shape, bad notes, not a tab, SDK errors) in the function; 11 response shapes in the client; 9 alphaTex cases in the checker. e2e: HTML error page, broken alphaTex, refusal — no page errors |
| All failures land in Riff Review with a clear message | ✅ model-answer failures → Riff Review card with the reason + "Fix the tab by hand" / "Paste as text tab" / "Try AI again". Transport problems (offline, rate limit, too long) stay on the form with the reason, since there is no answer to review |
| API key never appears in the client bundle | ✅ `npm run build` runs `scripts/check-bundle-secrets.mjs` (key pattern, Anthropic endpoint/headers, the function's prompt, and the real key value if set); a unit test forbids any `src/` import of the SDK or `supabase/functions` |
| Real conversion quality | ⏳ needs a deployed function: `npm run ai:eval` scores the 10 Phase 3 tabs (target mean F1 ≥ 0.9). Not run here: no API key in this environment |

### What exists
- `supabase/functions/convert-tab/` — Edge Function (Deno): official Anthropic SDK, `claude-opus-5-5`, structured
  output (JSON schema), refusal fallback, streaming; CORS allow-list; per-device + per-IP rate limit (in memory, no
  tables); every failure mapped to a JSON error + status. Type-checked with `deno check`; ran locally under Deno.
- `src/import/ai.ts` — client: never throws, strict response validation, timeout, cancel, offline check.
- `src/import/aiRiff.ts` (worker) — re-parses the alphaTex with alphaTab, builds + validates the timeline, maps the
  model's per-note confidence onto score notes (bar/beat/string/fret, with a bar/string/fret fallback); unrated notes
  are amber.
- AI import screen (`#/ai`), Riff Review AI banner / failure card, Paste screen "Try AI import instead".
- ASCII parser: words after the last bar line ("(play twice)") no longer break the block; "twice/x3" become repeats.
- Setup guide: `docs/AI_IMPORT.md`.

## After Phase 3 — user requests: 3D guitar, real guitar tone, chord highlighting ✅ in emulation · ⏳ real-device check

### What exists
- **3D guitar neck** (`src/render/three/neck3d.ts`, three.js, lazy-loaded): procedural fretboard with wood grain,
  binding, neck back, nut, shaped headstock (6-in-line or 3+3) with tuners, metal frets, inlays per skin; struck strings
  glow and vibrate; shadows. Default view for new riffs; "Flat 2D" is one tap away.
- **Camera**: drag the Studio preview to turn the guitar; presets Front / Angled / Low angle / From above / Player's view /
  Down the neck; "Slow orbit" motion. The camera is solved per frame so the whole fret window (incl. open-string dots and
  fret numbers) always fits left of the TikTok action column, at any angle.
- **One projection** (`src/render/view3d.ts`, pure math): three.js uses its camera, and the 2D overlay (dots, glyphs,
  look-ahead, fret numbers) plus the Sync Report's highlight probes project through the same function. Dot size follows
  the on-screen string spacing, so dots never overlap.
- **Guitar tone** (`src/audio/tone.ts`, `src/audio/fx.ts`): instrument (Electric DI, Jazz, Acoustic steel, Nylon, Bass —
  GM programs of the SoundFont) + pedalboard: compressor → drive (overdrive / distortion / fuzz, 2× oversampled) → amp
  (tone stack + speaker cabinet) → chorus → delay → reverb (Freeverb). 11 presets (Clean, Crunch, Rock, Metal, Lead, Fuzz,
  Ambient, Jazz, Acoustic, Nylon, Bass); default follows the guitar model. Deterministic, zero added latency; same chain in
  preview and export; knob changes re-run only the effects (dry synth cached in the worker). The metronome bypasses it.
- **Chords**: Riff Review playback lights every note of a chord (it used to light only the first); open strings are filled
  "0" dots like every other note.
- **Sync Report with effects**: notes whose attack the effects hide are re-checked on the dry guitar, gated by a
  stream-alignment check (decoded audio vs encoded audio, ≤ 2 ms, correlation ≥ 0.8).

### Checks
- Golden: Lead, Acoustic, Rock, Nylon, Metal tones; 3D on split / close-up (slow orbit) / classic — all Sync Reports green.
- e2e: 3D drag + presets + Rock tone with delay → export 25/25 ✅ (plus all earlier flows).
- Unit: fx (determinism, silent lead-in, no onset latency, harmonics from distortion, delay timing, reverb tail, cabinet
  roll-off), alignment.

### Notes
- 3D export speed on phones is not measured yet (headless tests use software WebGL). If a phone is too slow, use Flat 2D.
- The SoundFont is the built-in Sonivox GM set; the amp/pedals make it sound like a guitar rig, but better guitar
  samples (P8) would still help.

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
