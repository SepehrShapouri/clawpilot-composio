# ClawPilot Composio Plugin for OpenClaw

OpenClaw plugin for [Composio](https://composio.dev)'s Tool Router, hardened for ClawPilot-hosted multi-tenant deployments.

This fork is intentionally host-scoped:

- it requires a configured `userId`
- all tool calls execute only for that configured `userId`
- it does not expose cross-user account discovery or hints
- if `userId` is missing, the plugin fails closed

## Install

```bash
openclaw plugins install @sepehrshapouri/composio
```

## Setup

1. Get an API key from [platform.composio.dev/settings](https://platform.composio.dev/settings)

2. Run the guided setup:

```bash
openclaw composio setup
```

Or add manually to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "composio": {
        "enabled": true,
        "config": {
          "apiKey": "your-api-key",
          "userId": "clawpilot-user-id"
        }
      }
    }
  }
}
```

You can also set `COMPOSIO_API_KEY` and `COMPOSIO_USER_ID` as environment variables.

3. Restart the gateway.

## What it does

The plugin gives your agent three tools:

- `composio_search_tools` — finds relevant Composio actions from natural-language queries
- `composio_execute_tool` — runs a Composio action (e.g. `GMAIL_FETCH_EMAILS`, `SENTRY_LIST_ISSUES`)
- `composio_manage_connections` — checks connection status and generates OAuth links for unconnected toolkits

All tools are automatically scoped to the configured `userId`. Agents do not provide `user_id`.
`composio_execute_tool` accepts an optional `connected_account_id` when multiple accounts exist for the same toolkit inside that same configured user scope.

## Config options

| Key | Description |
|-----|-------------|
| `apiKey` | Composio API key (required) |
| `userId` | ClawPilot-managed Composio user ID (required) |

## CLI

```bash
openclaw composio setup --user-id user-123       # interactive setup
openclaw composio list                           # list available toolkits
openclaw composio status [toolkit]               # check connection status
openclaw composio connect gmail                  # open OAuth link
openclaw composio disconnect gmail               # remove a connection
```

## Updating

```bash
openclaw plugins update composio
openclaw gateway restart
```

## Development

```bash
git clone https://github.com/SepehrShapouri/clawpilot-composio.git
cd clawpilot-composio
npm install
npm run build
npm test
```

Set `COMPOSIO_LIVE_TEST=1` and `COMPOSIO_API_KEY` to run live integration tests with `npm run test:live`.

## Acknowledgments

Based on [openclaw-composio](https://github.com/ComposioHQ/openclaw-composio) by ComposioHQ. See [THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES).
