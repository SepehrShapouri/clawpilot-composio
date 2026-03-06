import { z } from "zod";
import type { ComposioConfig } from "./types.js";
import { isRecord } from "./utils.js";

/**
 * Zod schema for Composio plugin configuration
 */
export const ComposioConfigSchema = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  userId: z.string().optional(),
});

/**
 * Parse and validate plugin config with environment fallbacks
 */
export function parseComposioConfig(value: unknown): ComposioConfig {
  const raw = isRecord(value) ? value : {};
  const configObj = isRecord(raw.config) ? raw.config : undefined;

  const source = configObj ?? raw;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
  const apiKey =
    (typeof source.apiKey === "string" && source.apiKey.trim()) ||
    (typeof raw.apiKey === "string" && raw.apiKey.trim()) ||
    process.env.COMPOSIO_API_KEY ||
    "";
  const userId =
    (typeof source.userId === "string" && source.userId.trim()) ||
    (typeof source.defaultUserId === "string" && source.defaultUserId.trim()) ||
    (typeof raw.userId === "string" && raw.userId.trim()) ||
    (typeof raw.defaultUserId === "string" && raw.defaultUserId.trim()) ||
    process.env.COMPOSIO_USER_ID ||
    process.env.COMPOSIO_DEFAULT_USER_ID ||
    "";

  return ComposioConfigSchema.parse({
    enabled,
    apiKey,
    userId,
  });
}

/**
 * UI hints for configuration fields
 */
export const composioConfigUiHints = {
  enabled: {
    label: "Enable Composio",
    help: "Enable or disable the Composio Tool Router integration",
  },
  apiKey: {
    label: "API Key",
    help: "Composio API key from platform.composio.dev/settings",
    sensitive: true,
  },
  userId: {
    label: "User ID",
    help: "ClawPilot-managed Composio user ID used for all tool calls",
  },
};

/**
 * Plugin config schema object for openclaw
 */
export const composioPluginConfigSchema = {
  parse: parseComposioConfig,
  uiHints: composioConfigUiHints,
};
