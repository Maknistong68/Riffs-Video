import { DEFAULT_STYLE, type RiffRecord, type StyleSettings } from '../../../src/storage/db';
import { riffConfig as build } from '../../../src/storage/riffConfig';

export { DEFAULT_STYLE };
export { HOOK_LEAD_IN_MS } from '../../../src/storage/riffConfig';

/** riffConfig for a minimal alphaTex riff record with the given style. */
export function riffConfig(style: StyleSettings) {
  const riff = { id: 'r', title: 'T', artist: '', isOriginal: true, source: 'alphatex', sourceText: ':4 0.6', trackIndex: 0, styleSettings: style, createdAt: 0, updatedAt: 0 } as RiffRecord;
  return build(riff, style);
}
