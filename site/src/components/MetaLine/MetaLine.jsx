import { DateTime } from "../DateTime/DateTime.jsx";

// The small grey line of context under a title or above a post: who wrote it,
// when, and how the thread is placed. Every field is optional, so the same
// component serves a listing row -- which shows the reply count and the forum
// -- and a post inside a thread, which shows neither.
export function MetaLine({
  author,
  authorId,
  date,
  dateHref,
  comments,
  forum,
  forumTitle,
  votes,
  emphasis = false,
}) {
  const name = author ? (
    authorId != null ? (
      <a href={`/user/${authorId}/`}>{author}</a>
    ) : (
      <span>{author}</span>
    )
  ) : null;

  return (
    <div className="meta-line">
      {name ? <span className="meta-line__name">{name}</span> : null}

      {date ? (
        dateHref ? (
          <a href={dateHref}>
            <DateTime value={date} />
          </a>
        ) : (
          <DateTime value={date} />
        )
      ) : null}

      {comments != null ? (
        <span>
          {comments} {comments === 1 ? "reply" : "replies"}
        </span>
      ) : null}

      {/* Not every thread sits in a forum: blog posts and a few strays have a
          breadcrumb ending at "Home", which is a title with no forum behind
          it. Linking those produced /forum/null/. */}
      {forum != null && forumTitle ? (
        <a href={`/forum/${forum}/`}>{forumTitle}</a>
      ) : null}

      {votes != null ? <span>{votes} votes</span> : null}
    </div>
  );
}
