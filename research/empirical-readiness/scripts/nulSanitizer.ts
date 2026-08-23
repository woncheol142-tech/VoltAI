export const nulSanitizationStrategy = "REPLACE_WITH_U+0020" as const;

export function sanitizeExtractedText(text: string): string {
  return text.replaceAll("\u0000", " ");
}
