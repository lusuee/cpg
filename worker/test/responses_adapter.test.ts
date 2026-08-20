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

  it("correctly identifies assistant messages in multi-turn conversation", () => {
    const req = {
      model: "deepseek-chat",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "周末天气怎么样" }],
        },
        {
          type: "output_item",
          content: [{ type: "output_text", text: "周末有小雨" }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "如何配置模型" }],
        },
      ],
      stream: true,
    };

    const converted = convertResponsesRequest(req);
    expect(converted.messages).toEqual([
      { role: "user", content: "周末天气怎么样" },
      { role: "assistant", content: "周末有小雨" },
      { role: "user", content: "如何配置模型" },
    ]);
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

  it("separates upstream reasoning_content from final output_text", async () => {
    const rawChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"The user said hi. Keep it brief."}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello! "}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"How can I help you?"}}]}\n\n',
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
    const transform = createChatToResponsesTransform("resp_test_reasoning", "gemini-2.0-flash-thinking", (text) => {
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

    // Output text must ONLY be the final answer, NOT contaminated by reasoning_content
    expect(finishedText).toBe("Hello! How can I help you?");
    expect(result).toContain("event: response.reasoning_text.delta");
    expect(result).toContain('"The user said hi. Keep it brief."');
    expect(result).toContain("event: response.output_text.delta");
    expect(result).toContain('"Hello! "');
    expect(result).toContain('"How can I help you?"');

    // Ensure output_text.delta NEVER received the reasoning content
    const outputTextDeltas = result
      .split("\n\n")
      .filter((s) => s.includes("response.output_text.delta"));
    for (const d of outputTextDeltas) {
      expect(d).not.toContain("The user said hi");
    }
  });

  it("separates inline <think> tags from output_text in streaming", async () => {
    const rawChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"<think>Internal thought here</think>Actual response"}}]}\n\n',
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
    const transform = createChatToResponsesTransform("resp_test_think_tag", "deepseek-r1", (text) => {
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

    expect(finishedText).toBe("Actual response");
    expect(result).toContain("Internal thought here");
    expect(result).toContain("Actual response");
    expect(result).not.toContain("<think>");
    expect(result).not.toContain("</think>");
  });

  it("separates reasoning in convertChatToResponsesJson", () => {
    const chatJsonWithReasoning = {
      id: "chatcmpl-r1",
      model: "deepseek-r1",
      choices: [
        {
          message: {
            role: "assistant",
            reasoning_content: "Step by step reasoning...",
            content: "The final answer is 42.",
          },
        },
      ],
    };

    const resp1 = convertChatToResponsesJson(chatJsonWithReasoning, "resp_r1");
    expect(resp1.output.length).toBe(2);
    expect(resp1.output[0].type).toBe("reasoning");
    expect(resp1.output[1].type).toBe("message");
    expect(resp1.output[1].content[0].text).toBe("The final answer is 42.");

    const chatJsonWithThinkTag = {
      id: "chatcmpl-r2",
      model: "deepseek-r1",
      choices: [
        {
          message: {
            role: "assistant",
            content: "<think>Deep thoughts</think>The final answer is 100.",
          },
        },
      ],
    };

    const resp2 = convertChatToResponsesJson(chatJsonWithThinkTag, "resp_r2");
    expect(resp2.output.length).toBe(2);
    expect(resp2.output[0].type).toBe("reasoning");
    expect(resp2.output[1].type).toBe("message");
    expect(resp2.output[1].content[0].text).toBe("The final answer is 100.");

    const chatJsonImplicit = {
      id: "chatcmpl-r3",
      model: "deepseek-r1",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Implicit thoughts here without opening tag </think> Clean answer here.",
          },
        },
      ],
    };

    const resp3 = convertChatToResponsesJson(chatJsonImplicit, "resp_r3");
    expect(resp3.output.length).toBe(2);
    expect(resp3.output[0].type).toBe("reasoning");
    expect(resp3.output[1].type).toBe("message");
    expect(resp3.output[1].content[0].text).toBe("Clean answer here.");
  });

  it("handles <think> and </think> tags split across multiple chunks", async () => {
    const rawChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"<th"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"ink>Thinking about the problem... </th"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"ink> Here is the answer."}}]}\n\n',
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
    let finishedMeta: any;
    const transform = createChatToResponsesTransform("resp_test_split", "deepseek-chat", (text, meta) => {
      finishedText = text;
      finishedMeta = meta;
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

    expect(finishedText.trim()).toBe("Here is the answer.");
    expect(finishedMeta?.reasoning).toContain("Thinking about the problem...");
    expect(result).not.toContain("<think>");
    expect(result).not.toContain("</think>");
    expect(result).not.toContain("<th");
    expect(result).not.toContain("ink>");
  });

  it("handles standalone </think> in content when no opening <think> was sent", async () => {
    const rawChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Testing tool whether normal. </think> Tool abnormal, applying patch."}}]}\n\n',
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
    const transform = createChatToResponsesTransform("resp_test_standalone_close", "deepseek-r1", (text) => {
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

    expect(finishedText.trim()).toBe("Tool abnormal, applying patch.");
    expect(result).not.toContain("</think>");
  });

  it("handles </think> embedded inside reasoning_content", async () => {
    const rawChunks = [
      'data: {"id":"chatcmpl-1","choices":[{"delta":{"reasoning_content":"Step 1: check files. </think> Here is the output"}}]}\n\n',
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
    let finishedMeta: any;
    const transform = createChatToResponsesTransform("resp_test_reasoning_close", "deepseek-r1", (text, meta) => {
      finishedText = text;
      finishedMeta = meta;
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

    expect(finishedText.trim()).toBe("Here is the output");
    expect(finishedMeta?.reasoning?.trim()).toBe("Step 1: check files.");
    expect(result).not.toContain("</think>");
  });
});
