import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();
const SECRET_PASSWORD = "12345";
const DATA_DIR = path.resolve(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "messages.json");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
let messages = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    messages = JSON.parse(raw);
  }
} catch (e) {
  console.error("Failed reading messages file:", e);
}
if (messages.length === 0) {
  messages.push({
    id: "welcome_1",
    sender: "System",
    text: "\u{1F512} Group chat unlocked! Welcome to your private group. Say hi!",
    timestamp: Date.now(),
    system: true
  });
}
function saveMessages() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(messages.slice(-500), null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving messages:", err);
  }
}
const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = /* @__PURE__ */ new Map();
const typingUsers = /* @__PURE__ */ new Map();
function getActiveUsers() {
  const map = /* @__PURE__ */ new Map();
  for (const client of clients.values()) {
    if (client.authenticated && client.name) {
      map.set(client.name, client.color);
    }
  }
  return Array.from(map.entries()).map(([name, color]) => ({ name, color }));
}
function broadcast(payload, excludeWs) {
  const json = JSON.stringify(payload);
  for (const [ws, client] of clients.entries()) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN && client.authenticated) {
      ws.send(json);
    }
  }
}
function broadcastPresence() {
  const users = getActiveUsers();
  broadcast({
    type: "presence",
    users
  });
}
function broadcastTyping() {
  const typers = Array.from(typingUsers.keys());
  broadcast({
    type: "typing",
    typingUsers: typers
  });
}
app.post("/api/auth", (req, res) => {
  const { password, name } = req.body;
  if (password === SECRET_PASSWORD) {
    res.json({
      success: true,
      name: (name || "").trim(),
      message: "Access granted"
    });
  } else {
    res.status(401).json({
      success: false,
      message: "Incorrect password. Access denied."
    });
  }
});
app.get("/api/messages", (req, res) => {
  const authHeader = req.headers.authorization;
  const authPassword = authHeader ? authHeader.replace("Bearer ", "") : req.query.pwd;
  if (authPassword !== SECRET_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    messages,
    users: getActiveUsers()
  });
});
app.post("/api/messages", (req, res) => {
  const { password, sender, text, color, replyTo } = req.body;
  if (password !== SECRET_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!text || !text.trim() || !sender) {
    res.status(400).json({ error: "Missing content or sender" });
    return;
  }
  const newMsg = {
    id: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    sender: sender.trim(),
    text: text.trim(),
    timestamp: Date.now(),
    color: color || "#3b82f6",
    replyTo: replyTo || void 0
  };
  messages.push(newMsg);
  saveMessages();
  broadcast({ type: "message", message: newMsg });
  res.json({ success: true, message: newMsg });
});
app.post("/api/clear", (req, res) => {
  const { password } = req.body;
  if (password !== SECRET_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  messages = [
    {
      id: "welcome_" + Date.now(),
      sender: "System",
      text: "\u{1F9F9} Chat was cleared by a group member.",
      timestamp: Date.now(),
      system: true
    }
  ];
  saveMessages();
  broadcast({ type: "cleared", messages });
  res.json({ success: true });
});
wss.on("connection", (ws) => {
  const client = {
    ws,
    name: "",
    color: "#3b82f6",
    authenticated: false
  };
  clients.set(ws, client);
  ws.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === "auth") {
        if (parsed.password === SECRET_PASSWORD) {
          client.authenticated = true;
          client.name = (parsed.name || "Member").trim();
          client.color = parsed.color || "#3b82f6";
          ws.send(
            JSON.stringify({
              type: "init",
              messages,
              users: getActiveUsers(),
              activeTyping: Array.from(typingUsers.keys())
            })
          );
          const joinMsg = {
            id: "sys_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            sender: "System",
            text: `${client.name} joined the chat`,
            timestamp: Date.now(),
            system: true
          };
          messages.push(joinMsg);
          saveMessages();
          broadcast({ type: "message", message: joinMsg });
          broadcastPresence();
        } else {
          ws.send(
            JSON.stringify({
              type: "auth_error",
              message: "Incorrect password"
            })
          );
          ws.close();
        }
        return;
      }
      if (!client.authenticated) {
        ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
        return;
      }
      if (parsed.type === "message") {
        const text = (parsed.text || "").trim();
        if (!text) return;
        const newMsg = {
          id: "msg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
          sender: client.name,
          text,
          timestamp: Date.now(),
          color: client.color,
          replyTo: parsed.replyTo || void 0
        };
        messages.push(newMsg);
        saveMessages();
        if (typingUsers.has(client.name)) {
          clearTimeout(typingUsers.get(client.name));
          typingUsers.delete(client.name);
          broadcastTyping();
        }
        broadcast({ type: "message", message: newMsg });
        return;
      }
      if (parsed.type === "reaction") {
        const { messageId, emoji } = parsed;
        const msg = messages.find((m) => m.id === messageId);
        if (msg) {
          if (!msg.reactions) msg.reactions = {};
          if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
          const idx = msg.reactions[emoji].indexOf(client.name);
          if (idx >= 0) {
            msg.reactions[emoji].splice(idx, 1);
            if (msg.reactions[emoji].length === 0) {
              delete msg.reactions[emoji];
            }
          } else {
            msg.reactions[emoji].push(client.name);
          }
          saveMessages();
          broadcast({
            type: "reaction_update",
            messageId,
            reactions: msg.reactions
          });
        }
        return;
      }
      if (parsed.type === "typing") {
        const isTyping = Boolean(parsed.isTyping);
        if (isTyping) {
          if (typingUsers.has(client.name)) {
            clearTimeout(typingUsers.get(client.name));
          }
          const timeout = setTimeout(() => {
            typingUsers.delete(client.name);
            broadcastTyping();
          }, 3e3);
          typingUsers.set(client.name, timeout);
        } else {
          if (typingUsers.has(client.name)) {
            clearTimeout(typingUsers.get(client.name));
            typingUsers.delete(client.name);
          }
        }
        broadcastTyping();
        return;
      }
      if (parsed.type === "clear") {
        messages = [
          {
            id: "welcome_" + Date.now(),
            sender: "System",
            text: `\u{1F9F9} Chat was cleared by ${client.name}.`,
            timestamp: Date.now(),
            system: true
          }
        ];
        saveMessages();
        broadcast({ type: "cleared", messages });
        return;
      }
    } catch (err) {
      console.error("WebSocket message parsing error:", err);
    }
  });
  ws.on("close", () => {
    const wasAuth = client.authenticated;
    const name = client.name;
    clients.delete(ws);
    if (wasAuth && name) {
      if (typingUsers.has(name)) {
        clearTimeout(typingUsers.get(name));
        typingUsers.delete(name);
        broadcastTyping();
      }
      const stillOnline = Array.from(clients.values()).some((c) => c.authenticated && c.name === name);
      if (!stillOnline) {
        const leaveMsg = {
          id: "sys_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          sender: "System",
          text: `${name} left the chat`,
          timestamp: Date.now(),
          system: true
        };
        messages.push(leaveMsg);
        saveMessages();
        broadcast({ type: "message", message: leaveMsg });
      }
      broadcastPresence();
    }
  });
});
async function startServer() {
  const PORT = Number(process.env.PORT) || 3e3;
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve("dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist", "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}
startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
