import { isReasoningModel } from "./catalog";

export interface ParsedToolCall {
  callId: string;
  name: string;
  arguments: Record<string, any>;
}

export function extractDsmlToolCalls(text: string): { cleanContent: string; toolCalls: ParsedToolCall[] } | null {
  const dsmlRegex = /<\s*\|\s*DSML\s*\|\s*tool_calls\s*>([\s\S]*?)<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i;
  const match = text.match(dsmlRegex);
  if (!match) return null;

  const fullBlock = match[0];
  const innerBlock = match[1];
  const toolCalls: ParsedToolCall[] = [];

  const invokeRegex = /<\s*\|\s*DSML\s*\|\s*invoke\s+name=[\"'](.*?)[\"']\s*>([\s\S]*?)<\s*\/\s*\|\s*DSML\s*\|\s*invoke\s*>/gi;
  let invokeMatch: RegExpExecArray | null;

  while ((invokeMatch = invokeRegex.exec(innerBlock)) !== null) {
    const name = invokeMatch[1].trim();
    const paramsBlock = invokeMatch[2];
    const args: Record<string, any> = {};

    const paramRegex = /<\s*\|\s*DSML\s*\|\s*parameter\s+name=[\"'](.*?)[\"'](?:\s+string=[\"'](.*?)[\"'])?\s*>([\s\S]*?)<\s*\/\s*\|\s*DSML\s*\|\s*parameter\s*>/gi;
    let paramMatch: RegExpExecArray | null;

    while ((paramMatch = paramRegex.exec(paramsBlock)) !== null) {
      const paramName = paramMatch[1].trim();
      const isString = (paramMatch[2] || "").toLowerCase() === "true";
      const isNotString = (paramMatch[2] || "").toLowerCase() === "false";
      let paramValue: any = paramMatch[3].trim();

      if (isNotString) {
        try {
          paramValue = JSON.parse(paramValue);
        } catch {
          // keep as string
        }
      } else if (!isString) {
        if (/^(\[|\{|\d+|true|false|null)/.test(paramValue)) {
          try {
            paramValue = JSON.parse(paramValue);
          } catch {
            // keep as string
          }
        }
      }

      args[paramName] = paramValue;
    }

    const callId = `call_${Math.random().toString(36).slice(2, 11)}`;
    toolCalls.push({
      callId,
      name,
      arguments: args,
    });
  }

  if (toolCalls.length === 0) return null;

  const cleanContent = text.replace(fullBlock, "").trim();
  return { cleanContent, toolCalls };
}

export function convertResponsesRequest(body: any, customConfig?: Record<string, any>): any {
  const messages: Array<{ role: string; content: any; tool_calls?: any[]; tool_call_id?: string }> = [];

  if (body.instructions && typeof body.instructions === "string") {
    messages.push({ role: "system", content: body.instructions });
  }

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    for (const m of body.messages) {
      if (m && typeof m === "object") {
        messages.push({
          role: m.role || "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
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
        if (item.type === "function_call") {
          const callId = item.call_id || item.id || `call_${Math.random().toString(36).slice(2, 9)}`;
          const args = typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {});
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: callId,
                type: "function",
                function: {
                  name: item.name,
                  arguments: args,
                },
              },
            ],
          });
          continue;
        }

        if (item.type === "function_call_output") {
          const callId = item.call_id || item.id;
          const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");
          messages.push({
            role: "tool",
            tool_call_id: callId,
            content: output,
          });
          continue;
        }

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

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const normalizedTools: any[] = [];
    for (const t of body.tools) {
      if (!t || typeof t !== "object") continue;

      if (t.type === "function" && t.function && typeof t.function === "object") {
        normalizedTools.push({
          type: "function",
          function: {
            name: t.function.name,
            ...(t.function.description ? { description: t.function.description } : {}),
            ...(t.function.parameters ? { parameters: t.function.parameters } : {}),
            ...(t.function.strict !== undefined ? { strict: t.function.strict } : {}),
          },
        });
        continue;
      }

      const name = t.name || t.function?.name || t.custom?.name;
      if (name && typeof name === "string") {
        const description = t.description || t.function?.description || t.custom?.description;
        const parameters = t.parameters || t.function?.parameters || t.custom?.parameters || { type: "object", properties: {} };
        normalizedTools.push({
          type: "function",
          function: {
            name,
            ...(description ? { description } : {}),
            parameters,
            ...(t.strict !== undefined ? { strict: t.strict } : {}),
          },
        });
      }
    }

    if (normalizedTools.length > 0) {
      cleanBody.tools = normalizedTools;
    }
  }

  if (body.tool_choice) {
    if (typeof body.tool_choice === "string") {
      cleanBody.tool_choice = body.tool_choice;
    } else if (typeof body.tool_choice === "object") {
      const name = body.tool_choice.name || body.tool_choice.function?.name || body.tool_choice.custom?.name;
      if (name) {
        cleanBody.tool_choice = {
          type: "function",
          function: { name },
        };
      } else if (body.tool_choice.type === "function") {
        cleanBody.tool_choice = body.tool_choice;
      }
    }
  }
  const temp = typeof body.temperature === "number" ? body.temperature : customConfig?.temperature;
  if (typeof temp === "number") cleanBody.temperature = temp;

  const topP = typeof body.top_p === "number" ? body.top_p : customConfig?.top_p;
  if (typeof topP === "number") cleanBody.top_p = topP;

  const presencePenalty = typeof body.presence_penalty === "number"
    ? body.presence_penalty
    : typeof customConfig?.presence_penalty === "number"
    ? customConfig.presence_penalty
    : 0.1; // Default mild anti-repetition penalty
  if (typeof presencePenalty === "number") cleanBody.presence_penalty = presencePenalty;

  const freqPenalty = typeof body.frequency_penalty === "number"
    ? body.frequency_penalty
    : customConfig?.frequency_penalty;
  if (typeof freqPenalty === "number") cleanBody.frequency_penalty = freqPenalty;

  if (body.stop) cleanBody.stop = body.stop;
  if (body.response_format) cleanBody.response_format = body.response_format;
  if (body.seed !== undefined) cleanBody.seed = body.seed;

  const maxTokens = body.max_tokens ?? body.max_output_tokens ?? body.max_completion_tokens;
  if (typeof maxTokens === "number") {
    cleanBody.max_tokens = maxTokens;
  }

  return cleanBody;
}

export function cleanReasoningAndContent(
  rawContent: string,
  rawReasoning: string
): { content: string; reasoning: string } {
  let content = rawContent || "";
  let reasoning = rawReasoning || "";

  // 1. If reasoning is absent, extract <think>...</think> or <thought>...</thought>
  if (!reasoning && typeof content === "string") {
    const thinkBlockMatch = content.match(/<(think|thought)>([\s\S]*?)<\/\1>/i);
    if (thinkBlockMatch && thinkBlockMatch.index !== undefined) {
      reasoning = thinkBlockMatch[2].trim();
      content = (content.slice(0, thinkBlockMatch.index) + content.slice(thinkBlockMatch.index + thinkBlockMatch[0].length)).trim();
    } else {
      const closeMatch = content.match(/^([\s\S]*?)<\/(think|thought)>\s*/i);
      if (closeMatch) {
        reasoning = closeMatch[1].trim();
        content = content.slice(closeMatch[0].length).trim();
      }
    }
  }

  // 2. Strip any leftover tags
  if (typeof content === "string") {
    content = content.replace(/<\/?(think|thought)>/gi, "").trim();
  }
  if (typeof reasoning === "string") {
    reasoning = reasoning.replace(/<\/?(think|thought)>/gi, "").trim();
  }

  return { content, reasoning };
}

export function convertChatToResponsesJson(chatJson: any, responseId: string): any {
  const choice = chatJson.choices?.[0];
  const message = choice?.message;
  const rawContent = message?.content || choice?.text || "";
  const rawReasoning = message?.reasoning_content || message?.reasoning || "";

  const cleaned = cleanReasoningAndContent(
    typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent),
    typeof rawReasoning === "string" ? rawReasoning : JSON.stringify(rawReasoning)
  );
  let content = cleaned.content;
  let reasoning = cleaned.reasoning;

  const output: any[] = [];
  if (reasoning) {
    output.push({
      id: `reasoning_${responseId}`,
      type: "reasoning",
      status: "completed",
      summary: [],
    });
  }

  // 1. Standard OpenAI tool_calls
  const standardToolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

  // 2. DSML tool calls inside content
  let dsmlToolCalls: ParsedToolCall[] = [];
  if (typeof content === "string") {
    const dsml = extractDsmlToolCalls(content);
    if (dsml) {
      content = dsml.cleanContent;
      dsmlToolCalls = dsml.toolCalls;
    }
  }

  if (content) {
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
  }

  for (const tc of standardToolCalls) {
    if (tc.type === "function") {
      output.push({
        id: `call_${tc.id || responseId}`,
        type: "function_call",
        status: "completed",
        call_id: tc.id || `call_${responseId}`,
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "{}",
      });
    }
  }

  for (const tc of dsmlToolCalls) {
    output.push({
      id: `call_${tc.callId}`,
      type: "function_call",
      status: "completed",
      call_id: tc.callId,
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    });
  }

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

export function detectRepetitionLoop(text: string): { isLoop: boolean; loopPattern?: string } {
  if (text.length < 36) return { isLoop: false };
  const tail = text.slice(-600);
  const maxL = Math.min(200, Math.floor(tail.length / 3));

  for (let l = 12; l <= maxL; l++) {
    const pattern = tail.slice(-l);
    const trimmed = pattern.trim();
    if (trimmed.length < 12) continue;

    // Ignore horizontal rules or separator lines (e.g. ------------ or ========)
    if (new Set(trimmed).size < 4) continue;

    if (tail.endsWith(pattern + pattern + pattern)) {
      return { isLoop: true, loopPattern: pattern };
    }
  }

  return { isLoop: false };
}

export function createChatToResponsesTransform(
  responseId: string,
  modelName: string,
  onFinish?: (fullText: string, metadata?: { reasoning?: string; outputItems?: any[] }) => void
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
  let messageDone = false;

  let insideThinkTag = false;
  let tagPendingBuffer = "";
  let reasoningTagPendingBuffer = "";
  let insideDsmlTag = false;
  let dsmlBuffer = "";
  let contentLoopDetected = false;
  let reasoningLoopDetected = false;

  let outputIndexCounter = 0;
  const emittedOutputItems: any[] = [];
  const activeToolCalls = new Map<number, { id: string; callId: string; name: string; arguments: string; outputIndex: number }>();

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
      const reasoningIndex = outputIndexCounter++;
      sendEvent(controller, "response.output_item.added", {
        response_id: responseId,
        output_index: reasoningIndex,
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
    if (reasoningLoopDetected || !delta) return;
    ensureCreated(controller);
    startReasoning(controller);

    const tentative = fullReasoning + delta;
    const loopCheck = detectRepetitionLoop(tentative);
    if (loopCheck.isLoop) {
      reasoningLoopDetected = true;
      finishReasoning(controller);
      return;
    }

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

  let messageOutputIndex = 0;

  function startMessage(controller: TransformStreamDefaultController<Uint8Array>) {
    finishReasoning(controller);
    if (!messageStarted) {
      messageStarted = true;
      messageOutputIndex = outputIndexCounter++;
      sendEvent(controller, "response.output_item.added", {
        response_id: responseId,
        output_index: messageOutputIndex,
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
        output_index: messageOutputIndex,
        content_index: 0,
        part: { type: "output_text", text: "" },
      });
    }
  }

  function emitContentDelta(controller: TransformStreamDefaultController<Uint8Array>, delta: string) {
    if (contentLoopDetected || !delta) return;
    ensureCreated(controller);
    startMessage(controller);

    const tentative = fullContent + delta;
    const loopCheck = detectRepetitionLoop(tentative);
    if (loopCheck.isLoop) {
      contentLoopDetected = true;
      finishMessage(controller);
      return;
    }

    fullContent += delta;
    sendEvent(controller, "response.output_text.delta", {
      response_id: responseId,
      item_id: `item_${responseId}`,
      output_index: messageOutputIndex,
      content_index: 0,
      delta,
    });
  }

  function finishMessage(controller: TransformStreamDefaultController<Uint8Array>) {
    if (messageStarted && !messageDone) {
      messageDone = true;
      sendEvent(controller, "response.output_text.done", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: messageOutputIndex,
        content_index: 0,
        text: fullContent,
      });

      sendEvent(controller, "response.content_part.done", {
        response_id: responseId,
        item_id: `item_${responseId}`,
        output_index: messageOutputIndex,
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
        output_index: messageOutputIndex,
        item: messageOutputItem,
      });

      emittedOutputItems.push(messageOutputItem);
    }
  }

  function emitFunctionCall(
    controller: TransformStreamDefaultController<Uint8Array>,
    name: string,
    argumentsObjOrString: any,
    explicitCallId?: string
  ) {
    ensureCreated(controller);
    finishReasoning(controller);
    finishMessage(controller);

    const callId = explicitCallId || `call_${Math.random().toString(36).slice(2, 11)}`;
    const argsStr = typeof argumentsObjOrString === "string" ? argumentsObjOrString : JSON.stringify(argumentsObjOrString);
    const itemIndex = outputIndexCounter++;
    const itemId = `call_${callId}`;

    const funcItem = {
      id: itemId,
      type: "function_call",
      status: "in_progress",
      call_id: callId,
      name,
      arguments: "",
    };

    sendEvent(controller, "response.output_item.added", {
      response_id: responseId,
      output_index: itemIndex,
      item: funcItem,
    });

    sendEvent(controller, "response.function_call_arguments.delta", {
      response_id: responseId,
      item_id: itemId,
      output_index: itemIndex,
      call_id: callId,
      delta: argsStr,
    });

    sendEvent(controller, "response.function_call_arguments.done", {
      response_id: responseId,
      item_id: itemId,
      output_index: itemIndex,
      call_id: callId,
      arguments: argsStr,
    });

    const completedFuncItem = {
      id: itemId,
      type: "function_call",
      status: "completed",
      call_id: callId,
      name,
      arguments: argsStr,
    };

    sendEvent(controller, "response.output_item.done", {
      response_id: responseId,
      output_index: itemIndex,
      item: completedFuncItem,
    });

    emittedOutputItems.push(completedFuncItem);
  }

  function handleReasoningChunk(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    let remaining = reasoningTagPendingBuffer + text;
    reasoningTagPendingBuffer = "";

    const closeTagMatch = remaining.match(/<\/(think|thought)>/i);
    if (closeTagMatch && closeTagMatch.index !== undefined) {
      const thinkPart = remaining.slice(0, closeTagMatch.index);
      const afterPart = remaining.slice(closeTagMatch.index + closeTagMatch[0].length);
      const cleanThink = thinkPart.replace(/<\/?(think|thought)>/gi, "");
      if (cleanThink) {
        emitReasoningDelta(controller, cleanThink);
      }
      finishReasoning(controller);
      insideThinkTag = false;
      if (afterPart) {
        handleContentChunk(controller, afterPart);
      }
      return;
    }

    const trailing = remaining.match(/<[^>]{0,40}$/);
    if (trailing) {
      const safeText = remaining.slice(0, remaining.length - trailing[0].length);
      reasoningTagPendingBuffer = trailing[0];
      const cleanSafe = safeText.replace(/<\/?(think|thought)>/gi, "");
      if (cleanSafe) {
        emitReasoningDelta(controller, cleanSafe);
      }
    } else {
      const cleanAll = remaining.replace(/<\/?(think|thought)>/gi, "");
      if (cleanAll) {
        emitReasoningDelta(controller, cleanAll);
      }
    }
  }

  function handleContentChunk(controller: TransformStreamDefaultController<Uint8Array>, text: string) {
    let remaining = tagPendingBuffer + text;
    tagPendingBuffer = "";

    while (remaining.length > 0) {
      if (insideThinkTag) {
        const closeTagMatch = remaining.match(/<\/(think|thought)>/i);
        if (closeTagMatch && closeTagMatch.index !== undefined) {
          const thinkContent = remaining.slice(0, closeTagMatch.index);
          const cleanThink = thinkContent.replace(/<\/?(think|thought)>/gi, "");
          if (cleanThink) {
            emitReasoningDelta(controller, cleanThink);
          }
          finishReasoning(controller);
          insideThinkTag = false;
          remaining = remaining.slice(closeTagMatch.index + closeTagMatch[0].length);
        } else {
          const trailing = remaining.match(/<[^>]{0,40}$/);
          if (trailing) {
            const safeText = remaining.slice(0, remaining.length - trailing[0].length);
            tagPendingBuffer = trailing[0];
            const cleanSafe = safeText.replace(/<\/?(think|thought)>/gi, "");
            if (cleanSafe) {
              emitReasoningDelta(controller, cleanSafe);
            }
            remaining = "";
          } else {
            const cleanAll = remaining.replace(/<\/?(think|thought)>/gi, "");
            if (cleanAll) {
              emitReasoningDelta(controller, cleanAll);
            }
            remaining = "";
          }
        }
      } else if (insideDsmlTag) {
        dsmlBuffer += remaining;
        remaining = "";
        const closeDsmlMatch = dsmlBuffer.match(/<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i);
        if (closeDsmlMatch && closeDsmlMatch.index !== undefined) {
          const fullDsml = dsmlBuffer.slice(0, closeDsmlMatch.index + closeDsmlMatch[0].length);
          const afterDsml = dsmlBuffer.slice(fullDsml.length);
          insideDsmlTag = false;
          dsmlBuffer = "";

          const parsed = extractDsmlToolCalls(fullDsml);
          if (parsed) {
            for (const tc of parsed.toolCalls) {
              emitFunctionCall(controller, tc.name, tc.arguments, tc.callId);
            }
          }

          remaining = afterDsml;
        }
      } else {
        const openThinkMatch = remaining.match(/<(think|thought)>/i);
        const closeThinkMatch = remaining.match(/<\/(think|thought)>/i);
        const openDsmlMatch = remaining.match(/<\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i);

        let firstMatch: { type: "open_think" | "close_think" | "open_dsml"; index: number; length: number } | null = null;
        if (openThinkMatch && openThinkMatch.index !== undefined) {
          firstMatch = { type: "open_think", index: openThinkMatch.index, length: openThinkMatch[0].length };
        }
        if (closeThinkMatch && closeThinkMatch.index !== undefined) {
          if (!firstMatch || closeThinkMatch.index < firstMatch.index) {
            firstMatch = { type: "close_think", index: closeThinkMatch.index, length: closeThinkMatch[0].length };
          }
        }
        if (openDsmlMatch && openDsmlMatch.index !== undefined) {
          if (!firstMatch || openDsmlMatch.index < firstMatch.index) {
            firstMatch = { type: "open_dsml", index: openDsmlMatch.index, length: openDsmlMatch[0].length };
          }
        }

        if (firstMatch) {
          const preContent = remaining.slice(0, firstMatch.index);
          if (firstMatch.type === "open_think") {
            if (preContent) {
              emitContentDelta(controller, preContent);
            }
            insideThinkTag = true;
            remaining = remaining.slice(firstMatch.index + firstMatch.length);
          } else if (firstMatch.type === "close_think") {
            if (!reasoningDone && !messageStarted) {
              if (preContent) {
                emitReasoningDelta(controller, preContent);
              }
            } else {
              if (preContent) {
                emitContentDelta(controller, preContent);
              }
            }
            finishReasoning(controller);
            insideThinkTag = false;
            remaining = remaining.slice(firstMatch.index + firstMatch.length);
          } else {
            if (preContent) {
              emitContentDelta(controller, preContent);
            }
            insideDsmlTag = true;
            dsmlBuffer = remaining.slice(firstMatch.index);
            remaining = "";
            const closeDsmlMatch = dsmlBuffer.match(/<\s*\/\s*\|\s*DSML\s*\|\s*tool_calls\s*>/i);
            if (closeDsmlMatch && closeDsmlMatch.index !== undefined) {
              const fullDsml = dsmlBuffer.slice(0, closeDsmlMatch.index + closeDsmlMatch[0].length);
              const afterDsml = dsmlBuffer.slice(fullDsml.length);
              insideDsmlTag = false;
              dsmlBuffer = "";

              const parsed = extractDsmlToolCalls(fullDsml);
              if (parsed) {
                for (const tc of parsed.toolCalls) {
                  emitFunctionCall(controller, tc.name, tc.arguments, tc.callId);
                }
              }

              remaining = afterDsml;
            }
          }
        } else {
          const trailing = remaining.match(/<[^>]{0,40}$/);
          if (trailing) {
            const safeText = remaining.slice(0, remaining.length - trailing[0].length);
            tagPendingBuffer = trailing[0];
            if (safeText) {
              emitContentDelta(controller, safeText);
            }
            remaining = "";
          } else {
            emitContentDelta(controller, remaining);
            remaining = "";
          }
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

      // 1. Handle explicit reasoning deltas
      const reasoningDelta = delta?.reasoning_content ?? delta?.reasoning ?? "";
      if (reasoningDelta && typeof reasoningDelta === "string") {
        handleReasoningChunk(controller, reasoningDelta);
      }

      // 2. Handle standard OpenAI streaming tool_calls
      if (Array.isArray(delta?.tool_calls)) {
        finishReasoning(controller);
        finishMessage(controller);

        for (const tc of delta.tool_calls) {
          const index = typeof tc.index === "number" ? tc.index : 0;
          let entry = activeToolCalls.get(index);

          if (!entry && tc.function?.name) {
            const callId = tc.id || `call_${Math.random().toString(36).slice(2, 11)}`;
            const itemIndex = outputIndexCounter++;
            const itemId = `call_${callId}`;

            entry = {
              id: itemId,
              callId,
              name: tc.function.name,
              arguments: "",
              outputIndex: itemIndex,
            };
            activeToolCalls.set(index, entry);

            sendEvent(controller, "response.output_item.added", {
              response_id: responseId,
              output_index: itemIndex,
              item: {
                id: itemId,
                type: "function_call",
                status: "in_progress",
                call_id: callId,
                name: entry.name,
                arguments: "",
              },
            });
          }

          const argChunk = tc.function?.arguments;
          if (entry && argChunk && typeof argChunk === "string") {
            entry.arguments += argChunk;
            sendEvent(controller, "response.function_call_arguments.delta", {
              response_id: responseId,
              item_id: entry.id,
              output_index: entry.outputIndex,
              call_id: entry.callId,
              delta: argChunk,
            });
          }
        }
      }

      // 3. Handle standard content deltas
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

      if (reasoningTagPendingBuffer) {
        const clean = reasoningTagPendingBuffer.replace(/<\/?(think|thought)>/gi, "");
        if (clean) emitReasoningDelta(controller, clean);
        reasoningTagPendingBuffer = "";
      }

      if (tagPendingBuffer) {
        const clean = tagPendingBuffer.replace(/<\/?(think|thought)>/gi, "");
        if (clean) {
          if (insideThinkTag) {
            emitReasoningDelta(controller, clean);
          } else {
            emitContentDelta(controller, clean);
          }
        }
        tagPendingBuffer = "";
      }

      // Flush lingering DSML buffer if stream ended
      if (insideDsmlTag && dsmlBuffer) {
        const parsed = extractDsmlToolCalls(dsmlBuffer);
        if (parsed) {
          for (const tc of parsed.toolCalls) {
            emitFunctionCall(controller, tc.name, tc.arguments, tc.callId);
          }
        }
        dsmlBuffer = "";
        insideDsmlTag = false;
      }

      ensureCreated(controller);
      finishReasoning(controller);

      // Finish any standard streaming tool calls
      for (const [, tc] of activeToolCalls) {
        sendEvent(controller, "response.function_call_arguments.done", {
          response_id: responseId,
          item_id: tc.id,
          output_index: tc.outputIndex,
          call_id: tc.callId,
          arguments: tc.arguments,
        });

        const completedItem = {
          id: tc.id,
          type: "function_call",
          status: "completed",
          call_id: tc.callId,
          name: tc.name,
          arguments: tc.arguments,
        };

        sendEvent(controller, "response.output_item.done", {
          response_id: responseId,
          output_index: tc.outputIndex,
          item: completedItem,
        });

        emittedOutputItems.push(completedItem);
      }

      if (messageStarted) {
        finishMessage(controller);
      } else if (emittedOutputItems.length === 0) {
        // If neither message nor tool calls were sent, emit empty message
        startMessage(controller);
        finishMessage(controller);
      }

      const finalOutputList: any[] = [];
      if (reasoningStarted) {
        finalOutputList.push({
          id: `reasoning_${responseId}`,
          type: "reasoning",
          status: "completed",
          summary: [],
        });
      }
      finalOutputList.push(...emittedOutputItems);

      sendEvent(controller, "response.completed", {
        response: {
          id: responseId,
          object: "response",
          status: "completed",
          model: modelName,
          output: finalOutputList,
          usage: {
            input_tokens: 0,
            output_tokens: Math.max(1, Math.ceil(fullContent.length / 4)),
            total_tokens: Math.max(1, Math.ceil(fullContent.length / 4)),
          },
        },
      });

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      if (onFinish) onFinish(fullContent, { reasoning: fullReasoning, outputItems: finalOutputList });
    },
  });
}
