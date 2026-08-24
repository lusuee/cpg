import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtNum } from "../api/client";
import type { ModelItem, Provider } from "../types";
import { Badge, Button, Card, Empty, Input, Select, Spinner, CopyButton } from "../components/ui";
import {
  IconPlayground,
  IconZap,
  IconRefresh,
  IconTrash,
  IconDownload,
  IconCopy,
  IconCheck,
} from "../components/icons";
import { useToast } from "../components/Toast";
import { useQuery } from "../hooks/useQuery";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: number;
  latency_ms?: number;
  tokens?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  provider_name?: string;
  model?: string;
}

const PRESET_PROMPTS = [
  {
    title: "🛠️ 代码重构与类型优化",
    prompt: "请帮我重构以下 TypeScript 函数，提升代码可读性、健壮性并添加严格的类型注解：\n\n```ts\nfunction processData(input: any) {\n  return input.filter((x: any) => x.active).map((x: any) => x.val * 2);\n}\n```",
  },
  {
    title: "🌐 专业中英双向翻译",
    prompt: "请将以下技术段落翻译为地道、专业、自然的中文技术文档风格：\n\n\"Cloudflare Workers provides a serverless execution environment that allows you to create entirely new applications or augment existing ones without configuring or maintaining infrastructure.\"",
  },
  {
    title: "📊 结构化 JSON 提取",
    prompt: "请从以下产品描述中提取产品名称、发布年份、核心特性列表，并严格以标准 JSON 格式输出：\n\n“Apple 于 2024 年发布了全新的 M4 MacBook Pro，配备 14.2 英寸 Liquid Retina XDR 屏幕，支持高达 38 小时电池续航，拥有强大的硬件光线追踪能力。”",
  },
  {
    title: "🧠 逐步逻辑推理 (Chain of Thought)",
    prompt: "请一步步推导演算以下问题：\n一个水池有甲乙两个进水管和一个丙排水管。单开甲管 6 小时可注满水池，单开乙管 8 小时可注满，单开丙管 12 小时可将满池水排空。若三管齐开，注满水池需要多少小时？",
  },
];

export default function PlaygroundPage() {
  const toast = useToast();

  // Load Models & Providers
  const fetchModels = useCallback(async () => {
    const res = await api.get<{ items: ModelItem[] }>("/api/models");
    return (res.items || []).filter((m) => m.enabled);
  }, []);
  const { data: models = [], loading: loadingModels } = useQuery("playground-models", fetchModels);

  const [selectedModel, setSelectedModel] = useState<string>("");
  const [systemPrompt, setSystemPrompt] = useState<string>("You are a helpful, accurate, and concise AI assistant.");
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(2048);
  const [stream, setStream] = useState<boolean>(true);

  // Chat conversation
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [showSystemConfig, setShowSystemConfig] = useState<boolean>(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-select first model
  useEffect(() => {
    if (models.length > 0 && !selectedModel) {
      const defaultM = models.find((m) => m.model_name.includes("gpt") || m.model_name.includes("claude")) || models[0];
      setSelectedModel(defaultM.alias || defaultM.model_name);
    }
  }, [models, selectedModel]);

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isGenerating]);

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputText).trim();
    if (!textToSend || isGenerating) return;

    if (!selectedModel) {
      toast.error("请先选择一个可用模型");
      return;
    }

    const userMsgId = `usr_${Date.now()}`;
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: textToSend,
      timestamp: Date.now(),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    if (!customText) setInputText("");
    setIsGenerating(true);

    const assistantMsgId = `asst_${Date.now()}`;
    const startTime = Date.now();

    // Prepare payload
    const apiMessages = newHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      if (stream) {
        // Initial empty assistant bubble
        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            model: selectedModel,
          },
        ]);

        const response = await fetch("/api/playground/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            messages: apiMessages,
            system_prompt: systemPrompt || undefined,
            temperature,
            max_tokens: maxTokens,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errJson = await response.json().catch(() => ({ error: "request_failed" }));
          throw new Error(errJson.message || `请求失败 HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        let accumulatedText = "";

        if (reader) {
          let buffer = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") continue;

              if (trimmed.startsWith("data: ")) {
                try {
                  const chunk = JSON.parse(trimmed.slice(6));
                  const delta =
                    chunk.choices?.[0]?.delta?.content ||
                    chunk.delta?.text ||
                    chunk.content_block?.text ||
                    "";
                  if (delta) {
                    accumulatedText += delta;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMsgId
                          ? {
                              ...msg,
                              content: accumulatedText,
                              latency_ms: Date.now() - startTime,
                            }
                          : msg
                      )
                    );
                  }
                } catch {
                  // Fallback plain text chunk
                }
              }
            }
          }
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  content: accumulatedText || "(无返回内容)",
                  latency_ms: Date.now() - startTime,
                }
              : msg
          )
        );
      } else {
        // Non-stream mode
        const res = await api.post<any>("/api/playground/chat", {
          model: selectedModel,
          messages: apiMessages,
          system_prompt: systemPrompt || undefined,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        });

        let assistantContent = "";
        if (res.data?.choices?.[0]?.message?.content) {
          assistantContent = res.data.choices[0].message.content;
        } else if (res.data?.content?.[0]?.text) {
          assistantContent = res.data.content[0].text;
        } else if (typeof res.data === "string") {
          assistantContent = res.data;
        } else {
          assistantContent = JSON.stringify(res.data, null, 2);
        }

        setMessages((prev) => [
          ...prev,
          {
            id: assistantMsgId,
            role: "assistant",
            content: assistantContent,
            timestamp: Date.now(),
            latency_ms: res.latency_ms || Date.now() - startTime,
            provider_name: res.provider_name,
            model: res.target_model || selectedModel,
            tokens: res.usage,
          },
        ]);
      }
    } catch (err: any) {
      toast.error(err.message || "请求模型响应失败");
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: "assistant",
          content: `⚠️ **请求错误**: ${err.message || "未知错误，请检查网络或上游 Provider 配置"}`,
          timestamp: Date.now(),
          latency_ms: Date.now() - startTime,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearChat = () => {
    if (messages.length > 0 && !confirm("确定要清空当前对话记录吗？")) return;
    setMessages([]);
  };

  const handleExportChat = () => {
    if (messages.length === 0) {
      toast.error("当前无对话内容可导出");
      return;
    }
    const md = messages
      .map((m) => `### ${m.role.toUpperCase()} (${m.model || selectedModel})\n\n${m.content}\n\n---`)
      .join("\n\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `playground-chat-${selectedModel}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("对话记录已导出为 Markdown");
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <IconPlayground className="text-blue-600 dark:text-blue-400" />
            API Playground (在线调试与对话工作台)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            在管理后台直接测试各模型连通性、输出质量与延迟，无需配置客户端 Token
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportChat} disabled={messages.length === 0}>
            <IconDownload />
            <span>导出对话</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleClearChat} disabled={messages.length === 0}>
            <IconTrash />
            <span>清空对话</span>
          </Button>
        </div>
      </div>

      {/* Main Grid: Control Panel on Left, Chat Area on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Parameters Sidebar */}
        <div className="lg:col-span-4 space-y-4">
          <Card>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              ⚙️ 模型与运行参数
            </h3>

            <div className="space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  选择测试模型 / 别名
                </label>
                {loadingModels ? (
                  <Spinner text="正在加载可用模型…" />
                ) : (
                  <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                    {models.map((m) => (
                      <option key={m.id} value={m.alias || m.model_name}>
                        {m.display_name || m.model_name} {m.alias ? `(别名: ${m.alias})` : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    System Prompt 系统提示词
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSystemConfig(!showSystemConfig)}
                    className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {showSystemConfig ? "收起" : "展开编辑"}
                  </button>
                </div>
                {showSystemConfig && (
                  <textarea
                    rows={3}
                    className="w-full text-xs p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="例如: You are a helpful AI assistant..."
                  />
                )}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Temperature (多样性)</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400 font-bold">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Max Tokens (最大生成长度)</span>
                  <span className="font-mono text-purple-600 dark:text-purple-400 font-bold">{maxTokens}</span>
                </div>
                <input
                  type="range"
                  min="256"
                  max="8192"
                  step="256"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <span className="font-medium text-slate-700 dark:text-slate-300">流式响应 (Stream)</span>
                  <p className="text-[11px] text-slate-400">逐字实时打字机渲染</p>
                </div>
                <input
                  type="checkbox"
                  checked={stream}
                  onChange={(e) => setStream(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
              </div>
            </div>
          </Card>

          {/* Quick Presets */}
          <Card>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2.5">
              💡 快捷测试模板
            </h3>
            <div className="space-y-2">
              {PRESET_PROMPTS.map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(p.prompt)}
                  disabled={isGenerating}
                  className="w-full text-left p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 border border-slate-100 dark:border-slate-700/60 transition-colors text-xs text-slate-700 dark:text-slate-300 font-medium"
                >
                  {p.title}
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Right Chat Interactive Area */}
        <div className="lg:col-span-8 flex flex-col h-[650px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
          {/* Messages Scroll Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-3">
                  <IconPlayground className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">开始您的模型测试</h4>
                <p className="text-xs text-slate-400 max-w-sm mt-1">
                  选择一个模型并在下方输入测试内容，或点击左侧快捷模板立即体验。
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[11px] text-slate-400">
                    <span className="font-semibold">{m.role === "user" ? "用户 (Admin)" : m.model || "Assistant"}</span>
                    {m.latency_ms && (
                      <span className="font-mono text-purple-600 dark:text-purple-400">⚡ {m.latency_ms}ms</span>
                    )}
                    {m.tokens && (
                      <span className="font-mono text-slate-500">({m.tokens.total_tokens || 0} tokens)</span>
                    )}
                  </div>
                  <div
                    className={`max-w-[88%] p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-blue-600 text-white rounded-br-none shadow-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-none border border-slate-200/50 dark:border-slate-700/50"
                    }`}
                  >
                    {m.content || (isGenerating && m.role === "assistant" ? "正在思考生成中…" : "")}
                  </div>
                  {m.role === "assistant" && m.content && (
                    <div className="mt-1 flex items-center gap-1">
                      <CopyButton text={m.content} />
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Bottom Chat Input Bar */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <textarea
                rows={2}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={`向 ${selectedModel || "模型"} 发送消息 (Enter 发送, Shift+Enter 换行)…`}
                disabled={isGenerating}
                className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
              />
              <Button
                type="submit"
                disabled={!inputText.trim() || isGenerating}
                className="self-stretch px-4"
              >
                {isGenerating ? "生成中…" : "发送"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
