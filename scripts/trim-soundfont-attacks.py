#!/usr/bin/env python3
"""
Trim the silence before each sample's attack in an SF3 SoundFont (Ogg Vorbis samples).

Some free SoundFonts start their samples with tens of milliseconds of silence (FluidR3's steel
guitar: ~57 ms). A synth then sounds every note late, which breaks RiffReel's rule that audio and
video agree within one frame (CLAUDE.md §3). This cuts each sample to 1 ms before its attack, moves
the loop points by the same amount, re-encodes, and rewrites the sample table.

    python3 scripts/trim-soundfont-attacks.py in.sf3 out.sf3

Needs: pip install soundfile numpy  (libsndfile with Vorbis).
"""
import io
import struct
import sys

import numpy as np
import soundfile as sf

ATTACK_THRESHOLD = 0.05  # of the sample's peak
PRE_ROLL_S = 0.001


def chunks(buf, start, end):
    out = []
    p = start
    while p + 8 <= end:
        cid = buf[p:p + 4].decode('latin1')
        size = struct.unpack_from('<I', buf, p + 4)[0]
        c = {'id': cid, 'size': size, 'start': p + 8, 'end': p + 8 + size}
        if cid in ('RIFF', 'LIST'):
            c['type'] = buf[p + 8:p + 12].decode('latin1')
            c['children'] = chunks(buf, p + 12, p + 8 + size)
        out.append(c)
        p += 8 + size + (size & 1)
    return out


def chunk(cid, data):
    if len(data) & 1:
        data += b'\0'  # even size, counted in the chunk (not every reader skips a pad byte)
    return cid.encode('latin1') + struct.pack('<I', len(data)) + data


def main(src, dst):
    buf = open(src, 'rb').read()
    riff = chunks(buf, 0, len(buf))[0]
    lists = {c['type']: c for c in riff['children'] if c['id'] == 'LIST'}
    smpl = next(c for c in lists['sdta']['children'] if c['id'] == 'smpl')
    shdr = next(c for c in lists['pdta']['children'] if c['id'] == 'shdr')
    n = shdr['size'] // 46

    new_smpl = bytearray()
    new_shdr = bytearray()
    trims = []
    for i in range(n):
        rec = bytearray(buf[shdr['start'] + i * 46: shdr['start'] + (i + 1) * 46])
        name = rec[:20].split(b'\0')[0].decode('latin1')
        start, end, loop_s, loop_e, rate = struct.unpack_from('<IIIII', rec, 20)
        stype = struct.unpack_from('<H', rec, 44)[0]
        if i == n - 1 or not (stype & 0x10):
            if i != n - 1:
                raise SystemExit(f'{name}: only compressed (SF3) samples are supported')
            new_shdr += rec  # EOS
            continue
        data, sr = sf.read(io.BytesIO(buf[smpl['start'] + start: smpl['start'] + end]), dtype='float32')
        if data.ndim > 1:
            data = data.mean(axis=1)
        peak = float(np.max(np.abs(data))) if len(data) else 0.0
        cut = 0
        if peak > 0:
            first = int(np.argmax(np.abs(data) > peak * ATTACK_THRESHOLD))
            cut = max(0, first - int(PRE_ROLL_S * sr))
        if loop_s < loop_e:
            cut = min(cut, loop_s)  # never cut into the loop
        trimmed = data[cut:]
        out = io.BytesIO()
        sf.write(out, trimmed, sr, format='OGG', subtype='VORBIS')
        enc = out.getvalue()
        struct.pack_into('<IIII', rec, 20, len(new_smpl), len(new_smpl) + len(enc), max(0, loop_s - cut), max(0, loop_e - cut))
        new_smpl += enc
        new_shdr += rec
        trims.append((name, round(cut / sr * 1000, 1)))

    def rebuild(c):
        if c['id'] == 'LIST':
            return chunk('LIST', c['type'].encode('latin1') + b''.join(rebuild(k) for k in c['children']))
        if c is smpl:
            return chunk('smpl', bytes(new_smpl))
        if c is shdr:
            return chunk('shdr', bytes(new_shdr))
        return chunk(c['id'], buf[c['start']:c['end']])

    body = b'sfbk' + b''.join(rebuild(c) for c in riff['children'])
    open(dst, 'wb').write(chunk('RIFF', body))
    worst = max(trims, key=lambda t: t[1]) if trims else ('-', 0)
    print(f'{len(trims)} samples trimmed (max {worst[1]} ms: {worst[0]}) → {dst} ({len(body) / 1048576:.2f} MB)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
