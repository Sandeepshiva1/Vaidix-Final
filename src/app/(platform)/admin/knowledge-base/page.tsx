'use client'

import { BookOpen, Plus, FileText, Calendar, FlaskConical } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageTransition, StaggerItem, motion, HoverCard, staggerContainer, staggerItem } from '@/lib/motion'

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

type ArticleType = 'guideline' | 'protocol' | 'procedure' | 'technique' | 'review'

interface Article {
  id: string
  title: string
  type: ArticleType
  lastUpdated: string
  wordCount: number
  status: 'Published' | 'Draft'
}

const articles: Article[] = [
  {
    id: 'kb-1',
    title: 'AAO Preferred Practice Pattern: AMD',
    type: 'guideline',
    lastUpdated: '2026-03-15',
    wordCount: 4200,
    status: 'Published',
  },
  {
    id: 'kb-2',
    title: 'Diabetic Retinopathy Screening Protocol',
    type: 'protocol',
    lastUpdated: '2026-03-10',
    wordCount: 3100,
    status: 'Published',
  },
  {
    id: 'kb-3',
    title: 'Glaucoma First-Line Therapy Guidelines',
    type: 'guideline',
    lastUpdated: '2026-02-28',
    wordCount: 2800,
    status: 'Published',
  },
  {
    id: 'kb-4',
    title: 'Intravitreal Injection Technique',
    type: 'procedure',
    lastUpdated: '2026-03-20',
    wordCount: 1900,
    status: 'Published',
  },
  {
    id: 'kb-5',
    title: 'Ocular Emergency Management',
    type: 'protocol',
    lastUpdated: '2026-03-05',
    wordCount: 3500,
    status: 'Published',
  },
  {
    id: 'kb-6',
    title: 'Pediatric Ophthalmology Examination',
    type: 'technique',
    lastUpdated: '2026-02-20',
    wordCount: 2400,
    status: 'Draft',
  },
  {
    id: 'kb-7',
    title: 'Anti-VEGF Agents: Comparison',
    type: 'review',
    lastUpdated: '2026-03-18',
    wordCount: 5100,
    status: 'Published',
  },
  {
    id: 'kb-8',
    title: 'Post-Operative Care Standards',
    type: 'protocol',
    lastUpdated: '2026-01-30',
    wordCount: 2700,
    status: 'Draft',
  },
]

const typeBadgeColor: Record<ArticleType, string> = {
  guideline: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  protocol: 'bg-green-500/10 text-green-700 dark:text-green-400',
  procedure: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  technique: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  review: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
}

const statusBadgeColor: Record<string, string> = {
  Published: 'bg-green-500/10 text-green-700 dark:text-green-400',
  Draft: 'bg-slate-500/10 text-slate-700 dark:text-slate-400',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function KnowledgeBasePage() {
  return (
    <PageTransition className="space-y-6">
      {/* Page header */}
      <StaggerItem>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="size-6 text-primary" />
              <h1 className="text-2xl font-bold tracking-tight">Knowledge Base</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Curated guidelines, protocols, and references. RAG ingestion is coming soon.
            </p>
          </div>
          <Button disabled title="Article authoring is not yet available">
            <Plus className="size-4 mr-1.5" />
            Add Article
          </Button>
        </div>
      </StaggerItem>

      {/* preview banner — preview list below is illustrative until
          /api/admin/ingestion/jobs + /api/rag/query land. */}
      <StaggerItem>
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 pt-6">
            <FlaskConical className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium">Not yet available.</p>
              <p className="mt-1 text-muted-foreground">
                The Knowledge Base is the front-end for the RAG ingestion pipeline:{' '}
                <span className="font-medium">RagCollection</span> +{' '}
                <span className="font-medium">RagDocument</span> +{' '}
                <span className="font-medium">RagChunkMeta</span> tables exist in the schema
                but no documents have been ingested yet — content ingestion (PubMed PMC,
                journal scraping), BGE-M3 embeddings into Qdrant, and the{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">/api/rag/query</code>{' '}
                retrieval endpoint are not yet wired. The articles listed below are illustrative
                placeholders, not real records.
              </p>
            </div>
          </CardContent>
        </Card>
      </StaggerItem>

      {/* Articles grid */}
      <StaggerItem>
        <motion.div
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          {articles.map((article) => (
            <motion.div key={article.id} variants={staggerItem}>
              <HoverCard>
                <Card className="hover:ring-2 hover:ring-primary/20 transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="leading-snug">{article.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${typeBadgeColor[article.type]}`}
                      >
                        {article.type}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeColor[article.status]}`}
                      >
                        {article.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="size-3.5" />
                        {new Date(article.lastUpdated).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <FileText className="size-3.5" />
                        {article.wordCount.toLocaleString()} words
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </HoverCard>
            </motion.div>
          ))}
        </motion.div>
      </StaggerItem>
    </PageTransition>
  )
}
