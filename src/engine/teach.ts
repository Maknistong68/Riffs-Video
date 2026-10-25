/** Teach options (kept separate from arrange.ts so UI code doesn't bundle alphaTab). */
export type TeachOptions = { slowMo: boolean; loopHardest: boolean };
export const NO_TEACH: TeachOptions = { slowMo: false, loopHardest: false };
