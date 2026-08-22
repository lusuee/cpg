import { describe, expect, it } from "vitest";
import {
  parseCcSwitchConfig,
  parseCcSwitchSql,
  parseCcSwitchUrl,
  parseCcSwitchJson,
  parseCcSwitchEnv,
} from "../src/admin/ccswitch";

describe("CC Switch Configuration Parser", () => {
  it("parses CC-Switch SQL export format", () => {
    const sql = `
      INSERT INTO providers (id, app_type, name, settings_config, meta) VALUES
      ('prov-1', 'claude', 'Claude 官方', '{"apiKey":"sk-ant-test123456","apiBaseUrl":"https://api.anthropic.com","models":["claude-3-7-sonnet-20250219","claude-3-5-haiku-20241022"]}', '{"providerType":"anthropic"}'),
      ('prov-2', 'codex', 'DeepSeek 官方', '{"apiKey":"sk-dsk-test987654","apiBaseUrl":"https://api.deepseek.com/v1"}', '{"meta":1}');
    `;

    const result = parseCcSwitchSql(sql);
    expect(result.length).toBe(2);

    // Provider 1
    expect(result[0].name).toBe("Claude 官方");
    expect(result[0].type).toBe("anthropic");
    expect(result[0].api_key).toBe("sk-ant-test123456");
    expect(result[0].endpoint).toBe("https://api.anthropic.com");
    expect(result[0].models.map((m) => m.model_name)).toEqual([
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022",
    ]);

    // Provider 2
    expect(result[1].name).toBe("DeepSeek 官方");
    expect(result[1].type).toBe("openai");
    expect(result[1].api_key).toBe("sk-dsk-test987654");
    expect(result[1].endpoint).toBe("https://api.deepseek.com/v1");
    // Should have inferred default DeepSeek models
    expect(result[1].models.map((m) => m.model_name)).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });

  it("parses CC-Switch deep link protocol (ccswitch://)", () => {
    const url =
      "ccswitch://v1/import?resource=provider&app=claude&name=SiliconFlow%20Provider&apiKey=sk-sf-test&endpoint=https%3A%2F%2Fapi.siliconflow.cn%2Fv1&models=deepseek-ai%2FDeepSeek-V3%2Cdeepseek-ai%2FDeepSeek-R1";

    const result = parseCcSwitchUrl(url);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe("SiliconFlow Provider");
    expect(result[0].type).toBe("anthropic");
    expect(result[0].api_key).toBe("sk-sf-test");
    expect(result[0].endpoint).toBe("https://api.siliconflow.cn/v1");
    expect(result[0].models.map((m) => m.model_name)).toEqual([
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
    ]);
  });

  it("parses CC-Switch JSON export array", () => {
    const jsonStr = JSON.stringify([
      {
        id: "p1",
        name: "Zhipu AI",
        app_type: "claude",
        settings_config: {
          apiKey: "sk-zhipu-123",
          apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
          models: ["glm-4-plus", "glm-4-flash"],
        },
      },
      {
        name: "Google Gemini",
        type: "gemini",
        api_key: "AIzaSyTestKey",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
      },
    ]);

    const result = parseCcSwitchJson(jsonStr);
    expect(result.length).toBe(2);

    expect(result[0].name).toBe("Zhipu AI");
    expect(result[0].type).toBe("anthropic");
    expect(result[0].api_key).toBe("sk-zhipu-123");
    expect(result[0].endpoint).toBe("https://open.bigmodel.cn/api/paas/v4");
    expect(result[0].models.map((m) => m.model_name)).toEqual(["glm-4-plus", "glm-4-flash"]);

    expect(result[1].name).toBe("Google Gemini");
    expect(result[1].type).toBe("gemini");
    expect(result[1].api_key).toBe("AIzaSyTestKey");
    expect(result[1].endpoint).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  it("parses Claude Code settings.json env format", () => {
    const settingsJson = JSON.stringify({
      env: {
        ANTHROPIC_API_KEY: "sk-ant-api03-test",
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_MODEL: "claude-3-7-sonnet-20250219",
      },
    });

    const result = parseCcSwitchJson(settingsJson);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("anthropic");
    expect(result[0].api_key).toBe("sk-ant-api03-test");
    expect(result[0].endpoint).toBe("https://api.anthropic.com");
    expect(result[0].models.length).toBeGreaterThan(0);
    expect(result[0].models[0].model_name).toBe("claude-3-7-sonnet-20250219");
  });

  it("parses .env file format", () => {
    const envText = `
      # Custom OpenAI API
      OPENAI_API_KEY=sk-openai-12345
      OPENAI_BASE_URL=https://api.openai.com/v1
      OPENAI_MODEL=gpt-4o
    `;

    const result = parseCcSwitchEnv(envText);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe("openai");
    expect(result[0].api_key).toBe("sk-openai-12345");
    expect(result[0].endpoint).toBe("https://api.openai.com/v1");
    expect(result[0].models.map((m) => m.model_name)).toContain("gpt-4o");
  });

  it("handles parseCcSwitchConfig universal dispatcher", () => {
    const sql = `INSERT INTO providers (id, app_type, name, settings_config, meta) VALUES ('1', 'gemini', 'Gemini Pro', '{"apiKey":"key123"}', '{}');`;
    const resSql = parseCcSwitchConfig(sql);
    expect(resSql.length).toBe(1);
    expect(resSql[0].name).toBe("Gemini Pro");
    expect(resSql[0].type).toBe("gemini");

    const link = `ccswitch://v1/import?name=DirectLink&apiKey=abc&endpoint=https%3A%2F%2Fapi.com`;
    const resLink = parseCcSwitchConfig(link);
    expect(resLink.length).toBe(1);
    expect(resLink[0].name).toBe("DirectLink");
  });

  it("handles preview endpoint POST /api/providers/ccswitch/preview", async () => {
    const { providersApp } = await import("../src/admin/providers");
    const req = new Request("http://localhost/ccswitch/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: "ccswitch://v1/import?name=TestProv&apiKey=sk-1234567890&endpoint=https%3A%2F%2Fapi.test.com%2Fv1&models=m1%2Cm2",
      }),
    });

    const mockEnv = { DB: {} as any };
    const res = await providersApp.fetch(req, mockEnv);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.count).toBe(1);
    expect(json.items[0].name).toBe("TestProv");
    expect(json.items[0].api_key_masked).toBeDefined();
    expect(json.items[0].models.length).toBe(2);
  });

  it("handles import endpoint POST /api/providers/ccswitch/import", async () => {
    const { providersApp } = await import("../src/admin/providers");
    let insertedProvider: any = null;
    let insertedModels: any[] = [];

    const mockEnv = {
      DB: {
        prepare: (sql: string) => ({
          all: async () => ({ results: [] }),
          bind: (...args: any[]) => ({
            all: async () => ({ results: [] }),
            first: async () => {
              if (sql.includes("SELECT * FROM providers WHERE name = ?")) {
                return null; // Not existing
              }
              if (sql.includes("SELECT id FROM models WHERE provider_id = ? AND model_name = ?")) {
                return null; // Model not existing
              }
              return null;
            },
            run: async () => {
              if (sql.includes("INSERT INTO providers")) {
                insertedProvider = { id: args[0], name: args[1], type: args[2] };
              }
              if (sql.includes("INSERT INTO models")) {
                insertedModels.push({ id: args[0], provider_id: args[1], model_name: args[2] });
              }
              return { meta: { changes: 1 } };
            },
          }),
        }),
      },
    } as any;

    const req = new Request("http://localhost/ccswitch/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw: "ccswitch://v1/import?name=NewImported&apiKey=sk-test&endpoint=https%3A%2F%2Fapi.openai.com%2Fv1&models=gpt-4o",
        import_models: true,
      }),
    });

    const res = await providersApp.fetch(req, mockEnv);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.imported_providers).toBe(1);
    expect(json.imported_models).toBe(1);
    expect(insertedProvider.name).toBe("NewImported");
    expect(insertedModels[0].model_name).toBe("gpt-4o");
  });
});

