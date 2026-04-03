// server.ts
import express from "express";
import compression from "compression";
import cookieSession from "cookie-session";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readdirSync, statSync, existsSync, createReadStream } from "fs";
var __dirname = dirname(fileURLToPath(import.meta.url));
var PORT = parseInt(process.env.PORT || "3000", 10);
var AUDIO_DIR = process.env.AUDIO_DIR || resolve(__dirname, "../../data/sample-music");
var DIST_DIR = resolve(__dirname, "dist");
var AUTH_PAGE = resolve(__dirname, "auth-page.html");
var APPROVED_EMAILS = (process.env.APPROVED_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
var GATE_PASSWORD = process.env.GATE_PASSWORD || "";
var SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
function scanAudioFiles(dir, base = "") {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      results.push(...scanAudioFiles(full, rel));
    } else if (/\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(entry)) {
      results.push(rel);
    }
  }
  return results;
}
var MIME_TYPES = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4"
};
var app = express();
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});
app.use(compression());
app.use(cookieSession({
  name: "cybernoetica",
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 60 * 60 * 1e3,
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  sameSite: "lax"
}));
app.use(express.json());
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.post("/api/auth", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  if (password !== GATE_PASSWORD) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  if (APPROVED_EMAILS.length > 0 && !APPROVED_EMAILS.includes(email.toLowerCase())) {
    res.status(403).json({ error: "Email not approved for access" });
    return;
  }
  if (req.session) {
    req.session.authenticated = true;
    req.session.email = email.toLowerCase();
  }
  res.json({ success: true });
});
app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ success: true });
});
app.use((req, res, next) => {
  if (!GATE_PASSWORD) return next();
  if (req.session?.authenticated) return next();
  if (req.accepts("html")) {
    res.sendFile(AUTH_PAGE);
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
});
app.use("/sample-music", (req, res, next) => {
  if (req.method !== "GET") return next();
  if (req.url === "/__list") {
    res.json(scanAudioFiles(AUDIO_DIR));
    return;
  }
  const relativePath = decodeURIComponent(req.url.slice(1));
  const filePath = resolve(AUDIO_DIR, relativePath);
  if (!filePath.startsWith(AUDIO_DIR)) {
    res.status(403).end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.status(404).end();
    return;
  }
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  const stat = statSync(filePath);
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Accept-Ranges", "bytes");
    createReadStream(filePath).pipe(res);
  }
});
app.use(express.static(DIST_DIR, {
  maxAge: "1d",
  setHeaders: (res, path) => {
    if (path.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(resolve(DIST_DIR, "index.html"));
});
app.listen(PORT, () => {
  console.log(`Cybernoetica server on port ${PORT}`);
  console.log(`  Audio: ${AUDIO_DIR}`);
  console.log(`  Auth: ${GATE_PASSWORD ? "enabled" : "disabled (no GATE_PASSWORD)"}`);
});
