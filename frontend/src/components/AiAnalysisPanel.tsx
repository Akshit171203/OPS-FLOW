'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  AiAnalysisDto,
  AiAnalysisResponse,
  AnalysisRealtimeData,
  AnalysisStep,
} from '@opsflow/shared';
import { api, ApiError } from '@/lib/api';
import { useReconnect, useSocketEvent } from '@/lib/socket';
import { useToast } from './toast';
import { Button } from './ui';

const STEPS: { key: AnalysisStep | 'queued'; label: string }[] = [
  { key: 'collecting_context', label: 'Collecting context' },
  { key: 'searching_runbooks', label: 'Searching runbooks' },
  { key: 'generating', label: 'Generating analysis' },
];

const isActive = (a: AiAnalysisDto | null) => a?.status === 'QUEUED' || a?.status === 'RUNNING';

function ConfidenceBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2" title={`${label}: ${pct}%`}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-28 overflow-hidden rounded bg-slate-200"
      >
        <div className="h-full bg-accent-600" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-xs tabular-nums text-ink-muted">{pct}%</span>
    </div>
  );
}

function Progress({
  step,
  status,
}: {
  step: AnalysisStep | null;
  status: AiAnalysisDto['status'];
}) {
  // "repairing" is part of generating from the user's point of view
  const current = step === 'repairing' ? 'generating' : step;
  const index = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="space-y-1.5 text-sm" aria-live="polite">
      {STEPS.map((s, i) => {
        const done = index > i;
        const active = index === i || (index === -1 && status === 'QUEUED' && i === 0);
        return (
          <li
            key={s.key}
            className={`flex items-center gap-2 ${done ? 'text-resolved-fg' : active ? 'font-medium text-accent-700' : 'text-ink-subtle'}`}
          >
            <span aria-hidden="true" className="inline-block w-4 text-center">
              {done ? '✓' : active ? '●' : '○'}
            </span>
            {s.label}
            {active && step === 'repairing' && (
              <span className="text-xs font-normal text-ink-subtle">
                (correcting the answer format)
              </span>
            )}
            {active && status === 'QUEUED' && (
              <span className="text-xs font-normal text-ink-subtle">(waiting for a worker)</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ResultCard({ a }: { a: AiAnalysisDto }) {
  const r = a.result!;
  const tokens = (a.inputTokens ?? 0) + (a.outputTokens ?? 0);
  const offline = a.model?.startsWith('fake');
  return (
    <div className="space-y-4">
      <p className="text-sm">{r.summary}</p>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Possible causes</h3>
        <ul className="space-y-3">
          {r.possibleCauses.map((c, i) => (
            <li key={i} className="rounded border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{c.cause}</p>
                <ConfidenceBar value={c.confidence} label={`Confidence in cause ${i + 1}`} />
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                {c.evidence.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Suggested next steps</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {r.suggestedSteps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-subtle">
          Suggestions only. Anything that changes production needs a person to approve it.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-2 text-sm">
          Overall confidence{' '}
          <ConfidenceBar value={r.overallConfidence} label="Overall confidence" />
        </div>
        <p className="text-xs text-ink-subtle">
          {a.model} · prompt {a.promptVersion} · {tokens.toLocaleString()} tokens · {a.latencyMs} ms
          {offline
            ? ' · offline demo analyzer, no cost'
            : ` · est. $${(a.estimatedCost ?? 0).toFixed(4)}`}
        </p>
      </div>
      {offline && (
        <p className="rounded-md border border-notice-line bg-notice-bg p-2 text-xs text-notice-fg">
          This answer came from the built-in offline analyzer, which matches patterns in the
          evidence. It is not a real AI model. Set AI_PROVIDER=gemini and a GEMINI_API_KEY on the
          server to use one.
        </p>
      )}
    </div>
  );
}

export function AiAnalysisPanel({ incidentId, canRun }: { incidentId: string; canRun: boolean }) {
  const [latest, setLatest] = useState<AiAnalysisDto | null>(null);
  const [step, setStep] = useState<AnalysisStep | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const res = await api<AiAnalysisResponse>(`/api/incidents/${incidentId}/ai-analysis`);
      setLatest(res.latest);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the analysis');
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    void load();
  }, [load]);
  useReconnect(load);

  // Live progress: only events for THIS incident matter
  const mine = (d: AnalysisRealtimeData) => d.incidentId === incidentId;
  useSocketEvent<AnalysisRealtimeData>('ai.analysis_started', (d) => {
    if (!mine(d) || !d.analysis) return;
    setLatest(d.analysis);
    setStep('collecting_context');
  });
  useSocketEvent<AnalysisRealtimeData>('ai.analysis_progress', (d) => {
    if (mine(d) && d.step) setStep(d.step);
  });
  useSocketEvent<AnalysisRealtimeData>('ai.analysis_completed', (d) => {
    if (!mine(d) || !d.analysis) return;
    setLatest(d.analysis);
    setStep(null);
  });
  useSocketEvent<AnalysisRealtimeData>('ai.analysis_failed', (d) => {
    if (!mine(d) || !d.analysis) return;
    setLatest(d.analysis);
    setStep(null);
  });

  async function start() {
    setError(null);
    setStarting(true);
    try {
      await api(`/api/incidents/${incidentId}/ai-analysis`, { method: 'POST' });
      setStep(null);
      await load(); // shows QUEUED immediately; sockets take over from here
    } catch (e) {
      toast.error(e, 'Could not start the analysis.');
    } finally {
      setStarting(false);
    }
  }

  const running = isActive(latest);
  return (
    <section
      aria-labelledby="ai-heading"
      className="rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="ai-heading" className="text-base font-semibold">
          AI analysis
        </h2>
        {canRun && latest?.status !== 'FAILED' && (
          <Button
            variant={latest?.status === 'COMPLETED' ? 'secondary' : 'primary'}
            onClick={start}
            loading={starting || running}
            loadingText={running ? 'Analyzing…' : 'Starting…'}
          >
            {latest?.status === 'COMPLETED' ? 'Analyze again' : 'Analyze with AI'}
          </Button>
        )}
      </div>

      {error && !latest && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      {loading && !latest && <p className="text-sm text-ink-subtle">Loading…</p>}
      {!loading && !latest && !error && (
        <p className="text-sm text-ink-muted">
          Reads this incident&apos;s logs, deployments and metrics, plus your runbooks, and suggests
          likely causes and next steps.
        </p>
      )}
      {latest && running && <Progress step={step} status={latest.status} />}
      {latest?.status === 'COMPLETED' && latest.result && <ResultCard a={latest} />}
      {latest?.status === 'FAILED' && (
        <div
          role="alert"
          className="space-y-3 rounded-md border border-danger-line bg-danger-bg p-3"
        >
          <p className="text-sm font-medium text-danger-fg">The analysis could not be completed.</p>
          <p className="text-sm text-danger-fg">{latest.error?.message}</p>
          <p className="text-xs text-danger-fg">
            Error code: {latest.error?.code}. The rest of this incident works normally.
          </p>
          {canRun && (
            <Button onClick={start} loading={starting} loadingText="Starting…">
              Try again
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
