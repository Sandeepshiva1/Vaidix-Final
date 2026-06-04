import { UserRole } from './types'

export const BLOOMS_COGNITIVE = [
  { level: 1, label: 'Remember', description: 'Recall facts and basic concepts', color: '#94a3b8' },
  { level: 2, label: 'Understand', description: 'Explain ideas or concepts', color: '#60a5fa' },
  { level: 3, label: 'Apply', description: 'Use information in new situations', color: '#34d399' },
  { level: 4, label: 'Analyze', description: 'Draw connections among ideas', color: '#fbbf24' },
  { level: 5, label: 'Evaluate', description: 'Justify a stand or decision', color: '#f97316' },
  { level: 6, label: 'Create', description: 'Produce new or original work', color: '#ef4444' },
]

export const BLOOMS_AFFECTIVE = [
  { level: 1, label: 'Receiving', description: 'Acknowledges patient emotions' },
  { level: 2, label: 'Responding', description: 'Formulates empathetic response' },
  { level: 3, label: 'Valuing', description: 'Consistently explores patient perspective' },
  { level: 4, label: 'Organization', description: 'Balances evidence with patient autonomy' },
  { level: 5, label: 'Characterization', description: 'Humanistic practice becomes core identity' },
]

export const BLOOMS_PSYCHOMOTOR = [
  { level: 1, label: 'Perception', description: 'Identifies visual findings' },
  { level: 2, label: 'Set', description: 'Articulates systematic approach' },
  { level: 3, label: 'Guided Response', description: 'Attempts with AI feedback' },
  { level: 4, label: 'Mechanism', description: 'Performs consistently' },
  { level: 5, label: 'Complex Overt', description: 'Multitasks during examination' },
  { level: 6, label: 'Adaptation', description: 'Modifies technique for edge cases' },
  { level: 7, label: 'Origination', description: 'Designs novel approaches' },
]

export const OSLERIAN_PRINCIPLES = [
  { id: 'direct_observation', label: 'Direct Observation First', icon: 'Eye', description: 'Examine before ordering tests' },
  { id: 'listen_to_patient', label: 'Listen to Patient Story', icon: 'Ear', description: 'Engage with the person, not just the disease' },
  { id: 'first_principles', label: 'Reason from First Principles', icon: 'Brain', description: 'Explain the mechanism, don\'t just name the disease' },
  { id: 'equanimity', label: 'Equanimity with Compassion', icon: 'Heart', description: 'Balance clinical detachment with empathy' },
  { id: 'teaching_to_learn', label: 'Teaching to Learn', icon: 'GraduationCap', description: 'Explain concepts as if teaching a junior' },
]

export const EPA_LIST = [
  { id: 1, title: 'Comprehensive Eye Examination', category: 'Clinical Skills' },
  { id: 2, title: 'Refraction and Optical Correction', category: 'Clinical Skills' },
  { id: 3, title: 'Anterior Segment Assessment', category: 'Diagnostic' },
  { id: 4, title: 'Posterior Segment Assessment', category: 'Diagnostic' },
  { id: 5, title: 'Intraocular Pressure Measurement', category: 'Diagnostic' },
  { id: 6, title: 'Ocular Imaging Interpretation', category: 'Diagnostic' },
  { id: 7, title: 'Medical Management of Common Conditions', category: 'Management' },
  { id: 8, title: 'Surgical Planning and Consent', category: 'Surgical' },
  { id: 9, title: 'Intravitreal Injections', category: 'Surgical' },
  { id: 10, title: 'Cataract Surgery (Phacoemulsification)', category: 'Surgical' },
  { id: 11, title: 'Laser Procedures', category: 'Surgical' },
  { id: 12, title: 'Emergency Eye Care', category: 'Emergency' },
  { id: 13, title: 'Patient Communication and Counseling', category: 'Professionalism' },
]

export const ENTRUSTMENT_LEVELS = [
  { level: 1, label: 'Observe Only', color: '#ef4444' },
  { level: 2, label: 'Direct Supervision', color: '#f97316' },
  { level: 3, label: 'Indirect Supervision', color: '#fbbf24' },
  { level: 4, label: 'On-Demand Supervision', color: '#34d399' },
  { level: 5, label: 'Full Autonomy', color: '#10b981' },
]

// ---------------------------------------------------------------------------
// TOPICS — Ophthalmology subspecialties (matches LVPEI BewSoft mental model)
// Each topic groups Cases + Pearls + Atlas Signs + Imaging + Simulators
// ---------------------------------------------------------------------------
export interface Topic {
  id: string
  label: string
  shortLabel: string
  icon: string // lucide-react icon name
  emoji: string
  color: string // tailwind text class
  bg: string // tailwind bg class
  border: string // tailwind border class
  description: string
}

export const TOPICS: Topic[] = [
  { id: 'retina',          label: 'Retina & Vitreoretinal',    shortLabel: 'Retina',        icon: 'Eye',          emoji: '👁',  color: 'text-rose-600',     bg: 'bg-rose-500/10',     border: 'border-rose-500/30',     description: 'Vitreoretinal disease, surgery, AMD, diabetic retinopathy, ROP' },
  { id: 'uvea',            label: 'Uvea & Uveitis',            shortLabel: 'Uvea',          icon: 'Flame',        emoji: '🔥', color: 'text-orange-600',   bg: 'bg-orange-500/10',   border: 'border-orange-500/30',   description: 'Uveitis, infections, inflammation, immunology' },
  { id: 'glaucoma',        label: 'Glaucoma',                  shortLabel: 'Glaucoma',      icon: 'Droplet',      emoji: '💧', color: 'text-blue-600',     bg: 'bg-blue-500/10',     border: 'border-blue-500/30',     description: 'IOP, optic disc, visual fields, medical & surgical management' },
  { id: 'cornea',          label: 'Cornea & Anterior Segment', shortLabel: 'Cornea',        icon: 'Aperture',     emoji: '🪟', color: 'text-cyan-600',     bg: 'bg-cyan-500/10',     border: 'border-cyan-500/30',     description: 'Corneal disease, dystrophies, infections, transplants' },
  { id: 'cataract',        label: 'Cataract',                  shortLabel: 'Cataract',      icon: 'Circle',       emoji: '⭕', color: 'text-amber-600',    bg: 'bg-amber-500/10',    border: 'border-amber-500/30',    description: 'Cataract evaluation, phacoemulsification, IOL selection' },
  { id: 'pediatric',       label: 'Pediatric Ophthalmology',   shortLabel: 'Pediatric',     icon: 'Baby',         emoji: '👶', color: 'text-pink-600',     bg: 'bg-pink-500/10',     border: 'border-pink-500/30',     description: 'Strabismus, amblyopia, ROP, pediatric cataract' },
  { id: 'neuro',           label: 'Neuro-Ophthalmology',       shortLabel: 'Neuro',         icon: 'Brain',        emoji: '🧠', color: 'text-purple-600',   bg: 'bg-purple-500/10',   border: 'border-purple-500/30',   description: 'Optic nerve, pupils, ocular motor, neurological disease' },
  { id: 'oculoplasty',     label: 'Oculoplasty & Orbit',       shortLabel: 'Oculoplasty',   icon: 'Scissors',     emoji: '👁‍🗨', color: 'text-indigo-600',   bg: 'bg-indigo-500/10',   border: 'border-indigo-500/30',   description: 'Lid disease, orbit, lacrimal, thyroid eye disease' },
  { id: 'oncology',        label: 'Ocular Oncology',           shortLabel: 'Oncology',      icon: 'Ribbon',       emoji: '🎗', color: 'text-fuchsia-600',  bg: 'bg-fuchsia-500/10',  border: 'border-fuchsia-500/30',  description: 'Retinoblastoma, melanoma, leukemic infiltration' },
  { id: 'refractive',      label: 'Refractive Surgery',        shortLabel: 'Refractive',    icon: 'Sparkles',     emoji: '✨', color: 'text-violet-600',   bg: 'bg-violet-500/10',   border: 'border-violet-500/30',   description: 'LASIK, PRK, SMILE, refractive evaluation' },
  { id: 'contact-lens',    label: 'Contact Lens',              shortLabel: 'CL',            icon: 'CircleDot',    emoji: '👓', color: 'text-teal-600',     bg: 'bg-teal-500/10',     border: 'border-teal-500/30',     description: 'Contact lens fitting, complications, scleral lenses' },
  { id: 'comprehensive',   label: 'Comprehensive Ophthalmology', shortLabel: 'Comprehensive', icon: 'Stethoscope', emoji: '🩺', color: 'text-emerald-600',  bg: 'bg-emerald-500/10',  border: 'border-emerald-500/30',  description: 'General ophthalmology, primary eye care, refraction' },
  { id: 'low-vision',      label: 'Low Vision & CSE',          shortLabel: 'Low Vision',    icon: 'EyeOff',       emoji: '🦯', color: 'text-slate-600',    bg: 'bg-slate-500/10',    border: 'border-slate-500/30',    description: 'Low vision rehab, community eye care' },
  { id: 'genetics',        label: 'Ocular Genetics',           shortLabel: 'Genetics',      icon: 'Dna',          emoji: '🧬', color: 'text-lime-600',     bg: 'bg-lime-500/10',     border: 'border-lime-500/30',     description: 'Inherited retinal disease, genetic counseling' },
  { id: 'prosthesis',      label: 'Ocular Prosthesis',         shortLabel: 'Prosthesis',    icon: 'Eye',          emoji: '🦠', color: 'text-stone-600',    bg: 'bg-stone-500/10',    border: 'border-stone-500/30',    description: 'Anophthalmic socket, prosthetic eye fitting' },
  { id: 'emergency',       label: 'Ocular Emergency',          shortLabel: 'Emergency',     icon: 'AlertTriangle', emoji: '🚨', color: 'text-red-600',      bg: 'bg-red-500/10',      border: 'border-red-500/30',      description: 'Trauma, chemical injury, acute glaucoma, endophthalmitis' },
]

export const TOPIC_BY_ID: Record<string, Topic> = Object.fromEntries(TOPICS.map((t) => [t.id, t]))

// Maps legacy specialty strings → topic IDs
export const SPECIALTY_TO_TOPIC: Record<string, string> = {
  'Vitreoretinal Surgery': 'retina',
  'Uvea & Retina': 'retina',
  'Uvea': 'uvea',
  'Uvea & Oncology': 'oncology',
  'Glaucoma': 'glaucoma',
  'Cornea & Anterior Segment': 'cornea',
  'Cornea': 'cornea',
  'Cataract': 'cataract',
  'Pediatric Ophthalmology': 'pediatric',
  'Neuro-ophthalmology': 'neuro',
  'Neuro-Ophthalmology': 'neuro',
  'Oculoplastics': 'oculoplasty',
  'Oculoplasty': 'oculoplasty',
}

export const CONVERSATION_STAGES = [
  { stage: 1, label: 'Patient Story', icon: 'MessageCircle', description: 'Listen to the patient narrative' },
  { stage: 2, label: 'Observation', icon: 'Eye', description: 'Examine clinical findings' },
  { stage: 3, label: 'Hypothesis', icon: 'Brain', description: 'Build differential diagnosis' },
  { stage: 4, label: 'Investigation', icon: 'TestTubes', description: 'Order and interpret tests' },
  { stage: 5, label: 'Reflection', icon: 'Heart', description: 'Reflect on the experience' },
]

export const ROLE_LABELS: Record<UserRole, string> = {
  resident: 'Student',
  faculty: 'Teacher',
  program_director: 'HOD',
  admin: 'Admin',
  external_learner: 'External Learner',
}

// Original per-role sidebar. The only change vs. the very first version is that
// "My Documents" (/teacher/documents) is now present for ALL three roles —
// residents are scoped server-side to their own uploads. Everything else is the
// role's original nav.
type NavItem = { label: string; href: string; icon: string; badge?: string }

export const SIDEBAR_NAV: Record<UserRole, NavItem[]> = {
  resident: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inbox', href: '/inbox', icon: 'Bell' },
    { label: 'Topics', href: '/topics', icon: 'LayoutGrid' },
    { label: 'My Progress', href: '/progress', icon: 'TrendingUp' },
    { label: 'Reviews', href: '/reviews', icon: 'RotateCcw' },
    { label: 'Journal', href: '/journal', icon: 'NotebookPen' },
    { label: 'My Documents', href: '/teacher/documents', icon: 'FolderOpen' },
    { label: 'Classroom', href: '/classroom', icon: 'Video' },
    { label: 'Calendar', href: '/calendar', icon: 'CalendarDays' },
    { label: 'Challenges', href: '/challenges', icon: 'Trophy' },
  ],
  faculty: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inbox', href: '/inbox', icon: 'Bell' },
    { label: 'Assess', href: '/teacher/assess/dops', icon: 'ClipboardCheck' },
    { label: 'Cases', href: '/teacher/cases', icon: 'BookOpen' },
    { label: 'Classroom', href: '/classroom', icon: 'Video' },
    { label: 'Calendar', href: '/calendar', icon: 'CalendarDays' },
    { label: 'My Documents', href: '/teacher/documents', icon: 'FolderOpen' },
    { label: 'Forge Deck', href: '/teacher/decks/new', icon: 'Wand2' },
    { label: 'Blueprints', href: '/teacher/blueprints', icon: 'Sparkles' },
    { label: 'Approvals', href: '/inbox/approvals', icon: 'Inbox' },
    { label: 'Demo Prototype', href: '/demo', icon: 'Sparkles', badge: 'NEW' },
  ],
  program_director: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inbox', href: '/inbox', icon: 'Bell' },
    { label: 'Competency Map', href: '/hod/competency-map', icon: 'Map' },
    { label: 'Milestones', href: '/hod/milestones', icon: 'Flag' },
    { label: 'Accreditation', href: '/hod/accreditation', icon: 'Award' },
    { label: 'Learners', href: '/teacher/learners', icon: 'Users' },
    { label: 'Cohort Analytics', href: '/teacher/cohort', icon: 'BarChart3' },
    { label: 'Calendar', href: '/calendar', icon: 'CalendarDays' },
    { label: 'My Documents', href: '/teacher/documents', icon: 'FolderOpen' },
    { label: 'Forge Deck', href: '/teacher/decks/new', icon: 'Wand2' },
    { label: 'Blueprints', href: '/teacher/blueprints', icon: 'Sparkles' },
    { label: 'Approvals', href: '/inbox/approvals', icon: 'Inbox' },
    { label: 'Cohorts', href: '/admin/cohorts', icon: 'UsersRound' },
  ],
  admin: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inbox', href: '/inbox', icon: 'Bell' },
    { label: 'Institution', href: '/admin/institution', icon: 'Building2' },
    { label: 'Users', href: '/admin/users', icon: 'UserCog' },
    { label: 'Invitations', href: '/admin/invitations', icon: 'Inbox' },
    { label: 'Cohorts', href: '/admin/cohorts', icon: 'UsersRound' },
    { label: 'Calendar', href: '/calendar', icon: 'CalendarDays' },
    { label: 'Documents', href: '/teacher/documents', icon: 'FolderOpen' },
    { label: 'Knowledge Base', href: '/admin/knowledge-base', icon: 'Database' },
    { label: 'ML Training Queue', href: '/admin/training-queue', icon: 'Brain' },
    { label: 'Settings', href: '/admin/settings', icon: 'Settings' },
    { label: 'Audit Logs', href: '/admin/audit-logs', icon: 'ScrollText' },
  ],
  // External learners are invited guests (visiting fellows, conference attendees,
  // alumni). Module defaults in src/lib/modules.ts give them Pearls/Atlas/Classroom;
  // the additions below match that surface plus Cases for read-only review.
  external_learner: [
    { label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard' },
    { label: 'Inbox', href: '/inbox', icon: 'Bell' },
    { label: 'Cases', href: '/cases', icon: 'BookOpen' },
    { label: 'Pearls', href: '/pearls', icon: 'Lightbulb' },
    { label: 'Atlas', href: '/atlas', icon: 'ScanEye' },
    { label: 'Classroom', href: '/classroom', icon: 'Video' },
    { label: 'Calendar', href: '/calendar', icon: 'CalendarDays' },
  ],
}
