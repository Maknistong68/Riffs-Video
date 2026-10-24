# Third-party licences

| Package / asset | Licence | Use |
|---|---|---|
| mediabunny | MPL-2.0 | MP4 muxing/demuxing, WebCodecs encode/decode |
| @mediabunny/aac-encoder | MPL-2.0 (bundles a WASM build of FFmpeg's AAC encoder, LGPL-2.1+) | AAC fallback, lazy-loaded **only** when the browser has no native AAC encoder |
| react, react-dom | MIT | UI |

No fonts, SoundFonts or 3D assets are bundled yet. The renderer uses `system-ui`; Phase 1 must bundle a
font (and list it here) so frames look identical on every device.
