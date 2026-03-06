import { describe, it, expect, vi } from "vitest";
import { ComposioClient } from "./client.js";
import { parseComposioConfig } from "./config.js";
import { createComposioExecuteTool } from "./tools/execute.js";
import { createComposioConnectionsTool } from "./tools/connections.js";

// Mock the Composio SDK
vi.mock("@composio/core", () => ({
  Composio: vi.fn().mockImplementation(() => ({
    toolRouter: {
      create: vi.fn().mockResolvedValue({
        sessionId: "test-session-123",
        tools: vi.fn().mockResolvedValue([]),
        authorize: vi.fn().mockResolvedValue({ url: "https://connect.composio.dev/test" }),
        toolkits: vi.fn().mockResolvedValue({
          items: [
            { slug: "gmail", name: "Gmail", connection: { isActive: true } },
            { slug: "sentry", name: "Sentry", connection: { isActive: false } },
            { slug: "github", name: "GitHub", connection: { isActive: true } },
            { slug: "affinity", name: "Affinity", connection: { isActive: false } },
          ],
        }),
        experimental: { assistivePrompt: "" },
      }),
    },
    client: {
      connectedAccounts: {
        list: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
      },
    },
    tools: {
      executeMetaTool: vi.fn().mockResolvedValue({
        successful: true,
        data: { results: [{ tool_slug: "GMAIL_FETCH_EMAILS", index: 0, response: { successful: true, data: { messages: [] } } }] },
      }),
      execute: vi.fn().mockResolvedValue({
        successful: true,
        data: { direct: true },
      }),
    },
    connectedAccounts: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      get: vi.fn().mockResolvedValue({ toolkit: { slug: "gmail" }, status: "ACTIVE" }),
      delete: vi.fn().mockResolvedValue({}),
    },
  })),
}));

function makeClient(overrides?: Partial<ReturnType<typeof parseComposioConfig>>) {
  return new ComposioClient({
    enabled: true,
    apiKey: "test-key",
    userId: "default",
    ...overrides,
  });
}

async function getLatestComposioInstance() {
  const { Composio } = await import("@composio/core");
  const mockResults = (Composio as any).mock.results;
  return mockResults[mockResults.length - 1].value;
}

describe("config parsing", () => {
  it("reads apiKey from config object", () => {
    const config = parseComposioConfig({ config: { apiKey: "from-config" } });
    expect(config.apiKey).toBe("from-config");
  });

  it("reads apiKey from top-level", () => {
    const config = parseComposioConfig({ apiKey: "from-top" });
    expect(config.apiKey).toBe("from-top");
  });

  it("falls back to env var", () => {
    process.env.COMPOSIO_API_KEY = "from-env";
    process.env.COMPOSIO_USER_ID = "env-user";
    const config = parseComposioConfig({});
    expect(config.apiKey).toBe("from-env");
    expect(config.userId).toBe("env-user");
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_USER_ID;
  });

  it("defaults enabled to true", () => {
    const config = parseComposioConfig({});
    expect(config.enabled).toBe(true);
  });
});

describe("connection status", () => {
  it("reports gmail as connected", async () => {
    const client = makeClient();
    const statuses = await client.getConnectionStatus(["gmail"]);
    expect(statuses[0].connected).toBe(true);
  });

  it("reports sentry as not connected", async () => {
    const client = makeClient();
    const statuses = await client.getConnectionStatus(["sentry"]);
    expect(statuses[0].connected).toBe(false);
  });

  it("reports toolkit as connected when active connected account exists", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.connectedAccounts.list.mockResolvedValueOnce({
      items: [{ toolkit: { slug: "affinity" }, status: "ACTIVE" }],
      nextCursor: null,
    });

    const statuses = await client.getConnectionStatus(["affinity"]);
    expect(statuses[0].connected).toBe(true);
  });

  it("returns only connected toolkits when no filter", async () => {
    const client = makeClient();
    const statuses = await client.getConnectionStatus();
    expect(statuses.every(s => s.connected)).toBe(true);
    expect(statuses.map(s => s.toolkit)).toEqual(["gmail", "github"]);
  });
});

describe("execute tool", () => {
  it("executes and returns result", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ messages: [] });
    expect(instance.tools.executeMetaTool).toHaveBeenCalledWith(
      "COMPOSIO_MULTI_EXECUTE_TOOL",
      expect.objectContaining({ sessionId: "test-session-123" })
    );
  });

  it("uses data_preview when meta-tool omits response.data", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [{ id: "ca_gmail", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } }],
      next_cursor: null,
    });
    instance.tools.executeMetaTool.mockResolvedValueOnce({
      successful: true,
      data: {
        results: [
          {
            tool_slug: "GMAIL_FETCH_EMAILS",
            index: 0,
            response: {
              successful: true,
              data_preview: { messages: [{ id: "m1" }] },
            },
          },
        ],
      },
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ messages: [{ id: "m1" }] });
  });

  it("pins execution to explicit connected_account_id", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.connectedAccounts.get.mockResolvedValueOnce({
      toolkit: { slug: "gmail" },
      status: "ACTIVE",
      user_id: "default",
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {}, undefined, "ca_explicit");
    expect(result.success).toBe(true);
    expect(instance.toolRouter.create).toHaveBeenCalledWith("default", {
      connectedAccounts: { gmail: "ca_explicit" },
    });
  });

  it("uses configured userId when connected_account_id is provided", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.connectedAccounts.get.mockResolvedValueOnce({
      toolkit: { slug: "gmail" },
      status: "ACTIVE",
      user_id: "default",
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {}, undefined, "ca_explicit");
    expect(result.success).toBe(true);
    expect(instance.toolRouter.create).toHaveBeenCalledWith("default", {
      connectedAccounts: { gmail: "ca_explicit" },
    });
  });

  it("errors when explicit user_id does not match configured userId", async () => {
    const client = makeClient({ userId: "founding" });
    const instance = await getLatestComposioInstance();
    instance.connectedAccounts.get.mockResolvedValueOnce({
      toolkit: { slug: "gmail" },
      status: "ACTIVE",
      user_id: "customclaw",
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {}, undefined, "ca_explicit");
    expect(result.success).toBe(false);
    expect(result.error).toContain("belongs to user_id 'customclaw'");
    expect(result.error).toContain("'founding' is configured");
  });

  it("fails closed when explicit connected_account_id owner metadata is missing", async () => {
    const client = makeClient({ userId: "founding" });
    const instance = await getLatestComposioInstance();
    instance.connectedAccounts.get.mockResolvedValueOnce({
      toolkit: { slug: "gmail" },
      status: "ACTIVE",
    });
    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [],
      next_cursor: null,
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {}, undefined, "ca_explicit");
    expect(result.success).toBe(false);
    expect(result.error).toContain("ownership could not be verified");
    expect(instance.client.connectedAccounts.list).toHaveBeenCalledWith({
      toolkit_slugs: ["gmail"],
      user_ids: ["founding"],
      statuses: ["ACTIVE"],
      limit: 100,
    });
  });

  it("auto-pins execution when one active account exists", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_single", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } },
      ],
      next_cursor: null,
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {});
    expect(result.success).toBe(true);
    expect(instance.toolRouter.create).toHaveBeenCalledWith("default", {
      connectedAccounts: { gmail: "ca_single" },
    });
  });

  it("fails with clear error when multiple active accounts exist and none selected", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_1", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } },
        { id: "ca_2", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } },
      ],
      next_cursor: null,
    });

    const result = await client.executeTool("GMAIL_FETCH_EMAILS", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("Multiple ACTIVE 'gmail' accounts");
    expect(result.error).toContain("ca_1");
    expect(result.error).toContain("ca_2");
  });

  it("fails when meta-tool resolves entity as default for non-default user", async () => {
    const client = makeClient({ userId: "pg-user" });
    const instance = await getLatestComposioInstance();

    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_sentry", userId: "pg-user", status: "ACTIVE", toolkit: { slug: "sentry" } },
      ],
      next_cursor: null,
    });

    instance.tools.executeMetaTool.mockResolvedValueOnce({
      successful: false,
      error: "1 out of 1 tools failed",
      data: {
        results: [{ error: "Error: No connected account found for entity ID default for toolkit sentry" }],
      },
    });

    const result = await client.executeTool("SENTRY_GET_ORGANIZATION_DETAILS", {}, "pg-user");

    expect(result.success).toBe(false);
    expect(instance.tools.execute).not.toHaveBeenCalled();
  });

  it("does not retry execution using server-hinted identifiers", async () => {
    const client = makeClient({ userId: "pg-user" });
    const instance = await getLatestComposioInstance();

    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_posthog", userId: "pg-user", status: "ACTIVE", toolkit: { slug: "posthog" } },
      ],
      next_cursor: null,
    });

    instance.tools.executeMetaTool.mockResolvedValueOnce({
      successful: true,
      data: {
        results: [
          {
            tool_slug: "POSTHOG_RETRIEVE_USER_PROFILE_AND_TEAM_DETAILS",
            index: 0,
            response: {
              successful: false,
              error: JSON.stringify({
                type: "authentication_error",
                code: "permission_denied",
                detail: "As a non-staff user you're only allowed to access the `@me` user instance.",
                attr: null,
              }),
            },
          },
        ],
      },
    });

    const result = await client.executeTool(
      "POSTHOG_RETRIEVE_USER_PROFILE_AND_TEAM_DETAILS",
      { uuid: "some-other-uuid" },
      "pg-user"
    );

    expect(result.success).toBe(false);
    expect(instance.tools.execute).not.toHaveBeenCalled();
  });

  it("does not use direct execution fallback when meta-tool execution fails", async () => {
    const client = makeClient({ userId: "pg-user" });
    const instance = await getLatestComposioInstance();

    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_sentry", userId: "pg-user", status: "ACTIVE", toolkit: { slug: "sentry" } },
      ],
      next_cursor: null,
    });

    instance.tools.executeMetaTool.mockResolvedValueOnce({
      successful: false,
      error: "1 out of 1 tools failed",
      data: {
        results: [{ error: "Error: No connected account found for entity ID default for toolkit sentry" }],
      },
    });

    const result = await client.executeTool("SENTRY_GET_ORGANIZATION_DETAILS", {}, "pg-user");

    expect(result.success).toBe(false);
    expect(instance.tools.execute).not.toHaveBeenCalled();
  });
});

describe("strict user scoping", () => {
  it("uses configured userId for search", async () => {
    const client = makeClient();
    await expect(client.searchTools("fetch email")).resolves.toEqual(expect.any(Array));
  });

  it("uses configured userId for execute", async () => {
    const client = makeClient();
    await expect(client.executeTool("GMAIL_FETCH_EMAILS", {})).resolves.toMatchObject({ success: true });
  });

  it("uses configured userId for status", async () => {
    const client = makeClient();
    await expect(client.getConnectionStatus(["gmail"])).resolves.toEqual(expect.any(Array));
  });

  it("uses configured userId for createConnection", async () => {
    const client = makeClient();
    await expect(client.createConnection("gmail")).resolves.toHaveProperty("authUrl");
  });

  it("uses configured userId for listToolkits", async () => {
    const client = makeClient();
    await expect(client.listToolkits()).resolves.toEqual(expect.any(Array));
  });

  it("fails closed when no configured userId exists", async () => {
    const client = makeClient({ userId: "" });
    await expect(client.searchTools("fetch email")).rejects.toThrow(/userId/i);
  });
});

describe("create connection", () => {
  it("returns auth URL", async () => {
    const client = makeClient();
    const result = await client.createConnection("gmail");
    expect("authUrl" in result).toBe(true);
    if ("authUrl" in result) {
      expect(result.authUrl).toContain("connect.composio.dev");
    }
  });

  it("returns error when provider response has no auth URL", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.toolRouter.create.mockResolvedValueOnce({
      sessionId: "test-empty-url",
      tools: vi.fn().mockResolvedValue([]),
      authorize: vi.fn().mockResolvedValue({}),
      toolkits: vi.fn().mockResolvedValue({ items: [] }),
      experimental: { assistivePrompt: "" },
    });

    const result = await client.createConnection("gmail");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/auth url/i);
    }
  });
});

describe("disconnect toolkit", () => {
  it("disconnects single active account", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();

    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_gmail", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } },
      ],
      next_cursor: null,
    });

    const result = await client.disconnectToolkit("gmail");
    expect(result.success).toBe(true);
    expect(instance.connectedAccounts.delete).toHaveBeenCalledWith("ca_gmail");
  });

  it("fails safely when multiple active accounts exist", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();

    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        { id: "ca_1", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } },
        { id: "ca_2", userId: "default", status: "ACTIVE", toolkit: { slug: "gmail" } },
      ],
      next_cursor: null,
    });

    const result = await client.disconnectToolkit("gmail");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Multiple ACTIVE 'gmail' accounts");
    expect(instance.connectedAccounts.delete).not.toHaveBeenCalled();
  });
});

describe("connected accounts discovery", () => {
  it("lists connected accounts from raw API when available", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.client.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        {
          id: "ca_1",
          user_id: "user-a",
          status: "ACTIVE",
          toolkit: { slug: "sentry" },
          auth_config: { id: "ac_1" },
        },
      ],
      next_cursor: null,
    });

    const accounts = await client.listConnectedAccounts({ toolkits: ["sentry"], statuses: ["ACTIVE"] });
    expect(instance.client.connectedAccounts.list).toHaveBeenCalledWith({
      toolkit_slugs: ["sentry"],
      user_ids: ["default"],
      statuses: ["ACTIVE"],
      limit: 100,
    });
    expect(instance.connectedAccounts.list).not.toHaveBeenCalled();
    expect(accounts).toEqual([
      {
        id: "ca_1",
        toolkit: "sentry",
        userId: "user-a",
        status: "ACTIVE",
        authConfigId: "ac_1",
        isDisabled: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      },
    ]);
  });

  it("falls back to SDK list API when raw API fails", async () => {
    const client = makeClient();
    const instance = await getLatestComposioInstance();
    instance.client.connectedAccounts.list.mockRejectedValueOnce(new Error("raw unavailable"));
    instance.connectedAccounts.list.mockResolvedValueOnce({
      items: [
        {
          id: "ca_2",
          userId: "user-b",
          status: "ACTIVE",
          toolkit: { slug: "sentry" },
          authConfig: { id: "ac_2" },
        },
      ],
      nextCursor: null,
    });

    const accounts = await client.listConnectedAccounts({ toolkits: ["sentry"], statuses: ["ACTIVE"] });
    expect(instance.connectedAccounts.list).toHaveBeenCalledWith({
      toolkitSlugs: ["sentry"],
      userIds: ["default"],
      statuses: ["ACTIVE"],
      limit: 100,
    });
    expect(accounts).toEqual([
      {
        id: "ca_2",
        toolkit: "sentry",
        userId: "user-b",
        status: "ACTIVE",
        authConfigId: "ac_2",
        isDisabled: undefined,
        createdAt: undefined,
        updatedAt: undefined,
      },
    ]);
  });

  it("rejects connected account discovery outside the configured user scope", async () => {
    const client = makeClient();
    await expect(
      client.listConnectedAccounts({ toolkits: ["sentry"], userIds: ["other-user"], statuses: ["ACTIVE"] })
    ).rejects.toThrow(/outside the configured userId/i);
  });
});

describe("session caching", () => {
  it("reuses session for same user", async () => {
    const client = makeClient();
    await client.getConnectionStatus(["gmail"], "default");
    await client.getConnectionStatus(["gmail"], "default");
    // toolRouter.create should only be called once
    const { Composio } = await import("@composio/core");
    const instance = (Composio as any).mock.results[0].value;
    expect(instance.toolRouter.create).toHaveBeenCalledTimes(1);
  });
});

describe("execute tool string arguments (GLM-5 workaround)", () => {
  function makeTool() {
    const client = makeClient();
    const config = parseComposioConfig({ config: { apiKey: "test-key", userId: "default" } });
    return createComposioExecuteTool(client, config);
  }

  it("parses string arguments as JSON", async () => {
    const tool = makeTool();
    const result = await tool.execute("test", {
      tool_slug: "GMAIL_FETCH_EMAILS",
      arguments: '{"user_id": "me", "max_results": 5}',
    });
    expect(result.details).toHaveProperty("success", true);
  });

  it("handles object arguments normally", async () => {
    const tool = makeTool();
    const result = await tool.execute("test", {
      tool_slug: "GMAIL_FETCH_EMAILS",
      arguments: { user_id: "me", max_results: 5 },
    });
    expect(result.details).toHaveProperty("success", true);
  });

  it("falls back to empty args on invalid JSON string", async () => {
    const tool = makeTool();
    const result = await tool.execute("test", {
      tool_slug: "GMAIL_FETCH_EMAILS",
      arguments: "not valid json",
    });
    expect(result.details).toHaveProperty("success", true);
  });

  it("falls back to empty args when arguments is missing", async () => {
    const tool = makeTool();
    const result = await tool.execute("test", {
      tool_slug: "GMAIL_FETCH_EMAILS",
    });
    expect(result.details).toHaveProperty("success", true);
  });
});

describe("connections tool", () => {
  function makeConnectionsTool() {
    const client = makeClient();
    const config = parseComposioConfig({ config: { apiKey: "test-key", userId: "default" } });
    return createComposioConnectionsTool(client, config);
  }

  it("schema does not expose user_id or accounts action", () => {
    const tool = makeConnectionsTool();
    const schema = tool.parameters as any;
    const branches = Array.isArray(schema.anyOf) ? schema.anyOf : [];

    const byAction = (action: string) =>
      branches.find((b: any) => b?.properties?.action?.const === action);

    const listBranch = byAction("list");
    const createBranch = byAction("create");
    const statusBranch = byAction("status");
    const accountsBranch = byAction("accounts");

    expect(listBranch?.required ?? []).not.toContain("user_id");
    expect(createBranch?.required ?? []).not.toContain("user_id");
    expect(statusBranch?.required ?? []).not.toContain("user_id");
    expect(accountsBranch).toBeUndefined();
  });

  it("list action uses configured userId", async () => {
    const tool = makeConnectionsTool();
    await tool.execute("test", { action: "list" });
    const instance = await getLatestComposioInstance();
    expect(instance.toolRouter.create).toHaveBeenCalledWith("default", undefined);
  });

  it("status uses active connected accounts as fallback", async () => {
    const tool = makeConnectionsTool();
    const instance = await getLatestComposioInstance();
    instance.connectedAccounts.list.mockResolvedValueOnce({
      items: [{ toolkit: { slug: "affinity" }, status: "ACTIVE" }],
      nextCursor: null,
    });

    const result = await tool.execute("test", { action: "status", toolkit: "affinity" });
    const details = result.details as any;
    const conn = details.connections.find((c: any) => c.toolkit === "affinity");
    expect(conn.connected).toBe(true);
    expect(instance.tools.executeMetaTool).not.toHaveBeenCalledWith(
      "AFFINITY_GET_METADATA_ON_ALL_LISTS",
      expect.anything()
    );
  });

  it("status keeps disconnected when no active account exists", async () => {
    const tool = makeConnectionsTool();
    const result = await tool.execute("test", { action: "status", toolkit: "sentry" });
    const details = result.details as any;
    const conn = details.connections.find((c: any) => c.toolkit === "sentry");
    expect(conn.connected).toBe(false);
  });

  it("status succeeds without exposing user_id input", async () => {
    const tool = makeConnectionsTool();
    const result = await tool.execute("test", { action: "status", toolkit: "sentry" });
    const details = result.details as any;
    expect(details.error).toBeUndefined();
  });
});
