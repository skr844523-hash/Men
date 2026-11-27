// Generates firebase/database.rules.json. Run: node scripts/gen-rules.mjs
// Model: ALL application data lives under t/, unique/, counters/, kv/ and is reachable ONLY through the
// server (Firebase Admin SDK bypasses rules). Clients can read nothing there. The single client-readable
// area is live/ (realtime hints), where a user may read only their own channel.
import fs from 'node:fs';
const idx = {
  users: ['role', 'uid', 'status'],
  posts: ['author_id', 'community_id', 'type', 'challenge_id', 'daily_question_id'],
  comments: ['post_id', 'author_id'],
  comment_replies: ['comment_id', 'author_id'],
  reactions: ['user_id', 'target_id'],
  saved_posts: ['user_id', 'post_id'],
  post_follows: ['user_id', 'post_id'],
  notifications: ['user_id'],
  user_points: ['user_id'],
  user_badges: ['user_id'],
  blocked_users: ['blocker_id', 'blocked_id'],
  friendships: ['requester_id', 'addressee_id'],
  follows: ['follower_id', 'following_id'],
  community_members: ['community_id', 'user_id'],
  communities: ['creator_id', 'slug'],
  conversations: ['user1_id', 'user2_id'],
  messages: ['conversation_id', 'sender_id'],
  answers: ['question_post_id', 'author_id'],
  answer_votes: ['user_id', 'answer_id'],
  poll_votes: ['user_id', 'poll_post_id'],
  challenge_entries: ['challenge_id', 'user_id', 'post_id'],
  reports: ['status', 'reporter_id', 'target_id'],
  support_requests: ['user_id', 'status'],
  moderation_actions: ['moderator_id'],
  daily_questions: ['date_key'],
  challenges: ['status'],
};
const t = { '.read': false, '.write': false };
for (const [table, fields] of Object.entries(idx)) t[table] = { '.indexOn': fields };
const rules = {
  rules: {
    '.read': false,
    '.write': false,
    t,
    live: {
      '$uid': { '.read': "auth != null && auth.uid === $uid", '.write': false },
      '_all': { '.read': 'auth != null', '.write': false },
      '_posts': { '.read': 'auth != null', '.write': false },
    },
  },
};
fs.writeFileSync('firebase/database.rules.json', JSON.stringify(rules, null, 2) + '\n');
console.log('rules written');
