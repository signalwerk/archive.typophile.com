// What a listing page knows about a thread.
//
// A thread's YAML is mostly the HTML of its post and its comments, none of
// which a listing needs. This is the handful of fields it does need, and it
// lives here -- with the pipeline that produces the data -- so that step 9 and
// the site agree on the shape by sharing one definition rather than two that
// drift.

export function summarise(doc) {
  const comments = doc.comments ?? [];
  const last = comments.length ? comments[comments.length - 1] : null;
  return {
    id: doc.node,
    title: doc.title || `node ${doc.node}`,
    forum: doc.forum?.id ?? null,
    forumTitle: doc.forum?.title ?? null,
    author: doc.post?.user ?? null,
    date: doc.post?.date ?? null,
    comments: comments.length,
    lastDate: last?.date ?? doc.post?.date ?? null,
    archive: doc.source?.archive ?? null,
    truncated: Boolean(doc.source?.truncated),
  };
}

// Adding a field here has to invalidate the summaries already written, or it
// would silently stay missing for every thread. Hashing the function itself
// means only a real change to the shape costs a re-read -- editing anything
// else in this file, a comment included, leaves the index valid.
let cached = null;
export function summaryVersion() {
  if (cached) return cached;
  let hash = 0;
  const src = summarise.toString();
  for (let i = 0; i < src.length; i++) hash = (Math.imul(31, hash) + src.charCodeAt(i)) | 0;
  cached = (hash >>> 0).toString(16).padStart(8, "0");
  return cached;
}
