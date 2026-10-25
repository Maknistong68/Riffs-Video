# RiffReel — Guitar Riff Video Maker (PWA)

> Project brief for Claude Code. Read this whole file before writing code.
> Work phase by phase (see "Build phases"). Do not start a phase until the previous
> phase's acceptance checks pass. Ask the user before changing any decision marked 🔒.
>
> Current progress and open items per phase: see `docs/STATUS.md`.

---

## 1. What we are building

A **mobile-only Progressive Web App** that turns a guitar riff into a short vertical
video for TikTok / YouTube Shorts / Reels:

- An animated guitar neck (2D first, 3D later) where the string being played lights up and
  vibrates and a dot shows the fret (and optionally which finger).
- A tab lane showing string + fret, scrolling under a fixed playhead, current note highlighted.
- Audio of the riff, **sample-accurate in sync** with the visuals.
- Everything happens **on the phone**: the video is rendered and encoded on the device and
  saved/shared from there. No server render, no database in v1.

Accuracy is the #1 product value. Every design decision below serves it.

---

## 2. Locked decisions 🔒

| Area | Decision | Why |
|---|---|---|
| Platform | PWA, mobile-only (portrait), installable, works offline after first load | User requirement |
| Hosting | Static hosting over HTTPS (Cloudflare Pages / Netlify / Vercel static) | PWAs need HTTPS; no backend needed |
| Framework | Vite + React + TypeScript (strict) | Mature PWA tooling |
| PWA | `vite-plugin-pwa` (Workbox), precache app shell + soundfonts + fonts | Offline use |
| Storage | **Local only**: IndexedDB via Dexie; large binaries (rendered MP4s, audio) in OPFS | "No database" requirement |
| Tab parsing + synth | `@coderline/alphatab` (Guitar Pro 3–7, alphaTex, MusicXML; built-in SoundFont synth; `exportAudio`) | One library for score model + audio |
| Visual renderer | **Our own deterministic Canvas 2D renderer**: `drawFrame(ctx, timeline, frameIndex, theme)` | Pixel-exact, no DOM-capture approximations |
| Video encoding | `mediabunny` (WebCodecs): `CanvasSource` for video, `AudioBufferSource`/PCM for audio, MP4 output (H.264 + AAC) | Runs on-device, zero deps |
| Audio transcription / verification | `@spotify/basic-pitch` (TF.js, in-browser) | Lets the app "hear" audio and check notes |
| 3D (phase 5) | three.js rendering into an OffscreenCanvas, driven by the same frame function | Same timing engine |
| AI tab conversion (phase 4) | Claude API called through **one Supabase Edge Function** (holds the API key) | Never ship API keys in the client |
| Min. browsers | iOS Safari 26+, Chrome Android (recent), Samsung Internet recent. Show a friendly "update your browser" screen otherwise | WebCodecs (video **and** audio encode) required |

Rejected alternatives (don't reintroduce without asking): Remotion server rendering (needs a
server), Remotion web-renderer (DOM capture subset; we want exact canvas control),
FFmpeg.wasm (huge, slow on phones), screen recording of live playback (drift).

---

## 3. The accuracy model (the most important section)

**One source of truth: the Timeline.** Everything — audio, neck, tab lane, captions — reads
from it. Nothing has its own clock.

```
Input (alphaTex / .gp / .gp5 / .gpx / MusicXML / pasted ASCII tab / AI import)
        │
        ▼
 alphaTab Score model ──► normalize ──► Timeline (pure data, JSON-serialisable)
                                         │
             ┌───────────────────────────┼────────────────────────────┐
             ▼                           ▼                            ▼
   Audio: alphaTab exportAudio     Video: drawFrame(frame)       Verify: Basic Pitch on
   (same score, same tempo map)    for frame = 0..N-1            rendered audio vs Timeline
             │                           │                            │
             └──────────► mediabunny MP4 mux ◄───────────┘       Sync Report (pass/fail)
```

### Timeline schema (`src/engine/timeline.ts`)
```ts
type Timeline = {
  version: 1;
  title: string;
  tuning: number[];          // MIDI pitch per string, index 0 = HIGH e (tab-display order)
  capo: number;
  tempoMap: { ms: number; bpm: number }[];
  leadInMs: number;          // count-in applied in ONE place only
  durationMs: number;
  events: NoteEvent[];       // sorted by startMs, repeats already expanded
  bars: { index: number; startMs: number }[];
  sections?: { startMs: number; endMs: number; label: string }[]; // teach passes ("Slow · 50%")
};
type NoteEvent = {
  id: string;
  ref?: { bar: number; voice: number; beat: number; note: number }; // stable score address (edits)
  startMs: number;           // relative to start of video (includes leadInMs)
  durationMs: number;
  stringIdx: number;         // 0 = high e … 5 = low E (display order) — see pitfall P5
  fret: number;              // 0 = open
  midi: number;              // must equal tuning[stringIdx] + capo + fret (validated)
  finger?: 1 | 2 | 3 | 4 | 'T';
  pick?: 'down' | 'up';
  tech: Technique[];         // 'bend' | 'release' | 'slide' | 'hammer' | 'pull' | 'palmMute' | 'vibrato' | 'harmonic' | 'dead' | 'tieContinue'
  chordId?: string;          // notes sharing a chordId are struck together
  legato?: boolean;          // sounds without a new pick attack (slide destination): no onset expected
  bendSemitones?: number;    // bend target above midi (Sync Report accepts the bent range)
  confidence?: number;       // 0..1, set by AI import / transcription; < 0.7 is flagged in UI
};
```

### Rules
1. `frameIndex → ms = round(frameIndex * 1000 / fps)`; lookups use a binary search over
   `events`. Same rounding helper everywhere (`src/engine/time.ts`).
2. Audio is produced from **the same alphaTab score** the timeline was built from, using
   alphaTab's own MIDI/tick→ms conversion. The timeline builder must use alphaTab's tick
   lookup / playback positions, not its own tempo math, so the two can't disagree.
3. Video fps is fixed per export (30 or 60). Audio 48 kHz. Duration of audio and video
   streams must match within 1 frame.
4. Lead-in / count-in is added once, in `buildTimeline()`.
5. `drawFrame` is a **pure function** of (timeline, frameIndex, settings). No `Date.now()`,
   no `requestAnimationFrame` timing, no randomness (use a seeded PRNG if needed).
6. The live preview and the export call the exact same `drawFrame`.

### Built-in self-check ("Sync Report") — runs automatically after every export
1. Decode the exported MP4's audio with mediabunny.
2. Run Basic Pitch (in a Web Worker) → detected notes (onset + pitch).
3. Match detected notes to `timeline.events`: onset within ±1 frame, pitch within ±50 cents
   (bends: compare target pitch).
4. Render 5 sample frames from the encoded video (decode with mediabunny) and compare
   pixel-hash against `drawFrame` output for those frames.
5. Show a result card: ✅ "In sync — 48/48 notes matched" or ⚠️ list of mismatches with
   "jump to note" buttons. Exports with failures are still saved but labelled.

---

## 4. Information architecture & UX

Mobile portrait only. Bottom tab bar with 3 tabs + a central "+" button.
Design: dark by default (videos look best on dark), large touch targets (≥ 44 px),
one-handed reach (primary actions in the bottom third), haptics via `navigator.vibrate`
where supported.

### Tabs
1. **Library** — the user's riffs (cards with thumbnail, title, tuning, length, last export).
2. **Create (+)** — opens the Import sheet.
3. **Exports** — rendered videos stored on device; share / save / delete; Sync Report badge.
4. **Settings** — defaults, sound packs, storage usage, about/licences.

### Screen list
| # | Screen | Purpose / key elements |
|---|---|---|
| S0 | **Compatibility check** (first launch) | Feature-detect WebCodecs `VideoEncoder` + `AudioEncoder` (H.264 + AAC via `canEncodeVideo/Audio`), OPFS, SharedArrayBuffer if needed. Pass → onboarding. Fail → explain which browser/version to update to. |
| S1 | **Onboarding** (3 swipes) | "Pick a riff → style it → export". "Install to home screen" prompt (iOS: show the Share → Add to Home Screen instructions). |
| S2 | **Library** | Search, sort, demo riffs preloaded (original/public-domain, safe to post). Long-press → duplicate / rename / delete. |
| S3 | **Import sheet** | Options: ✍️ Write riff (alphaTex editor) · 📄 Open file (.gp/.gp5/.gpx/.gp3/.gp4/.xml/.atex) · 📋 Paste text tab · 🎙️ Record or upload audio (transcribe) · 🤖 AI import (phase 4) · 🎲 Generate original riff (phase 6) |
| S4 | **Riff Review** (accuracy gate) | Shows the parsed tab with playback. Flags: low-confidence notes (amber), impossible notes (red), missing rhythm. Tap a note → edit string/fret/duration/technique. "Tap tempo" to set rhythm for rhythm-less text tabs. Alternative-fingering button (optimizer). **The user must confirm here before styling.** |
| S5 | **Studio** (main editor) | Top 60 %: live preview canvas (9:16). Bottom sheet with tabs: **Guitar** (model skin, tuning, capo, left-handed mirror) · **Sound** (sound pack, tone, volume, metronome/drums, sound mode) · **Layout** (preset, tab position, neck angle/zoom, safe-zone overlay) · **Text** (title, artist credit, difficulty badge, captions) · **Teach** (slow-mo passes, loop hardest bar, finger numbers, pick arrows, note names). Transport: play/pause, scrub, speed. |
| S6 | **Export sheet** | Platform preset (TikTok / Shorts / Reels — all 1080×1920), fps 30/60, quality, sound mode, estimated time & size. Big "Export" button. |
| S7 | **Rendering** | Progress (frames encoded / total), ETA, "keep screen on" (Wake Lock API), cancel. Warn not to leave the app (rendering stops if the tab is backgrounded on iOS). |
| S8 | **Result** | Video player, Sync Report card, buttons: Share (Web Share API Level 2 with file), Save to Files/Photos, Re-export, Edit. |
| S9 | **Exports** | Grid of rendered videos with Sync badge. |
| S10 | **Settings** | Default preset, fps, theme, sound packs (download for offline), storage meter (`navigator.storage.estimate()`), persistent-storage request (`navigator.storage.persist()`), clear cache, licences. |

### Primary flow (happy path, target < 60 s for a demo riff)
Library → + → Write/Open/Paste → **Riff Review** (confirm) → **Studio** (pick preset) →
Export → Rendering → Result → Share to TikTok.

### Sound modes (in Sound tab + Export sheet)
1. **Synth** (default): audio generated by the app from the tab. Safe for originals.
2. **Silent / timing-only**: exports video with no audio but with a configurable start offset
   and BPM so the user can add the official track inside TikTok (licensed library).
   Optional local "reference audio" import used **only for alignment preview**, never exported.
3. **Synth + click**: synth plus metronome, for practice videos.

Copyright notice (shown once, in Export sheet when mode = Synth and the riff is not marked
original): "Recreated audio of a famous song can still be claimed by the songwriter. For
monetized videos use originals; for famous songs use Silent mode and add the official sound
in TikTok."

### Video layout presets (all 1080×1920)
- **Classic**: title top, horizontal neck middle, tab lane bottom.
- **Neck-Overlay**: tab numbers drawn directly on the neck, big and centered.
- **Split**: neck top half, tab + standard notation bottom half.
- **Close-up**: camera zoomed on the active fret region, pans with the hand.
Every preset respects TikTok/Shorts **safe zones** (keep text out of the right ~140 px
action column and the bottom ~420 px caption area — make these constants editable).

---

## 5. Code structure

```
src/
  app/                 routes, layout, bottom nav, theme
  screens/             S0–S10 (one folder each)
  components/          Button, Sheet, Slider, Segmented, NoteEditor, Transport…
  engine/
    time.ts            frame↔ms helpers (single rounding rule)
    timeline.ts        types + buildTimeline(score, settings) + validateTimeline()
    fingering.ts       fingering optimizer (dynamic programming over positions)
    techniques.ts      technique mapping alphaTab → Technique
  import/
    alphatab.ts        load files/alphaTex → Score
    asciiTab.ts        rule-based ASCII tab parser → partial score (no rhythm)
    rhythm.ts          tap-tempo + onset alignment to give rhythm to ASCII tabs
    transcribe.ts      Basic Pitch worker wrapper (audio → notes)
    ai.ts              (phase 4) calls Supabase Edge Function
  render/
    drawFrame.ts       pure frame renderer (dispatches to layout)
    layouts/           classic.ts, overlay.ts, split.ts, closeup.ts
    neck2d.ts          fretboard drawing, string vibration, finger dots
    tabLane.ts         tab lane drawing
    skins/             strat, lespaul, acoustic, classical, bass4, seven (colors, wood, inlays, string gauges)
    three/             (phase 5) 3D neck + camera rigs
  audio/
    synth.ts           alphaTab exportAudio → Float32 PCM (48 kHz stereo)
    mix.ts             metronome/drum mix, loudness normalisation (target -14 LUFS integrated)
    soundpacks.ts      SoundFont registry (cached by service worker)
  export/
    exporter.ts        mediabunny Output: CanvasSource + audio source → MP4 (worker)
    verify.ts          Sync Report
  storage/
    db.ts              Dexie schema (riffs, settings, exportsMeta)
    opfs.ts            write/read large blobs
  workers/             render.worker.ts, transcribe.worker.ts
public/
  soundfonts/          guitar SoundFonts (check licences — document in LICENSES.md)
  demo-riffs/          original/public-domain .atex files
tests/
  unit/                vitest
  golden/              golden riffs + expected timelines + expected frame hashes
  e2e/                 Playwright (mobile device emulation)
```

### Local data (Dexie)
- `riffs`: id, title, artist, isOriginal, source ('alphatex'|'gp'|'ascii'|'audio'|'ai'), sourceText/blobRef, score (serialized), timelineCache, styleSettings, createdAt, updatedAt.
- `exportsMeta`: id, riffId, opfsPath, preset, fps, durationMs, sizeBytes, syncReport, createdAt.
- `settings`: single row.
Request persistent storage on first export so iOS/Android don't evict files.

---

## 6. External connections

| Connection | Phase | Notes |
|---|---|---|
| Static host (Cloudflare Pages/Netlify) | 1 | HTTPS, correct headers. If SharedArrayBuffer is needed set COOP/COEP headers. |
| Web Share API (files) | 2 | Share MP4 straight to TikTok/Instagram/YouTube apps. Fallback: download link. |
| Supabase **Edge Function** `convert-tab` | 4 | Holds the Claude API key. Input: pasted tab text / user-provided URL text. Output: alphaTex + per-note confidence. Rate-limit by anonymous device id. **No tables needed.** |
| Supabase Auth + Postgres + Storage | later, optional | Only if we add accounts, cross-device sync, or sharing riffs. Not in v1. |

AI import rules: the user pastes tab text or uploads a file; the app does **not** scrape tab
websites. The model must return valid alphaTex; the app re-parses it with alphaTab and runs
`validateTimeline()`; anything that fails goes back to the user in Riff Review, never
straight to export.

---

## 7. Claude Code setup (do this before Phase 1)

```bash
# Browser testing of the PWA in phone emulation (screenshots, taps, console)
claude mcp add playwright -- npx @playwright/mcp@latest
# Performance / memory debugging of render + encode
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest
# Up-to-date library docs (alphaTab, mediabunny, Dexie, vite-plugin-pwa)
claude mcp add context7 -- npx -y @upstash/context7-mcp
```
Verify each with `claude mcp list` and confirm commands against each project's README before
relying on them. Phase 4 adds the Supabase CLI (`npx supabase`) for the edge function.

Ways Claude Code must check its own work (no MCP needed):
- `npm run test` (vitest) — timeline math, fingering, ASCII parser, validators.
- `npm run golden` — renders golden riffs headlessly (Playwright, Chromium) and compares
  timeline JSON and frame hashes with stored snapshots.
- `npm run e2e` — Playwright on "iPhone 15" and "Pixel 7" emulation: import → review →
  export → Sync Report shows ✅.
- Use the Playwright MCP to take screenshots of every screen after UI changes and look at them.
- Note: emulation runs Chromium. Before each phase is "done", the user tests on a **real
  iPhone (Safari 26+) and a real Android phone**; Claude asks for that.

---

## 8. Build phases & acceptance criteria

### Phase 0 — Spike (prove the risky parts first)
- Minimal page: hard-coded 8-note timeline → drawFrame → mediabunny MP4 (H.264+AAC) with a
  sine-beep per note, on-device.
- ✅ MP4 plays on iPhone Safari and Android Chrome; beeps line up with highlights (Sync Report
  logic can be a simple onset check here).

### Phase 1 — Core engine + MVP UI
- alphaTab import of alphaTex and .gp/.gp5; buildTimeline with repeats, ties, tempo changes,
  chords; validateTimeline (midi = tuning + capo + fret, fret 0–24, string range).
- 2D neck (Strat skin) + tab lane, Classic layout, live preview with transport.
- alphaTab synth audio export; MP4 export; Library + Exports screens; Dexie/OPFS storage; PWA
  installable + offline.
- ✅ 5 golden riffs pass; Sync Report ✅ on all; e2e passes; real-device check by user.

### Phase 2 — Make it good
- Riff Review screen with note editor; fingering optimizer; finger numbers; pick arrows;
  technique glyphs + animations (bend arrow, slide line, h/p arcs, PM bracket).
- Skins: Strat, Les Paul, Acoustic, Classical, 4-string Bass, 7-string; tunings + capo;
  left-handed mirror.
- Layout presets + safe-zone overlay; Teach options (slow-mo passes 50→75→100 %, loop hardest
  bar ×3); title/credit/difficulty badge; Web Share.
- ✅ All screens screenshot-reviewed; Sync Report ✅ including slow-mo exports.

### Phase 3 — Understanding music from text and audio
- ASCII tab paste parser (multi-line blocks, `h p / \ b r ~ x`, bar lines, tunings in the
  margin) → notes without rhythm → Riff Review with **tap tempo** to assign rhythm.
- Audio import (record via MediaRecorder or upload): Basic Pitch → notes → fingering
  optimizer → timeline with confidence values → Riff Review.
- Silent / timing-only sound mode with reference-audio alignment preview (beat offset + BPM).
- ✅ 10 test ASCII tabs parse to the expected note lists; recorded clean-guitar test clips
  transcribe with ≥ 90 % note accuracy before user correction.

### Phase 4 — AI import (needs internet)
- Supabase project + `convert-tab` edge function (Claude API). Client `ai.ts`.
- Prompting: ask for alphaTex + confidence per note + rhythm guesses flagged; app always
  validates and routes to Riff Review.
- ✅ Malformed model output never crashes the app; all failures land in Riff Review with a
  clear message. API key never appears in client bundle (grep the build).

### Phase 5 — 3D
- three.js neck (procedural geometry: fretboard, frets, inlays, strings, headstock outline —
  no third-party model files unless licence is documented). Camera rigs: front, low-angle,
  follow-hand, slow orbit. Same drawFrame contract (frameIndex → camera + highlights).
- ✅ 3D export on a mid-range Android renders at ≥ 0.5× real-time and passes Sync Report;
  automatic fallback to 2D on devices that are too slow (benchmark on first use).

### Phase 6 — Creative extras (backlog, pick by user priority)
Hook-first intro (full speed, then teach) · difficulty auto-score · camera zoom follows hand ·
genre themes (metal / blues / lo-fi / acoustic) · "Guess the song" opener · AI-generated
original "riff of the day" (copyright-safe) · same riff in 3 positions · drum/metronome
backing · end-of-video fretboard heatmap · bar counter + progress bar · auto title/caption/
hashtags · batch export queue · Part 1/Part 2 end cards · split screen with standard notation ·
practice link page.

---

## 9. Known problems and the planned fix (check these explicitly)

| # | Problem | Fix |
|---|---|---|
| P1 | Text tabs have no rhythm | Tap tempo + onset alignment; prefer Guitar Pro files |
| P2 | Online tabs are often wrong | Basic Pitch check vs audio; confidence flags; Riff Review gate |
| P3 | Scraping is blocked / against terms | User pastes or uploads; app never scrapes |
| P4 | Same pitch playable in several places | Fingering optimizer (min hand movement, max 4-fret span) |
| P5 | String numbering confusion (alphaTab vs tab display) | Unit test against a known file; single conversion function |
| P6 | Audio/video drift | Single timeline, pure drawFrame, shared tick→ms from alphaTab |
| P7 | Real recordings drift in tempo (Silent mode) | Per-bar sync points from beat tracking / manual nudges |
| P8 | Synth sounds fake | Better guitar SoundFonts, velocity humanize (seeded), tone presets |
| P9 | Techniques missing | Glyphs + animations + alphaTab bend/slide audio |
| P10 | Fast riffs unreadable | Slow-mo passes, note look-ahead, larger glyphs |
| P11 | Chords clutter | Chord box pop-up + grouped highlight |
| P12 | Tunings / capo | From file; labels on screen; validator |
| P13 | Repeats / tempo changes | Expand to play order; golden tests |
| P14 | Phone too slow / hot | Render in worker, OffscreenCanvas, 30 fps option, benchmark, 2D fallback |
| P15 | iOS stops work when app is backgrounded | Wake Lock, warning UI, resumable export (chunked, checkpoint to OPFS) |
| P16 | Browser evicts stored files | `navigator.storage.persist()`; storage meter; export-to-Files prompt |
| P17 | TikTok UI covers content | Safe-zone constants + overlay toggle |
| P18 | Copyright claims | Sound modes; "original" flag; notice in Export sheet |
| P19 | AI conversion errors | Strict alphaTex validation; Riff Review; never auto-export |
| P20 | Loudness inconsistent | Normalize to -14 LUFS, true-peak ≤ -1 dBTP |
| P21 | Codec support differs per device | `canEncode` checks at startup; pick best supported config; clear error |
| P22 | Large SoundFonts slow first load | Lazy-download per sound pack, cached by service worker, progress UI |

---

## 10. Working rules for Claude Code
- TypeScript strict, no `any` in engine/render/audio/export.
- Every engine function has unit tests before UI uses it.
- After any UI change: Playwright MCP screenshots at 390×844 (iPhone) and 412×915 (Pixel);
  review them before saying "done".
- Keep heavy work (render, encode, transcription) in Web Workers; UI must stay responsive.
- Record every third-party asset licence (SoundFonts, fonts, 3D assets) in `LICENSES.md`.
- When a library API is uncertain, look it up (Context7 / official docs) instead of guessing.
- End each phase with a short summary + a checklist for the user to test on real phones.
