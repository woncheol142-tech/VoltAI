import type { ElectricalReviewPorts, ReviewLlm } from "@voltai/agent-review";
import type { CompanySearchResult } from "@voltai/knowledge-company";
import {
  extractDrawingLayout,
  loadDrawingIndex,
  searchDrawings,
} from "@voltai/mcp-project-files";

import {
  createLocalReviewPorts,
  type LocalReviewPortsDependencies,
} from "./localReviewPorts.js";

export type LocalElectricalReviewPortsOptions = {
  indexPath: string;
  pageMapPath: string;
  searchKec?: ElectricalReviewPorts["searchKec"];
  searchCompany?: (question: string) => Promise<CompanySearchResult[]>;
  companySearchProvider?: string;
  llm?: ReviewLlm;
  localReviewDependencies?: LocalReviewPortsDependencies;
};

export function createLocalElectricalReviewPorts(
  projectRoot: string,
  options: LocalElectricalReviewPortsOptions,
): ElectricalReviewPorts {
  const needsLocalReviewPorts =
    options.searchKec === undefined || options.llm === undefined;
  const localReviewPorts = needsLocalReviewPorts
    ? createLocalReviewPorts(projectRoot, {
        ...options.localReviewDependencies,
        ...(options.llm === undefined ? {} : { llm: options.llm }),
      })
    : undefined;
  const searchKec = options.searchKec ?? localReviewPorts?.searchKec;
  const llm = options.llm ?? localReviewPorts?.llm;

  if (searchKec === undefined || llm === undefined) {
    throw new Error("Electrical review KEC and LLM ports are required");
  }

  const searchCompany =
    options.searchCompany ?? localReviewPorts?.searchCompany;
  const companySearchProvider =
    options.companySearchProvider ?? localReviewPorts?.companySearchProvider;

  return {
    searchDrawings: async (query) => {
      const result = await searchDrawings(projectRoot, {
        indexPath: options.indexPath,
        pageMapPath: options.pageMapPath,
        query,
      });
      const document = loadDrawingIndex(projectRoot, options.indexPath);

      return {
        sourcePath: document.source,
        ...result,
      };
    },
    readDrawingPage: async (sourcePath, page) => {
      const layout = await extractDrawingLayout(projectRoot, {
        relativePath: sourcePath,
        page,
      });

      return {
        sourcePath: layout.source,
        page: layout.page,
        pageCount: layout.pageCount,
        text: layout.lines
          .map((line) => line.text)
          .filter((line) => line.length > 0)
          .join("\n")
          .trim(),
        warnings: [...layout.warnings],
      };
    },
    searchKec,
    ...(searchCompany === undefined ? {} : { searchCompany }),
    ...(companySearchProvider === undefined ? {} : { companySearchProvider }),
    llm,
    ...(localReviewPorts?.close === undefined
      ? {}
      : { close: localReviewPorts.close }),
  };
}
