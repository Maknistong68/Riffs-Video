/**
 * Bundled font so frames render identically on every device (system-ui differs per OS).
 * Must be loaded before drawFrame runs, in the window (preview) and in the render worker.
 */
import w500 from '@fontsource/inter/files/inter-latin-500-normal.woff2?url';
import w600 from '@fontsource/inter/files/inter-latin-600-normal.woff2?url';
import w700 from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import w800 from '@fontsource/inter/files/inter-latin-800-normal.woff2?url';
import bravura from '@coderline/alphatab/font/Bravura.woff2?url';

export const FONT_FAMILY = 'RiffReel Inter';
/** SMuFL music font (OFL, shipped with alphaTab) for staff notation. */
export const MUSIC_FONT = 'RiffReel Bravura';

export function font(weight: 500 | 600 | 700 | 800, sizePx: number): string {
  return `${weight} ${sizePx}px "${FONT_FAMILY}", system-ui, sans-serif`;
}

let loading: Promise<boolean> | null = null;

/** Resolves true when the bundled font is ready (false = fell back to system font). */
export function loadRenderFonts(): Promise<boolean> {
  loading ??= (async () => {
    // Workers expose self.fonts; windows expose document.fonts.
    const g = globalThis as unknown as { fonts?: FontFaceSet; document?: { fonts?: FontFaceSet } };
    const set = g.fonts ?? g.document?.fonts;
    if (!set || typeof FontFace === 'undefined') return false;
    try {
      const faces = (
        [
          [500, w500],
          [600, w600],
          [700, w700],
          [800, w800],
        ] as const
      ).map(([weight, url]) => new FontFace(FONT_FAMILY, `url(${new URL(url, globalThis.location.href).href})`, { weight: String(weight) }));
      faces.push(new FontFace(MUSIC_FONT, `url(${new URL(bravura, globalThis.location.href).href})`));
      await Promise.all(faces.map((f) => f.load()));
      for (const f of faces) set.add(f);
      return true;
    } catch {
      return false;
    }
  })();
  return loading;
}
