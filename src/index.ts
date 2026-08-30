import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

interface Env { DB: D1Database }

const UI_URI = "ui://zack-game-room/room.html";

const UI_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:system-ui;margin:0;padding:12px}header{display:flex;justify-content:space-between;font-weight:700}
#room{font-size:12px;opacity:.65;margin:8px 0}#log{min-height:240px;display:flex;flex-direction:column;gap:7px}
.msg{padding:8px 10px;border-radius:12px;background:#f2f2f2}.msg b{margin-right:8px}.msg small{opacity:.5}
footer{display:flex;gap:6px;margin-top:10px}input{flex:1;padding:9px;border:1px solid #bbb;border-radius:8px}
button{padding:9px 14px;border:0;border-radius:8px}
</style></head><body>
<header><span>🎲 Zack Game Room</span><span id="status">●</span></header>
<div id="room"></div><div id="log"></div>
<script>
const esc=s=>s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
window.addEventListener("message",e=>{
  const d=e.data?.params?.structuredContent;
  if(!d)return;
  if(d.room)document.getElementById("room").textContent="Stanza: "+d.room;
  if(Array.isArray(d.events)){
    document.getElementById("log").innerHTML=d.events.map(x=>'<div class="msg"><b>'+esc(x.name)+'</b><small>'+new Date(x.ts).toLocaleTimeString()+'</small><div>'+esc(x.text)+'</div></div>').join("");
  }
});
</script></body></html>`;

function makeServer(env: Env) {
  const server = new McpServer({ name: "zack-game-room", version: "1.0.0" });

  // MCP resources are exposed as text/html for the embedded ChatGPT UI.
  server.registerResource(
    "Zack Game Room UI",
    UI_URI,
    { mimeType: "text/html+skybridge" },
    async () => ({ contents: [{ uri: UI_URI, mimeType: "text/html+skybridge", text: UI_HTML }] })
  );

  server.registerTool(
    "open_game_room",
    {
      title: "Open Zack Game Room",
      description: "Open the shared RPG room for Alan or Manlio.",
      inputSchema: { room: z.string().min(1), player: z.enum(["Alan","Manlio"]) },
      _meta: { "openai/outputTemplate": UI_URI, "openai/widgetAccessible": true }
    },
    async ({ room, player }) => {
      const rows = await env.DB.prepare(
        "SELECT id AS seq,name,role,text,kind,ts FROM messages WHERE room=? ORDER BY id ASC LIMIT 200"
      ).bind(room).all();
      return {
        content: [{ type: "text", text: `Opened room ${room} for ${player}.` }],
        structuredContent: { room, player, events: rows.results ?? [] }
      };
    }
  );

  server.registerTool(
    "read_game_room",
    {
      title: "Read Game Room",
      description: "Read the authoritative shared game log before resolving a turn.",
      inputSchema: { room: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
      _meta: { "openai/outputTemplate": UI_URI }
    },
    async ({ room, limit }) => {
      const n = limit ?? 100;
      const rows = await env.DB.prepare(
        "SELECT id AS seq,name,role,text,kind,ts FROM messages WHERE room=? ORDER BY id DESC LIMIT ?"
      ).bind(room, n).all();
      const events = [...(rows.results ?? [])].reverse();
      return {
        content: [{ type: "text", text: JSON.stringify({ room, events }) }],
        structuredContent: { room, events }
      };
    }
  );

  server.registerTool(
    "send_game_message",
    {
      title: "Send Game Message",
      description: "Write an Alan, Manlio, or Master message into the shared room.",
      inputSchema: {
        room: z.string().min(1),
        name: z.string().min(1),
        role: z.enum(["ALAN","MANLIO","MASTER"]),
        text: z.string().min(1).max(10000)
      },
      _meta: { "openai/outputTemplate": UI_URI, "openai/widgetAccessible": true }
    },
    async ({ room, name, role, text }) => {
      const ts = Date.now();
      const result = await env.DB.prepare(
        "INSERT INTO messages(room,name,role,text,kind,ts) VALUES(?,?,?,?,?,?)"
      ).bind(room, name, role, text, role === "MASTER" ? "master" : "chat", ts).run();

      const ev = { seq: result.meta.last_row_id, name, role, text, kind: role === "MASTER" ? "master" : "chat", ts };
      return {
        content: [{ type: "text", text: "Message delivered to the shared room." }],
        structuredContent: { room, event: ev, events: [ev] }
      };
    }
  );

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "Zack Game Room" }), {
        headers: { "content-type": "application/json" }
      });
    }
    const handler = createMcpHandler(() => makeServer(env));
    return handler(request, env, ctx);
  }
};