import type { Env } from "../types";
import { listModels, listProviders } from "../db/repo";
import { inferModelCapabilities } from "./catalog";

export async function generateOpenApiSpec(env: Env, baseUrl?: string): Promise<Record<string, unknown>> {
  const [models, providers] = await Promise.all([
    listModels(env),
    listProviders(env),
  ]);

  const enabledModels = models.filter((m) => m.enabled === 1);
  const enabledProviders = providers.filter((p) => p.enabled === 1);

  const modelIds = Array.from(
    new Set([
      ...enabledModels.map((m) => m.model_name),
      ...enabledModels.map((m) => m.alias).filter((a): a is string => Boolean(a)),
    ])
  );

  const serverUrl = baseUrl || env.GATEWAY_BASE_URL || "https://gateway.example.com";

  return {
    openapi: "3.0.3",
    info: {
      title: env.APP_NAME ? `${env.APP_NAME} API` : "CPG Personal AI Gateway API",
      version: "1.0.0",
      description:
        "High-performance personal unified AI Gateway deployed on Cloudflare Workers edge network. Seamlessly proxy, multiplex, cache, and rate-limit OpenAI, Anthropic, Gemini, and DeepSeek upstream models.",
      contact: {
        name: "Gateway Administrator",
      },
    },
    servers: [
      {
        url: serverUrl,
        description: "Primary Edge AI Gateway Server",
      },
    ],
    paths: {
      "/v1/chat/completions": {
        post: {
          summary: "OpenAI-compatible Chat Completions",
          description:
            "Create a model response for the given chat conversation. Compatible with OpenAI Python/Node SDK, LangChain, Cursor, and any OpenAI-compatible client.",
          operationId: "createChatCompletion",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ChatCompletionRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful response (JSON object or Server-Sent Events stream)",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ChatCompletionResponse",
                  },
                },
                "text/event-stream": {
                  schema: {
                    type: "string",
                    description: "SSE stream with data: [DONE] chunks",
                  },
                },
              },
            },
            "401": {
              $ref: "#/components/responses/UnauthorizedError",
            },
            "429": {
              $ref: "#/components/responses/RateLimitError",
            },
            "500": {
              $ref: "#/components/responses/InternalServerError",
            },
          },
        },
      },
      "/v1/messages": {
        post: {
          summary: "Anthropic-compatible Messages API",
          description:
            "Send a structured list of input messages and get a Claude model response. Compatible with Anthropic SDK.",
          operationId: "createAnthropicMessage",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AnthropicMessageRequest",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful response from Anthropic Claude model",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                  },
                },
              },
            },
            "401": {
              $ref: "#/components/responses/UnauthorizedError",
            },
            "429": {
              $ref: "#/components/responses/RateLimitError",
            },
          },
        },
      },
      "/v1/models": {
        get: {
          summary: "List Available Models",
          description: "List all currently configured and enabled AI models and aliases available through the gateway.",
          operationId: "listModels",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "List of available models in OpenAI format",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ModelListResponse",
                  },
                },
              },
            },
          },
        },
      },
      "/v1/models/{model_id}": {
        get: {
          summary: "Retrieve Model Details",
          description: "Get metadata, capability tags, and pricing for a specific model or alias.",
          operationId: "retrieveModel",
          security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
          parameters: [
            {
              name: "model_id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "The model ID or alias",
            },
          ],
          responses: {
            "200": {
              description: "Model details",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ModelItem",
                  },
                },
              },
            },
            "404": {
              description: "Model not found",
            },
          },
        },
      },
      "/health": {
        get: {
          summary: "Gateway Health Check",
          description: "Unauthenticated health probe endpoint for uptime monitoring.",
          responses: {
            "200": {
              description: "Service is healthy and ready",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean", example: true },
                      service: { type: "string", example: "personal-ai-gateway" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Device Token passed in Authorization header: Bearer <token>",
        },
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: "Device Token passed in x-api-key header",
        },
      },
      schemas: {
        ChatCompletionRequest: {
          type: "object",
          required: ["model", "messages"],
          properties: {
            model: {
              type: "string",
              description: "ID of the model or alias to use",
              enum: modelIds.length > 0 ? modelIds : ["gpt-4o", "claude-3-5-sonnet", "deepseek-reasoner"],
              example: modelIds[0] || "gpt-4o",
            },
            messages: {
              type: "array",
              description: "A list of messages comprising the conversation so far.",
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: {
                    type: "string",
                    enum: ["system", "user", "assistant", "tool"],
                    example: "user",
                  },
                  content: {
                    oneOf: [
                      { type: "string", example: "Hello, what can you do?" },
                      { type: "array", items: { type: "object" } },
                    ],
                  },
                  name: { type: "string" },
                },
              },
            },
            temperature: {
              type: "number",
              minimum: 0,
              maximum: 2,
              default: 1,
              description: "Sampling temperature between 0 and 2.",
            },
            max_tokens: {
              type: "integer",
              minimum: 1,
              description: "The maximum number of tokens to generate in the chat completion.",
            },
            stream: {
              type: "boolean",
              default: false,
              description: "If set, partial message deltas will be sent as Server-Sent Events.",
            },
            tools: {
              type: "array",
              items: { type: "object" },
              description: "A list of tools the model may call.",
            },
          },
        },
        ChatCompletionResponse: {
          type: "object",
          properties: {
            id: { type: "string", example: "chatcmpl-12345" },
            object: { type: "string", example: "chat.completion" },
            created: { type: "integer", example: 1785542400 },
            model: { type: "string", example: "gpt-4o" },
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", example: 0 },
                  message: {
                    type: "object",
                    properties: {
                      role: { type: "string", example: "assistant" },
                      content: { type: "string", example: "Hello! How can I assist you today?" },
                    },
                  },
                  finish_reason: { type: "string", example: "stop" },
                },
              },
            },
            usage: {
              type: "object",
              properties: {
                prompt_tokens: { type: "integer", example: 12 },
                completion_tokens: { type: "integer", example: 9 },
                total_tokens: { type: "integer", example: 21 },
              },
            },
          },
        },
        AnthropicMessageRequest: {
          type: "object",
          required: ["model", "messages", "max_tokens"],
          properties: {
            model: {
              type: "string",
              example: "claude-3-5-sonnet",
            },
            messages: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: { type: "string", enum: ["user", "assistant"] },
                  content: { type: "string" },
                },
              },
            },
            max_tokens: { type: "integer", example: 4096 },
            system: { type: "string" },
            temperature: { type: "number", example: 1 },
            stream: { type: "boolean", default: false },
          },
        },
        ModelItem: {
          type: "object",
          properties: {
            id: { type: "string", example: "gpt-4o" },
            object: { type: "string", example: "model" },
            created: { type: "integer", example: 1785542400 },
            owned_by: { type: "string", example: "openai" },
            capabilities: {
              type: "array",
              items: { type: "string" },
              example: ["vision", "tool_call", "long_context"],
            },
          },
        },
        ModelListResponse: {
          type: "object",
          properties: {
            object: { type: "string", example: "list" },
            data: {
              type: "array",
              items: { $ref: "#/components/schemas/ModelItem" },
            },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: "Authentication failed. Missing or invalid Bearer Token.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string", example: "unauthorized" },
                },
              },
            },
          },
        },
        RateLimitError: {
          description: "Rate limit exceeded or budget quota reached.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string", example: "rate_limit_exceeded" },
                  message: { type: "string", example: "Device monthly spending limit exceeded" },
                },
              },
            },
          },
        },
        InternalServerError: {
          description: "Internal gateway or upstream error.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string", example: "upstream_error" },
                },
              },
            },
          },
        },
      },
    },
  };
}
