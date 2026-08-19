import { describe, expect, it } from "vitest";
import { maskApiKey, publicProvider } from "../src/admin/providers";
import type { Env, ProviderRow } from "../src/types";

describe("Provider API Key Management", () => {
  it("masks API keys properly for security", () => {
    expect(maskApiKey("sk-proj-1234567890abcdef1234")).toBe("sk-pro••••1234");
    expect(maskApiKey("AIzaSyD1234567890abcdef")).toBe("AIzaSy••••cdef");
    expect(maskApiKey("12345678")).toBe("••••••••");
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey(undefined)).toBeNull();
  });

  it("publicProvider hides plaintext api_key and returns masked key and configuration status", () => {
    const mockEnv = {
      DB: {} as any,
      ASSETS: {} as any,
      CF_TEST_SECRET: "sk-env-secret-val",
    } as Env;

    const dbKeyProvider: ProviderRow = {
      id: "prov_1",
      name: "OpenAI DB",
      type: "openai",
      endpoint: "https://api.openai.com/v1",
      api_key: "sk-proj-db-api-key-99887766",
      secret_name: null,
      enabled: 1,
      config_json: null,
      created_at: 1000,
      updated_at: 1000,
    };

    const pub1 = publicProvider(dbKeyProvider, mockEnv);
    expect(pub1.api_key).toBeUndefined();
    expect(pub1.api_key_configured).toBe(true);
    expect(pub1.api_key_masked).toBe("sk-pro••••7766");

    const envSecretProvider: ProviderRow = {
      id: "prov_2",
      name: "OpenAI Secret",
      type: "openai",
      endpoint: null,
      api_key: null,
      secret_name: "CF_TEST_SECRET",
      enabled: 1,
      config_json: null,
      created_at: 1000,
      updated_at: 1000,
    };

    const pub2 = publicProvider(envSecretProvider, mockEnv);
    expect(pub2.api_key).toBeUndefined();
    expect(pub2.api_key_configured).toBe(true);
    expect(pub2.api_key_masked).toBeNull();

    const emptyProvider: ProviderRow = {
      id: "prov_3",
      name: "Unconfigured",
      type: "anthropic",
      endpoint: null,
      api_key: null,
      secret_name: "NON_EXISTENT_SECRET",
      enabled: 1,
      config_json: null,
      created_at: 1000,
      updated_at: 1000,
    };

    const pub3 = publicProvider(emptyProvider, mockEnv);
    expect(pub3.api_key_configured).toBe(false);
    expect(pub3.api_key_masked).toBeNull();
  });
});
