export function convertResponsesRequest(body: any): any {
  const newBody: Record<string, any> = { ...body };
  if (!newBody.messages) {
    const messages: Array<{ role: string; content: any }> = [];
    if (newBody.instructions && typeof newBody.instructions === "string") {
      messages.push({ role: "system", content: newBody.instructions });
    }
    if (typeof newBody.input === "string") {
      messages.push({ role: "user", content: newBody.input });
    } else if (Array.isArray(newBody.input)) {
      for (const item of newBody.input) {
        if (typeof item === "string") {
          messages.push({ role: "user", content: item });
        } else if (item && typeof item === "object") {
          let role = item.role;
          if (!role) {
            role = item.type === "message" ? (item.role || "user") : "user";
          }
          let content = item.content ?? item.text ?? "";
          if (Array.isArray(content)) {
            const parts: string[] = [];
            for (const part of content) {
              if (typeof part === "string") {
                parts.push(part);
              } else if (part && typeof part === "object") {
                if (typeof part.text === "string") parts.push(part.text);
                else if (typeof part.input_text === "string") parts.push(part.input_text);
                else if (part.type === "input_text" && typeof part.text === "string") parts.push(part.text);
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
    }
    newBody.messages = messages.length ? messages : [{ role: "user", content: "Hello" }];
  }
  delete newBody.input;
  delete newBody.instructions;
  delete newBody.conversation;
  delete newBody.output_item_types;
  return newBody;
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
        id: `msg_${responseId}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "text",
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
            id: `msg_${responseId}`,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [{ type: "text", text: "" }],
          },
        });
        sendEvent(controller, "response.content_part.added", {
          response_id: responseId,
          item_id: `msg_${responseId}`,
          output_index: 0,
          content_index: 0,
          part: { type: "text", text: "" },
        });
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content ?? choice?.text ?? choice?.delta?.reasoning_content ?? "";
      if (delta && typeof delta === "string") {
        fullContent += delta;
        sendEvent(controller, "response.output_text.delta", {
          response_id: responseId,
          item_id: `msg_${responseId}`,
          output_index: 0,
          content_index: 0,
          delta,
        });
        sendEvent(controller, "response.text.delta", {
          response_id: responseId,
          item_id: `msg_${responseId}`,
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
            id: `msg_${responseId}`,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [{ type: "text", text: "" }],
          },
        });
        sendEvent(controller, "response.content_part.added", {
          response_id: responseId,
          item_id: `msg_${responseId}`,
          output_index: 0,
          content_index: 0,
          part: { type: "text", text: "" },
        });
      }

      sendEvent(controller, "response.output_text.done", {
        response_id: responseId,
        item_id: `msg_${responseId}`,
        output_index: 0,
        content_index: 0,
        text: fullContent,
      });

      sendEvent(controller, "response.text.done", {
        response_id: responseId,
        item_id: `msg_${responseId}`,
        output_index: 0,
        content_index: 0,
        text: fullContent,
      });

      sendEvent(controller, "response.content_part.done", {
        response_id: responseId,
        item_id: `msg_${responseId}`,
        output_index: 0,
        content_index: 0,
        part: { type: "text", text: fullContent },
      });

      sendEvent(controller, "response.output_item.done", {
        response_id: responseId,
        output_index: 0,
        item: {
          id: `msg_${responseId}`,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "text", text: fullContent }],
        },
      });

      const finalOutputItem = {
        id: `msg_${responseId}`,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "text", text: fullContent }],
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
            output_tokens: Math.ceil(fullContent.length / 4),
            total_tokens: Math.ceil(fullContent.length / 4),
          },
        },
      });

      sendEvent(controller, "response.done", {
        response: {
          id: responseId,
          object: "response",
          status: "completed",
          model: modelName,
          output: [finalOutputItem],
        },
      });

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      if (onFinish) onFinish(fullContent);
    },
  });
}
