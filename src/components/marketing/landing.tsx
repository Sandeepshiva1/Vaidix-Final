'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { DM_Sans, Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';
import styles from './landing.module.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['700'],
  display: 'swap',
  variable: '--font-dm-sans',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['700'],
  style: ['italic'],
  display: 'swap',
  variable: '--font-playfair',
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-jakarta',
});

type Role = 'presenters' | 'learners' | 'moderators' | 'administrators';

const ROLE_CONTENT: Record<
  Role,
  {
    title: string;
    subtitle: string;
    features: { icon: 'sparkle' | 'chart' | 'chat' | 'cap' | 'people' | 'gear' | 'shield' | 'map' | 'pulse'; title: string; body: string }[];
  }
> = {
  presenters: {
    title: 'For Presenters',
    subtitle: 'Teaching intelligence that enhances your expertise',
    features: [
      {
        icon: 'sparkle',
        title: 'Smart Slide Intelligence',
        body: 'AI analyzes your presentation and suggests engagement hooks, discussion prompts, and case integration points.',
      },
      {
        icon: 'chart',
        title: 'Attention Analytics',
        body: 'Real-time feedback on learner engagement with prompts to adjust pacing or introduce interactive elements.',
      },
      {
        icon: 'chat',
        title: 'Question Orchestration',
        body: 'Pre-submitted questions ranked by relevance, with AI-suggested answers and discussion frameworks.',
      },
    ],
  },
  learners: {
    title: 'For Learners',
    subtitle: 'A continuous learning journey that adapts to you',
    features: [
      {
        icon: 'cap',
        title: 'Personalized Pathways',
        body: 'Adaptive pre-session priming, in-class hooks, and spaced reinforcement tuned to your readiness score.',
      },
      {
        icon: 'pulse',
        title: 'Live Engagement',
        body: 'Polls, breakout rooms, and a clinical AI assistant available the moment a concept feels unclear.',
      },
      {
        icon: 'sparkle',
        title: 'Reflection & Mastery',
        body: 'Microlearning pearls, error-replay simulations, and competency dashboards across Head, Heart, Hands.',
      },
    ],
  },
  moderators: {
    title: 'For Moderators',
    subtitle: 'Facilitation tools that keep every session on the rails',
    features: [
      {
        icon: 'people',
        title: 'Room Orchestration',
        body: 'Drag-and-drop breakout assignment by specialty, performance, or participation pattern in one tap.',
      },
      {
        icon: 'chat',
        title: 'Question Triage',
        body: 'AI clusters incoming questions, flags urgency, and surfaces the top concerns for the presenter.',
      },
      {
        icon: 'shield',
        title: 'Engagement Safeguards',
        body: 'Anonymous polling, attention alerts, and discreet nudges to re-engage quiet participants.',
      },
    ],
  },
  administrators: {
    title: 'For Administrators',
    subtitle: 'Program-level visibility across cohorts, faculty, and outcomes',
    features: [
      {
        icon: 'gear',
        title: 'Program Configuration',
        body: 'Roles, permissions, and accreditation mapping configured at the program level with auditable change history.',
      },
      {
        icon: 'chart',
        title: 'Outcomes Reporting',
        body: 'Kirkpatrick L1–L4, Bloom progression, and competency heat maps aggregated across every cohort.',
      },
      {
        icon: 'map',
        title: 'Cohort Insights',
        body: 'Longitudinal dashboards by specialty, year, and faculty member with certification readiness scoring.',
      },
    ],
  },
};

/**
 * Vaidix marketing landing page.
 * Rendered at `/` for unauthenticated visitors (authenticated users redirect
 * to /dashboard via src/app/page.tsx before this mounts).
 */
export function Landing() {
  const [activeTab, setActiveTab] = useState<Role>('presenters');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add(styles.revealVisible);
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    root.querySelectorAll(`.${styles.reveal}`).forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const tabContent = ROLE_CONTENT[activeTab];

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${dmSans.variable} ${playfair.variable} ${jakarta.variable} ${jakarta.className}`}
    >
      {/* ════════════ NAV ════════════ */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <Link href="/" className={styles.navBrand}>
            <Image
              src="/logo.png"
              alt="Vaidix"
              width={44}
              height={44}
              className={styles.navLogoImg}
              priority
            />
            <span className={styles.fontDisplay}>Vaidix</span>
          </Link>
          <div className={styles.navLinks}>
            <a href="#framework">Framework</a>
            <a href="#platform">Platform</a>
            <a href="#roles">For Educators</a>
            <a href="#intelligence">Intelligence</a>
          </div>
          <div className={styles.navActions}>
            <Link href="/login" className={styles.navSignIn}>Sign In</Link>
            <a href="#cta" className={styles.navCta}>Request Walkthrough</a>
          </div>
        </div>
      </nav>

      {/* ════════════ HERO ════════════ */}
      <section className={styles.hero}>
        <div className={styles.heroDots} aria-hidden />
        <div className={styles.heroGrid}>
          <div>
            <span className={`${styles.pill} ${styles.reveal}`}>
              <span className={styles.pillDot} />
              Next-Generation Medical Education
            </span>
            <h1 className={`${styles.heroHeadline} ${styles.reveal}`} style={{ transitionDelay: '80ms' }}>
              Live medical education that{' '}
              <span className={styles.heroEm}>thinks</span> before the session,{' '}
              <span className={styles.heroEm}>guides</span> during the session, and{' '}
              <span className={styles.heroEm}>reinforces</span> after.
            </h1>
            <p className={`${styles.heroSub} ${styles.reveal}`} style={{ transitionDelay: '160ms' }}>
              AI-enabled teaching, engagement, simulation, and microlearning in one continuous ecosystem. Prepare deeply, engage live, practice repeatedly.
            </p>
            <div className={`${styles.heroCtas} ${styles.reveal}`} style={{ transitionDelay: '240ms' }}>
              <a href="#framework" className={styles.btnSecondary}>
                <Icon name="playSm" size={16} />
                <span>Explore 3H Learning Model</span>
              </a>
            </div>
          </div>

          <div className={`${styles.heroMedia} ${styles.reveal}`} style={{ transitionDelay: '120ms' }}>
            <div className={styles.heroImage}>
              <Image
                src="/3h_golden_circle_redesigned.svg"
                alt="3H Golden Circle — Head, Heart, Hands learning framework"
                fill
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
                className={styles.heroSvg}
              />
            </div>
            <div className={styles.heroFloatCard}>
              <span className={styles.heroFloatIcon} aria-hidden>
                <Icon name="sparkle" size={18} />
              </span>
              <div>
                <div className={styles.heroFloatTitle}>Readiness Score</div>
                <div className={styles.heroFloatSub}>AI-Powered Prediction</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ 3H LEARNING MODEL ════════════ */}
      <section id="framework" className={styles.section}>
        <div className={styles.container}>
          <div className={`${styles.sectionHead} ${styles.threeHHead} ${styles.reveal}`}>
            <span className={styles.pill}>The 3H Learning Model</span>
            <h2 className={styles.headline}>Education grounded in pedagogy, powered by intelligence</h2>
            <p className={styles.subtext}>
              Our platform architecture maps directly to the Head-Heart-Hands framework, ensuring cognitive, affective, and psychomotor development at every stage.
            </p>
          </div>

          <div className={styles.threeHGrid}>
            {[
              {
                icon: 'brain',
                title: 'Head',
                subtitle: 'Cognitive Mastery',
                body: 'Knowledge activation, reasoning depth, and cognitive priming through intelligent pre-session preparation and live transcript support.',
                modules: [
                  'Study Material Hub',
                  'Knowledge Priming Quiz',
                  'Readiness Predictor Dashboard',
                  'Interactive Transcript',
                  'AI Clinical Assistant',
                  "Bloom's Taxonomy Analytics",
                ],
              },
              {
                icon: 'heart',
                title: 'Heart',
                subtitle: 'Emotional Engagement',
                body: 'Human connection, reflection, confidence building through question submission, peer voting, and emotionally engaging teaching moments.',
                modules: [
                  'Pre-Conference Question Engine',
                  'Attention Hook Intelligence',
                  'Smart Breakout Rooms',
                  'AI Discussion Co-Facilitator',
                  'Reflective Learning Bot',
                  'Kirkpatrick Evaluation',
                ],
              },
              {
                icon: 'hand',
                title: 'Hands',
                subtitle: 'Applied Practice',
                body: 'Clinical competency through branching cases, live decision simulations, procedural demonstrations, and deliberate practice scenarios.',
                modules: [
                  'Pre-Case Simulations',
                  'Branching Diagnostic Scenarios',
                  'Live Decision Simulations',
                  'Virtual Patient Simulations',
                  'Procedure Demonstrations',
                  'Certification Prep Simulations',
                ],
              },
            ].map((card, i) => (
              <article
                key={card.title}
                className={`${styles.threeHCard} ${styles.reveal}`}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <div className={styles.threeHHero}>
                  <div className={styles.threeHBadge}>
                    <span className={styles.threeHBadgeIcon} aria-hidden>
                      <Icon name={card.icon as IconName} size={22} />
                    </span>
                    <div>
                      <div className={styles.threeHBadgeTitle}>{card.title}</div>
                      <div className={styles.threeHBadgeSub}>{card.subtitle}</div>
                    </div>
                  </div>
                </div>
                <div className={styles.threeHBody}>
                  <p>{card.body}</p>
                  <div className={styles.modulesLabel}>Key Modules:</div>
                  <div className={styles.chipRow}>
                    {card.modules.map((m) => (
                      <span key={m} className={`${styles.chip} ${styles.chipPrimary}`}>{m}</span>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════ PLATFORM ARCHITECTURE ════════════ */}
      <section id="platform" className={`${styles.section} ${styles.architecture}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHead} ${styles.reveal}`}>
            <span className={styles.pill}>Platform Architecture</span>
            <h2 className={styles.headline}>A continuous learning ecosystem, not a course library</h2>
            <p className={styles.subtext}>
              Every stage of the learning journey is intelligently designed to build knowledge, engagement, and clinical competency.
            </p>
          </div>

          <div className={styles.archGrid}>
            {[
              {
                icon: 'clock' as IconName,
                stagePill: 'Before',
                title: 'Pre-Conference Intelligence',
                subtitle: 'Cognitive priming and readiness optimization',
                features: [
                  'AI-curated study materials',
                  'Microlearning nuggets',
                  'Priming quizzes with readiness scores',
                  'Pre-session case simulations',
                  'Question submission engine',
                  'Knowledge gap identification',
                ],
              },
              {
                icon: 'play' as IconName,
                stagePill: 'During',
                title: 'Live Session Enhancement',
                subtitle: 'Real-time engagement and interaction intelligence',
                features: [
                  'Smart slide intelligence for presenters',
                  'Attention hooks every 6-8 minutes',
                  'Interactive transcript with timestamps',
                  'Live polling and Q&A facilitation',
                  'Breakout room orchestration',
                  'Real-time decision simulations',
                ],
              },
              {
                icon: 'refresh' as IconName,
                stagePill: 'After',
                title: 'Post-Conference Mastery',
                subtitle: 'Spaced reinforcement and competency tracking',
                features: [
                  'Clinical pearls delivered via spaced repetition',
                  'Revision pathways with micro-assessments',
                  'Error replay for deliberate practice',
                  'Competency dashboards with progression',
                  'Reflective learning prompts',
                  'Certification simulation prep',
                ],
              },
            ].map((col, i) => (
              <div
                key={col.title}
                className={`${styles.archCol} ${styles.reveal}`}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                <span className={styles.archIcon} aria-hidden>
                  <Icon name={col.icon} size={22} />
                </span>
                <div className={styles.archImageCard}>
                  <div className={styles.archOverlay}>
                    <span className={styles.archOverlayPill}>{col.stagePill}</span>
                    <h3 className={styles.archOverlayTitle}>{col.title}</h3>
                    <p className={styles.archOverlaySub}>{col.subtitle}</p>
                  </div>
                </div>
                <ul className={styles.archFeatures}>
                  {col.features.map((f) => (
                    <li key={f}>
                      <span className={styles.archArrow} aria-hidden>→</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className={`${styles.archFooter} ${styles.reveal}`}>
            This architecture ensures that knowledge, reflection, and clinical performance grow
          </p>
        </div>
      </section>

      {/* ════════════ BUILT FOR EVERY ROLE ════════════ */}
      <section id="roles" className={`${styles.section} ${styles.roles}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHead} ${styles.reveal}`}>
            <span className={styles.pill}>Built for Every Role</span>
            <h2 className={styles.headline}>Purpose-built experiences for every participant</h2>
            <p className={styles.subtext}>
              Whether you&apos;re teaching, learning, facilitating, or managing, MedLearn OS adapts to your workflow.
            </p>
          </div>

          <div className={`${styles.reveal}`}>
            <div role="tablist" aria-label="Roles" className={styles.tabBar}>
              {(
                [
                  { id: 'presenters', label: 'For Presenters', icon: 'monitor' },
                  { id: 'learners', label: 'For Audience', icon: 'cap' },
                  { id: 'moderators', label: 'For Moderator/Panel', icon: 'people' },
                  { id: 'administrators', label: 'For Administrators', icon: 'gear' },
                ] as { id: Role; label: string; icon: IconName }[]
              ).map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={activeTab === t.id}
                  className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  <Icon name={t.icon} size={18} />
                  {t.label}
                </button>
              ))}
            </div>

            <div key={activeTab} className={styles.tabPanel} role="tabpanel">
              <h3 className={styles.tabPanelTitle}>{tabContent.title}</h3>
              <p className={styles.tabPanelSub}>{tabContent.subtitle}</p>
              <div className={styles.featureCardGrid}>
                {tabContent.features.map((f) => (
                  <div key={f.title} className={styles.featureCard}>
                    <span className={styles.featureIcon} aria-hidden>
                      <Icon name={f.icon} size={20} />
                    </span>
                    <h4 className={styles.featureTitle}>{f.title}</h4>
                    <p className={styles.featureBody}>{f.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════ INTELLIGENCE / AI FEATURES ════════════ */}
      <section id="intelligence" className={`${styles.section} ${styles.intel}`}>
        <div className={styles.container}>
          <div className={`${styles.sectionHead} ${styles.intelHead} ${styles.reveal}`}>
            <h2 className={styles.headline}>Intelligence that amplifies teaching and accelerates learning</h2>
            <p className={styles.subtext}>
              Our AI doesn&apos;t replace educators — it enhances their impact with real-time insights, personalized pathways, and competency tracking.
            </p>
          </div>

          <div className={styles.intelGrid}>
            {[
              {
                icon: 'brain' as IconName,
                title: 'Teaching Assistant AI',
                body: 'Analyzes presentations to suggest engagement moments, case integration points, and discussion prompts tailored to content.',
                chips: ['Slide intelligence', 'Hook suggestions', 'Content gap detection'],
              },
              {
                icon: 'pulse' as IconName,
                title: 'Attention Intelligence',
                body: 'Monitors learner engagement patterns and prompts intervention when attention drifts, maintaining optimal session flow.',
                chips: ['Engagement alerts', '6-8 min intervention prompts', 'Participation tracking'],
              },
              {
                icon: 'target' as IconName,
                title: 'Simulation Coach',
                body: 'Guides learners through branching clinical scenarios, providing adaptive feedback and identifying knowledge gaps in real-time.',
                chips: ['Decision accuracy', 'Retry patterns', 'Competency progression'],
              },
              {
                icon: 'chart' as IconName,
                title: 'Assessment Bot',
                body: "Delivers spaced micro-assessments aligned with Bloom's taxonomy, tracking cognitive progression from recall to synthesis.",
                chips: ['Spaced repetition', "Bloom's alignment", 'Mastery scoring'],
              },
              {
                icon: 'sparkle' as IconName,
                title: 'Reflection Mentor',
                body: 'Prompts reflective thinking with tailored questions, helping learners connect theory to clinical practice and build...',
                chips: ['Reflective prompts', 'Journal coaching', 'Case linkage'],
              },
              {
                icon: 'badge' as IconName,
                title: 'Competency Tracker',
                body: 'Longitudinal analytics across Head, Heart, Hands dimensions with Kirkpatrick evaluation and certification readiness scoring.',
                chips: ['Head · Heart · Hands', 'Kirkpatrick L1–L4', 'Certification readiness'],
              },
            ].map((card, i) => (
              <article
                key={card.title}
                className={`${styles.intelCard} ${styles.reveal}`}
                style={{ transitionDelay: `${(i % 3) * 80}ms` }}
              >
                <span className={styles.intelIcon} aria-hidden>
                  <Icon name={card.icon} size={22} />
                </span>
                <h3 className={styles.intelTitle}>{card.title}</h3>
                <p className={styles.intelBody}>{card.body}</p>
                <div className={styles.metricsLabel}>Key Metrics</div>
                <div className={styles.chipRow}>
                  {card.chips.map((c) => (
                    <span key={c} className={styles.chip}>{c}</span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════ ANALYTICS DASHBOARD ════════════ */}
      <section id="cta" className={styles.analyticsWrap}>
        <div className={styles.analytics}>
          <div className={styles.reveal}>
            <span className={styles.analyticsPill}>Analytics in Action</span>
            <h2 className={styles.analyticsHeadline}>From data to insight to intervention</h2>
            <p className={styles.analyticsBody}>
              Every interaction generates learning intelligence. Our analytics engine tracks attention patterns, decision accuracy, retry behavior, and confidence progression — then delivers actionable insights to presenters, personalized pathways to learners, and competency dashboards to administrators.
            </p>
            <div className={styles.miniStats}>
              <div className={styles.miniStat}>
                <span className={styles.miniStatIcon} aria-hidden>
                  <Icon name="arrowUp" size={18} />
                </span>
                <div className={styles.miniStatNum}>87%</div>
                <div className={styles.miniStatLabel}>Prediction Accuracy</div>
              </div>
              <div className={styles.miniStat}>
                <span className={styles.miniStatIcon} aria-hidden>
                  <Icon name="bolt" size={18} />
                </span>
                <div className={styles.miniStatNum}>Real-time</div>
                <div className={styles.miniStatLabel}>Intervention Prompts</div>
              </div>
            </div>
          </div>

          <div className={`${styles.dashboard} ${styles.reveal}`} style={{ transitionDelay: '120ms' }}>
            <div className={styles.dashHeader}>
              <div className={styles.dashTitle}>Learner Competency Dashboard</div>
              <span className={styles.livePill}>
                <span className={styles.liveDot} /> Live
              </span>
            </div>

            {[
              { label: 'Head (Cognitive)', val: 89, color: '#3b82f6' },
              { label: 'Heart (Affective)', val: 76, color: '#ec4899' },
              { label: 'Hands (Psychomotor)', val: 82, color: '#10b981' },
            ].map((row) => (
              <div key={row.label} className={styles.dashRow}>
                <div className={styles.dashRowHead}>
                  <span className={styles.dashRowLabel}>{row.label}</span>
                  <span className={styles.dashRowVal}>{row.val}%</span>
                </div>
                <div className={styles.dashBar}>
                  <div
                    className={styles.dashBarFill}
                    style={{ width: `${row.val}%`, background: row.color }}
                  />
                </div>
              </div>
            ))}

            <div className={styles.dashOverall}>
              <span className={styles.dashOverallLabel}>Overall Readiness</span>
              <span className={styles.dashOverallVal}>83%</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ───────────── inline SVG icon set ───────────── */

type IconName =
  | 'brain'
  | 'heart'
  | 'hand'
  | 'clock'
  | 'play'
  | 'playSm'
  | 'refresh'
  | 'monitor'
  | 'cap'
  | 'people'
  | 'gear'
  | 'sparkle'
  | 'chart'
  | 'chat'
  | 'pulse'
  | 'target'
  | 'badge'
  | 'arrowRight'
  | 'arrowUp'
  | 'bolt'
  | 'shield'
  | 'map';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'brain':
      return (
        <svg {...common}>
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...common}>
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      );
    case 'hand':
      return (
        <svg {...common}>
          <path d="M18 11V6a2 2 0 0 0-4 0v5" />
          <path d="M14 10V4a2 2 0 0 0-4 0v6" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <path d="m10 8 6 4-6 4V8Z" />
        </svg>
      );
    case 'playSm':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M8 5v14l11-7z" />
        </svg>
      );
    case 'arrowRight':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
          <path d="M21 3v5h-5" />
        </svg>
      );
    case 'monitor':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'cap':
      return (
        <svg {...common}>
          <path d="M22 10 12 4 2 10l10 6 10-6Z" />
          <path d="M6 12v5a6 3 0 0 0 12 0v-5" />
        </svg>
      );
    case 'people':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 5-6" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
        </svg>
      );
    case 'pulse':
      return (
        <svg {...common}>
          <path d="M22 12h-4l-3 9-6-18-3 9H2" />
        </svg>
      );
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case 'badge':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="6" />
          <path d="M15.5 13 17 22l-5-3-5 3 1.5-9" />
        </svg>
      );
    case 'arrowUp':
      return (
        <svg {...common}>
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...common}>
          <path d="m13 2-3 7h7l-9 13 3-9H4l9-11z" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
      );
    case 'map':
      return (
        <svg {...common}>
          <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" />
          <path d="M9 3v15M15 6v15" />
        </svg>
      );
  }
}

