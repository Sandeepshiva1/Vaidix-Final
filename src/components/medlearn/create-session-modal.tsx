'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SessionType } from '@prisma/client';
import styles from './medlearn.module.css';
import { createTeachingSessionAction } from './actions';
import { IconArrowRight, IconArrowLeft, IconCheckBare, IconClose } from './icons';

interface Props {
  onClose: () => void;
}

type Step = 0 | 1 | 2;

const LEVELS = ['Interns', 'Residents', 'Specialists', 'Mixed'] as const;
const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: SessionType.LECTURE, label: 'Lecture' },
  { value: SessionType.GRAND_ROUNDS, label: 'Grand Rounds' },
  { value: SessionType.CASE_CONFERENCE, label: 'Case Conference' },
  { value: SessionType.JOURNAL_CLUB, label: 'Journal Club' },
  { value: SessionType.SKILLS_WORKSHOP, label: 'Skills Workshop' },
  { value: SessionType.ASSESSMENT, label: 'Assessment' },
];

export function CreateSessionModal({ onClose }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState(() => defaultStart());
  const [sessionType, setSessionType] = useState<SessionType>(SessionType.LECTURE);
  const [duration, setDuration] = useState(60);
  const [expectedLearners, setExpectedLearners] = useState(20);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('Residents');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canAdvanceStep0 = title.trim().length > 0;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createTeachingSessionAction({
        title,
        scheduledStart: new Date(scheduledAt).toISOString(),
        durationMinutes: duration,
        sessionType,
        expectedLearners,
        learnerLevel: level,
      });
      if (!result.ok) { setError(result.error); return; }
      setCreatedId(result.sessionId);
      setStep(2);
    });
  };

  return (
    <div className={styles.modalScrim} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="cs-title" onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className={styles.modalDots}>
              <span className={`${styles.modalDot} ${step >= 0 ? styles.modalDotActive : ''}`} />
              <span className={`${styles.modalDot} ${step >= 1 ? styles.modalDotActive : ''}`} />
              <span className={`${styles.modalDot} ${step >= 2 ? styles.modalDotActive : ''}`} />
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.btnGhost} style={{ padding: 4, minHeight: 32, minWidth: 32 }}>
              <IconClose size={18} />
            </button>
          </div>
          <h2 id="cs-title" className={styles.modalTitle}>
            {step === 0 && "What's this session about?"}
            {step === 1 && 'Who are your learners?'}
            {step === 2 && "You're all set"}
          </h2>
        </header>

        <div className={styles.modalBody}>
          {step === 0 && (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="cs-title-input">Session title</label>
                <input
                  ref={titleRef}
                  id="cs-title-input"
                  className={styles.input}
                  placeholder="e.g. Cardiac Anatomy for Interns"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="cs-date">Date &amp; time</label>
                <input
                  id="cs-date"
                  type="datetime-local"
                  className={styles.input}
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="cs-type">Specialty</label>
                <select id="cs-type" className={styles.select} value={sessionType} onChange={(e) => setSessionType(e.target.value as SessionType)}>
                  {SESSION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="cs-dur">Duration (minutes)</label>
                <input
                  id="cs-dur"
                  type="number"
                  min={15}
                  max={360}
                  step={15}
                  className={styles.input}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value) || 60)}
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="cs-num">Expected number of learners</label>
                <input
                  id="cs-num"
                  type="number"
                  min={1}
                  className={styles.input}
                  value={expectedLearners}
                  onChange={(e) => setExpectedLearners(Number(e.target.value) || 0)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="cs-lvl">Learner level</label>
                <select id="cs-lvl" className={styles.select} value={level} onChange={(e) => setLevel(e.target.value as (typeof LEVELS)[number])}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <p className={styles.body} style={{ marginTop: 8 }}>You can invite specific learners later — share a link or send invites from the Pre-Conference screen.</p>
            </>
          )}

          {step === 2 && (
            <div className={styles.successWrap}>
              <div className={styles.successRing} aria-hidden><IconCheckBare size={32} /></div>
              <div>
                <p className={styles.modalTitle} style={{ marginBottom: 6 }}>{title} is ready.</p>
                <p className={styles.body}>What would you like to do next?</p>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" style={{ color: 'var(--error)', fontFamily: 'var(--font-jakarta), system-ui, sans-serif', fontSize: 14, margin: 0 }}>
              {error}
            </p>
          )}
        </div>

        <footer className={styles.modalFooter}>
          {step === 0 && (
            <>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>Cancel</button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!canAdvanceStep0} onClick={() => setStep(1)}>
                <span>Next</span>
                <IconArrowRight size={16} />
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setStep(0)}>
                <IconArrowLeft size={16} />
                <span>Back</span>
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pending} onClick={submit}>
                {pending ? 'Creating…' : 'Create Session'}
              </button>
            </>
          )}
          {step === 2 && createdId && (
            <>
              <button type="button" className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => { onClose(); router.refresh(); }}>
                I&apos;ll prepare later
              </button>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => router.push(`/session/${createdId}/pre`)}>
                <span>Set Up Session Now</span>
                <IconArrowRight size={16} />
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function defaultStart(): string {
  // Default to next round 30-min slot, formatted for datetime-local.
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30 - (d.getMinutes() % 30), 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
