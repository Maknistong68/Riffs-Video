#!/usr/bin/env node
/**
 * Phase 4 acceptance (CLAUDE.md §8): the Claude API key must never reach the client bundle.
 * Scans every built file in dist/ for key-shaped strings, the Anthropic endpoint/headers and the
 * Edge Function's server-only code. Runs after `vite build`; exits 1 on any hit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const patterns = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/, 'Anthropic API key'],
  [/api\.anthropic\.com/, 'Anthropic API endpoint (only the Edge Function may call it)'],
  [/ANTHROPIC_API_KEY/, 'server secret name'],
  [/x-api-key/i, 'Anthropic auth header'],
  [/anthropic-version/i, 'Anthropic API header'],
  [/You convert guitar or bass tablature/, 'Edge Function prompt (server-only code in the bundle)'],
];
const secret = process.env.ANTHROPIC_API_KEY;
if (secret && secret.length >= 8) patterns.push([new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the actual ANTHROPIC_API_KEY value']);

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|css|html|json|webmanifest|map|txt)$/.test(name)) files.push(p);
  }
};
try {
  walk(root);
} catch {
  console.error('check-bundle-secrets: dist/ not found — run vite build first');
  process.exit(1);
}
let hits = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [re, what] of patterns) {
    if (re.test(text)) {
      console.error(`✗ ${relative(root, f)}: contains ${what}`);
      hits++;
    }
  }
}
if (hits) process.exit(1);
console.log(`✓ no API keys or server-only code in ${files.length} built files`);
