export type Category = 'school' | 'ece';

export interface Institution {
  key: string;
  cat: Category;
  id: number;
  name: string;
  type: string | null;
  authority: string | null;
  region: string | null;
  district: string | null;
  suburb: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  url: string | null;
  roll: number | null;
  rollDate: string | null;
  status: string | null;
  sourceStatus: 'present' | 'source_missing';
  missingSince?: string;
  batch: string;
  firstSeen: string;
}

export interface Batch {
  id: string;
  sourceType: Category;
  sourceLabel: string;
  sourceUrl: string;
  sourceAsOf: string | null;
  importedAt: string;
  checksum: string;
  status: string;
  counts: Record<string, number>;
  importer: string;
}

export interface Enrichment {
  value: string;
  sourceUrl: string | null;
  verifiedAt: string | null;
  updatedBy: string | null;
}

export interface GeoGroup {
  id: string;
  name: string;
  definitionVersion: string;
  approved: boolean;
  basis: string;
  region?: string;
  suburbs: string[];
  members: string[];
}

export interface AewvCandidate {
  employer: string;
  tradingName: string | null;
  nzbn: string | null;
  expiry: string | null;
  sourceAsOf: string | null;
  batch: string;
  reasons: string[];
  reviewStatus: 'verified' | 'link_confirmed' | 'pending';
  verifiedAt: string | null;
  reviewer: string | null;
}

export interface AewvMatch {
  level: 'high' | 'medium' | 'low' | 'conflict';
  candidates: AewvCandidate[];
}

export interface AewvSource {
  name: string;
  url: string;
  licence: string;
  snapshotDate: string;
  sha256: string;
  rows: number;
  employers: number;
  expiredExcluded: number;
  fetchedAt: string;
}

export interface Overlays {
  generatedAt: string;
  enrichments: Record<string, Partial<Record<'website' | 'careers', Enrichment>>>;
  groups: GeoGroup[];
  aewv: { source: AewvSource | null; matches: Record<string, AewvMatch> };
}

export interface Dataset {
  generatedAt: string;
  records: Institution[];
  batches: Batch[];
  overlays: Overlays;
  byKey: Map<string, Institution>;
  batchById: Map<string, Batch>;
  search: Map<string, string>;
}
