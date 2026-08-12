import type { CompanySearchResult } from "@voltai/knowledge-company";

import type { KecSearchResult, ReviewLlm } from "./ports.js";

export type ElectricalDrawingCandidate = {
  drawingNo: string;
  title: string;
  category: string;
  complex: string | null;
  building: string | null;
  floor: string | null;
  scaleA1: string | null;
  scaleA3: string | null;
  sourceListPage: number;
  confidence: number;
  score: number;
  matchedFields: string[];
  matchReasons: string[];
  drawingPage?: number | null;
  pageMatchConfidence?: number | null;
  pageMatchMethod?: "title-block-coordinate" | null;
};

export type ElectricalDrawingSearchResult = {
  sourcePath: string;
  query: string;
  normalizedQuery: string;
  resultCount: number;
  totalCandidates: number;
  results: ElectricalDrawingCandidate[];
  warnings: string[];
};

export type ElectricalDrawingPage = {
  sourcePath: string;
  page: number;
  pageCount: number;
  text: string;
  warnings: string[];
};

export type ElectricalReviewPorts = {
  searchDrawings: (query: string) => Promise<ElectricalDrawingSearchResult>;
  readDrawingPage: (
    sourcePath: string,
    page: number,
  ) => Promise<ElectricalDrawingPage>;
  searchKec: (question: string) => Promise<KecSearchResult[]>;
  searchCompany?: (question: string) => Promise<CompanySearchResult[]>;
  companySearchProvider?: string;
  llm: ReviewLlm;
  close?: () => Promise<void> | void;
};
