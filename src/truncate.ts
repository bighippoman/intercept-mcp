export interface ContentSlice {
  text: string;
  totalLength: number;
  returnedLength: number;
  truncated: boolean;
  nextStartIndex?: number;
}

/** Default response budget for a single fetch (~12k tokens of markdown). */
export const DEFAULT_MAX_LENGTH = 50_000;
/** Default per-URL budget for batch/research fetches. */
export const DEFAULT_BATCH_MAX_LENGTH = 20_000;

/**
 * Slice content to a character window so large pages don't flood the
 * agent's context. Callers paginate by passing the returned nextStartIndex
 * back as startIndex.
 */
export function sliceContent(content: string, maxLength: number, startIndex = 0): ContentSlice {
  const totalLength = content.length;

  if (startIndex > 0 && startIndex >= totalLength) {
    return {
      text: `[startIndex ${startIndex} is past the end of the content (${totalLength} characters total). There is no more content to return.]`,
      totalLength,
      returnedLength: 0,
      truncated: false,
    };
  }

  const end = Math.min(totalLength, startIndex + maxLength);
  const text = content.slice(startIndex, end);
  const truncated = end < totalLength;

  return {
    text,
    totalLength,
    returnedLength: text.length,
    truncated,
    nextStartIndex: truncated ? end : undefined,
  };
}

/** The sliced text plus, when truncated, an instruction telling the agent how to continue. */
export function sliceWithNotice(content: string, maxLength: number, startIndex = 0): ContentSlice {
  const slice = sliceContent(content, maxLength, startIndex);
  if (slice.truncated) {
    slice.text += `\n\n[Content truncated: showing characters ${startIndex}–${slice.nextStartIndex} of ${slice.totalLength}. Call fetch again with startIndex=${slice.nextStartIndex} to continue.]`;
  }
  return slice;
}
