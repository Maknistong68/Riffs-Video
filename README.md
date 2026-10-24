# RiffReel

On-device guitar riff → vertical video maker (PWA). Project brief: [CLAUDE.md](CLAUDE.md). Progress: [docs/STATUS.md](docs/STATUS.md).

```bash
npm install
npm run dev        # http://localhost:5173 (Phase 0 spike page)
npm test           # vitest unit tests
npm run e2e        # Playwright: exports an MP4 in Chromium and asserts the Sync Report is green
npm run build
```

To test on a phone: `npm run build && npx vite preview --host`, then open it over HTTPS. WebCodecs needs a
secure context, so use a tunnel or deploy `dist/` to Cloudflare Pages / Netlify.
