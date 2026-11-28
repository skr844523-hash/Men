import { createApi } from '../server/fb/app.ts';
import { check, results, client, idTokenFromCustom, markVerified } from './fb-test-lib.mjs';
const server = createApi().listen(0);
const api = client(`http://127.0.0.1:${server.address().port}`);
async function mk(name) {
  const r = await api('POST', '/auth/register', { displayName: name, username: name, email: `${name}@example.com`, password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true });
  await markVerified(`${name}@example.com`);
  return { id: r.body.user.id, tok: await idTokenFromCustom(r.body.customToken) };
}
const A = await mk('msga'), B = await mk('msgb'), C = await mk('msgc');

let r = await api('GET', '/messages/conversations');
check('conversations need auth', r.status === 401);
r = await api('POST', '/messages/conversations', { peerId: B.id }, A.tok);
check('start conversation (stranger => request)', r.status === 201 && r.body.status === 'request');
const conv = r.body.conversationId;
r = await api('POST', '/messages/conversations', { peerId: B.id }, A.tok);
check('same conversation reused', r.status === 200 && r.body.conversationId === conv);
r = await api('POST', '/messages/conversations', { peerId: A.id }, B.tok);
check('reverse direction reuses it too', r.body.conversationId === conv);
r = await api('POST', '/messages/conversations', { peerId: A.id }, A.tok);
check('cannot message self', r.status === 400);

r = await api('POST', `/messages/conversations/${conv}`, { content: 'أهلا' }, A.tok);
check('send message', r.status === 201 && r.body.message.content === 'أهلا');
const m1 = r.body.message.id;
r = await api('POST', `/messages/conversations/${conv}`, { content: 'تسلل' }, C.tok);
check('outsider cannot send', r.status === 404);
r = await api('GET', `/messages/conversations/${conv}`, undefined, C.tok);
check('outsider cannot read', r.status === 404);
r = await api('POST', `/messages/conversations/${conv}`, { content: '' }, A.tok);
check('empty rejected', r.status === 400);

r = await api('GET', '/auth/me', undefined, B.tok);
check('request does not count as unread yet', r.body.user.unreadMessages === 0);
r = await api('GET', '/messages/conversations', undefined, B.tok);
check('list shows request + unread', r.body.conversations.length === 1 && r.body.conversations[0].status === 'request' && r.body.conversations[0].unreadCount === 1 && r.body.conversations[0].isInitiator === false);
r = await api('POST', `/messages/conversations/${conv}/respond`, { action: 'accept' }, A.tok);
check('initiator cannot accept own request', r.status === 403);
r = await api('POST', `/messages/conversations/${conv}/respond`, { action: 'accept' }, B.tok);
check('recipient accepts', r.status === 200 && r.body.status === 'active');
r = await api('GET', '/auth/me', undefined, B.tok);
check('unread counted after accept', r.body.user.unreadMessages === 1);

r = await api('POST', `/messages/conversations/${conv}`, { content: 'ردي', replyToId: m1 }, B.tok);
check('reply with quote', r.status === 201 && r.body.message.replyContent === 'أهلا');
const m2 = r.body.message.id;
r = await api('POST', `/messages/conversations/${conv}`, { content: 'x', replyToId: 99999 }, B.tok);
check('reply to foreign message rejected', r.status === 400);

r = await api('GET', `/messages/conversations/${conv}`, undefined, B.tok);
check('read marks messages read', r.status === 200 && r.body.messages.length === 2);
r = await api('GET', '/auth/me', undefined, B.tok);
check('unread cleared', r.body.user.unreadMessages === 0);
r = await api('GET', `/messages/conversations/${conv}`, undefined, A.tok);
check('sender sees read status', r.body.messages.find((m) => m.id === m1).status === 'read');

r = await api('POST', `/messages/conversations/${conv}/typing`, {}, A.tok);
check('typing ping', r.status === 200);
r = await api('DELETE', `/messages/${m1}`, undefined, B.tok);
check('cannot delete peer message', r.status === 403);
r = await api('DELETE', `/messages/${m1}`, undefined, A.tok);
check('delete own message', r.status === 200);
r = await api('GET', `/messages/conversations/${conv}`, undefined, B.tok);
const dm = r.body.messages.find((m) => m.id === m1);
check('deleted message hidden', dm.deleted && dm.content === 'تم حذف هذه الرسالة' && r.body.messages.find((m) => m.id === m2).replyContent === 'تم حذف هذه الرسالة');

r = await api('GET', '/messages/conversations?q=msgb', undefined, A.tok);
check('search conversations', r.body.conversations.length === 1 && r.body.conversations[0].lastMessage.content.length > 0);
r = await api('GET', '/messages/conversations?q=zzz', undefined, A.tok);
check('search no match', r.body.conversations.length === 0);

// privacy: allow_messages_from
await api('PATCH', '/account/privacy', { allowMessagesFrom: 'friends' }, C.tok);
r = await api('POST', '/messages/conversations', { peerId: C.id }, A.tok);
check('friends-only recipient refuses stranger', r.status === 403);
await api('PATCH', '/account/privacy', { allowMessagesFrom: 'none' }, C.tok);
r = await api('POST', '/messages/conversations', { peerId: C.id }, A.tok);
check('closed inbox refuses', r.status === 403);

// blocks
await api('POST', `/blocks/${B.id}`, {}, A.tok);
r = await api('POST', `/messages/conversations/${conv}`, { content: 'بعد الحظر' }, B.tok);
check('blocked cannot send', r.status === 403);
r = await api('GET', `/messages/conversations/${conv}`, undefined, A.tok);
check('blocker cannot open thread', r.status === 403);
r = await api('GET', '/messages/conversations', undefined, A.tok);
check('blocked conversation hidden from list', r.body.conversations.length === 0);

// decline
await api('POST', `/blocks/${B.id}`, {}, A.tok); // noop
await api('DELETE', `/blocks/${B.id}`, undefined, A.tok);
await api('PATCH', '/account/privacy', { allowMessagesFrom: 'everyone' }, C.tok);
r = await api('POST', '/messages/conversations', { peerId: C.id }, B.tok);
const c2 = r.body.conversationId;
r = await api('POST', `/messages/conversations/${c2}/respond`, { action: 'decline' }, C.tok);
check('decline', r.body.status === 'declined');
r = await api('POST', `/messages/conversations/${c2}`, { content: 'x' }, B.tok);
check('cannot message declined', r.status === 403);
r = await api('POST', '/messages/conversations', { peerId: C.id }, B.tok);
check('cannot restart declined', r.status === 403);

console.log(`\n${results.pass} passed, ${results.fail} failed`);
server.close();
process.exit(results.fail ? 1 : 0);
