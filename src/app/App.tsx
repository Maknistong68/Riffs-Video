import { useEffect, useState } from 'react';
import { ImportSheet } from '../screens/import/ImportSheet';
import { CompatScreen } from '../screens/compat/CompatScreen';
import { ExportsScreen } from '../screens/exports/ExportsScreen';
import { LibraryScreen } from '../screens/library/LibraryScreen';
import { ResultScreen } from '../screens/result/ResultScreen';
import { ReviewScreen } from '../screens/review/ReviewScreen';
import { PasteScreen } from '../screens/paste/PasteScreen';
import { AiImportScreen } from '../screens/ai/AiImportScreen';
import { PracticeScreen } from '../screens/practice/PracticeScreen';
import { AudioImportScreen } from '../screens/audio/AudioImportScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { StudioScreen } from '../screens/studio/StudioScreen';
import { WriteScreen } from '../screens/write/WriteScreen';
import { seedDemos } from '../storage/riffs';
import { recoverQueue } from '../export/queue';
import { BottomNav } from './BottomNav';
import { checkCompatibility, type CompatResult } from './compat';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  const [compat, setCompat] = useState<CompatResult | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    void checkCompatibility().then(setCompat);
    void seedDemos();
    void recoverQueue();
  }, []);

  if (compat && !compat.ok) return <CompatScreen result={compat} />;

  const withNav = route.name === 'library' || route.name === 'exports' || route.name === 'settings';
  return (
    <div className="app">
      {route.name === 'library' && <LibraryScreen onCreate={() => setImportOpen(true)} />}
      {route.name === 'exports' && <ExportsScreen />}
      {route.name === 'settings' && <SettingsScreen compat={compat} />}
      {route.name === 'write' && <WriteScreen {...(route.riffId ? { riffId: route.riffId } : {})} />}
      {route.name === 'paste' && <PasteScreen />}
      {route.name === 'ai' && <AiImportScreen />}
      {route.name === 'practice' && <PracticeScreen key={route.data} data={route.data} />}
      {route.name === 'audio' && <AudioImportScreen />}
      {route.name === 'review' && <ReviewScreen key={route.riffId} riffId={route.riffId} />}
      {route.name === 'studio' && (
        <StudioScreen key={route.riffId} riffId={route.riffId} {...(route.atMs !== undefined ? { atMs: route.atMs } : {})} openExport={route.openExport ?? false} />
      )}
      {route.name === 'result' && <ResultScreen exportId={route.exportId} />}
      {withNav && <BottomNav route={route} onPlus={() => setImportOpen(true)} />}
      {importOpen && <ImportSheet onClose={() => setImportOpen(false)} />}
    </div>
  );
}
