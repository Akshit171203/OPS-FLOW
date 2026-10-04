'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  GitCommitHorizontal,
  MessageSquare,
  Pause,
  Play,
  Rocket,
  Siren,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { LifecycleStepper } from './LifecycleStepper';
import { SeverityBadge, StatusBadge } from './ui';

const SLIDE_MS = 6000;

/** One slide: a miniature of a real screen, plus the headline that explains it. */
const slides = [
  {
    title: 'Alerts become incidents, automatically',
    text: 'Connect Alertmanager, Grafana or a plain webhook. OpsFlow opens the incident and links the deploy that caused it.',
    visual: <AlertVisual />,
  },
  {
    title: 'AI that reads the evidence',
    text: 'Logs, metrics and your own runbooks, searched for you, with likely causes and how confident the answer is.',
    visual: <AnalysisVisual />,
  },
  {
    title: 'One live timeline for the whole team',
    text: 'Assign, discuss and resolve together. Every change is recorded in the timeline and the audit trail.',
    visual: <TimelineVisual />,
  },
] as const;

function Window({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[26rem] overflow-hidden rounded-2xl border border-white/10 bg-[#101218] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]">
      <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-3 text-[11px] text-white/40">{title}</span>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

const item = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: 0.12 + i * 0.12, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
});

function AlertVisual() {
  return (
    <Window title="OpsFlow · Incidents">
      <motion.div
        {...item(0)}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-sev1-bg text-sev1-fg">
          <Siren className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">Alertmanager</p>
          <p className="text-xs text-white/45">HighErrorRate · payment-service · firing</p>
        </div>
        <span className="text-[11px] text-white/40">just now</span>
      </motion.div>
      <motion.div
        {...item(1)}
        className="mx-auto h-5 w-px bg-gradient-to-b from-white/25 to-transparent"
      />
      <motion.div {...item(2)} className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
        <div className="flex items-center gap-2">
          <SeverityBadge value="SEV1" />
          <StatusBadge value="OPEN" />
          <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-ink">
            Alert
          </span>
        </div>
        <p className="mt-2.5 text-sm font-medium text-white">
          Payment failures spiking after v2.4.0 rollout
        </p>
        <p className="mt-0.5 text-xs text-white/45">Payment Service · opened by alert</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-white/70">
          <Rocket className="h-3.5 w-3.5 text-accent-ink" />
          Linked deployment <span className="font-mono text-white">v2.4.0</span>
          <span className="ml-auto text-white/40">15 min before</span>
        </div>
      </motion.div>
    </Window>
  );
}

function AnalysisVisual() {
  return (
    <Window title="OpsFlow · AI analysis">
      <motion.p
        {...item(0)}
        className="flex items-center gap-1.5 text-xs font-medium text-accent-ink"
      >
        <Sparkles className="h-3.5 w-3.5" /> Possible causes
      </motion.p>
      {[
        { t: 'Database connection pool exhaustion', v: 82 },
        { t: 'Regression introduced by deployment v2.4.0', v: 74 },
      ].map((c, i) => (
        <motion.div
          key={c.t}
          {...item(i + 1)}
          className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
        >
          <div className="flex items-center justify-between gap-3 text-sm text-white">
            <span className="min-w-0 truncate">{c.t}</span>
            <span className="text-xs tabular-nums text-white/50">{c.v}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${c.v}%` }}
              transition={{ delay: 0.5 + i * 0.15, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full bg-gradient-to-r from-accent-600 to-[#8b5cf6]"
            />
          </div>
        </motion.div>
      ))}
      <motion.div
        {...item(3)}
        className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs text-white/70"
      >
        <Activity className="h-3.5 w-3.5 text-accent-ink" />
        Runbook: <span className="text-white">Payment service troubleshooting</span>
      </motion.div>
    </Window>
  );
}

function TimelineVisual() {
  const events = [
    { icon: Siren, who: 'Alertmanager', what: 'opened the incident', when: '3 min ago' },
    {
      icon: GitCommitHorizontal,
      who: 'Erin',
      what: 'moved it to Investigating',
      when: '2 min ago',
    },
    { icon: MessageSquare, who: 'Adam', what: 'commented: rolling back v2.4.0', when: '1 min ago' },
  ];
  return (
    <Window title="OpsFlow · Incident timeline">
      <motion.div {...item(0)}>
        <LifecycleStepper status="INVESTIGATING" wrap />
      </motion.div>
      {events.map((e, i) => (
        <motion.div
          key={e.what}
          {...item(i + 1)}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2.5"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-accent-ink">
            <e.icon className="h-3.5 w-3.5" />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-white/90">
            <strong className="font-medium text-white">{e.who}</strong> {e.what}
          </p>
          <span className="shrink-0 text-[11px] text-white/40">{e.when}</span>
        </motion.div>
      ))}
    </Window>
  );
}

/**
 * Left half of the sign-in screen: three slides that advance by themselves, with the usual carousel
 * controls (dots, and a pause button because moving content must be stoppable). It starts paused when
 * the visitor asks for reduced motion, and pauses while the pointer or keyboard focus is on it.
 */
export function AuthCarousel() {
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced.current) setUserPaused(true);
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

  return (
    <section
      aria-roledescription="carousel"
      aria-label="What OpsFlow does"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocusCapture={() => setHovering(true)}
      onBlurCapture={() => setHovering(false)}
      className="dark relative hidden overflow-hidden bg-black text-white lg:block"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-accent-600/25 blur-3xl motion-safe:animate-drift" />
        <div className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-sky-500/15 blur-3xl motion-safe:animate-drift [animation-delay:-9s]" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at 50% 35%, #000, transparent 70%)',
          }}
        />
      </div>

      <div className="relative flex h-full min-h-screen flex-col px-12 py-10">
        <div className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-accent-600 to-[#8b5cf6] shadow-[0_0_24px_-4px_rgb(99_91_255/0.8)]"
          >
            <Activity className="h-4 w-4 text-white" strokeWidth={2.6} />
          </span>
          OpsFlow
        </div>

        <div
          className="relative flex flex-1 items-center justify-center py-8"
          aria-live={paused ? 'polite' : 'off'}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${slides.length}`}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -40 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="flex w-full flex-col items-center"
            >
              <div className="flex h-[24rem] w-full items-center justify-center" aria-hidden="true">
                {slides[index]!.visual}
              </div>
              <h2 className="mt-8 max-w-md text-center text-3xl font-semibold leading-tight tracking-tight">
                {slides[index]!.title}
              </h2>
              <p className="mt-3 max-w-md text-center text-[15px] leading-relaxed text-white/60">
                {slides[index]!.text}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.title}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show slide ${i + 1}: ${s.title}`}
                aria-current={i === index ? 'true' : undefined}
                className={`relative h-2 overflow-hidden rounded-full bg-white/25 transition-all duration-300 ${i === index ? 'w-10' : 'w-2 hover:bg-white/50'}`}
              >
                {i === index && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 rounded-full bg-white"
                    style={{
                      width: `${paused && !userPaused ? Math.max(progress, 0.02) * 100 : progress * 100}%`,
                    }}
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
      </div>
    </section>
  );
}
