import { z } from "zod";
import { zValidator as zv } from "@hono/zod-validator";
import type { ZodSchema } from "zod";
import type { ValidationTargets } from "hono";

export const zValidator = <Target extends keyof ValidationTargets, T extends ZodSchema>(
  target: Target,
  schema: T
) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const fieldPath = firstIssue?.path.join(".");
      const fieldPrefix = fieldPath ? `${fieldPath}: ` : "";
      return c.json(
        {
          error: "validation_error",
          message: `${fieldPrefix}${firstIssue?.message || "Invalid request"}`,
          issues: result.error.issues,
        },
        400
      );
    }
  });

// Auth Schemas
export const LoginSchema = z.object({
  password: z.string().min(1, "密码不能为空"),
});

// Provider Schemas
export const CreateProviderSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(100),
  type: z.enum(["anthropic", "openai", "gemini"], {
    errorMap: () => ({ message: "type 必须是 anthropic, openai 或 gemini" }),
  }),
  endpoint: z.string().url("endpoint 必须是合法的 URL").nullable().optional(),
  api_key: z.string().nullable().optional(),
  secret_name: z.string().max(100).nullable().optional(),
  enabled: z.boolean().optional().default(true),
  config_json: z.string().nullable().optional(),
});

export const UpdateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["anthropic", "openai", "gemini"]).optional(),
  endpoint: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  secret_name: z.string().max(100).nullable().optional(),
  enabled: z.boolean().optional(),
  config_json: z.string().nullable().optional(),
});

export const BatchUpdateProvidersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "ids 列表不能为空"),
  enabled: z.boolean().optional(),
});

export const BatchDeleteProvidersSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "ids 列表不能为空"),
});

// Model Schemas
export const CreateModelSchema = z.object({
  provider_id: z.string().min(1, "provider_id 不能为空"),
  model_name: z.string().min(1, "model_name 不能为空").max(150),
  display_name: z.string().nullable().optional(),
  alias: z.string().nullable().optional(),
  fallback_model_id: z.string().nullable().optional(),
  input_price_per_m: z.number().min(0).optional().default(0),
  output_price_per_m: z.number().min(0).optional().default(0),
  cache_enabled: z.boolean().optional().default(false),
  cache_ttl: z.number().min(60).optional().default(3600),
  enabled: z.boolean().optional().default(true),
  config_json: z.string().nullable().optional(),
});

export const UpdateModelSchema = z.object({
  provider_id: z.string().min(1).optional(),
  model_name: z.string().min(1).max(150).optional(),
  display_name: z.string().nullable().optional(),
  alias: z.string().nullable().optional(),
  fallback_model_id: z.string().nullable().optional(),
  input_price_per_m: z.number().min(0).optional(),
  output_price_per_m: z.number().min(0).optional(),
  cache_enabled: z.boolean().optional(),
  cache_ttl: z.number().min(60).optional(),
  enabled: z.boolean().optional(),
  config_json: z.string().nullable().optional(),
});

export const BatchCreateModelItemSchema = z.union([
  z.string().min(1),
  z.object({
    model_name: z.string().min(1, "model_name 不能为空"),
    display_name: z.string().optional(),
    alias: z.string().optional(),
  }),
]);

export const BatchCreateModelsSchema = z.object({
  provider_id: z.string().min(1, "provider_id 不能为空"),
  models: z.array(BatchCreateModelItemSchema).min(1, "models 列表不能为空"),
});

export const BatchUpdateModelsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "ids 列表不能为空"),
  enabled: z.boolean().optional(),
  cache_enabled: z.boolean().optional(),
  cache_ttl: z.number().min(60).optional(),
});

export const BatchDeleteModelsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "ids 列表不能为空"),
});

// Device Schemas
export const CreateDeviceSchema = z.object({
  name: z.string().min(1, "设备名称不能为空").max(100),
  rate_limit_rpm: z.number().int().min(0).optional().default(0),
});

export const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  rate_limit_rpm: z.number().int().min(0).optional(),
});

// Usage Schemas
export const AggregateStatsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date 必须为 YYYY-MM-DD 格式").optional(),
});

// CC-Switch Schemas
export const CcSwitchPreviewSchema = z.object({
  raw: z.string().min(1, "配置内容不能为空"),
});

export const CcSwitchImportItemSchema = z.object({
  name: z.string().min(1, "Provider 名称不能为空").max(100),
  type: z.enum(["anthropic", "openai", "gemini"]),
  endpoint: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  models: z
    .array(
      z.object({
        model_name: z.string().min(1),
        display_name: z.string().optional(),
        alias: z.string().optional(),
        input_price_per_m: z.number().optional(),
        output_price_per_m: z.number().optional(),
      })
    )
    .optional()
    .default([]),
  config_json: z.string().nullable().optional(),
});

export const CcSwitchImportSchema = z.object({
  raw: z.string().optional(),
  items: z.array(CcSwitchImportItemSchema).optional(),
  overwrite: z.boolean().optional().default(false),
  import_models: z.boolean().optional().default(true),
});
