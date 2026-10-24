// Draws the app icons once (node scripts/make-icons.cjs). Output is committed in public/icons.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, false]]) {
    const data = await p.evaluate(([size, maskable]) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const s = size / 512;
      g.fillStyle = '#0d0f14';
      if (maskable) g.fillRect(0, 0, size, size);
      else { g.beginPath(); g.roundRect(0, 0, size, size, 112 * s); g.fill(); }
      const inset = maskable ? 0.8 : 1; // keep the motif inside the maskable safe circle
      g.translate(size / 2, size / 2); g.scale(inset, inset); g.translate(-size / 2, -size / 2);
      // fretboard
      g.fillStyle = '#3b2414'; g.fillRect(70 * s, 130 * s, 372 * s, 252 * s);
      g.fillStyle = '#c9ccd2'; for (const x of [170, 260, 340, 410]) g.fillRect(x * s, 130 * s, 7 * s, 252 * s);
      g.fillStyle = '#efe6cf'; g.fillRect(64 * s, 130 * s, 12 * s, 252 * s);
      for (let i = 0; i < 6; i++) {
        const y = (150 + i * 42.4) * s;
        g.fillStyle = i === 3 ? '#ffd34d' : '#b9b2a2';
        g.fillRect(50 * s, y - (1.5 + i * 0.7) * s, 412 * s, (3 + i * 1.4) * s);
      }
      g.fillStyle = '#ffcc1a'; g.beginPath(); g.arc(215 * s, (150 + 3 * 42.4) * s, 40 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1a1205'; g.font = `800 ${48 * s}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('3', 215 * s, (152 + 3 * 42.4) * s);
      return c.toDataURL('image/png');
    }, [size, maskable]);
    fs.writeFileSync(`public/icons/${name}`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await b.close();
})();
