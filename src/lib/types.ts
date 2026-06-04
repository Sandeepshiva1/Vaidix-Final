// Roles — keep in sync with prisma/schema.prisma `Role` enum.
// Mapped from Prisma's UPPERCASE_SNAKE_CASE to lowercase strings via
// mapPrismaRoleToUserRole() in src/lib/identity.ts.
export type UserRole =
  | 'resident'
  | 'faculty'
  | 'program_director'
  | 'admin'
  | 'external_learner'

// User
export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  avatar?: string
  specialization?: string
  designation?: string
  department?: string
  yearOfTraining?: string // PGY-1, PGY-2, etc.
}

// Institution
export interface Institution {
  id: string
  name: string
  city: string
  state: string
  logo?: string
  departments: string[]
}

// Case
export interface ClinicalCase {
  id: string
  title: string
  condition: string
  specialty: string
  topic?: string // subspecialty topic id (retina, uvea, glaucoma, ...)
  isEmergency?: boolean
  bloomsLevel: number // 1-6
  bloomsLabel: string // Remember, Understand, Apply, etc.
  oslerianPrinciples: string[]
  patientName: string
  patientAge: number | string
  patientGender: 'M' | 'F' | 'Male' | 'Female'
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimatedMinutes: number
  description: string
  tags: string[]
  imageCount: number
  completions: number // how many learners completed
  avgScore: number
  stages?: unknown[] // optional case stages; only length is consumed in UI
}

// Citation (shared by pearls and read sections)
export interface Citation {
  authors: string
  title: string
  journal: string
  year: number
  doi?: string
}

// Pearl — clinical pearl Q&A (mock-data/pearls.json)
export interface Pearl {
  id: string
  question: string
  answer: string
  mechanism?: string
  condition: string
  subspecialty: string
  category: string
  citation: Citation
  bloomsLevel: number
  tags: string[]
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  topic?: string // subspecialty topic id
}

// Atlas sign — diagnostic sign (mock-data/signs-atlas.json)
export interface AtlasSign {
  id: string
  name: string
  description: string
  mechanism: string
  conditions: string[]
  imagingModality: string
  clinicalSignificance: string
  category: string
  tags: string[]
  topic?: string // subspecialty topic id
}

// Conversation
export interface Message {
  id: string
  role: 'patient' | 'nurse' | 'lab' | 'mentor' | 'learner' | 'system'
  content: string
  timestamp: string
  stage: number // 1-5
  attachments?: MessageAttachment[]
}

export interface MessageAttachment {
  type: 'clinical-image' | 'lab-report' | 'vitals'
  title: string
  data: Record<string, unknown>
}

export interface Conversation {
  id: string
  caseId: string
  learnerId: string
  status: 'active' | 'completed' | 'abandoned'
  currentStage: number
  messages: Message[]
  startedAt: string
  completedAt?: string
  scores?: TripleHScore
}

// Scoring
export interface TripleHScore {
  head: number // 0-100
  heart: number
  hands: number
  headBreakdown: {
    diagnosticAccuracy: number
    differentialCompleteness: number
    reasoningDepth: number
    evidenceBased: number
  }
  heartBreakdown: {
    patientEngagement: number
    emotionalVocabulary: number
    communicationQuality: number
    reflectionDepth: number
  }
  handsBreakdown: {
    actionSequence: number
    testOrdering: number
    examinationTechnique: number
    deliberatePractice: number
  }
}

export interface OslerianScore {
  learnerId: string
  scores: {
    directObservation: number
    listenToPatient: number
    firstPrinciples: number
    equanimity: number
    teachingToLearn: number
  }
  history: { date: string; scores: Record<string, number> }[]
}

export interface BloomsProgression {
  learnerId: string
  cognitive: { level: number; label: string; achieved: boolean; casesAtLevel: number }[]
  affective: { level: number; label: string; achieved: boolean; casesAtLevel: number }[]
  psychomotor: { level: number; label: string; achieved: boolean; casesAtLevel: number }[]
}

// Assessment
export interface DOPSRecord {
  id: string
  learnerId: string
  facultyId: string
  procedure: string
  date: string
  scores: {
    indication: number
    consent: number
    preparation: number
    technique: number
    asepsis: number
    postProcedure: number
    communication: number
  }
  overallRating: number // 1-9
  feedback: string
}

export interface MiniCEXRecord {
  id: string
  learnerId: string
  facultyId: string
  encounterType: string
  date: string
  scores: {
    medicalInterview: number
    physicalExam: number
    professionalism: number
    clinicalJudgment: number
    counseling: number
    organization: number
  }
  overallRating: number
  feedback: string
}

export interface EPATracking {
  learnerId: string
  epas: {
    epaId: number
    title: string
    entrustmentLevel: number // 1-5
    lastAssessed: string
    assessmentCount: number
  }[]
}

// Journal
export interface ReflectionEntry {
  id: string
  learnerId: string
  caseId?: string
  date: string
  title: string
  content: string
  mood: 'positive' | 'neutral' | 'contemplative' | 'challenged'
  sentiment: number // -1 to 1
  tags: string[]
}

// Teaching Session
export interface TeachingSession {
  id: string
  title: string
  topic: string
  facultyId: string
  facultyName: string
  type: 'grand_rounds' | 'case_discussion' | 'journal_club' | 'skills_lab'
  scheduledAt: string
  duration: number // minutes
  status: 'scheduled' | 'live' | 'completed'
  attendees: string[]
  recordingUrl?: string
  summary?: string
  keyTakeaways?: string[]
}

// Challenge
export interface DiagnosticChallenge {
  id: string
  title: string
  difficulty: 'easy' | 'medium' | 'hard'
  timeLimit: number // seconds
  imageUrls: string[]
  correctDiagnosis: string
  options: string[]
  explanation: string
  bloomsLevel: number
}

// Spaced Repetition
export interface ReviewItem {
  id: string
  learnerId: string
  caseId: string
  caseTitle: string
  dueDate: string
  interval: number // days
  easeFactor: number
  repetitions: number
  lastReviewed?: string
}

// Dashboard stats
export interface DashboardStats {
  casesCompleted: number
  casesAvailable: number
  avgHeadScore: number
  avgHeartScore: number
  avgHandsScore: number
  weeklyStreak: number
  reviewsDue: number
  nextSession?: string
}
