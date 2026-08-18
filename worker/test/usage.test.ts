import { describe, expect, it } from "vitest";
import { parseUsage } from "../src/gateway/usage";

describe("parseUsage", () => {
  it("parses OpenAI chat completion response", () => {
    const text = JSON.stringify({
      id: "x",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });
    expect(parseUsage("openai", text)).toEqual({ input_tokens: 10, output_tokens: 20, total_tokens: 30 });
  });

  it("parses OpenAI SSE stream with final usage chunk", () => {
    const text =
      "data: {\"id\":\"a\",\"choices\":[]}\n\ndata: {\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":9,\"total_tokens\":16},\"choices\":[]}\n\ndata: [DONE]\n\n";
    expect(parseUsage("openai", text)).toEqual({ input_tokens: 7, output_tokens: 9, total_tokens: 16 });
  });

  it("parses Anthropic messages response", () => {
    const text = JSON.stringify({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 3, output_tokens: 4 },
    });
    expect(parseUsage("anthropic", text)).toEqual({ input_tokens: 3, output_tokens: 4, total_tokens: 7 });
  });

  it("parses Anthropic SSE stream events", () => {
    const text = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1}}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","usage":{"output_tokens":11}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join("\n");
    expect(parseUsage("anthropic", text)).toEqual({ input_tokens: 5, output_tokens: 11, total_tokens: 16 });
  });

  it("returns null when no usage present", () => {
    expect(parseUsage("openai", "not json")).toBeNull();
    expect(parseUsage("anthropic", "{}")).toBeNull();
  });
});
