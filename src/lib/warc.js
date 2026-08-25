import zlib from "zlib";

// Parse a single WARC/ARC record out of a gzip member.
//
// The one thing that must be exactly right: the record block is precisely
// `Content-Length` bytes long. Every WARC record is followed by a `\r\n\r\n`
// separator, and if those four bytes are left on the end of the payload the
// SHA-1 will not match the digest the index advertises.
export function parseWarcRecord(gzipped) {
  let raw;
  try {
    raw = zlib.gunzipSync(gzipped);
  } catch (err) {
    throw new Error(`not a gzip member: ${err.message}`);
  }

  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) throw new Error("no WARC header terminator");

  const warcHeader = raw.subarray(0, headerEnd).toString("latin1");
  const contentLength = parseInt(/^Content-Length:\s*(\d+)\s*$/im.exec(warcHeader)?.[1], 10);
  if (!Number.isFinite(contentLength)) throw new Error("WARC record has no Content-Length");

  const block = raw.subarray(headerEnd + 4, headerEnd + 4 + contentLength);

  // ARC records (arquivo.pt's older collections) have no HTTP header block of
  // their own inside the record; WARC `response` records do.
  const httpEnd = block.indexOf("\r\n\r\n");
  const hasHttp = httpEnd !== -1 && /^HTTP\//.test(block.subarray(0, 8).toString("latin1"));

  return {
    warcHeader,
    httpHeader: hasHttp ? block.subarray(0, httpEnd).toString("latin1") : "",
    payload: hasHttp ? block.subarray(httpEnd + 4) : block,
    truncated: /^WARC-Truncated:\s*(\S+)\s*$/im.exec(warcHeader)?.[1] ?? null,
    payloadDigest: /^WARC-Payload-Digest:\s*sha1:(\S+)\s*$/im.exec(warcHeader)?.[1] ?? null,
  };
}

export function httpStatusOf(httpHeader) {
  const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(httpHeader);
  return m ? Number(m[1]) : null;
}
