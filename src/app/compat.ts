/** S0: feature detection (P21). AAC may come from the WASM fallback, so only WebAssembly is needed for it. */
import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export type CompatResult = { ok: boolean; missing: string[]; notes: string[] };

export async function checkCompatibility(): Promise<CompatResult> {
  const missing: string[] = [];
  const notes: string[] = [];
  if (typeof VideoEncoder === 'undefined') missing.push('Video encoding (WebCodecs VideoEncoder)');
  if (typeof AudioEncoder === 'undefined') missing.push('Audio encoding (WebCodecs AudioEncoder)');
  if (typeof OffscreenCanvas === 'undefined') missing.push('OffscreenCanvas');
  if (typeof Worker === 'undefined') missing.push('Web Workers');
  if (typeof indexedDB === 'undefined') missing.push('IndexedDB storage');
  if (missing.length === 0) {
    try {
      if (!(await canEncodeVideo('avc', { width: 1080, height: 1920, frameRate: 30 }))) missing.push('H.264 video encoding at 1080×1920');
    } catch {
      missing.push('H.264 video encoding');
    }
    try {
      if (!(await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000 }))) {
        if (typeof WebAssembly === 'undefined') missing.push('AAC audio encoding');
        else notes.push('No built-in AAC encoder: using the bundled one (slightly slower).');
      }
    } catch {
      notes.push('AAC check failed: using the bundled encoder.');
    }
  }
  if (!navigator.storage?.getDirectory) notes.push('No OPFS: videos are stored in IndexedDB instead.');
  return { ok: missing.length === 0, missing, notes };
}

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
