export function convertResponsesRequest(body: any): any {
  const newBody = { ...body };
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
          const role = item.role || (item.type === "message" ? "user" : "user");
          let content = item.content || item.text || "";
          if (Array.isArray(content)) {
            content = content
              .map((c) => (typeof c === "string" ? c : c.text || JSON.stringify(c)))
              .join("\n");
          }
          messages.push({ role, content });
        }
      }
    }
    newBody.messages = messages;
  }
  delete newBody.input;
  delete newBody.instructions;
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
    const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    controller.enqueue(encoder.encode(s));
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

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
                content: [],
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

          const delta = parsed.choices?.[0]?.delta?.content || "";
          if (delta) {
            fullContent += delta;
            sendEvent(controller, "response.output_text.delta", {
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
    },
    flush(controller) {
      if (!started) {
        sendEvent(controller, "response.created", {
          response: {
            id: responseId,
            object: "response",
            status: "in_progress",
            model: modelName,
          },
        });
      }
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
      sendEvent(controller, "response.completed", {
        response: {
          id: responseId,
          object: "response",
          status: "completed",
          model: modelName,
        },
      });
      if (onFinish) onFinish(fullContent);
    },
  });
}
