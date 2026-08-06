import { useSnapbackConnection } from '@expo/snapback-react';

export function App() {
  const connection = useSnapbackConnection();

  return (
    <main className="scaffold-shell">
      <p className="eyebrow">LLP 0183 · Stage 0.5</p>
      <h1>Zerobugs current-surface control</h1>
      <p>
        The ten-table schema and React binding are generated and ready to attach
        to a locally admitted Snapback server.
        Query, mutation, fixture, composition, and source-faithful UI lanes are
        intentionally left for the execution jobs in PLAN.md.
      </p>
      <dl>
        <div>
          <dt>Binding</dt>
          <dd>generated</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>{connection.status}</dd>
        </div>
      </dl>
    </main>
  );
}
