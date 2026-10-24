/**
 * P5: the ONE string-number conversion.
 * alphaTab: note.string 1 = lowest-pitched string; staff.tuning[0] = highest string.
 * Timeline: stringIdx 0 = highest string (tab display order), same order as tuning.
 */
export function alphaTabStringToIdx(alphaTabString: number, stringCount: number): number {
  return stringCount - alphaTabString;
}

export function idxToAlphaTabString(stringIdx: number, stringCount: number): number {
  return stringCount - stringIdx;
}
