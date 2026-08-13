import type {
  EvidenceAuthority,
  KnowledgeCitation,
  KnowledgeSearchResult,
  PageLocator,
} from "@voltai/knowledge-core";
import {
  companyEvidenceAuthority,
  type CompanyCitation,
  type CompanyKnowledgeMetadata,
  type CompanyKnowledgeSearchResult,
  type CompanySearchResult,
} from "../../src/index.js";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft
        ? 1
        : 2
      ? true
      : false
    : false;
type Assert<T extends true> = T;

type CompanyAuthorityParameter = Assert<
  Equal<
    Parameters<typeof companyEvidenceAuthority>,
    [CompanyKnowledgeSearchResult]
  >
>;
type CompanyAuthorityReturn = Assert<
  Equal<ReturnType<typeof companyEvidenceAuthority>, EvidenceAuthority>
>;

const metadata: CompanyKnowledgeMetadata = {
  standardId: "CS-ELEC-001",
  title: "Electrical Design Standard",
  section: null,
  revision: null,
  effectiveDate: null,
  department: null,
};
const locator: PageLocator = { kind: "page", page: 4 };
const knowledgeResult: KnowledgeSearchResult<
  CompanyKnowledgeMetadata,
  PageLocator
> = {
  chunkId: "company:standards/electrical.pdf#page=4#chunk=0",
  documentId: "company:standards/electrical.pdf",
  sourcePath: "standards/electrical.pdf",
  locator,
  metadata,
  text: "Grounding conductors shall be bonded.",
  similarity: 0.9,
};
const companyKnowledgeResult: CompanyKnowledgeSearchResult = knowledgeResult;
const companyResult: CompanySearchResult = {
  chunkId: knowledgeResult.chunkId,
  sourcePath: knowledgeResult.sourcePath,
  page: locator.page,
  standardId: metadata.standardId,
  title: metadata.title,
  section: metadata.section,
  text: knowledgeResult.text,
  similarity: knowledgeResult.similarity,
};
const knowledgeCitation: KnowledgeCitation<
  "company",
  CompanyKnowledgeMetadata,
  PageLocator
> = {
  citationId: "company:citation-1",
  sourceType: "knowledge",
  domain: "company",
  collection: "company",
  documentId: knowledgeResult.documentId,
  sourcePath: knowledgeResult.sourcePath,
  locator,
  label: metadata.standardId,
  excerpt: knowledgeResult.text,
  metadata,
};
const companyCitation: CompanyCitation = {
  id: knowledgeCitation.citationId,
  sourceType: "company",
  standardId: metadata.standardId,
  title: metadata.title,
  section: metadata.section,
  sourcePath: knowledgeCitation.sourcePath,
  page: locator.page,
  excerpt: knowledgeCitation.excerpt,
};
const authority: EvidenceAuthority = companyEvidenceAuthority(
  companyKnowledgeResult,
);

void (null as CompanyAuthorityParameter | null);
void (null as CompanyAuthorityReturn | null);
void metadata;
void companyKnowledgeResult;
void companyResult;
void knowledgeCitation;
void companyCitation;
void authority;
