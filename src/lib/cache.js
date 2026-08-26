// Small on-disk cache for the metadata step 0 needs before it can fetch
// anything: how many index pages a domain has, and which Common Crawl crawls
// exist. Both are one network round-trip that would otherwise happen on every
// run, including runs where every page is already downloaded.
//
// Cached values are reused indefinitely; `--refresh` re-checks them (which is
// what you want when the archive may have new captures), and `--force`
// re-fetches everything.

import fs from "fs";
import path from "path";
import { ensureDir } from "./util.js";

export function readCache(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || raw.value === undefined) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeCache(file, value) {
  ensureDir(path.dirname(file));
  const payload = { value, fetchedAt: new Date().toISOString() };
  fs.writeFileSync(`${file}.part`, JSON.stringify(payload, null, 2) + "\n");
  fs.renameSync(`${file}.part`, file);
  return payload;
}

export function ageOf(entry) {
  if (!entry?.fetchedAt) return null;
  const ms = Date.now() - Date.parse(entry.fetchedAt);
  if (!Number.isFinite(ms)) return null;
  const days = ms / 86_400_000;
  if (days >= 1) return `${Math.floor(days)}d old`;
  const hours = ms / 3_600_000;
  if (hours >= 1) return `${Math.floor(hours)}h old`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m old`;
}

// Reuse what we have unless the caller explicitly asks for a fresh look.
export async function cached(file, { refresh = false, load, label, log }) {
  if (!refresh) {
    const hit = readCache(file);
    if (hit) {
      log?.(`   ${label}: from cache (${ageOf(hit)}) -- pass --refresh to re-check`);
      return hit.value;
    }
  }
  const value = await load();
  writeCache(file, value);
  log?.(`   ${label}: fetched`);
  return value;
}
