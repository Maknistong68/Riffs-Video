# RiffReel

On-device guitar riff → vertical video maker (PWA). Project brief: [CLAUDE.md](CLAUDE.md). Progress: [docs/STATUS.md](docs/STATUS.md).

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # vitest: engine, audio, sync matching, storage
npm run golden         # Chromium: golden timelines + frame hashes + full export with Sync Report
npm run golden:update  # rewrite golden snapshots (review the diff)
npm run e2e            # Playwright, iPhone 15 + Pixel 7 emulation: import → export → Sync Report ✅
npm run build && npx vite preview
```

Testing on a phone needs HTTPS (WebCodecs and service workers require a secure context): deploy `dist/` to
Cloudflare Pages / Netlify, or use an HTTPS tunnel to `vite preview`.
