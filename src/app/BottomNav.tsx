import { haptic } from './haptics';
import { href, type Route } from './router';

export function BottomNav({ route, onPlus }: { route: Route; onPlus: () => void }) {
  const item = (name: 'library' | 'exports' | 'settings', ico: string, label: string) => (
    <a href={href({ name })} className={route.name === name ? 'on' : ''} aria-current={route.name === name ? 'page' : undefined}>
      <span className="ico" aria-hidden="true">{ico}</span>
      {label}
    </a>
  );
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        {item('library', '🎸', 'Library')}
        <button
          className="plus-wrap"
          aria-label="Create riff"
          onClick={() => {
            haptic();
            onPlus();
          }}
        >
          <span className="plus" aria-hidden="true">+</span>
        </button>
        {item('exports', '🎬', 'Exports')}
        {item('settings', '⚙️', 'Settings')}
      </div>
    </nav>
  );
}
