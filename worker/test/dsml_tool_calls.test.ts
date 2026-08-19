import { describe, expect, it } from "vitest";
import {
  extractDsmlToolCalls,
  convertResponsesRequest,
  convertChatToResponsesJson,
  createChatToResponsesTransform,
} from "../src/gateway/responses_adapter";

describe("DSML & Tool Calling Adapter", () => {
  const userScreenshotSample = `我来帮你查一下2026年下一次法定假日的具体日期（基于中国官方法定节假日）。

< | DSML | tool_calls>
< | DSML | invoke name="exec_command">
< | DSML | parameter name="cmd" string="true">curl -s --max-time 15 'https://api.caihongzh.com/holiday?year=2026'</ | DSML | parameter>
< | DSML | parameter name="justification" string="true">Do you want to allow a network request to fetch China's 2026 statutory holidays JSON?</ | DSML | parameter>
< | DSML | parameter name="sandbox_permissions" string="true">require_escalated</ | DSML | parameter>
< | DSML | parameter name="prefix_rule" string="false">["curl", "-s"]</ | DSML | parameter>
</ | DSML | invoke>
</ | DSML | tool_calls>`;

  it("extracts DSML tool calls correctly", () => {
    const result = extractDsmlToolCalls(userScreenshotSample);
    expect(result).not.toBeNull();
    expect(result?.cleanContent).toBe("我来帮你查一下2026年下一次法定假日的具体日期（基于中国官方法定节假日）。");
    expect(result?.toolCalls.length).toBe(1);

    const tc = result?.toolCalls[0];
    expect(tc?.name).toBe("exec_command");
    expect(tc?.arguments.cmd).toBe("curl -s --max-time 15 'https://api.caihongzh.com/holiday?year=2026'");
    expect(tc?.arguments.justification).toBe("Do you want to allow a network request to fetch China's 2026 statutory holidays JSON?");
    expect(tc?.arguments.sandbox_permissions).toBe("require_escalated");
    expect(tc?.arguments.prefix_rule).toEqual(["curl", "-s"]);
  });

  it("converts responses request with tools and function call outputs", () => {
    const reqBody = {
      model: "deepseek-r1",
      tools: [
        {
          type: "function",
          name: "exec_command",
          description: "Execute a shell command",
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
          },
        },
      ],
      input: [
        { role: "user", content: "下一次法定假日是什么时候" },
        {
          type: "function_call",
          call_id: "call_test_123",
          name: "exec_command",
          arguments: '{"cmd":"curl ..." }',
        },
        {
          type: "function_call_output",
          call_id: "call_test_123",
          output: '{"holiday": "2026-01-01", "name": "元旦"}',
        },
      ],
    };

    const clean = convertResponsesRequest(reqBody);
    expect(clean.model).toBe("deepseek-r1");
    expect(clean.tools.length).toBe(1);
    expect(clean.tools[0].function.name).toBe("exec_command");
    expect(clean.messages.length).toBe(3);
    expect(clean.messages[0].role).toBe("user");
    expect(clean.messages[1].role).toBe("assistant");
    expect(clean.messages[1].tool_calls?.[0].function.name).toBe("exec_command");
    expect(clean.messages[2].role).toBe("tool");
    expect(clean.messages[2].tool_call_id).toBe("call_test_123");
  });

  it("converts non-streaming chat JSON containing DSML into function_call output item", () => {
    const chatJson = {
      model: "deepseek-v3",
      choices: [
        {
          message: {
            role: "assistant",
            content: userScreenshotSample,
          },
        },
      ],
      usage: { input_tokens: 10, output_tokens: 50, total_tokens: 60 },
    };

    const resp = convertChatToResponsesJson(chatJson, "resp_dsml_1");
    expect(resp.output.length).toBe(2);

    const msgItem = resp.output.find((x: any) => x.type === "message");
    expect(msgItem?.content[0].text).toBe("我来帮你查一下2026年下一次法定假日的具体日期（基于中国官方法定节假日）。");

    const funcItem = resp.output.find((x: any) => x.type === "function_call");
    expect(funcItem).toBeDefined();
    expect(funcItem?.name).toBe("exec_command");
    const parsedArgs = JSON.parse(funcItem?.arguments);
    expect(parsedArgs.cmd).toBe("curl -s --max-time 15 'https://api.caihongzh.com/holiday?year=2026'");
  });

  it("converts streaming chat SSE chunks with DSML into function_call SSE events", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"我来帮你查一下2026年下一次法定假日的具体日期"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"（基于中国官方法定节假日）。\\n\\n< | DSML | tool_calls>\\n< | DSML | invoke name=\\"exec_command\\">\\n< | DSML | parameter name=\\"cmd\\" string=\\"true\\">curl -s --max-time 15 \'https://api.caihongzh.com/holiday?year=2026\'</ | DSML | parameter>\\n</ | DSML | invoke>\\n</ | DSML | tool_calls>"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const transform = createChatToResponsesTransform("resp_stream_dsml", "deepseek-v3");
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) {
          controller.enqueue(enc.encode(c));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transform);
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let eventsText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      eventsText += decoder.decode(value);
    }

    // Must NOT leak DSML raw tag in output text delta
    expect(eventsText).not.toContain("< | DSML | tool_calls>");

    // Must contain function_call event
    expect(eventsText).toContain('"type":"function_call"');
    expect(eventsText).toContain('"name":"exec_command"');
    expect(eventsText).toContain("curl -s --max-time 15");
  });
});
