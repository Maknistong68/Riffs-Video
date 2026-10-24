# Status

## Phase 0 — Spike ✅ in emulation · ⏳ waiting for real-device check

What exists:
- `src/engine/time.ts`: the single frame↔ms↔sample rounding rule.
- `src/engine/timeline.ts`: Timeline types, `validateTimeline`, binary-search lookups.
- `src/spike/demoTimeline.ts`: hard-coded original 8-note riff (100 bpm, 1 s lead-in).
- `src/render/`: pure `drawFrame` (Classic layout: title, 2D neck with vibrating string + finger dot, scrolling tab lane, progress bar, safe-zone overlay).
- `src/audio/beeps.ts`: one sine beep per note, placed at `msToSample(startMs)`.
- `src/export/exporter.ts` (runs in `src/workers/render.worker.ts`): OffscreenCanvas → `CanvasSource` (H.264) + `AudioSampleSource` (AAC) → MP4.
- `src/export/verify.ts`: Phase 0 Sync Report. It decodes the MP4 and checks (a) every beep onset is within ±1 frame, (b) audio and video stream durations match within 1 frame, (c) each finger dot shows on its note's first frame and not on the frame before.

Results (headless Chromium, iPhone 15 + Pixel 7 viewports, 30 and 60 fps): 8/8 onsets at 0.0 ms error, 8/8 highlights on the exact frame, durations within 16 ms.

Findings from the spike:
- **AAC priming.** AAC encoders put about 1024 priming samples (21.3 ms) in front of the audio. The WASM fallback encoder doesn't flag them, so audio would play late. Fix: `encoderLatency.ts` runs a short probe encode before every export to measure the delay, then starts the audio track at `-delay`. mediabunny turns that negative start into an MP4 edit list. This works for any encoder, native or WASM. If an encoder already handles priming, the probe measures 0 and nothing changes.
- **Linux Chromium has no native AAC encoder.** `@mediabunny/aac-encoder` (WASM) is loaded only in that case. Phones use their native encoder.

Not done / deferred:
- Real-device check (iPhone Safari 26+, Android Chrome). See the checklist in the PR/commit summary.
- §7 MCP servers (playwright / chrome-devtools / context7) are not configured in this cloud session. For now, verification runs through the repo's own Playwright tests.
