import { describe, expect, it } from "vitest";
import {
  convertResponsesRequest,
  convertChatToResponsesJson,
  createChatToResponsesTransform,
} from "../src/gateway/responses_adapter";

describe("responses_adapter", () => {
  it("converts responses request to chat completions request", () => {
    const req = {
      model: "deepseek-chat",
      instructions: "You are a helpful assistant.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Hello!" }],
        },
      ],
      stream: true,
    };

    const converted = convertResponsesRequest(req);
    expect(converted.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello!" },
    ]);
    expect(converted.stream).toBe(true);
    expect(converted.input).toBeUndefined();
    expect(converted.instructions).toBeUndefined();
  });

  it("converts chat completion JSON to responses JSON", () => {
    const chatJson = {
      id: "chatcmpl-123",
      model: "deepseek-chat",
      choices: [{ message: { role: "assistant", content: "Hi there!" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const resp = convertChatToResponsesJson(chatJson, "resp_123");
    expect(resp.id).toBe("resp_123");
    expect(resp.status).toBe("completed");
    expect(resp.output[0].content[0].text).toBe("Hi there!");
  });

  it("transforms SSE chat stream to OpenAI responses stream with response.completed event", async () => {
    const rawChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world!"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of rawChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    let finishedText = "";
    const transform = createChatToResponsesTransform("resp_test_123", "deepseek-chat", (text) => {
      finishedText = text;
    });

    const transformed = stream.pipeThrough(transform);
    const reader = transformed.getReader();
    const decoder = new TextDecoder();
    let result = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      result += decoder.decode(value);
    }

    expect(finishedText).toBe("Hello world!");
    expect(result).toContain("event: response.created");
    expect(result).toContain("event: response.output_text.delta");
    expect(result).toContain("event: response.completed");
    expect(result).toContain('"type":"response.completed"');
    expect(result).toContain("data: [DONE]");
  });
});
