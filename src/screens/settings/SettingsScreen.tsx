import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { isIos, isStandalone, type CompatResult } from '../../app/compat';
import { SOUND_PACKS } from '../../audio/soundpacks';
import { formatBytes } from '../../components/format';
import { Segmented } from '../../components/Segmented';
import { db, DEFAULT_SETTINGS, updateSettings } from '../../storage/db';
import { requestPersistence, storageInfo, type StorageInfo } from '../../storage/opfs';
import { deleteExport } from '../../storage/riffs';

const LICENCES: [string, string][] = [
  ['alphaTab (tab parsing, synth)', 'MPL-2.0'],
  ['Sonivox GM SoundFont', 'Apache-2.0, © Sonic Network Inc.'],
  ['mediabunny + AAC encoder (FFmpeg AAC, LGPL-2.1+)', 'MPL-2.0'],
  ['Basic Pitch (Spotify) + TensorFlow.js', 'Apache-2.0'],
  ['Inter font', 'SIL OFL 1.1'],
  ['three.js (3D guitar)', 'MIT'],
  ['React, Dexie, Workbox', 'MIT / Apache-2.0'],
];

/** S10 */
export function SettingsScreen({ compat }: { compat: CompatResult | null }) {
  const settings = useLiveQuery(async () => ({ ...DEFAULT_SETTINGS, ...((await db().settings.get('app')) ?? {}) }), []);
  const exportCount = useLiveQuery(() => db().exportsMeta.count(), []);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const refresh = () => void storageInfo().then(setStorage);
  useEffect(refresh, [exportCount]);

  return (
    <main className="screen">
      <div className="topbar"><h1>Settings</h1></div>

      <section className="card panel">
        <h2>Defaults</h2>
        <div className="field"><span>Frame rate for new riffs</span>
          <Segmented<30 | 60> label="Default frame rate" value={settings?.defaultFps ?? 30} onChange={(v) => void updateSettings(db(), { defaultFps: v })} options={[{ value: 30, label: '30 fps (faster)' }, { value: 60, label: '60 fps (smoother)' }]} />
        </div>
        <div className="row spread"><span className="dim">Theme</span><strong>Dark</strong></div>
      </section>

      <section className="card panel" data-testid="perf-card">
        <h2>This phone’s speed</h2>
        {settings?.perf?.['3d'] || settings?.perf?.['2d'] ? (
          <>
            {(['3d', '2d'] as const).map((k) => settings.perf?.[k] && (
              <div key={k} className="row spread">
                <span>{k === '3d' ? '3D guitar' : 'Flat 2D'}</span>
                <strong className={settings.perf[k]!.ratio >= 0.5 ? 'good' : 'warn'}>{settings.perf[k]!.ratio.toFixed(1)}× real time</strong>
              </div>
            ))}
            <p className="dim small">Measured on first 3D use (render + encode at 30 fps). Below 0.5× the app uses 2D unless you choose 3D.</p>
          </>
        ) : (
          <p className="dim small">Measured the first time you open a riff in 3D.</p>
        )}
        <button className="btn" onClick={() => void updateSettings(db(), { perf: {} })}>Measure again next time</button>
      </section>

      <section className="card panel">
        <h2>Sound packs</h2>
        {SOUND_PACKS.map((p) => (
          <div key={p.id} className="row spread"><span>{p.name}</span><span className="badge good">Offline ✓</span></div>
        ))}
        <p className="dim small">More guitar sound packs (downloadable for offline use) are planned.</p>
      </section>

      <section className="card panel">
        <h2>Storage</h2>
        {storage && (
          <>
            <div className="meter"><div style={{ width: `${storage.quota ? Math.min(100, (storage.usage / storage.quota) * 100) : 0}%` }} /></div>
            <p className="small dim">{formatBytes(storage.usage)} used of {formatBytes(storage.quota)} · {exportCount ?? 0} videos</p>
            <div className="row spread">
              <span className="small">{storage.persisted ? 'Protected from automatic clean-up ✓' : 'The browser may delete files when space is low'}</span>
              {!storage.persisted && <button className="btn" onClick={() => void requestPersistence().then(refresh)}>Protect</button>}
            </div>
          </>
        )}
        {confirmClear ? (
          <div className="row">
            <button className="btn danger" style={{ flex: 1 }} onClick={async () => { for (const e of await db().exportsMeta.toArray()) await deleteExport(e.id); setConfirmClear(false); refresh(); }}>Delete all videos</button>
            <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmClear(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirmClear(true)} disabled={!exportCount}>Clear exported videos…</button>
        )}
        <p className="dim small">Save videos you want to keep to Files/Photos — they only live on this device.</p>
      </section>

      {!isStandalone() && (
        <section className="card panel">
          <h2>Install</h2>
          <p className="small">{isIos() ? 'In Safari tap Share → “Add to Home Screen” to use RiffReel like an app, offline.' : 'Use your browser menu → “Install app” / “Add to Home screen”.'}</p>
        </section>
      )}

      <section className="card panel">
        <h2>About & licences</h2>
        <p className="small" data-testid="app-version">Version {__APP_VERSION__}</p>
        {compat?.notes.map((n) => <p key={n} className="small dim">{n}</p>)}
        {LICENCES.map(([name, lic]) => (
          <div key={name} className="small"><div>{name}</div><div className="dim">{lic}</div></div>
        ))}
      </section>
    </main>
  );
}
