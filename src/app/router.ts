/** Tiny hash router: #/library, #/exports, #/settings, #/riff/:id, #/result/:id, #/write[/:id]. */
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'exports' }
  | { name: 'settings' }
  | { name: 'write'; riffId?: string }
  | { name: 'studio'; riffId: string; atMs?: number }
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
    case 'riff':
      if (parts[1]) {
        const at = params.get('t');
        return at !== null ? { name: 'studio', riffId: parts[1], atMs: Number(at) } : { name: 'studio', riffId: parts[1] };
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
    case 'studio':
      return `#/riff/${r.riffId}${r.atMs !== undefined ? `?t=${Math.round(r.atMs)}` : ''}`;
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
