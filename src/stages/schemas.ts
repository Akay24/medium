import { z } from "zod";

export const claimKindSchema = z.enum(["doc-fact", "derived", "opinion"]);

export const sourceSchema = z.object({
  id: z.string().min(1),
  requestedUrl: z.string().url(),
  resolvedUrl: z.string().url().nullable().optional(),
  title: z.string().nullable().optional(),
  sourceType: z.enum(["docs", "article", "blog", "spec", "repo", "book", "other"]),
  publishedAt: z.string().nullable().optional(),
  retrievalStatus: z.enum(["not_fetched", "fetched", "failed"]),
  retrievalError: z.string().nullable().optional()
});

export const claimSchema = z.object({
  id: z.string().regex(/^c\d+$/, "claim id must look like c12"),
  text: z.string().min(1),
  kind: claimKindSchema,
  sourceIds: z.array(z.string()).default([])
});

export const researchOutputSchema = z.object({
  thesis: z.string().min(1),
  prerequisites: z.array(z.string()).default([]),
  learningObjectives: z.array(z.string()).default([]),
  misconceptions: z.array(z.string()).default([]),
  claims: z.array(claimSchema),
  sources: z.array(sourceSchema),
  evidenceGaps: z.array(z.string()).default([]),
  versionSensitiveClaims: z.array(z.string()).default([])
});

export type ResearchOutput = z.infer<typeof researchOutputSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type SourceRecord = z.infer<typeof sourceSchema>;

export const outlineSectionSchema = z.object({
  heading: z.string().min(1),
  purpose: z.string().min(1),
  keyPoints: z.array(z.string()).default([]),
  claimIds: z.array(z.string()).default([]),
  codeIds: z.array(z.string()).default([]),
  diagramIds: z.array(z.string()).default([]),
  interviewRelevance: z.string().nullable().default(null)
});

export const outlineOutputSchema = z.object({
  titles: z.array(z.string()).length(3),
  recommendedTitle: z.string().min(1),
  prerequisites: z.array(z.string()).default([]),
  learningObjectives: z.array(z.string()).default([]),
  sections: z.array(outlineSectionSchema).min(1),
  sequenceRationale: z.string().min(1),
  assumptionsNeedingApproval: z.array(z.string()).default([])
});

export type OutlineOutput = z.infer<typeof outlineOutputSchema>;

export const diagramRecordSchema = z.object({
  id: z.string().min(1),
  articleLocation: z.string().min(1),
  purpose: z.string().min(1),
  status: z.enum(["conceptual", "rendered", "failed"]),
  mmdPath: z.string().nullable().default(null),
  renderedPaths: z.array(z.string()).default([]),
  renderError: z.string().nullable().default(null)
});

export const coverStatusSchema = z.enum(["not_requested", "brief_created", "generated", "failed"]);

export const visualsOutputSchema = z.object({
  diagrams: z.array(diagramRecordSchema).default([]),
  cover: z.object({
    status: coverStatusSchema,
    briefPath: z.string().nullable().default(null),
    imagePath: z.string().nullable().default(null),
    note: z.string().nullable().default(null)
  })
});

export type DiagramRecord = z.infer<typeof diagramRecordSchema>;
export type VisualsOutput = z.infer<typeof visualsOutputSchema>;

export const platformLimitOutputSchema = z.object({
  value: z.union([z.number(), z.string(), z.null()]),
  lastVerifiedAt: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  unverified: z.boolean()
});

export const metadataOutputSchema = z.object({
  headline: z.string().min(1),
  alternativeHeadlines: z.array(z.string()).length(2),
  subtitle: z.string().min(1),
  excerpt: z.string().min(1),
  tags: z.array(z.string()).min(1),
  readingTimeMinutes: z.number().min(0),
  coverAltText: z.string().min(1),
  series: z
    .object({
      name: z.string().nullable(),
      articleNumber: z.number().nullable()
    })
    .default({ name: null, articleNumber: null }),
  navigation: z
    .object({
      previous: z.string().nullable(),
      next: z.string().nullable(),
      roadmap: z.string().nullable()
    })
    .default({ previous: null, next: null, roadmap: null }),
  relatedArticles: z
    .array(z.object({ title: z.string(), suggestion: z.literal(true) }))
    .default([]),
  suggestedSection: z.string().nullable().default(null),
  platformLimits: z.object({
    tags: platformLimitOutputSchema,
    title: platformLimitOutputSchema,
    subtitle: platformLimitOutputSchema
  })
});

export type MetadataOutput = z.infer<typeof metadataOutputSchema>;

export const codeBlockSchema = z.object({
  id: z.string().min(1),
  language: z.string(),
  runSpec: z.string().nullable(),
  code: z.string(),
  sha256: z.string()
});

export type CodeBlock = z.infer<typeof codeBlockSchema>;

export const untestedBehaviorSchema = z.object({
  codeId: z.string(),
  behavior: z.string()
});

export const draftOutputSchema = z.object({
  markdownPath: z.string(),
  claims: z.array(claimSchema),
  codeBlocks: z.array(codeBlockSchema),
  diagramRefs: z.array(z.string()).default([]),
  untestedBehaviors: z.array(untestedBehaviorSchema).default([])
});

export type DraftOutput = z.infer<typeof draftOutputSchema>;
