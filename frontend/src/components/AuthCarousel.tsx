'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BellRing,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  FileSearch,
  GitCommitHorizontal,
  History,
  MessageSquare,
  Pause,
  Play,
  Rocket,
  Server,
  ShieldCheck,
  Siren,
  Sparkles,
  UserCheck,
  Users,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { incidentStatuses } from '@opsflow/shared';
import { StatusDot } from './StatusDot';
import { SeverityBadge, StatusBadge } from './ui';

const SLIDE_MS = 6000;

/* ---------- widgets: miniatures of OpsFlow's own screens, on white cards ---------- */

const card =
  'theme-light auth-blue w-[12.5rem] shrink-0 rounded-xl bg-surface p-3 pr-12 text-ink shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)] xl:w-[15rem]';

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <p className="text-[12px] font-semibold leading-tight">{title}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-subtle">{sub}</p>}
    </>
  );
}

const legendColor = {
  accent: 'bg-accent-600',
  ok: 'bg-dot-ok',
  warn: 'bg-dot-warn',
  bad: 'bg-dot-bad',
} as const;

const LegendMini = ({
  title,
  items,
}: {
  title: string;
  items: readonly (readonly [string, keyof typeof legendColor])[];
}) => (
  <div className={card}>
    <CardTitle title={title} />
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
      {items.map(([label, color]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`h-0.5 w-3 rounded-full ${legendColor[color]}`} />
          {label}
        </li>
      ))}
    </ul>
  </div>
);

const IncidentMini = () => (
  <div className={card}>
    <div className="flex flex-wrap items-center gap-1">
      <SeverityBadge value="SEV1" />
      <StatusBadge value="OPEN" />
    </div>
    <p className="mt-2 text-[12px] font-semibold leading-snug">
      Payment failures spiking after v2.4.0 rollout
    </p>
    <p className="mt-1 text-[10px] text-ink-subtle">Payment Service · opened by alert</p>
  </div>
);

const HealthMini = () => (
  <div className={card}>
    <CardTitle title="Service health" />
    <ul className="mt-2 space-y-1.5">
      {(
        [
          ['Auth Service', 'HEALTHY'],
          ['Payment Service', 'DEGRADED'],
          ['Order Service', 'HEALTHY'],
        ] as const
      ).map(([name, status]) => (
        <li key={name} className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1.5">
            <StatusDot status={status} />
            {name}
          </span>
          <span className="text-[9px] uppercase tracking-wide text-ink-subtle">{status}</span>
        </li>
      ))}
    </ul>
  </div>
);

const DeployMini = () => (
  <div className={card}>
    <CardTitle title="Linked deployment" />
    <div className="mt-2 flex items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-muted">
        <Rocket className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium">
          Payment Service <span className="font-mono text-[10px] text-ink-muted">v2.4.0</span>
        </p>
        <p className="text-[9px] text-ink-subtle">production · 15 min before the incident</p>
      </div>
    </div>
  </div>
);

const CausesMini = () => (
  <div className={card}>
    <p className="flex items-center gap-1 text-[12px] font-semibold">
      <Sparkles className="h-3 w-3 text-accent-ink" /> AI analysis
    </p>
    <p className="mt-0.5 text-[10px] text-ink-subtle">Possible causes</p>
    {(
      [
        ['Connection pool exhaustion', 82],
        ['Regression from deployment v2.4.0', 74],
      ] as const
    ).map(([cause, pct], i) => (
      <div key={cause} className="mt-2">
        <div className="flex gap-2 text-[10px]">
          <span className="truncate">{cause}</span>
          <span className="tabular-nums text-ink-subtle">{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-skeleton">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ delay: 0.5 + i * 0.15, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="h-full rounded-full bg-accent-600"
          />
        </div>
      </div>
    ))}
  </div>
);

const EvidenceMini = () => (
  <div className={card}>
    <CardTitle title="Evidence" sub="Logs and metrics" />
    <div className="mt-2 rounded-md bg-surface-2 p-2 font-mono text-[9px] leading-snug">
      <span className="mr-1 rounded bg-down-bg px-1 py-px text-[8px] font-semibold text-down-fg">
        ERROR
      </span>
      Connection pool exhausted: active=50 max=50 waiting=60
    </div>
    <p className="mt-2 text-[10px] text-ink-muted">
      Error rate <b className="text-ink">34.0%</b> · Latency <b className="text-ink">5200 ms</b>
    </p>
  </div>
);

const StepsMini = () => (
  <div className={card}>
    <CardTitle title="Suggested next steps" />
    <ol className="mt-2 list-decimal space-y-1 pl-4 text-[10px] leading-snug">
      <li>Review what v2.4.0 changed</li>
      <li>Roll back v2.4.0 (needs approval)</li>
      <li>Check active connections</li>
    </ol>
  </div>
);

const MetricsMini = () => (
  <div className={card}>
    <CardTitle title="Payment Service" sub="Latest metrics" />
    <div className="mt-2 grid grid-cols-3 gap-1 text-[9px] text-ink-subtle">
      <div>
        Error rate<b className="mt-0.5 block text-[12px] text-sev1-fg">34.0%</b>
      </div>
      <div>
        Latency<b className="mt-0.5 block text-[12px] text-ink">5200 ms</b>
      </div>
      <div>
        Traffic<b className="mt-0.5 block text-[12px] text-ink">410/min</b>
      </div>
    </div>
    <svg viewBox="0 0 120 26" className="mt-2 h-6 w-full" fill="none" aria-hidden="true">
      <path
        d="M0 22 L14 21 L28 23 L42 19 L56 20 L70 16 L84 9 L98 6 L120 3"
        stroke="var(--color-dot-bad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

const RunbookMini = () => (
  <div className={card}>
    <CardTitle title="Runbook match" />
    <div className="mt-2 flex items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        <BookOpen className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium">Payment service troubleshooting</p>
        <p className="text-[9px] text-ink-subtle">Indexed · best match for this incident</p>
      </div>
    </div>
  </div>
);

const RespondersMini = () => (
  <div className={card}>
    <CardTitle title="Responders" sub="Assigned and watching" />
    <ul className="mt-2 space-y-1.5">
      {(
        [
          ['Adam Admin', 'Assignee'],
          ['Erin Engineer', 'Investigating'],
        ] as const
      ).map(([name, role]) => (
        <li key={name} className="flex items-center gap-2 text-[11px]">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-600 text-[8px] font-semibold text-white">
            {name
              .split(' ')
              .map((w) => w[0])
              .join('')}
          </span>
          <span className="flex-1 truncate">{name}</span>
          <span className="text-[9px] text-ink-subtle">{role}</span>
        </li>
      ))}
    </ul>
  </div>
);

const LifecycleMini = () => {
  const current = incidentStatuses.indexOf('INVESTIGATING');
  return (
    <div className={card}>
      <CardTitle title="Lifecycle" sub="Investigating" />
      <ol className="mt-3 flex items-center" aria-hidden="true">
        {incidentStatuses.map((st, i) => (
          <li key={st} className="flex flex-1 items-center last:flex-none">
            <span
              className={`grid h-4 w-4 place-items-center rounded-full ${
                i < current
                  ? 'bg-resolved-bg text-resolved-fg'
                  : i === current
                    ? 'bg-accent-600 text-white ring-2 ring-accent-600/30'
                    : 'bg-skeleton text-ink-subtle'
              }`}
            >
              {i < current ? (
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
              ) : (
                <span className="h-1 w-1 rounded-full bg-current" />
              )}
            </span>
            {i < incidentStatuses.length - 1 && (
              <span
                className={`h-px flex-1 ${i < current ? 'bg-resolved-fg/50' : 'bg-line-strong'}`}
              />
            )}
          </li>
        ))}
      </ol>
      <div className="mt-1.5 flex justify-between text-[8px] text-ink-subtle">
        <span>Open</span>
        <span>Closed</span>
      </div>
    </div>
  );
};

const TimelineMini = () => (
  <div className={card}>
    <CardTitle title="Timeline" />
    <ul className="mt-2 space-y-2">
      {(
        [
          [Siren, 'Alertmanager', 'opened the incident', '3 min ago'],
          [Rocket, 'Adam', 'linked deployment v2.4.0', '2 min ago'],
          [Sparkles, 'Erin', 'finished an AI analysis', '1 min ago'],
        ] as const
      ).map(([Icon, who, what, when]) => (
        <li key={what} className="flex items-start gap-2">
          <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line-strong text-accent-ink">
            <Icon className="h-2.5 w-2.5" />
          </span>
          <p className="min-w-0 text-[10px] leading-snug">
            <b className="font-medium">{who}</b> <span className="text-ink-muted">{what}</span>
            <span className="block text-[9px] text-ink-subtle">{when}</span>
          </p>
        </li>
      ))}
    </ul>
  </div>
);

const CommentMini = () => (
  <div className={card}>
    <CardTitle title="Comments" />
    <div className="mt-2 flex items-start gap-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-600 text-[8px] font-semibold text-white">
        AA
      </span>
      <p className="rounded-lg bg-surface-2 px-2 py-1.5 text-[10px] leading-snug">
        Rolling back v2.4.0 now, will confirm the error rate drops.
      </p>
    </div>
  </div>
);

/* ---------- the three slides ---------- */

interface Slide {
  heading: string;
  icons: LucideIcon[];
  title: string;
  text: string;
  widgets: React.ReactNode;
}

const slides: Slide[] = [
  {
    heading: 'Zero triage',
    icons: [Siren, Webhook, Rocket, Server, GitCommitHorizontal, BellRing],
    title: 'Alerts become incidents, automatically',
    text: 'Connect Alertmanager, Grafana or any webhook. OpsFlow opens the incident and links the deploy that caused it.',
    widgets: (
      <>
        <LegendMini
          title="Alert sources"
          items={[
            ['Alertmanager', 'accent'],
            ['Grafana', 'ok'],
            ['Webhook', 'warn'],
            ['Deploy hook', 'bad'],
          ]}
        />
        <IncidentMini />
        <HealthMini />
        <DeployMini />
        <MetricsMini />
      </>
    ),
  },
  {
    heading: 'Causes, ranked',
    icons: [Sparkles, FileSearch, BookOpen, Activity, ShieldCheck, Clock],
    title: 'AI that reads the evidence',
    text: 'Logs, metrics and your own runbooks, searched for you, with likely causes and how confident the answer is.',
    widgets: (
      <>
        <LegendMini
          title="Evidence sources"
          items={[
            ['Logs', 'bad'],
            ['Metrics', 'accent'],
            ['Runbooks', 'ok'],
            ['Deployments', 'warn'],
          ]}
        />
        <CausesMini />
        <EvidenceMini />
        <StepsMini />
        <RunbookMini />
      </>
    ),
  },
  {
    heading: 'Shared timeline',
    icons: [Users, MessageSquare, UserCheck, CheckCircle2, History, Clock],
    title: 'Everyone sees the same incident, live',
    text: 'Assign, discuss and resolve together. Every change is recorded in the timeline and the audit trail.',
    widgets: (
      <>
        <LegendMini
          title="Roles"
          items={[
            ['Owner', 'accent'],
            ['Admin', 'ok'],
            ['Engineer', 'warn'],
            ['Viewer', 'bad'],
          ]}
        />
        <LifecycleMini />
        <TimelineMini />
        <CommentMini />
        <RespondersMini />
      </>
    ),
  },
];

/**
 * Left half of the sign-in screen. Black stage, a tablet-style frame with big overlay text, a row
 * of icons and cropped dashboard widgets, then a caption and the slide dots. Three slides advance
 * by themselves; hovering or focusing pauses them, there is a pause button, and reduced-motion
 * visitors start paused.
 */
export function AuthCarousel() {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setUserPaused(true);
  }, []);

  // Elapsed time lives in a ref so the timer callback has no side effects inside a state updater
  // (those run twice in React strict mode and would skip a slide).
  const elapsed = useRef(0);
  const go = useCallback((i: number) => {
    elapsed.current = 0;
    setProgress(0);
    setIndex((i + slides.length) % slides.length);
  }, []);

  const paused = userPaused || hovering;
  useEffect(() => {
    if (paused) return;
    const tick = 60;
    const id = window.setInterval(() => {
      elapsed.current += tick;
      if (elapsed.current >= SLIDE_MS) {
        elapsed.current = 0;
        setProgress(0);
        setIndex((i) => (i + 1) % slides.length);
      } else {
        setProgress(elapsed.current / SLIDE_MS);
      }
    }, tick);
    return () => window.clearInterval(id);
  }, [paused]);

  const slide = slides[index]!;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What OpsFlow does"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
      className="relative hidden min-h-screen flex-col overflow-hidden bg-black text-white lg:flex"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          role="group"
          aria-roledescription="slide"
          aria-label={`${index + 1} of ${slides.length}`}
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -36 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col"
        >
          {/* stage: the tablet frame is taller than the stage, so its bottom is cropped */}
          <div className="relative flex-1 overflow-hidden" aria-hidden="true">
            <div className="absolute inset-x-[7%] top-[10%] bottom-[-34%] rounded-tl-[3.25rem] border-l-[3px] border-t-[3px] border-white/25 bg-[#1b1b1d] shadow-[inset_0_0_80px_rgb(0_0_0/0.5)]">
              <span className="absolute left-1/2 top-3.5 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/20" />
              <span className="absolute left-[18%] top-[-3px] h-[3px] w-28 rounded-b bg-white/35" />
              <span className="absolute left-[42%] top-[-3px] h-[3px] w-28 rounded-b bg-white/35" />

              <div className="absolute inset-0 flex overflow-hidden rounded-tl-[3.25rem]">
                <div className="flex min-w-0 flex-1 flex-col justify-center pb-[18%] pl-[7%] pr-6">
                  <h2 className="text-[clamp(2rem,3.7vw,4rem)] font-semibold leading-[1.04] tracking-tight">
                    {slide.heading}
                  </h2>
                  <div className="mt-[clamp(1.75rem,6vh,4rem)] flex justify-between [@media(max-height:700px)]:hidden">
                    {slide.icons.map((Icon, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + i * 0.06 }}
                      >
                        <Icon
                          className="h-[clamp(1.2rem,1.8vw,1.9rem)] w-[clamp(1.2rem,1.8vw,1.9rem)] text-white"
                          strokeWidth={2}
                        />
                      </motion.span>
                    ))}
                  </div>
                </div>

                <div className="-mr-12 -mt-9 flex shrink-0 flex-col gap-3 xl:-mr-14">
                  {slide.widgets}
                </div>
              </div>
            </div>
          </div>

          <div className="px-12 pb-3 pt-7 text-center">
            <h3 className="text-[1.65rem] font-semibold leading-tight tracking-tight">
              {slide.title}
            </h3>
            <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed text-white/75">
              {slide.text}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-center gap-3 pb-9 pt-3">
        <div className="flex items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show slide ${i + 1}: ${s.title}`}
              aria-current={i === index ? 'true' : undefined}
              className={`relative h-2 overflow-hidden rounded-full transition-all duration-300 ${
                i === index ? 'w-12 bg-white/30' : 'w-2.5 bg-white/45 hover:bg-white/70'
              }`}
            >
              {i === index && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-full bg-white"
                  style={{ width: `${Math.max(progress, 0.06) * 100}%` }}
                />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setUserPaused((p) => !p)}
          aria-label={userPaused ? 'Play slideshow' : 'Pause slideshow'}
          className="grid h-7 w-7 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          {userPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      </div>
    </section>
  );
}
