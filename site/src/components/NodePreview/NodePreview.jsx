import { MetaLine } from "../MetaLine/MetaLine.jsx";

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
      <MetaLine
        author={author}
        authorId={authorId}
        date={date}
        comments={comments}
        forum={forum}
        forumTitle={forumTitle}
      />
    </li>
  );
}
