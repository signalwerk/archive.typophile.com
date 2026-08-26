import { Layout } from "../components/Layout.jsx";
import { formatDate } from "../components/DateTime/DateTime.jsx";
import { MetaLine } from "../components/MetaLine/MetaLine.jsx";
import { sanitize } from "../../lib/sanitize.mjs";
import { Avatar } from "../components/Avatar.jsx";

function Entry({ entry, op = false, anchor, user }) {
  const name = user?.name || "unknown";
  const href = entry.user != null ? `/user/${entry.user}/` : undefined;
  return (
    <article className={op ? "post post--op" : "post"} id={anchor}>
      <div className="entry">
        <a className="entry__who" href={href}>
          <Avatar user={{ name, picture: user?.picture }} size={44} />
        </a>
        <div className="entry__main">
            <MetaLine
              author={name}
              authorId={entry.user}
              date={entry.date}
              dateHref={anchor ? `#${anchor}` : undefined}
              votes={entry.votes}
            />
          {/* html_clean has internal links repointed at our copies; fall back
              to the captured html if the cleanup pass has not run yet. */}
          <div
            className="body"
            dangerouslySetInnerHTML={{ __html: sanitize(entry.html_clean ?? entry.html) }}
          />
        </div>
      </div>
    </article>
  );
}

export function ThreadPage({ doc, users = {} }) {
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

      {doc.pages && !doc.pages.complete ? (
        <p className="note">
          This thread ran to {doc.pages.total} pages of replies and{" "}
          {doc.pages.recovered === 1 ? "only one was" : `only ${doc.pages.recovered} were`}{" "}
          recovered, so replies are missing.
        </p>
      ) : null}

      {doc.source?.truncated ? (
        <p className="note">
          The capture this came from was cut short by the archive that made it,
          so the text may be incomplete.
        </p>
      ) : null}

      {doc.post ? <Entry entry={doc.post} op user={users[doc.post.user]} /> : null}

      {comments.map((c, i) => (
        <Entry
          key={c.id ?? i}
          entry={c}
          anchor={c.id ? `comment-${c.id}` : undefined}
          user={users[c.user]}
        />
      ))}

      <p className="foot">
        Captured from {doc.source?.archive} on {formatDate(doc.source?.captured_at)}.{" "}
        <a href={doc.source?.url} rel="nofollow noreferrer">original URL</a>
      </p>
    </Layout>
  );
}
