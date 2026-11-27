import type { PollOption, Post } from '../types';

export function applyRealtimePostEvent(
  posts: Post[],
  event: Record<string, unknown> | null | undefined
): Post[] {
  if (!event || typeof event.type !== 'string') return posts;

  if (event.type === 'post:deleted') {
    const targetId = Number(event.postId);
    if (!targetId) return posts;
    return posts.filter((p) => p.id !== targetId);
  }

  if (event.type === 'post:updated') {
    const targetId = Number(event.postId);
    const content = typeof event.content === 'string' ? event.content : null;
    if (!targetId || content === null) return posts;
    return posts.map((p) => (p.id === targetId ? { ...p, content } : p));
  }

  if (event.type === 'post:reaction') {
    const targetId = Number(event.postId);
    const likesCount = Number(event.likesCount);
    const supportsCount = Number(event.supportsCount);
    if (!targetId) return posts;
    return posts.map((p) =>
      p.id === targetId
        ? {
            ...p,
            likesCount: Number.isFinite(likesCount) ? likesCount : p.likesCount,
            supportsCount: Number.isFinite(supportsCount) ? supportsCount : p.supportsCount,
          }
        : p
    );
  }

  if (event.type === 'post:comment_new') {
    const targetId = Number(event.postId);
    const commentsCount = Number(event.commentsCount);
    if (!targetId) return posts;
    return posts.map((p) =>
      p.id === targetId
        ? {
            ...p,
            commentsCount: Number.isFinite(commentsCount) ? commentsCount : p.commentsCount + 1,
          }
        : p
    );
  }

  if (event.type === 'poll:voted') {
    const targetId = Number(event.postId);
    const nextOptions = Array.isArray(event.options) ? (event.options as PollOption[]) : null;
    const totalVotes = Number(event.totalVotes);
    if (!targetId || !nextOptions) return posts;
    return posts.map((p) => {
      if (p.id !== targetId || !p.poll) return p;
      return {
        ...p,
        poll: {
          ...p.poll,
          totalVotes: Number.isFinite(totalVotes) ? totalVotes : p.poll.totalVotes,
          options: p.poll.showResults
            ? nextOptions
            : p.poll.options.map((o) => ({ ...o })),
        },
      };
    });
  }

  return posts;
}
