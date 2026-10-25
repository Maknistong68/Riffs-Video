import { useEffect, useRef, useState } from 'react';
import { navigate } from '../../app/router';
import { Segmented } from '../../components/Segmented';
import { db, newId } from '../../storage/db';
import { saveBlob } from '../../storage/opfs';
import { createRiff, updateRiff } from '../../storage/riffs';
import { transcribeAudio, WorkerError } from '../../workers/client';

const MAX_SECONDS = 30;
const TUNINGS = [
  { id: 'std', label: 'Guitar', tuning: [64, 59, 55, 50, 45, 40] },
  { id: 'dropd', label: 'Drop D', tuning: [64, 59, 55, 50, 45, 38] },
  { id: 'eb', label: 'E♭', tuning: [63, 58, 54, 49, 44, 39] },
  { id: 'bass', label: 'Bass', tuning: [43, 38, 33, 28] },
] as const;
type TuningId = (typeof TUNINGS)[number]['id'];

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording'; started: number }
  | { kind: 'working'; label: string; fraction: number }
  | { kind: 'error'; message: string };

/** S3: record or upload a riff → Basic Pitch → tab with confidence flags → Riff Review. */
export function AudioImportScreen() {
  const [tuning, setTuning] = useState<TuningId>('std');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [level, setLevel] = useState(0);
  const [now, setNow] = useState(0);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; ctx: AudioContext; raf: number; chunks: Blob[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => stopStreams(), []);
  const stopStreams = () => {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close();
    rec.current = null;
  };

  const startRecording = async () => {
    try {
      // Raw guitar sound: phone voice processing would mangle notes.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        const type = mr.mimeType || 'audio/webm';
        stopStreams();
        void process(new Blob(chunks, { type }), 'Recorded riff');
      };
      const started = performance.now();
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        setLevel(peak);
        setNow(performance.now());
        if (performance.now() - started > MAX_SECONDS * 1000) mr.stop();
        else if (rec.current) rec.current.raf = requestAnimationFrame(tick);
      };
      rec.current = { mr, stream, ctx, raf: requestAnimationFrame(tick), chunks };
      mr.start();
      setPhase({ kind: 'recording', started });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser settings, or upload a file instead.' : `Could not start recording: ${String(e)}` });
    }
  };

  const process = async (blob: Blob, title: string) => {
    try {
      setPhase({ kind: 'working', label: 'Decoding audio…', fraction: 0 });
      const pcm = await decodeToMono48k(blob);
      if (pcm.length < 48_000 * 0.5) throw new Error('That clip is too short — play the riff for at least a second.');
      const clipped = pcm.length > MAX_SECONDS * 48_000 ? pcm.slice(0, MAX_SECONDS * 48_000) : pcm;
      const t = TUNINGS.find((x) => x.id === tuning)!;
      const result = await transcribeAudio(
        { pcm: clipped, sampleRate: 48_000, modelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`, location.href).href, tuning: [...t.tuning], capo: 0, title },
        (f) => setPhase({ kind: 'working', label: 'Listening to the notes…', fraction: f }),
      );
      setPhase({ kind: 'working', label: 'Writing the tab…', fraction: 1 });
      const id = await createRiff({
        title,
        artist: '',
        isOriginal: true,
        source: 'audio',
        sourceText: result.alphaTex,
        noteConfidence: result.noteConfidence,
        rhythm: { method: 'audio', bpm: result.bpm, units: result.units },
        trackIndex: 0,
      });
      const path = `rec_${newId('a')}`;
      await saveBlob(db(), path, blob);
      await updateRiff(id, { recordingPath: path });
      navigate({ name: 'review', riffId: id }, true);
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof WorkerError || e instanceof Error ? e.message : String(e) });
    }
  };

  const busy = phase.kind === 'working' || phase.kind === 'recording';
  const secs = phase.kind === 'recording' ? Math.max(0, (now - phase.started) / 1000) : 0;
  return (
    <main className="screen no-nav">
      <div className="topbar">
        <button className="icon-btn" aria-label="Back" onClick={() => history.back()} disabled={busy}>‹</button>
        <h1>Record or upload</h1>
      </div>
      <p className="dim small">
        Play the riff once, cleanly, close to the phone (up to {MAX_SECONDS} s). RiffReel listens, writes the tab, and marks notes
        it isn’t sure about in amber so you can check them.
      </p>
      <div className="field">
        <span>Instrument / tuning</span>
        <Segmented<TuningId> label="Tuning" value={tuning} onChange={setTuning} disabled={busy} options={TUNINGS.map((t) => ({ value: t.id, label: t.label }))} />
      </div>

      {phase.kind === 'recording' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <strong style={{ fontSize: 28 }}>● {secs.toFixed(1)} s</strong>
          <div className="meter" aria-label="Input level"><div style={{ width: `${Math.min(100, level * 140)}%`, background: level > 0.7 ? 'var(--bad)' : 'var(--good)' }} /></div>
          <button className="btn primary block" onClick={() => rec.current?.mr.stop()} data-testid="stop-recording">Stop</button>
        </div>
      ) : (
        <>
          <button className="btn primary block" onClick={() => void startRecording()} disabled={busy}>🎙️ Record</button>
          <button className="btn block" onClick={() => fileRef.current?.click()} disabled={busy}>Upload audio or video file</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.ogg,.webm,.flac"
            data-testid="audio-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void process(f, f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </>
      )}
      {phase.kind === 'working' && (
        <div className="card" data-testid="transcribe-progress">
          <p>{phase.label}</p>
          <div className="bar"><div style={{ width: `${Math.round(phase.fraction * 100)}%` }} /></div>
        </div>
      )}
      {phase.kind === 'error' && <div className="errors" role="alert">{phase.message}</div>}
      <p className="dim small">Your recording stays on this phone. It’s only used to write the tab and for comparing in Review — never put in videos.</p>
    </main>
  );
}

/** Any browser-decodable file → mono Float32 at 48 kHz (decodeAudioData resamples to the context rate). */
async function decodeToMono48k(blob: Blob): Promise<Float32Array<ArrayBuffer>> {
  const ctx = new OfflineAudioContext(1, 1, 48_000);
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    throw new Error('Could not read that file. Try WAV, MP3, M4A or a phone recording.');
  }
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / buf.numberOfChannels;
  }
  return out;
}
