'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BellRing,
  BookOpen,
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

const SLIDE_MS = 6000;

/* ---------- small widgets: white cards, like the dashboards they stand for ---------- */

const card =
  'last:[@media(max-height:820px)]:hidden theme-light auth-blue w-[11rem] shrink-0 xl:w-[13.5rem] rounded-xl bg-surface p-3 text-ink shadow-[0_10px_30px_-8px_rgb(0_0_0/0.6)]';

function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <p className="text-[12px] font-semibold leading-tight">{title}</p>
      {sub && <p className="mt-0.5 text-[10px] text-ink-subtle">{sub}</p>}
    </>
  );
}

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => i.value));
  return (
    <div className="mt-3 flex h-20 items-end gap-3">
      {items.map((i, n) => (
        <div key={i.label} className="flex flex-1 flex-col items-center justify-end gap-1">
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: Math.round((i.value / max) * 64) }}
            transition={{ delay: 0.5 + n * 0.1, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="w-full rounded-t bg-accent-600"
          />
          <span className="text-[8px] text-ink-subtle">{i.label}</span>
        </div>
      ))}
    </div>
  );
}

function Spark({ color = '#dc2626' }: { color?: string }) {
  return (
    <svg viewBox="0 0 120 32" className="mt-2 h-8 w-full" fill="none" aria-hidden="true">
      <path
        d="M0 26 L12 24 L24 27 L36 22 L48 25 L60 20 L72 23 L84 12 L96 8 L108 4 L120 3"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Donut({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mt-2 grid h-[4.5rem] w-[4.5rem] place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-skeleton)" strokeWidth="6" />
        <motion.circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="var(--color-accent-600)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ delay: 0.6, duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="text-sm font-semibold tabular-nums">{value}%</span>
    </div>
  );
}

function Row({ icon: Icon, text, sub }: { icon: LucideIcon; text: string; sub: string }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-ink">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium leading-tight">{text}</p>
        <p className="text-[9px] text-ink-subtle">{sub}</p>
      </div>
    </div>
  );
}

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
    heading: 'Automate response',
    icons: [Siren, Webhook, Rocket, Server, GitCommitHorizontal, BellRing],
    title: 'Alerts become incidents, automatically',
    text: 'Connect Alertmanager, Grafana or any webhook. OpsFlow opens the incident and links the deploy that caused it.',
    widgets: (
      <>
        <div className={card}>
          <CardTitle title="Alerts by source" sub="Last 24 hours" />
          <Bars
            items={[
              { label: 'Prom', value: 14 },
              { label: 'Grafana', value: 9 },
              { label: 'Hook', value: 5 },
            ]}
          />
        </div>
        <div className={card}>
          <CardTitle title="Error rate" sub="payment-service" />
          <p className="mt-1 text-xl font-semibold tabular-nums">34.0%</p>
          <Spark />
        </div>
        <div className={card}>
          <CardTitle title="Linked deployment" />
          <Row icon={Rocket} text="v2.4.0 · production" sub="15 min before the incident" />
        </div>
      </>
    ),
  },
  {
    heading: 'Find the cause',
    icons: [Sparkles, FileSearch, BookOpen, Activity, ShieldCheck, Clock],
    title: 'AI that reads the evidence',
    text: 'Logs, metrics and your own runbooks, searched for you, with likely causes and how confident the answer is.',
    widgets: (
      <>
        <div className={card}>
          <CardTitle title="Possible causes" sub="Ranked by confidence" />
          {[
            ['Connection pool', 82],
            ['Regression v2.4.0', 74],
          ].map(([l, v], i) => (
            <div key={l} className="mt-2.5">
              <div className="flex justify-between text-[10px]">
                <span>{l}</span>
                <span className="tabular-nums text-ink-subtle">{v}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-skeleton">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${v}%` }}
                  transition={{ delay: 0.5 + i * 0.15, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full bg-accent-600"
                />
              </div>
            </div>
          ))}
        </div>
        <div className={card}>
          <CardTitle title="Overall confidence" />
          <Donut value={82} />
        </div>
        <div className={card}>
          <CardTitle title="Runbook match" />
          <Row
            icon={BookOpen}
            text="Payment service troubleshooting"
            sub="Best match from your runbooks"
          />
        </div>
      </>
    ),
  },
  {
    heading: 'Resolve together',
    icons: [Users, MessageSquare, UserCheck, CheckCircle2, History, Clock],
    title: 'One live timeline for the whole team',
    text: 'Assign, discuss and resolve together. Every change is recorded in the timeline and the audit trail.',
    widgets: (
      <>
        <div className={card}>
          <CardTitle title="Incident lifecycle" sub="Investigating" />
          <div className="mt-3 flex items-center">
            {['Open', 'Inv.', 'Mit.', 'Res.', 'Closed'].map((s, i) => (
              <div key={s} className="flex flex-1 items-center last:flex-none">
                <span
                  className={`grid h-4 w-4 place-items-center rounded-full text-[7px] font-semibold ${
                    i < 1
                      ? 'bg-accent-600 text-white'
                      : i === 1
                        ? 'bg-accent-soft text-accent-ink ring-2 ring-accent-600'
                        : 'bg-skeleton text-ink-subtle'
                  }`}
                >
                  {i + 1}
                </span>
                {i < 4 && (
                  <span className={`h-px flex-1 ${i < 1 ? 'bg-accent-600' : 'bg-line-strong'}`} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[8px] text-ink-subtle">
            <span>Open</span>
            <span>Closed</span>
          </div>
        </div>
        <div className={card}>
          <CardTitle title="Avg. resolution" sub="Last 7 days" />
          <p className="mt-1 text-xl font-semibold tabular-nums">40m</p>
          <Spark color="#16a34a" />
        </div>
        <div className={card}>
          <CardTitle title="Timeline" />
          <Row icon={Siren} text="Alertmanager opened it" sub="3 min ago" />
          <Row icon={MessageSquare} text="Adam: rolling back v2.4.0" sub="1 min ago" />
        </div>
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
            <div className="absolute inset-x-[11%] top-[14%] bottom-[-30%] rounded-tl-[3rem] border-l-[3px] border-t-[3px] border-white/25 bg-[#1b1b1d] shadow-[inset_0_0_80px_rgb(0_0_0/0.5)]">
              <span className="absolute left-1/2 top-3 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-white/20" />
              <span className="absolute left-[18%] top-[-3px] h-[3px] w-24 rounded-b bg-white/35" />
              <span className="absolute left-[40%] top-[-3px] h-[3px] w-24 rounded-b bg-white/35" />

              <div className="absolute inset-0 overflow-hidden rounded-tl-[3rem]">
                <div className="absolute left-[8%] top-[24%] w-[84%]">
                  <h2 className="max-w-[46%] text-[clamp(1.9rem,3.3vw,3.6rem)] font-semibold leading-[1.04] tracking-tight">
                    {slide.heading}
                  </h2>
                  <div className="mt-[clamp(1.5rem,5vh,3.5rem)] flex gap-x-[clamp(0.7rem,1.35vw,1.4rem)] [@media(max-height:760px)]:hidden">
                    {slide.icons.map((Icon, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.25 + i * 0.06 }}
                      >
                        <Icon
                          className="h-[clamp(1.4rem,2vw,2.1rem)] w-[clamp(1.4rem,2vw,2.1rem)] text-white"
                          strokeWidth={2}
                        />
                      </motion.span>
                    ))}
                  </div>
                </div>

                <div className="absolute right-[-2.75rem] top-3 flex flex-col gap-3">
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
