import fs from "fs";
import path from "path";
import crypto from "crypto";
import readline from "readline";

// --- base32 (RFC 4648, no padding) -----------------------------------------
// The CDX `digest` field is the SHA-1 of the response payload in base32, so
// hashing a local file the same way tells us whether it is already the exact
// capture we want.

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function digestOfBuffer(buf) {
  return base32(crypto.createHash("sha1").update(buf).digest());
}

export function digestOfFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(base32(hash.digest())));
  });
}

// --- CDX url keys ----------------------------------------------------------
// A key looks like `com,typophile)/node/123?page=2`: host reversed and
// comma-separated, then the path and an already-normalised query string.

export function parseUrlKey(urlkey) {
  const split = urlkey.indexOf(")");
  if (split === -1) return null;

  let hostPart = urlkey.slice(0, split);
  const rest = urlkey.slice(split + 1);

  let port = "";
  const colon = hostPart.indexOf(":");
  if (colon !== -1) {
    port = hostPart.slice(colon + 1);
    hostPart = hostPart.slice(0, colon);
  }

  const host = hostPart.split(",").reverse().join(".");

  const q = rest.indexOf("?");
  const urlPath = q === -1 ? rest : rest.slice(0, q);
  const query = q === -1 ? "" : rest.slice(q + 1);

  return { host, port, path: urlPath || "/", query };
}

// The URL we ask the Wayback Machine to replay. We rebuild it from the key
// rather than using the CDX `original` field so that every capture of the
// same page resolves to one identical request.
export function urlKeyToUrl(urlkey) {
  const parts = parseUrlKey(urlkey);
  if (!parts) return null;
  const host = parts.port && parts.port !== "80" ? `${parts.host}:${parts.port}` : parts.host;
  const query = parts.query ? `?${parts.query}` : "";
  return `http://${host}${parts.path}${query}`;
}

// --- local file naming -----------------------------------------------------

const EXT_BY_MIME = {
  "text/html": ".html",
  "application/xhtml+xml": ".html",
  "text/plain": ".txt",
  "text/css": ".css",
  "text/javascript": ".js",
  "application/javascript": ".js",
  "application/x-javascript": ".js",
  "application/json": ".json",
  "text/xml": ".xml",
  "application/xml": ".xml",
  "application/rss+xml": ".rss",
  "application/atom+xml": ".atom",
  "image/jpeg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/tiff": ".tif",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/gzip": ".gz",
  "application/x-shockwave-flash": ".swf",
  "application/msword": ".doc",
  "application/octet-stream": ".bin",
  "video/quicktime": ".mov",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "application/font-woff": ".woff",
  "application/vnd.ms-fontobject": ".eot",
};

export function extensionForMime(mime) {
  if (!mime) return ".bin";
  return EXT_BY_MIME[mime.toLowerCase().split(";")[0].trim()] || ".bin";
}

// Characters that are unsafe (or merely annoying) in a path segment.
const UNSAFE = /[\x00-\x1f\x7f/\\:*?"<>|]/g;

function escapeUnsafe(str) {
  return str.replace(UNSAFE, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
}

function sanitizeSegment(segment) {
  let out = escapeUnsafe(segment);
  // "." and ".." would escape the output directory.
  if (/^\.+$/.test(out)) out = out.replace(/\./g, "%2E");
  return out;
}

const MAX_SEGMENT = 180;

function clampLength(name) {
  if (Buffer.byteLength(name) <= MAX_SEGMENT) return name;
  const hash = crypto.createHash("sha1").update(name).digest("hex").slice(0, 10);
  let cut = name.slice(0, MAX_SEGMENT - 12);
  while (Buffer.byteLength(cut) > MAX_SEGMENT - 12) cut = cut.slice(0, -1);
  return `${cut}~${hash}`;
}

// Map a CDX key + mime type onto a stable path below DIRS.files.
// The extension comes from the mime type only when the URL has none, so
// `/node/123` becomes `node/123.html` while `/misc/drupal.css` is left alone.
export function localPathFor(urlkey, mime) {
  const parts = parseUrlKey(urlkey);
  if (!parts) return null;

  const hostDir = sanitizeSegment(
    parts.port && parts.port !== "80" ? `${parts.host}_${parts.port}` : parts.host
  );

  const segments = parts.path.split("/").filter(Boolean).map(sanitizeSegment);
  const trailingSlash = parts.path.endsWith("/");
  if (segments.length === 0 || trailingSlash) segments.push("index");

  let name = segments.pop();

  // Split off an existing extension so the query tag stays before it.
  let stem = name;
  let ext = "";
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot > name.length - 12) {
    stem = name.slice(0, dot);
    ext = name.slice(dot);
  }

  if (parts.query) stem += "__q_" + sanitizeSegment(parts.query);
  if (!ext) ext = extensionForMime(mime);

  name = clampLength(stem) + ext;

  return [hostDir, ...segments.map(clampLength), name].join("/");
}

// --- io helpers ------------------------------------------------------------

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const knownDirs = new Set();

export function ensureDirCached(dir) {
  if (knownDirs.has(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  knownDirs.add(dir);
}

// Write via a temp file + rename so an interrupted run never leaves a
// half-written file that a later run would mistake for real content.
export function writeFileAtomic(file, data) {
  ensureDirCached(path.dirname(file));
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function writeJson(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

export function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export async function* readLines(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.length) yield line;
  }
}

export async function* readJsonl(file) {
  for await (const line of readLines(file)) {
    yield JSON.parse(line);
  }
}

// --- misc ------------------------------------------------------------------

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (const item of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(item);
    if (match) args[match[1]] = match[2] === undefined ? true : match[2];
    else args._.push(item);
  }
  return args;
}

export function formatCount(n) {
  return n.toLocaleString("en-US");
}

export function formatBytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- run locks -------------------------------------------------------------
// Two downloaders working on the same archive corrupt each other's state: the
// append stream of one still points at the old inode after the other compacts
// and renames the file, so its writes vanish. Nothing is lost permanently --
// the digest check rebuilds state from the files on disk -- but it wastes an
// enormous amount of time, so runs are serialised per archive.

export function acquireLock(file, label = "run") {
  ensureDirCached(path.dirname(file));

  if (fs.existsSync(file)) {
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { /* unreadable lock -- treat as stale */ }

    if (holder?.pid && isAlive(holder.pid)) {
      const err = new Error(
        `another ${label} is already running (pid ${holder.pid}, started ${holder.startedAt}).\n` +
        `   Wait for it to finish, or stop it first. Nothing is lost either way --\n` +
        `   every step resumes where it left off.`
      );
      err.code = "ELOCKED";
      throw err;
    }
    // Stale lock from a killed process.
    try { fs.unlinkSync(file); } catch {}
  }

  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n");

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8"));
      if (held.pid === process.pid) fs.unlinkSync(file);
    } catch { /* already gone */ }
  };
  process.on("exit", release);
  return release;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
