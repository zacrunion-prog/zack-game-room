# Zack Game Room — Cloudflare Workers

Cloudflare Workers/MCP version of Zack Game Room.

Architecture:
ChatGPT Alan -> MCP Worker -> D1
ChatGPT Manlio -> MCP Worker -> D1
ChatGPT Master -> MCP Worker -> D1

The Worker exposes /mcp and /health.

D1 stores the shared game log so the PC of either player does not
need to remain online.

Before deployment, create a D1 database and replace the placeholder
database_id in wrangler.jsonc. Apply schema.sql to the database.
