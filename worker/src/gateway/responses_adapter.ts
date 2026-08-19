export function convertResponsesRequest(body: any): any {
  const messages: Array<{ role: string; content: any }> = [];

  if (body.instructions && typeof body.instructions === "string") {
    messages.push({ role: "system", content: body.instructions });
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    for (const m of body.messages) {
      if (m && typeof m === "object") {
        messages.push({
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        });
      }
    }
  } else if (typeof body.input === "string") {
    messages.push({ role: "user", content: body.input });
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
      } else if (item && typeof item === "object") {
        let role = "user";
        if (typeof item.role === "string" && item.role) {
          role = item.role === "developer" ? "system" : item.role;
        } else if (
          item.type === "output_item" ||
          item.type === "assistant" ||
          item.type === "response.output_item" ||
          (typeof item.type === "string" && item.type.includes("output"))
        ) {
          role = "assistant";
        } else if (item.type === "message" && item.role) {
          role = item.role;
        }

        let content = item.content ?? item.text ?? "";
        if (Array.isArray(content)) {
          // If any content part is output_text, this is an assistant message
          if (!item.role && content.some((c: any) => c && typeof c === "object" && c.type === "output_text")) {
            role = "assistant";
          }

          const parts: string[] = [];
          for (const part of content) {
            if (typeof part === "string") {
              parts.push(part);
            } else if (part && typeof part === "object") {
              if (typeof part.text === "string") parts.push(part.text);
              else if (typeof part.output_text === "string") parts.push(part.output_text);
              else if (typeof part.input_text === "string") parts.push(part.input_text);
              else if (part.type === "output_text" && typeof part.text === "string") parts.push(part.text);
              else if (part.type === "input_text" && typeof part.text === "string") parts.push(part.text);
              else if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
              else parts.push(JSON.stringify(part));
            }
          }
          content = parts.join("\n");
        } else if (typeof content === "object" && content !== null) {
          content = (content as any).text || JSON.stringify(content);
        }
        messages.push({ role, content: String(content) });
      }
    }
  } else if (typeof body.prompt === "string") {
    messages.push({ role: "user", content: body.prompt });
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "Hello" });
  }

  const cleanBody: Record<string, any> = {
    model: body.model,
    messages,
    stream: body.stream === true,
  };

  if (typeof body.temperature === "number") cleanBody.temperature = body.temperature;
  if (typeof body.top_p === "number") cleanBody.top_p = body.top_p;
  if (typeof body.presence_penalty === "number") cleanBody.presence_penalty = body.presence_penalty;
  if (typeof body.frequency_penalty === "number") cleanBody.frequency_penalty = body.frequency_penalty;
  if (body.stop) cleanBody.stop = body.stop;
  if (body.response_format) cleanBody.response_format = body.response_format;
  if (body.seed !== undefined) cleanBody.seed = body.seed;

  const maxTokens = body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens;
  if (typeof maxTokens === "number") {
    cleanBody.max_tokens = maxTokens;
  }

  return cleanBody;
}

export function convertChatToResponsesJson(chatJson: any, responseId: string): any {
  const choice = chatJson.choices?.[0];
  const message = choice?.message;
  let content = message?.content || choice?.text || "";
  let reasoning = message?.reasoning_content || message?.reasoning || "";

  // Extract <think>...</think> or <thought>...</thought> if reasoning_content is absent but embedded in content
  if (!reasoning && typeof content === "string") {
    const thinkMatch = content.match(/^<(think|thought)>([\s\S]*?)<\/\1>\s*/i);
    if (thinkMatch) {
      reasoning = thinkMatch[2].trim();
      content = content.slice(thinkMatch[0].length);
    }
  }

  const output: any[] = [];
  if (reasoning) {
    output.push({
      id: `reasoning_${responseId}`,
      type: "reasoning",
      status: "completed",
      summary: [],
    });
  }

  output.push({
    id: `item_${responseId}`,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: content,
      },
    ],
  });

  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: chatJson.model || "openai",
    output,
    usage: chatJson.usage,
  };
}

export function createChatToResponsesTransform(
  responseId: string,
  modelName: string,
  onFinish?: (fullText: string) => void
): TransformStream<Uint8Array, Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let fullReasoning = "";
  let createdSent = false;
  let reasoningStarted = false;
  let reasoningDone = false;
  let messageStarted = false;

  let insideThinkTag = false;

  function sendEvent(controller: TransformStreamDefaultController<Uint8Array>, event: string, data: any) {
    const payload = { type: event, ...data };
    const s = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    controller.enqueue(encoder.encode(s));
  }

  function ensureCreated(controller: TransformStreamDefaultController<Uint8Array>) {
    if (!createdSent) {
      createdSent = true;
      sendEvent(controller, "response.created", {
        response: {
          id: responseId,
          object: "response",
          status: "in_progress",
          model: modelName,
        },
      });
    }
  }

  function startReasoning(controller: TransformStreamDefaultController<Uint8Array>) {
    if (!reasoningStarted) {
      reasoningStarted = true;
      sendEvent(controller, "response.output_item.added", {
        response_id: responseId,
        output_index: 0,
        item: {
          id: `reasoning_${responseId}`,
          type: "reasoning",
          status: "in_progress",
          summary: [],
        },
      });
    }
  }

  function emitReasoningDelta(controller: TransformStreamDefaultController<Uint8Array>, delta: string) {
    ensureCreated(controller);
    startReasoning(controller);
    fullReasoning += delta;
    sendEvent(controller, "response.reasoning_text.delta", {
      response_id: responseId,
      item_id: `reasoning_${responseId}`,
      output_index: 0,
      content_index: 0,
      delta,
    });
    sendEvent(controller, "response.reasoning.delta", {
      response_id: responseId,
      item_id: `reasoning_${responseId}`,
      output_index: 0,
      delta,
    });
  }

  function finishReasoning(controller: TransformStreamDefaultController<Uint8Array>) {
    if (reasoningStarted && !reasoningDone) {
      reasoningDone = true;
      sendEvent(controller, "response.output_item.done", {
        response_id: responseId,
        output_index: 0,
        item: {
          id: `reasoning_${responseId}`,
          type: "reasoning",
          status: "completed",
          summary: [],
        },
      });
    }
  }

  function startMessage(controller: TransformStreamDefaultController<Uint8Array>) {
    finishReasoning(controller);
    if (!messageStarted) {
      messageStarted = true;
      const messageIndex = reasoningStarted ? 1 : 0;
      sendEvent(controller, "response.output_item.added", {
        response_id: responseId,
        output_index: messageIndex,
        item: {
          id: `item_${responseId}`,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
      });
      sendEvent(controller, "response.content_part.added", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: messageIndex,
        content_index: 0,
        part: { type: "output_text", text: "" },
      });
    }
  }

  function emitContentDelta(controller: TransformStreamDefaultController<Uint8Array>, delta: string) {
    ensureCreated(controller);
    startMessage(controller);
    fullContent += delta;
    const messageIndex = reasoningStarted ? 1 : 0;
    sendEvent(controller, "response.output_text.delta", {
      response_id: responseId,
      item_id: `item_${responseId}`,
      output_index: messageIndex,
      content_index: 0,
      delta,
    });
  }

  function handleContentChunk(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    let remaining = text;

    while (remaining.length > 0) {
      if (insideThinkTag) {
        const closeTagMatch = remaining.match(/<\/(think|thought)>/i);
        if (closeTagMatch && closeTagMatch.index !== undefined) {
          const thinkContent = remaining.slice(0, closeTagMatch.index);
          if (thinkContent) {
            emitReasoningDelta(controller, thinkContent);
          }
          finishReasoning(controller);
          insideThinkTag = false;
          remaining = remaining.slice(closeTagMatch.index + closeTagMatch[0].length);
        } else {
          emitReasoningDelta(controller, remaining);
          remaining = "";
        }
      } else {
        const openTagMatch = remaining.match(/<(think|thought)>/i);
        if (openTagMatch && openTagMatch.index !== undefined) {
          const preContent = remaining.slice(0, openTagMatch.index);
          if (preContent) {
            emitContentDelta(controller, preContent);
          }
          insideThinkTag = true;
          remaining = remaining.slice(openTagMatch.index + openTagMatch[0].length);
        } else {
          emitContentDelta(controller, remaining);
          remaining = "";
        }
      }
    }
  }

  function processLine(controller: TransformStreamDefaultController<Uint8Array>, line: string) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    try {
      const parsed = JSON.parse(payload);
      ensureCreated(controller);

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      // 1. Handle explicit reasoning deltas (DeepSeek-R1, Gemini Thinking, etc.)
      const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning ?? "";
      if (reasoningDelta && typeof reasoningDelta === "string") {
        emitReasoningDelta(controller, reasoningDelta);
      }

      // 2. Handle standard content deltas
      const contentDelta = delta?.content ?? choice?.text ?? "";
      if (contentDelta && typeof contentDelta === "string") {
        handleContentChunk(controller, contentDelta);
      }
    } catch {
      // ignore parse errors on fragmented chunks
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        processLine(controller, line);
      }
    },
    flush(controller) {
      if (buffer.trim()) {
        processLine(controller, buffer);
      }

      ensureCreated(controller);
      finishReasoning(controller);

      if (!messageStarted) {
        startMessage(controller);
      }

      const messageIndex = reasoningStarted ? 1 : 0;

      sendEvent(controller, "response.output_text.done", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: messageIndex,
        content_index: 0,
        text: fullContent,
      });

      sendEvent(controller, "response.content_part.done", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: messageIndex,
        content_index: 0,
        part: { type: "output_text", text: fullContent },
      });

      const messageOutputItem = {
        id: `item_${responseId}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: fullContent }],
      };

      sendEvent(controller, "response.output_item.done", {
        response_id: responseId,
        output_index: messageIndex,
        item: messageOutputItem,
      });

      const outputItems: any[] = [];
      if (reasoningStarted) {
        outputItems.push({
          id: `reasoning_${responseId}`,
          type: "reasoning",
          status: "completed",
          summary: [],
        });
      }
      outputItems.push(messageOutputItem);

      sendEvent(controller, "response.completed", {
        response: {
          id: responseId,
          object: "response",
          status: "completed",
          model: modelName,
          output: outputItems,
          usage: {
            input_tokens: 0,
            output_tokens: Math.max(1, Math.ceil(fullContent.length / 4)),
            total_tokens: Math.max(1, Math.ceil(fullContent.length / 4)),
          },
        },
      });

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      if (onFinish) onFinish(fullContent);
    },
  });
}
