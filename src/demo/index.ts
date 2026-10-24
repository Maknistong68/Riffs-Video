/** Original demo riffs (safe to post), seeded into the Library on first launch. */
import midnight from './midnight-pentatonic.atex?raw';
import power from './power-drive.atex?raw';
import blues from './slow-bend-blues.atex?raw';

export type DemoRiff = { id: string; title: string; text: string };

export const DEMO_RIFFS: DemoRiff[] = [
  { id: 'midnight-pentatonic', title: 'Midnight Pentatonic', text: midnight },
  { id: 'power-drive', title: 'Power Drive', text: power },
  { id: 'slow-bend-blues', title: 'Slow Bend Blues', text: blues },
];
