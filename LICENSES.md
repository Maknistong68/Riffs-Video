# Third-party licences

| Package / asset | Licence | Use |
|---|---|---|
| @coderline/alphatab | MPL-2.0 | Score import (alphaTex, Guitar Pro, MusicXML), MIDI generation, synth |
| Sonivox GM SoundFont (`sonivox.sf2`, shipped with alphaTab) | Apache-2.0, © Sonic Network Inc. | Synth sound pack (precached) |
| mediabunny | MPL-2.0 | MP4 muxing/demuxing, WebCodecs encode/decode |
| @mediabunny/aac-encoder | MPL-2.0 (bundles a WASM build of FFmpeg's AAC encoder, LGPL-2.1+) | AAC fallback, lazy-loaded only when the browser has no native AAC encoder |
| @spotify/basic-pitch (incl. model files) | Apache-2.0 | Pitch detection for the Sync Report |
| @tensorflow/tfjs | Apache-2.0 | Runs Basic Pitch |
| @fontsource/inter (Inter) | SIL OFL 1.1 | Bundled render font (deterministic frames) |
| react, react-dom | MIT | UI |
| dexie, dexie-react-hooks | Apache-2.0 | IndexedDB |
| vite-plugin-pwa / workbox | MIT | Service worker, offline precache |

Test fixtures in `tests/fixtures/alphatab/` are alphaTab test files (MPL-2.0), see the README there.
App icons are drawn by `scripts/make-icons.cjs` (original).
