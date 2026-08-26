// The stored HTML is whatever a forum post contained in 2005, kept verbatim by
// the pipeline. Rendering it into a page means dropping the parts that execute
// or phone home; everything structural is left exactly as it was.

const DROP_ELEMENTS = /<(script|style|iframe|object|embed|applet|form|input|button|link|meta)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_VOID = /<(script|style|iframe|object|embed|applet|form|input|button|link|meta)\b[^>]*\/?>/gi;
const ON_ATTR = /\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URL = /\s+(href|src|action|formaction)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi;

export function sanitize(html) {
  if (!html) return "";
  return String(html)
    .replace(DROP_ELEMENTS, "")
    .replace(DROP_VOID, "")
    .replace(ON_ATTR, "")
    .replace(JS_URL, "");
}
