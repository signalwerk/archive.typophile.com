import { Layout, formatDate } from "../components/Layout.jsx";
import { sanitize } from "../../lib/sanitize.mjs";
import { Avatar } from "../components/Avatar.jsx";

function Author({ entry }) {
  const name = entry.user_name || "unknown";
  return entry.user_id ? (
    <strong><a href={`/user/${entry.user_id}/`}>{name}</a></strong>
  ) : (
    <strong>{name}</strong>
  );
}

function Entry({ entry, op = false, anchor, picture }) {
  return (
    <article className={op ? "post post--op" : "post"} id={anchor}>
      <div className="entry">
        <a className="entry__who" href={entry.user_id ? `/user/${entry.user_id}/` : undefined}>
          <Avatar user={{ name: entry.user_name, picture }} size={44} />
        </a>
        <div className="entry__main">
          <div className="byline">
            <Author entry={entry} />
            {entry.date ? <span>{formatDate(entry.date)}</span> : null}
            {entry.votes != null ? <span>{entry.votes} votes</span> : null}
            {anchor ? <a href={`#${anchor}`}>#</a> : null}
          </div>
          <div className="body" dangerouslySetInnerHTML={{ __html: sanitize(entry.html) }} />
        </div>
      </div>
    </article>
  );
}

export function ThreadPage({ doc, pictures = {} }) {
  const comments = doc.comments ?? [];
  return (
    <Layout>
      <div className="thread-head">
        <div className="crumbs">
          <a href="/">Typophile</a>
          {doc.forum?.id ? (
            <> &rsaquo; <a href={`/forum/${doc.forum.id}/`}>{doc.forum.title || `forum ${doc.forum.id}`}</a></>
          ) : null}
        </div>
        <h1>{doc.title || `node ${doc.node}`}</h1>
      </div>

      {doc.source?.truncated ? (
        <p className="note">
          This copy was truncated by the archive that captured it, so the thread
          may be incomplete.
        </p>
      ) : null}

      {doc.post ? <Entry entry={doc.post} op picture={pictures[doc.post.user_id]} /> : null}

      {comments.map((c, i) => (
        <Entry
          key={c.id ?? i}
          entry={c}
          anchor={c.id ? `comment-${c.id}` : undefined}
          picture={pictures[c.user_id]}
        />
      ))}

      <p className="foot">
        Captured from {doc.source?.archive} on {formatDate(doc.source?.captured_at)}.{" "}
        <a href={doc.source?.url} rel="nofollow noreferrer">original URL</a>
      </p>
    </Layout>
  );
}
