import { all, bump, get, releaseUnique, remove, where } from './store.ts';
import { deleteMediaByUrl, deleteMediaOwnedBy } from './media.ts';

// Removes everything a user owns. Called on account deletion.
const BY_FIELD: Array<[string, string]> = [
  ['posts', 'author_id'], ['comments', 'author_id'], ['comment_replies', 'author_id'], ['answers', 'author_id'],
  ['reactions', 'user_id'], ['saved_posts', 'user_id'], ['post_follows', 'user_id'], ['notifications', 'user_id'],
  ['user_points', 'user_id'], ['user_badges', 'user_id'], ['poll_votes', 'user_id'], ['answer_votes', 'user_id'],
  ['follows', 'follower_id'], ['follows', 'following_id'], ['blocked_users', 'blocker_id'], ['blocked_users', 'blocked_id'],
  ['friendships', 'requester_id'], ['friendships', 'addressee_id'], ['community_members', 'user_id'],
  ['challenge_entries', 'user_id'], ['reports', 'reporter_id'], ['support_requests', 'user_id'],
];

export async function deleteUserData(userId: number): Promise<void> {
  for (const [table, field] of BY_FIELD) {
    const rows = await where<any>(table, field, userId);
    for (const r of rows) await remove(table, r.key ?? r.id);
  }
  for (const field of ['user1_id', 'user2_id']) {
    for (const c of await where<any>('conversations', field, userId)) {
      for (const m of await where<any>('messages', 'conversation_id', c.id)) {
        await deleteMediaByUrl(m.media_url ?? null);
        await remove('messages', m.id);
      }
      await releaseUnique('conv', `${Math.min(c.user1_id, c.user2_id)}_${Math.max(c.user1_id, c.user2_id)}`);
      await remove('conversations', c.id);
    }
  }
  // Uploaded voice notes belong to the account that uploaded them.
  await deleteMediaOwnedBy(userId);
  void all;
}

// Deletes a post and everything hanging off it.
export async function purgePost(postId: number): Promise<void> {
  const comments = await where<any>('comments', 'post_id', postId);
  for (const c of comments) {
    for (const r of await where<any>('comment_replies', 'comment_id', c.id)) await remove('comment_replies', r.id);
    await remove('comments', c.id);
  }
  for (const [table, field] of [['saved_posts', 'post_id'], ['post_follows', 'post_id'], ['reactions', 'target_id'], ['answers', 'question_post_id'], ['poll_votes', 'poll_post_id'], ['challenge_entries', 'post_id']] as const) {
    const rows = await where<any>(table, field, postId);
    for (const r of rows) {
      if (table === 'reactions' && r.target_type !== 'post') continue;
      await remove(table, r.id);
    }
  }
  const p = await get<any>('posts', postId);
  if (p?.community_id) await bump('communities', p.community_id, 'posts_count', -1);
  await remove('posts', postId);
}
