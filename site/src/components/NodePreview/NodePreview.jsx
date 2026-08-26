import { DateTime } from "../DateTime/DateTime.jsx";

// One thread as it appears in a list: its title, and a line of context under
// it. Used for the front page, forum listings and a member's activity, so
// every piece of the meta line is optional -- a member's own page has no need
// to repeat their name.
export function NodePreview({
  id,
  title,
  href,
  author,
  authorId,
  date,
  comments,
  forum,
  forumTitle,
}) {
  return (
    <li className="node-preview">
      <a className="node-preview__title" href={href ?? `/node/${id}/`}>
        {title || `node ${id}`}
      </a>
      <div className="node-preview__meta">
        {author ? (
          authorId != null ? <a href={`/user/${authorId}/`}>{author}</a> : <span>{author}</span>
        ) : null}
        {date ? <DateTime value={date} /> : null}
        {comments != null ? (
          <span>
            {comments} {comments === 1 ? "reply" : "replies"}
          </span>
        ) : null}
        {/* Not every thread sits in a forum -- blog posts and a few strays
            have a breadcrumb that ends at "Home", which is a title with no
            forum behind it. Linking those produced /forum/null/. */}
        {forum != null && forumTitle ? <a href={`/forum/${forum}/`}>{forumTitle}</a> : null}
      </div>
    </li>
  );
}
