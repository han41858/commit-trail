import { useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { debug } from './debug';
import { requestActivity } from './requestActivity';
import './debug.css';

const ms = (value: number) => `${value.toFixed(2)} ms`;
const date = (value: number | null) =>
  value === null ? 'unknown' : new Date(value).toLocaleTimeString();
function Panel() {
  const data = useSyncExternalStore(debug.subscribe, debug.getSnapshot);
  const active = useSyncExternalStore(requestActivity.subscribe, requestActivity.getSnapshot);
  const queued = useSyncExternalStore(
    requestActivity.subscribeQueue,
    requestActivity.getQueuedSnapshot,
  );
  const [dock, setDock] = useState('bottom-right'),
    [copied, setCopied] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(debug.diagnostics());
      setCopied('Copied');
    } catch {
      setCopied('Clipboard unavailable; use Console');
    }
  }
  const completed = Object.values(data.api.statuses).reduce((sum, count) => sum + count, 0);
  const api = data.api,
    graph = data.graph,
    lastLayout = data.layouts.at(-1),
    lastRender = data.renders.at(-1);
  return (
    <section
      className={`debug-panel debug-${dock}`}
      data-debug-ui
      role="dialog"
      aria-label="Developer diagnostics"
      aria-modal="false"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          debug.setMode('button');
        }
      }}
    >
      <header>
        <strong>Developer diagnostics</strong>
        <button aria-label="Close diagnostics" onClick={() => debug.setMode('button')}>
          ×
        </button>
      </header>
      <div className="debug-body">
        <label className="debug-dock">
          {'Position '}
          <select
            aria-label="Diagnostics position"
            value={dock}
            onChange={(event) => setDock(event.target.value)}
          >
            <option value="bottom-right">Bottom right</option>
            <option value="top-right">Top right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="top-left">Top left</option>
          </select>
        </label>
        <h3>GitHub API</h3>
        <p>
          HTTP {api.requests} · active {active} · queued {queued}
        </p>
        <p>
          Conditional {api.conditional} · 304 {api.notModified}
          <br />
          Memory hits {api.memoryHits} · shared requests {api.shared}
          <br />
          Failed {api.failed} · cancelled {api.cancelled} · queue cancelled {api.queuedCancelled}
          <br />
          Overlapping identical requests {api.duplicates}
        </p>
        <p>
          HTTP time: avg {ms(completed ? api.totalMs / completed : 0)} · max {ms(api.maxMs)}
        </p>
        <table>
          <caption>Requests by API type</caption>
          <tbody>
            {Object.entries(api.types).map(([kind, count]) => (
              <tr key={kind}>
                <th scope="row">{kind}</th>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {'HTTP status: '}
          {Object.entries(api.statuses)
            .map(([status, count]) => `${status}: ${count}`)
            .join(' · ') || '—'}
        </p>
        <h3>Rate limit headers</h3>
        {data.rates.length ? (
          data.rates.map((rate) => (
            <p key={rate.resource}>
              {rate.resource}: remaining {rate.remaining ?? 'unknown'} / {rate.limit ?? 'unknown'} ·
              used {rate.used ?? 'unknown'}
              <br />
              Reset {date(rate.resetAt)} · observed used Δ {rate.observedUsedDelta ?? 'unknown'}
            </p>
          ))
        ) : (
          <p>No exposed headers observed.</p>
        )}
        <small>
          HTTP requests and quota use differ. Header deltas may include traffic from other clients.
          Overlap is a duplicate candidate, not proof of waste.
        </small>
        <h3>Graph</h3>
        <p>
          Loaded {graph.loaded} · visible {graph.visible} · drawn {graph.drawn}
          <br />
          Branches {graph.branches} · lanes {graph.lanes}
          <br />
          DAG {lastLayout ? ms(lastLayout.ms) : '—'} · {data.layoutCount} calculations
          <br />
          Canvas {lastRender ? ms(lastRender.ms) : '—'} · {data.renderCount} draws
        </p>
        <h3>Refreshes · last 20</h3>
        {[...data.cycles].reverse().map((cycle) => (
          <details key={cycle.id}>
            <summary>
              {cycle.id} · {cycle.kind} · {ms(cycle.durationMs)} · HTTP {cycle.requests}
            </summary>
            <p>
              {cycle.outcome} · 304 {cycle.notModified} · cache {cycle.memoryHits}
              {' · shared '}
              {cycle.shared}
              <br />
              Commits +{cycle.commitsAdded} ~{cycle.commitsChanged} −{cycle.commitsRemoved}
              <br />
              Branches +{cycle.branchesAdded} ~{cycle.branchesChanged} −{cycle.branchesRemoved}
              <br />
              Tags {cycle.tagsChanged} · releases {cycle.releasesChanged}
              {' · Actions '}
              {cycle.actionsChanged}
              <br />
              DAG {cycle.layouts} / {ms(cycle.layoutMs)} · Canvas {cycle.renders}
              {' / '}
              {ms(cycle.renderMs)}
            </p>
          </details>
        ))}
        <details>
          <summary>Recent HTTP / DAG / Canvas samples (20 each)</summary>
          <pre>
            {JSON.stringify(
              { http: data.requests, dag: data.layouts, canvas: data.renders },
              null,
              2,
            )}
          </pre>
        </details>
        <small>Local memory only. Detailed numeric summaries are also in DevTools Console.</small>
      </div>
      <div className="debug-tools">
        <button onClick={() => void copy()}>Copy diagnostics</button>
        <button onClick={debug.print}>Console</button>
        <button onClick={debug.reset}>Reset</button>
        <button onClick={() => debug.setMode('off')}>Disable debug</button>
        <span role="status">{copied}</span>
      </div>
    </section>
  );
}
// Loaded on demand by DebugRoot, so users who never enable debug mode do not download the panel or its styles.
export default function DebugUI({ mode, panelHost }: {
  mode: 'button' | 'panel';
  panelHost: RefObject<HTMLElement | null>;
}) {
  // Movable diagnostics are not bottom notices; retain the app's theme in the portal.
  if (mode === 'panel')
    return panelHost.current ? createPortal(<Panel />, panelHost.current) : null;
  return (
    <button
      className="debug-entry"
      data-debug-ui
      aria-label="Open developer diagnostics"
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
      onClick={() => debug.setMode('panel')}
    >
      Debug
    </button>
  );
}
