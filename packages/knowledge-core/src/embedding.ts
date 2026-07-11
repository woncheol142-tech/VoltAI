export type KnowledgeEmbeddingProvider = {
  embed: (text: string) => Promise<number[]>;
  getMetadata: () => {
    provider: string;
    model: string;
  };
};
