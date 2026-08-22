import type { Env } from "../types";
import { getSetting } from "../db/repo";

export interface WebhookEventPayload {
  event: "budget_exceeded" | "budget_warning" | "provider_error" | "test";
  title: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp?: number;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  events: string[];
}

/**
 * Format payload according to target webhook platform (Feishu, DingTalk, WeCom, Slack, Discord, or generic JSON)
 */
export function buildPlatformPayload(url: string, payload: WebhookEventPayload): { body: string; headers: Record<string, string> } {
  const ts = new Date(payload.timestamp || Date.now()).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // 1. Feishu / Lark Webhook
  if (url.includes("open.feishu.cn") || url.includes("open.larksuite.com")) {
    const contentText = `【${payload.title}】\n${payload.message}\n时间: ${ts}` +
      (payload.details ? `\n详情: ${JSON.stringify(payload.details, null, 2)}` : "");
    return {
      body: JSON.stringify({
        msg_type: "text",
        content: { text: contentText },
      }),
      headers,
    };
  }

  // 2. DingTalk Webhook
  if (url.includes("dingtalk.com")) {
    const text = `### ${payload.title}\n\n${payload.message}\n\n> **时间**: ${ts}` +
      (payload.details ? `\n\n\`\`\`json\n${JSON.stringify(payload.details, null, 2)}\n\`\`\`` : "");
    return {
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: {
          title: payload.title,
          text,
        },
      }),
      headers,
    };
  }

  // 3. WeCom Webhook
  if (url.includes("qyapi.weixin.qq.com")) {
    const text = `**【${payload.title}】**\n${payload.message}\n> 时间: <font color="comment">${ts}</font>` +
      (payload.details ? `\n\`\`\`json\n${JSON.stringify(payload.details, null, 2)}\n\`\`\`` : "");
    return {
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content: text },
      }),
      headers,
    };
  }

  // 4. Slack Webhook
  if (url.includes("hooks.slack.com")) {
    return {
      body: JSON.stringify({
        text: `*${payload.title}*\n${payload.message}\n_Time: ${ts}_`,
        attachments: payload.details
          ? [{ text: "\`\`\`" + JSON.stringify(payload.details, null, 2) + "\`\`\`" }]
          : undefined,
      }),
      headers,
    };
  }

  // 5. Discord Webhook
  if (url.includes("discord.com") || url.includes("discordapp.com")) {
    return {
      body: JSON.stringify({
        content: `**${payload.title}**\n${payload.message}\n> _${ts}_`,
        embeds: payload.details
          ? [
              {
                title: "Event Details",
                description: "\`\`\`json\n" + JSON.stringify(payload.details, null, 2) + "\n\`\`\`",
                color: payload.event.includes("error") || payload.event.includes("exceeded") ? 0xff4d4f : 0x1890ff,
              },
            ]
          : undefined,
      }),
      headers,
    };
  }

  // 6. Generic Custom Webhook
  return {
    body: JSON.stringify({
      event: payload.event,
      title: payload.title,
      message: payload.message,
      details: payload.details || {},
      timestamp: payload.timestamp || Date.now(),
    }),
    headers,
  };
}

/**
 * Send webhook notification asynchronously with timeout safety
 */
export async function sendWebhookNotification(
  env: Env,
  payload: WebhookEventPayload
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const rawConfig = await getSetting(env, "webhook_config");
    if (!rawConfig) return { ok: false, error: "webhook_not_configured" };

    const config: WebhookConfig = typeof rawConfig === "string" ? JSON.parse(rawConfig) : (rawConfig as any);
    if (!config?.url || !config.url.startsWith("http")) {
      return { ok: false, error: "invalid_webhook_url" };
    }

    if (payload.event !== "test") {
      const allowedEvents = Array.isArray(config.events) ? config.events : [];
      if (!allowedEvents.includes(payload.event) && !allowedEvents.includes("all")) {
        return { ok: true, error: "event_ignored_by_filter" };
      }
    }

    const { body, headers } = buildPlatformPayload(config.url, payload);
    if (config.secret) {
      headers["X-Webhook-Secret"] = config.secret;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${errText.slice(0, 150)}` };
    }

    return { ok: true, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err.name === "AbortError" ? "请求 Webhook 超时 (5s)" : err.message || "未知网络错误" };
  }
}
