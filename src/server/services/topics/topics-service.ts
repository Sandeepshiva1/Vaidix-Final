// ════════════════════════════════════════════════════════════════════════════
// Topics Service
// ════════════════════════════════════════════════════════════════════════════
// Read-only surface over the Topic model. Hierarchy is exposed shallowly
// (parent + children one level deep) so /api/topics returns a tree without
// recursive expansion. Counts of related artifacts (cases / pearls / atlas
// images / courses) help downstream UI surface "rich" topics.

import { db } from '@/lib/db';

export interface TopicSummary {
  id: string;
  slug: string;
  name: string;
  subspecialty: string | null;
  description: string | null;
  parentTopicId: string | null;
  displayOrder: number;
  counts: {
    cases: number;
    pearls: number;
    atlasImages: number;
    courses: number;
  };
}

export interface TopicDetail extends TopicSummary {
  parent: { id: string; name: string; slug: string } | null;
  children: Array<Pick<TopicSummary, 'id' | 'name' | 'slug' | 'displayOrder'>>;
}

export class TopicError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'INVALID_NAME', message: string) {
    super(message);
  }
}

function slugifyTopicName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'topic';
}

export async function createTopic(
  input: { name: string; subspecialty?: string | null },
  programId: string,
): Promise<{ id: string; name: string; subspecialty: string | null }> {
  const name = input.name.trim();
  if (!name) throw new TopicError('INVALID_NAME', 'Topic name is required');

  // Slug must be unique within program; on collision append -2, -3, …
  const baseSlug = slugifyTopicName(name);
  let slug = baseSlug;
  for (let n = 2; n < 50; n++) {
    const taken = await db.topic.findFirst({
      where: { programId, slug },
      select: { id: true },
    });
    if (!taken) break;
    slug = `${baseSlug}-${n}`;
  }

  // Push new topics to the end of their group rather than colliding on order 0.
  const last = await db.topic.aggregate({
    where: { programId },
    _max: { displayOrder: true },
  });
  const displayOrder = (last._max.displayOrder ?? 0) + 1;

  const created = await db.topic.create({
    data: {
      programId,
      name,
      slug,
      subspecialty: input.subspecialty?.trim() || null,
      displayOrder,
    },
    select: { id: true, name: true, subspecialty: true },
  });
  return created;
}

export async function listTopics(opts: {
  programId: string;
  subspecialty?: string;
}): Promise<TopicSummary[]> {
  // Topic curriculum is per-program; never list across tenants.
  const rows = await db.topic.findMany({
    where: {
      programId: opts.programId,
      ...(opts.subspecialty ? { subspecialty: opts.subspecialty } : {}),
    },
    orderBy: [{ subspecialty: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { cases: true, pearls: true, atlasImages: true, courses: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    subspecialty: t.subspecialty,
    description: t.description,
    parentTopicId: t.parentTopicId,
    displayOrder: t.displayOrder,
    counts: {
      cases: t._count.cases,
      pearls: t._count.pearls,
      atlasImages: t._count.atlasImages,
      courses: t._count.courses,
    },
  }));
}

export async function getTopic(idOrSlug: string, programId: string): Promise<TopicDetail> {
  // slug is unique-within-program post-migration, so the OR-by-slug
  // path requires the programId to disambiguate the same slug across tenants.
  const topic = await db.topic.findFirst({
    where: {
      programId,
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      children: {
        select: { id: true, name: true, slug: true, displayOrder: true },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      },
      _count: { select: { cases: true, pearls: true, atlasImages: true, courses: true } },
    },
  });
  if (!topic) throw new TopicError('NOT_FOUND', 'Topic not found');
  return {
    id: topic.id,
    slug: topic.slug,
    name: topic.name,
    subspecialty: topic.subspecialty,
    description: topic.description,
    parentTopicId: topic.parentTopicId,
    displayOrder: topic.displayOrder,
    counts: {
      cases: topic._count.cases,
      pearls: topic._count.pearls,
      atlasImages: topic._count.atlasImages,
      courses: topic._count.courses,
    },
    parent: topic.parent,
    children: topic.children,
  };
}
