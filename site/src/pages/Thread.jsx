import { Layout, formatDate } from "../components/Layout.jsx";
import { sanitize } from "../../lib/sanitize.mjs";

function Author({ name, id, path }) {
  if (!name) return <strong>unknown</strong>;
  const href = id ? `https://web.archive.org/web/2015/http://typophile.com/user/${id}` : null;
  return href ? (
    <strong><a href={href} rel="nofollow noreferrer">{name}</a></strong>
  ) : (
    <strong>{name}</strong>
  );
}

function Entry({ entry, op = false, anchor }) {
  return (
    <article className={op ? "post post--op" : "post"} id={anchor}>
      <div className="byline">
        <Author name={entry.user_name} id={entry.user_id} path={entry.user_path} />
        {entry.date ? <span>{formatDate(entry.date)}</span> : null}
        {entry.votes != null ? <span>{entry.votes} votes</span> : null}
        {anchor ? <a href={`#${anchor}`}>#</a> : null}
      </div>
      <div className="body" dangerouslySetInnerHTML={{ __html: sanitize(entry.html) }} />
    </article>
  );
}

export function ThreadPage({ doc }) {
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

      {doc.post ? <Entry entry={doc.post} op /> : null}

      {comments.map((c, i) => (
        <Entry key={c.id ?? i} entry={c} anchor={c.id ? `comment-${c.id}` : undefined} />
      ))}

      <p className="foot">
        Captured from {doc.source?.archive} on {formatDate(doc.source?.captured_at)}.{" "}
        <a href={doc.source?.url} rel="nofollow noreferrer">original URL</a>
      </p>
    </Layout>
  );
}
