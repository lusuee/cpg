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
  const content = chatJson.choices?.[0]?.message?.content || "";
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: chatJson.model || "openai",
    output: [
      {
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
      },
    ],
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
  let started = false;

  function sendEvent(controller: TransformStreamDefaultController<Uint8Array>, event: string, data: any) {
    const payload = { type: event, ...data };
    const s = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    controller.enqueue(encoder.encode(s));
  }

  function processLine(controller: TransformStreamDefaultController<Uint8Array>, line: string) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;

    try {
      const parsed = JSON.parse(payload);
      if (!started) {
        started = true;
        sendEvent(controller, "response.created", {
          response: {
            id: responseId,
            object: "response",
            status: "in_progress",
            model: modelName,
          },
        });
        sendEvent(controller, "response.output_item.added", {
          response_id: responseId,
          output_index: 0,
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
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "" },
        });
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.text ?? choice?.delta?.reasoning_content ?? "";
      if (delta && typeof delta === "string") {
        fullContent += delta;
        sendEvent(controller, "response.output_text.delta", {
          response_id: responseId,
          item_id: `item_${responseId}`,
          output_index: 0,
          content_index: 0,
          delta,
        });
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

      if (!started) {
        started = true;
        sendEvent(controller, "response.created", {
          response: {
            id: responseId,
            object: "response",
            status: "in_progress",
            model: modelName,
          },
        });
        sendEvent(controller, "response.output_item.added", {
          response_id: responseId,
          output_index: 0,
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
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "" },
        });
      }

      sendEvent(controller, "response.output_text.done", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: 0,
        content_index: 0,
        text: fullContent,
      });

      sendEvent(controller, "response.content_part.done", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: fullContent },
      });

      sendEvent(controller, "response.output_item.done", {
        response_id: responseId,
        output_index: 0,
        item: {
          id: `item_${responseId}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text: fullContent }],
        },
      });

      const finalOutputItem = {
        id: `item_${responseId}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: fullContent }],
      };

      sendEvent(controller, "response.completed", {
        response: {
          id: responseId,
          object: "response",
          status: "completed",
          model: modelName,
          output: [finalOutputItem],
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
