import type { ProviderType, TokenUsage } from "../types";

function pushUsageBlocks(blocks: Array<Record<string, any>>, obj: Record<string, any>) {
  if (obj.usage) blocks.push(obj.usage);
  if (obj.usageMetadata) blocks.push(obj.usageMetadata);
  if (obj.message && obj.message.usage) blocks.push(obj.message.usage);
}

function extractUsageBlocks(text: string): Array<Record<string, any>> {
  const blocks: Array<Record<string, any>> = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m) continue;
    const payload = m[1].trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj) pushUsageBlocks(blocks, obj);
    } catch {
      // ignore malformed SSE lines; usage stays best-effort
    }
  }
  if (blocks.length === 0) {
    try {
      const obj = JSON.parse(text);
      if (obj) pushUsageBlocks(blocks, obj);
    } catch {
      // non-JSON body (e.g. error page) -> no usage found
    }
  }
  return blocks;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseUsage(providerType: ProviderType, bodyText: string): TokenUsage | null {
  const blocks = extractUsageBlocks(bodyText);
  if (blocks.length === 0) return null;
  let input = 0;
  let output = 0;
  let total = 0;
  for (const b of blocks) {
    const inTokens =
      providerType === "anthropic"
        ? num(b.input_tokens)
        : Math.max(
            num(b.input_tokens),
            num(b.prompt_tokens ?? b.promptTokens ?? b.promptTokenCount ?? b.prompt_token_count)
          );
    const outTokens =
      providerType === "anthropic"
        ? num(b.output_tokens)
        : Math.max(
            num(b.output_tokens),
            num(b.completion_tokens ?? b.completionTokens ?? b.candidatesTokenCount ?? b.candidates_token_count)
          );
    if (inTokens > 0) input = Math.max(input, inTokens);
    if (outTokens > 0) output = Math.max(output, outTokens);
    const totTokens = num(b.total_tokens ?? b.totalTokens ?? b.totalTokenCount ?? b.total_token_count);
    total = Math.max(total, totTokens, input + output);
  }
  if (input === 0 && output === 0 && total === 0) return null;
  return { input_tokens: input, output_tokens: output, total_tokens: total > 0 ? total : input + output };
}
