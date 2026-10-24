import { loadAlphaTex, loadScoreFile, type Score } from './alphatab';

/** What we store and send to workers: the original input, re-parsed deterministically when needed. */
export type RiffSource =
  | { kind: 'alphatex'; text: string }
  | { kind: 'file'; name: string; bytes: Uint8Array };

export function loadRiffSource(src: RiffSource): Score {
  return src.kind === 'alphatex' ? loadAlphaTex(src.text) : loadScoreFile(src.bytes, src.name);
}
