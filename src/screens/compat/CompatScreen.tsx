import { isIos } from '../../app/compat';
import type { CompatResult } from '../../app/compat';

/** S0: shown when the browser cannot make videos on-device. */
export function CompatScreen({ result }: { result: CompatResult }) {
  return (
    <main className="screen no-nav" style={{ justifyContent: 'center' }}>
      <h1>Please update your browser</h1>
      <p>RiffReel renders and encodes videos on your phone. Your browser is missing:</p>
      <ul>
        {result.missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <div className="card">
        {isIos() ? (
          <p>Update to <strong>iOS 26</strong> or later (Settings → General → Software Update), then open RiffReel in Safari.</p>
        ) : (
          <p>Update <strong>Chrome</strong> or <strong>Samsung Internet</strong> from the Play Store, then reopen this page.</p>
        )}
      </div>
    </main>
  );
}
