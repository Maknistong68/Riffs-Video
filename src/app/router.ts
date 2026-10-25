/** Tiny hash router: #/library, #/exports, #/settings, #/riff/:id, #/result/:id, #/write[/:id]. */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'exports' }
  | { name: 'settings' }
  | { name: 'write'; riffId?: string }
  | { name: 'review'; riffId: string }
  | { name: 'studio'; riffId: string; atMs?: number; openExport?: boolean }
  | { name: 'result'; exportId: string };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);
  switch (parts[0]) {
    case 'exports':
      return { name: 'exports' };
    case 'settings':
      return { name: 'settings' };
    case 'write':
      return parts[1] ? { name: 'write', riffId: parts[1] } : { name: 'write' };
    case 'review':
      return parts[1] ? { name: 'review', riffId: parts[1] } : { name: 'library' };
    case 'riff':
      if (parts[1]) {
        const at = params.get('t');
        return {
          name: 'studio',
          riffId: parts[1],
          ...(at !== null ? { atMs: Number(at) } : {}),
          ...(params.get('export') === '1' ? { openExport: true } : {}),
        };
      }
      return { name: 'library' };
    case 'result':
      return parts[1] ? { name: 'result', exportId: parts[1] } : { name: 'exports' };
    default:
      return { name: 'library' };
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'library':
      return '#/library';
    case 'exports':
      return '#/exports';
    case 'settings':
      return '#/settings';
    case 'write':
      return r.riffId ? `#/write/${r.riffId}` : '#/write';
    case 'review':
      return `#/review/${r.riffId}`;
    case 'studio': {
      const q = new URLSearchParams();
      if (r.atMs !== undefined) q.set('t', String(Math.round(r.atMs)));
      if (r.openExport) q.set('export', '1');
      const qs = q.toString();
      return `#/riff/${r.riffId}${qs ? `?${qs}` : ''}`;
    }
    case 'result':
      return `#/result/${r.exportId}`;
  }
}

export function navigate(r: Route, replace = false): void {
  const h = href(r);
  if (replace) history.replaceState(null, '', h);
  else location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
