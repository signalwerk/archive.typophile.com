import http from "http";
import https from "https";
import { HTTP } from "./config.js";
import { sleep } from "./util.js";

const agents = {
  "http:": new http.Agent({ keepAlive: true, maxSockets: HTTP.concurrency * 2 }),
  "https:": new https.Agent({ keepAlive: true, maxSockets: HTTP.concurrency * 2 }),
};

// Space out request starts across all workers so we stay a polite client.
let nextSlot = 0;

async function takeSlot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + HTTP.minRequestIntervalMs;
  if (at > now) await sleep(at - now);
}

class HttpError extends Error {
  constructor(status, url, retryAfter) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// One request, no retries. Returns the raw body.
//
// We deliberately do NOT let the client decompress: the Wayback Machine
// replays the *original* `Content-Encoding` header while serving an already
// decoded body, so any automatic gunzip blows up with "incorrect header
// check". Raw bytes are also exactly what the CDX digest is computed over.
function requestOnce(url, { depth = 0, timeoutMs = HTTP.timeoutMs, range = null } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      return reject(err);
    }

    const lib = target.protocol === "https:" ? https : http;
    const req = lib.get(
      target,
      {
        agent: agents[target.protocol],
        headers: {
          "User-Agent": HTTP.userAgent,
          "Accept-Encoding": "identity",
          Accept: "*/*",
          ...(range ? { Range: `bytes=${range[0]}-${range[1]}` } : {}),
        },
      },
      (res) => {
        const { statusCode, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (depth >= 6) return reject(new Error(`too many redirects for ${url}`));
          let next;
          try {
            next = new URL(headers.location, target).href;
          } catch (err) {
            return reject(err);
          }
          return resolve(requestOnce(next, { depth: depth + 1, timeoutMs, range }));
        }

        // 206 is the expected answer to a Range request.
        if (statusCode !== 200 && statusCode !== 206) {
          res.resume();
          return reject(new HttpError(statusCode, url, headers["retry-after"]));
        }

        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks);

          // A connection cut mid-stream yields a short body that looks like a
          // successful response. Catch it so it is retried rather than saved.
          //
          // Skipped when the response carries a Content-Encoding: the Wayback
          // Machine replays the *original* header while serving an already
          // decoded body, so its Content-Length legitimately disagrees.
          const expected = Number(headers["content-length"]);
          if (
            !headers["content-encoding"] &&
            Number.isFinite(expected) &&
            body.length < expected
          ) {
            return reject(
              new Error(`truncated response: got ${body.length} of ${expected} bytes from ${url}`)
            );
          }

          resolve({ status: statusCode, headers, body, finalUrl: target.href });
        });
        res.on("error", reject);
      }
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms: ${url}`)));
    req.on("error", reject);
  });
}

function retryDelay(attempt, err) {
  const after = Number(err?.retryAfter);
  if (Number.isFinite(after) && after > 0) {
    return Math.min(after * 1000, HTTP.maxBackoffMs);
  }
  const base = HTTP.backoffBaseMs * 2 ** attempt;
  // Jitter keeps parallel workers from retrying in lockstep.
  return Math.min(base + Math.random() * 1000, HTTP.maxBackoffMs);
}

function isRetryable(err) {
  if (err instanceof HttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  return true; // network errors, timeouts, socket hang-ups
}

export async function fetchRaw(url, { retries = HTTP.retries, onRetry, range = null } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await takeSlot();
    try {
      return await requestOnce(url, { range });
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === retries) break;
      const wait = retryDelay(attempt, err);
      onRetry?.(err, attempt + 1, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export { HttpError };

// Fetch an exact byte range -- used to pull a single WARC record out of a
// Common Crawl archive file without downloading the whole thing.
export function fetchRange(url, offset, length, opts = {}) {
  return fetchRaw(url, { ...opts, range: [offset, offset + length - 1] });
}
