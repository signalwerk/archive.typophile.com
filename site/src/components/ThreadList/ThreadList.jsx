import { NodePreview } from "../NodePreview/NodePreview.jsx";

export function ThreadList({ threads }) {
  return (
    <ul className="threads">
      {threads.map((t) => (
        <NodePreview
          key={t.id}
          id={t.id}
          title={t.title}
          author={t.authorName}
          authorId={t.author}
          date={t.date}
          comments={t.comments}
          forum={t.forum}
          forumTitle={t.forumTitle}
        />
      ))}
    </ul>
  );
}
