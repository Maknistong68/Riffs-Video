#!/usr/bin/env node
/**
 * Keep only some presets of an SF2/SF3 SoundFont (and the instruments + samples they use).
 * Used to build the small guitar sound pack from FluidR3Mono_GM.sf3 (MIT) — see LICENSES.md.
 *
 *   node scripts/subset-soundfont.mjs in.sf3 out.sf3 0:24 0:25 0:26 0:27 0:33 128:0
 *
 * SF3 (MuseScore's Ogg-compressed SF2): a compressed sample's start/end are byte offsets in the
 * smpl chunk and its loop points are relative to the sample, so samples are copied byte for byte.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output, ...wanted] = process.argv;
if (!input || !output || wanted.length === 0) {
  console.error('usage: subset-soundfont.mjs in.sf2|sf3 out.sf2|sf3 bank:program ...');
  process.exit(1);
}
const keep = new Set(wanted);
const buf = readFileSync(input);

// --- RIFF parsing -------------------------------------------------------------------------
function chunks(start, end) {
  const out = [];
  for (let p = start; p + 8 <= end; ) {
    const id = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const dataStart = p + 8;
    const c = { id, size, dataStart, dataEnd: dataStart + size };
    if (id === 'LIST' || id === 'RIFF') {
      c.type = buf.toString('latin1', dataStart, dataStart + 4);
      c.children = chunks(dataStart + 4, dataStart + size);
    }
    out.push(c);
    p = dataStart + size + (size & 1);
  }
  return out;
}
const [riff] = chunks(0, buf.length);
if (!riff || riff.id !== 'RIFF' || riff.type !== 'sfbk') throw new Error('not a SoundFont');
const list = (t) => riff.children.find((c) => c.id === 'LIST' && c.type === t);
const info = list('INFO');
const sdta = list('sdta');
const pdta = list('pdta');
const sub = (l, id) => l.children.find((c) => c.id === id);
const smpl = sub(sdta, 'smpl');
if (sub(sdta, 'sm24')) throw new Error('24-bit samples (sm24) are not supported');

function records(id, size, read) {
  const c = sub(pdta, id);
  const out = [];
  for (let p = c.dataStart; p + size <= c.dataEnd; p += size) out.push(read(p));
  return out;
}
const name20 = (p) => buf.toString('latin1', p, p + 20).replace(/\0.*$/s, '');
const phdr = records('phdr', 38, (p) => ({ name: name20(p), preset: buf.readUInt16LE(p + 20), bank: buf.readUInt16LE(p + 22), bag: buf.readUInt16LE(p + 24), library: buf.readUInt32LE(p + 26), genre: buf.readUInt32LE(p + 30), morphology: buf.readUInt32LE(p + 34) }));
const bagOf = (p) => ({ gen: buf.readUInt16LE(p), mod: buf.readUInt16LE(p + 2) });
const pbag = records('pbag', 4, bagOf);
const ibag = records('ibag', 4, bagOf);
const modOf = (p) => buf.subarray(p, p + 10);
const pmod = records('pmod', 10, modOf);
const imod = records('imod', 10, modOf);
const genOf = (p) => ({ oper: buf.readUInt16LE(p), raw: buf.subarray(p + 2, p + 4), u: buf.readUInt16LE(p + 2) });
const pgen = records('pgen', 4, genOf);
const igen = records('igen', 4, genOf);
const inst = records('inst', 22, (p) => ({ name: name20(p), bag: buf.readUInt16LE(p + 20) }));
const shdr = records('shdr', 46, (p) => ({ name: name20(p), start: buf.readUInt32LE(p + 20), end: buf.readUInt32LE(p + 24), loopStart: buf.readUInt32LE(p + 28), loopEnd: buf.readUInt32LE(p + 32), rate: buf.readUInt32LE(p + 36), pitch: buf.readUInt8(p + 40), correction: buf.readInt8(p + 41), link: buf.readUInt16LE(p + 42), type: buf.readUInt16LE(p + 44) }));

const GEN_INSTRUMENT = 41;
const GEN_SAMPLE = 53;

// --- Selection ------------------------------------------------------------------------------
const presets = phdr.slice(0, -1).map((h, i) => ({ ...h, i })).filter((h) => keep.has(`${h.bank}:${h.preset}`));
const missing = [...keep].filter((k) => !presets.some((h) => `${h.bank}:${h.preset}` === k));
if (missing.length) throw new Error(`presets not found: ${missing.join(', ')}`);

const zonesOf = (hdrs, i, bags) => {
  const zones = [];
  for (let b = hdrs[i].bag; b < hdrs[i + 1].bag; b++) zones.push(b);
  return zones.map((b) => ({ gens: [bags[b].gen, bags[b + 1].gen], mods: [bags[b].mod, bags[b + 1].mod] }));
};

const instIdx = new Map(); // old → new
const sampleIdx = new Map();
const usedInst = [];
for (const h of presets) {
  for (const z of zonesOf(phdr, h.i, pbag)) {
    for (let g = z.gens[0]; g < z.gens[1]; g++) if (pgen[g].oper === GEN_INSTRUMENT && !instIdx.has(pgen[g].u)) { instIdx.set(pgen[g].u, usedInst.length); usedInst.push(pgen[g].u); }
  }
}
const usedSamples = [];
const addSample = (s) => {
  if (sampleIdx.has(s)) return;
  sampleIdx.set(s, usedSamples.length);
  usedSamples.push(s);
  const t = shdr[s].type & 0x7fff & ~0x10;
  if ((t === 2 || t === 4) && shdr[s].link < shdr.length - 1) addSample(shdr[s].link); // stereo partner
};
for (const ii of usedInst) for (const z of zonesOf(inst, ii, ibag)) for (let g = z.gens[0]; g < z.gens[1]; g++) if (igen[g].oper === GEN_SAMPLE) addSample(igen[g].u);

// --- Rebuild ----------------------------------------------------------------------------------
const out = { phdr: [], pbag: [], pmod: [], pgen: [], inst: [], ibag: [], imod: [], igen: [], shdr: [] };
const rec = (n) => Buffer.alloc(n);
const writeName = (b, name) => b.write(name.slice(0, 19), 0, 'latin1');
const genRec = (oper, raw) => { const b = rec(4); b.writeUInt16LE(oper, 0); raw.copy(b, 2); return b; };
const bagRec = (g, m) => { const b = rec(4); b.writeUInt16LE(g, 0); b.writeUInt16LE(m, 2); return b; };

function copyZones(hdrs, i, bags, gens, mods, outBags, outGens, outMods, remap) {
  for (const z of zonesOf(hdrs, i, bags)) {
    outBags.push(bagRec(outGens.length, outMods.length));
    for (let m = z.mods[0]; m < z.mods[1]; m++) outMods.push(Buffer.from(mods[m]));
    for (let g = z.gens[0]; g < z.gens[1]; g++) {
      const gen = gens[g];
      const mapped = remap(gen);
      if (mapped === null) continue;
      const amt = Buffer.alloc(2);
      if (mapped === undefined) gen.raw.copy(amt);
      else amt.writeUInt16LE(mapped, 0);
      outGens.push(genRec(gen.oper, amt));
    }
  }
}

presets.sort((a, b) => a.bank - b.bank || a.preset - b.preset);
for (const h of presets) {
  const b = rec(38);
  writeName(b, h.name);
  b.writeUInt16LE(h.preset, 20); b.writeUInt16LE(h.bank, 22); b.writeUInt16LE(out.pbag.length, 24);
  b.writeUInt32LE(h.library, 26); b.writeUInt32LE(h.genre, 30); b.writeUInt32LE(h.morphology, 34);
  out.phdr.push(b);
  copyZones(phdr, h.i, pbag, pgen, pmod, out.pbag, out.pgen, out.pmod, (g) => (g.oper === GEN_INSTRUMENT ? instIdx.get(g.u) : undefined));
}
{ const b = rec(38); writeName(b, 'EOP'); b.writeUInt16LE(out.pbag.length, 24); out.phdr.push(b); }
out.pbag.push(bagRec(out.pgen.length, out.pmod.length));
out.pgen.push(rec(4));
out.pmod.push(rec(10));

for (const ii of usedInst) {
  const b = rec(22);
  writeName(b, inst[ii].name);
  b.writeUInt16LE(out.ibag.length, 20);
  out.inst.push(b);
  copyZones(inst, ii, ibag, igen, imod, out.ibag, out.igen, out.imod, (g) => (g.oper === GEN_SAMPLE ? sampleIdx.get(g.u) : undefined));
}
{ const b = rec(22); writeName(b, 'EOI'); b.writeUInt16LE(out.ibag.length, 20); out.inst.push(b); }
out.ibag.push(bagRec(out.igen.length, out.imod.length));
out.igen.push(rec(4));
out.imod.push(rec(10));

// Sample data
const parts = [];
let offset = 0; // bytes for compressed, frames for PCM (PCM is 16-bit)
let compressedAny = false;
for (const s of usedSamples) {
  const h = shdr[s];
  const compressed = (h.type & 0x10) !== 0;
  const b = rec(46);
  writeName(b, h.name);
  if (compressed) {
    compressedAny = true;
    const data = buf.subarray(smpl.dataStart + h.start, smpl.dataStart + h.end);
    b.writeUInt32LE(offset, 20); b.writeUInt32LE(offset + data.length, 24);
    b.writeUInt32LE(h.loopStart, 28); b.writeUInt32LE(h.loopEnd, 32); // relative to the sample
    parts.push(data);
    offset += data.length;
  } else {
    const data = buf.subarray(smpl.dataStart + h.start * 2, smpl.dataStart + h.end * 2);
    const frames = h.end - h.start;
    b.writeUInt32LE(offset, 20); b.writeUInt32LE(offset + frames, 24);
    b.writeUInt32LE(h.loopStart - h.start + offset, 28); b.writeUInt32LE(h.loopEnd - h.start + offset, 32);
    parts.push(data, Buffer.alloc(46 * 2)); // 46 zero frames after each sample (spec)
    offset += frames + 46;
  }
  b.writeUInt32LE(h.rate, 36); b.writeUInt8(h.pitch, 40); b.writeInt8(h.correction, 41);
  b.writeUInt16LE(sampleIdx.get(h.link) ?? 0, 42); b.writeUInt16LE(h.type, 44);
  out.shdr.push(b);
}
{ const b = rec(46); writeName(b, 'EOS'); out.shdr.push(b); }
if (compressedAny && usedSamples.some((s) => (shdr[s].type & 0x10) === 0)) throw new Error('mixed PCM/compressed samples are not supported');

// --- Write ------------------------------------------------------------------------------------
// Every chunk gets an even size (padding counted inside it): the RIFF pad byte after an odd-sized
// chunk is not skipped by every reader (alphaTab's isn't), which would misalign the next chunk.
const chunk = (id, data) => {
  const body = data.length & 1 ? Buffer.concat([data, Buffer.alloc(1)]) : data;
  const head = Buffer.alloc(8);
  head.write(id, 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};
const listChunk = (type, children) => chunk('LIST', Buffer.concat([Buffer.from(type, 'latin1'), ...children]));
const infoChildren = info.children.map((c) => {
  if (c.id === 'ICMT') return chunk('ICMT', Buffer.from(`Subset (presets ${[...keep].join(' ')}) of the original SoundFont. See LICENSES.md.\0`, 'latin1'));
  return chunk(c.id, buf.subarray(c.dataStart, c.dataEnd));
});
const body = Buffer.concat([
  Buffer.from('sfbk', 'latin1'),
  listChunk('INFO', infoChildren),
  listChunk('sdta', [chunk('smpl', Buffer.concat(parts))]),
  listChunk('pdta', ['phdr', 'pbag', 'pmod', 'pgen', 'inst', 'ibag', 'imod', 'igen', 'shdr'].map((id) => chunk(id, Buffer.concat(out[id])))),
]);
writeFileSync(output, chunk('RIFF', body));
console.log(`${presets.length} presets, ${usedInst.length} instruments, ${usedSamples.length} samples → ${output} (${(body.length / 1024 / 1024).toFixed(2)} MB)`);
for (const h of presets) console.log(`  ${h.bank}:${h.preset} ${h.name}`);
