import { createApi } from '../server/fb/app.ts';
import { check, results, client, idTokenFromCustom, markVerified } from './fb-test-lib.mjs';
const server = createApi().listen(0);
const api = client(`http://127.0.0.1:${server.address().port}`);

async function mk(name) {
  let r = await api('POST', '/auth/register', { displayName: name, username: name, email: `${name}@example.com`, password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true });
  if (r.status !== 201) throw new Error('register ' + JSON.stringify(r.body));
  await markVerified(`${name}@example.com`);
  return { id: r.body.user.id, tok: await idTokenFromCustom(r.body.customToken), name };
}
const A = await mk('alice'), B = await mk('bobby'), C = await mk('carol');

let r = await api('POST', '/posts', { content: 'مرحبا بالجميع', category: 'فضفضة' });
check('create post needs auth', r.status === 401);
r = await api('POST', '/posts', { content: 'مرحبا بالجميع', category: 'فضفضة' }, A.tok);
check('create post', r.status === 201 && r.body.post.author.username === 'alice' && r.body.post.isOwner === true, JSON.stringify(r.body));
const p1 = r.body.post.id;
r = await api('POST', '/posts', { content: 'سر صغير', type: 'confession', moodType: 'فضفضة بدون اسم' }, A.tok);
check('anonymous confession hides author', r.status === 201 && r.body.post.author === null && r.body.post.isAnonymous);
const pAnon = r.body.post.id;
r = await api('POST', '/posts', { content: 'للأصدقاء فقط', audience: 'friends' }, A.tok);
const pFriends = r.body.post.id;
r = await api('POST', '/posts', { content: 'تصويت', type: 'poll', pollOptions: ['أ', 'ب'] }, A.tok);
check('poll created', r.status === 201 && r.body.post.poll.options.length === 2, JSON.stringify(r.body).slice(0, 200));
r = await api('POST', '/posts', { content: 'x', type: 'poll', pollOptions: ['واحد'] }, A.tok);
check('poll needs 2 options', r.status === 400);

r = await api('GET', '/posts', undefined, B.tok);
check('feed shows public + anon, hides friends-only', r.status === 200 && r.body.items.some((p) => p.id === p1) && r.body.items.some((p) => p.id === pAnon) && !r.body.items.some((p) => p.id === pFriends), JSON.stringify(r.body.items.map((p) => p.id)));
check('feed never leaks anon author', r.body.items.find((p) => p.id === pAnon).author === null && !JSON.stringify(r.body.items.find((p) => p.id === pAnon)).includes('alice'));
r = await api('GET', `/posts/${pFriends}`, undefined, B.tok);
check('friends-only post 404 for stranger', r.status === 404);
r = await api('GET', '/posts');
check('feed public for guests', r.status === 200 && r.body.items.length >= 2);

// react
r = await api('POST', `/posts/${p1}/react`, { reactionType: 'like' }, B.tok);
check('like', r.status === 200 && r.body.active && r.body.likesCount === 1);
r = await api('GET', `/posts/${p1}`, undefined, B.tok);
check('userLiked true', r.body.post.userLiked === true && r.body.post.likesCount === 1);
r = await api('POST', `/posts/${p1}/react`, { reactionType: 'like' }, B.tok);
check('unlike', r.body.active === false && r.body.likesCount === 0);
r = await api('POST', `/posts/${p1}/react`, { reactionType: 'support' }, C.tok);
check('support', r.body.supportsCount === 1);
r = await api('GET', '/notifications', undefined, A.tok);
check('author got reaction notifications', r.body.notifications.length >= 2 && r.body.notifications.every((n) => !('user_id' in n)));
r = await api('GET', '/auth/me', undefined, A.tok);
check('unread count', r.body.user.unreadNotifications >= 2);
await api('POST', '/notifications/read-all', {}, A.tok);
r = await api('GET', '/auth/me', undefined, A.tok);
check('read-all clears', r.body.user.unreadNotifications === 0);

// comments
r = await api('POST', `/posts/${p1}/comments`, { content: 'تعليق' }, B.tok);
check('comment', r.status === 201 && r.body.comment.author.username === 'bobby');
const cid = r.body.comment.id;
r = await api('POST', `/posts/${p1}/comments`, { content: 'مجهول', isAnonymous: true }, C.tok);
check('anon comment', r.status === 201 && r.body.comment.author === null);
r = await api('POST', `/comments/${cid}/replies`, { content: 'رد' }, A.tok);
check('reply', r.status === 201);
r = await api('GET', `/posts/${p1}/comments`, undefined, A.tok);
check('comments list w/ replies, anon shield', r.body.comments.length === 2 && r.body.comments[0].replies.length === 1 && r.body.comments.some((c) => c.author === null && !JSON.stringify(c).includes('carol')));
r = await api('GET', `/posts/${p1}`, undefined, A.tok);
check('commentsCount', r.body.post.commentsCount === 2);
r = await api('POST', `/posts/${pFriends}/comments`, { content: 'تسلل' }, B.tok);
check('cannot comment on invisible post', r.status === 404);

// save / follow post / share
r = await api('POST', `/posts/${p1}/save`, {}, B.tok);
check('save', r.body.saved === true);
r = await api('GET', '/saved', undefined, B.tok);
check('saved list', r.body.items.length === 1 && r.body.items[0].id === p1 && r.body.items[0].userSaved);
r = await api('POST', `/posts/${p1}/follow`, {}, B.tok);
check('follow post', r.body.following === true);
r = await api('POST', `/posts/${p1}/share`, {}, B.tok);
check('share count', r.body.sharesCount === 1);
r = await api('POST', `/posts/${p1}/share`, {});
check('share needs auth', r.status === 401);

// edit / delete permissions
r = await api('PATCH', `/posts/${p1}`, { content: 'معدل' }, B.tok);
check('cannot edit others post', r.status === 403);
r = await api('PATCH', `/posts/${p1}`, { content: 'معدل' }, A.tok);
check('edit own post', r.status === 200 && r.body.post.content === 'معدل');
r = await api('DELETE', `/posts/${pAnon}`, undefined, B.tok);
check('cannot delete others post', r.status === 403);

// friends flow
r = await api('POST', '/friends/request', { userId: B.id }, A.tok);
check('friend request', r.status === 200);
r = await api('POST', '/friends/request', { userId: B.id }, A.tok);
check('duplicate friend request rejected', r.status === 400);
r = await api('GET', '/friends', undefined, B.tok);
check('incoming request listed', r.body.incomingRequests.length === 1 && r.body.incomingRequests[0].id === A.id);
r = await api('POST', '/friends/respond', { userId: A.id, action: 'accept' }, C.tok);
check('third party cannot accept', r.status === 404);
r = await api('POST', '/friends/respond', { userId: A.id, action: 'accept' }, B.tok);
check('accept', r.status === 200);
r = await api('GET', `/posts/${pFriends}`, undefined, B.tok);
check('friend can now see friends-only post', r.status === 200);
r = await api('GET', '/posts?filter=friends', undefined, B.tok);
check('friends filter', r.body.items.every((p) => p.isOwner || p.author?.id === A.id) && r.body.items.length >= 3);
r = await api('GET', '/users/alice', undefined, B.tok);
check('profile friendStatus', r.status === 200 && r.body.profile.friendStatus === 'friends' && r.body.profile.friendsCount === 1 && !r.body.profile.posts.some((p) => p.id === pAnon));
r = await api('GET', '/users/alice', undefined, A.tok);
check('own profile includes own anon posts', r.body.profile.posts.some((p) => p.id === pAnon));

// follow users, blocks
r = await api('POST', `/follow/${A.id}`, {}, C.tok);
check('follow user', r.body.following === true);
r = await api('POST', `/blocks/${C.id}`, {}, A.tok);
check('block', r.status === 200);
r = await api('GET', `/posts/${p1}`, undefined, C.tok);
check('blocked user cannot see blocker posts', r.status === 404);
r = await api('GET', '/users/alice', undefined, C.tok);
check('blocked user cannot see profile', r.status === 404);
r = await api('GET', '/posts', undefined, A.tok);
check('blocker feed hides blocked authors', r.body.items.every((p) => p.author?.id !== C.id));
r = await api('GET', '/blocks', undefined, A.tok);
check('blocks list', r.body.blocked.length === 1);
r = await api('POST', `/friends/request`, { userId: A.id }, C.tok);
check('blocked cannot send friend request', r.status === 403);
await api('DELETE', `/blocks/${C.id}`, undefined, A.tok);
r = await api('GET', `/posts/${p1}`, undefined, C.tok);
check('unblocked can see again', r.status === 200);

// reports / support
r = await api('POST', '/reports', { targetType: 'post', targetId: p1, reason: 'spam' }, B.tok);
check('report', r.status === 201);
r = await api('POST', '/reports', { targetType: 'post', targetId: p1, reason: 'spam' }, B.tok);
check('duplicate open report 409', r.status === 409);
r = await api('POST', '/reports', { targetType: 'post', targetId: 99999, reason: 'x' }, B.tok);
check('report missing target 404', r.status === 404);
r = await api('GET', '/reports/mine', undefined, B.tok);
check('my reports', r.body.reports.length === 1);
r = await api('POST', '/support', { subject: 'مشكلة', description: 'وصف المشكلة هنا' }, B.tok);
check('support request', r.status === 201);
r = await api('GET', '/support/mine', undefined, B.tok);
check('support mine', r.body.requests.length === 1);

// delete own post cascade
r = await api('DELETE', `/posts/${p1}`, undefined, A.tok);
check('delete own post', r.status === 200);
r = await api('GET', `/posts/${p1}`, undefined, A.tok);
check('deleted post gone', r.status === 404);
r = await api('GET', '/saved', undefined, B.tok);
check('saves cleaned', r.body.items.length === 0);

// profile edits
r = await api('PATCH', '/account/profile', { username: 'bobby' }, A.tok);
check('username taken 409', r.status === 409);
r = await api('PATCH', '/account/profile', { username: 'alice_new' }, A.tok);
check('rename ok', r.status === 200);
r = await api('GET', '/users/alice_new', undefined, B.tok);
check('lookup by new username', r.status === 200);
r = await api('GET', '/users/alice', undefined, B.tok);
check('old username free/gone', r.status === 404);

console.log(`\n${results.pass} passed, ${results.fail} failed`);
server.close();
process.exit(results.fail ? 1 : 0);
