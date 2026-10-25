/**
 * The UI thread must not bundle the heavy libraries (alphaTab, TF.js, Basic Pitch): they live in
 * the render worker. Follows non-type imports from every UI entry file.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../src');
const HEAVY = [/@coderline\/alphatab(?!\/(soundfont|font)\/)/, /@tensorflow\//, /@spotify\/basic-pitch/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

/** Non-type import specifiers (static imports and re-exports; dynamic import() is fine). */
function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(re)) {
    // `import { type A, type B } from` is type-only too.
    const names = m[1]!.replace(/[{}]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
    if (names.length && names.every((n) => n.startsWith('type '))) continue;
    out.push(m[2]!);
  }
  for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

function reachesHeavy(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: [string, string[]][] = [[entry, [entry]]];
  while (stack.length) {
    const [f, path] = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of imports(f)) {
      if (HEAVY.some((h) => h.test(spec))) return [...path, spec];
      const next = resolveLocal(f, spec);
      if (next) stack.push([next, [...path, next]]);
    }
  }
  return null;
}

describe('UI bundle boundary', () => {
  const ui = ['app', 'screens', 'components', 'storage'].flatMap((d) => files(join(SRC, d))).concat(join(SRC, 'main.tsx'));
  for (const f of ui) {
    it(f.replace(SRC, 'src'), () => {
      const chain = reachesHeavy(f);
      expect(chain && chain.map((p) => p.replace(SRC, 'src')).join(' → ')).toBeNull();
    });
  }
});

// Phase 4: the Claude API key lives only in the Edge Function. No app code (UI or worker) may
// import the Anthropic SDK or the function's code — the app talks to the function over HTTP.
const SERVER_ONLY = [/@anthropic-ai\/sdk/, /supabase\/functions/];
describe('server-only code stays out of the app', () => {
  for (const f of files(SRC)) {
    it(f.replace(SRC, 'src'), () => {
      const src = readFileSync(f, 'utf8');
      const specs = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      expect(specs.filter((sp) => SERVER_ONLY.some((r) => r.test(sp)))).toEqual([]);
    });
  }
});
