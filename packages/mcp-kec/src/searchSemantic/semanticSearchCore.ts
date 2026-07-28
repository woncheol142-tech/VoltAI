import type { KecSemanticSearchCoreDependencies } from "./types.js";

const metadataMismatchError =
  "KEC index embedding metadata mismatch. Please re-run index_kec.";

export type { KecSemanticSearchCoreDependencies } from "./types.js";

export async function executeKecSemanticSearch<TResult>(
  query: string,
  topK: number,
  dependencies: KecSemanticSearchCoreDependencies<TResult>,
): Promise<TResult[]> {
  const embedding = await dependencies.embeddingProvider.embed(query);
  const providerMetadata = dependencies.embeddingProvider.getMetadata();
  const indexMetadata = await dependencies.getIndexMetadata();

  if (
    !indexMetadata ||
    indexMetadata.embeddingProvider !== providerMetadata.provider ||
    indexMetadata.embeddingModel !== providerMetadata.model ||
    indexMetadata.dimensions !== embedding.length
  ) {
    throw new Error(metadataMismatchError);
  }

  return dependencies.search(embedding, topK);
}
