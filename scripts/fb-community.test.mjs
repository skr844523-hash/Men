import { createApi } from '../server/fb/app.ts';
import { insert, nowIso } from '../server/fb/store.ts';
import { check, results, client, idTokenFromCustom, markVerified } from './fb-test-lib.mjs';
const server = createApi().listen(0);
const api = client(`http://127.0.0.1:${server.address().port}`);
async function mk(name) {
  const r = await api('POST', '/auth/register', { displayName: name, username: name, email: `${name}@example.com`, password: 'Passw0rd!x', confirmPassword: 'Passw0rd!x', birthDate: '2000-01-01', termsAccepted: true });
  await markVerified(`${name}@example.com`);
  return { id: r.body.user.id, tok: await idTokenFromCustom(r.body.customToken) };
}
const A = await mk('owner1'), B = await mk('member1'), C = await mk('outsider');

let r = await api('POST', '/communities', { name: 'ab', description: 'x' }, A.tok);
check('community validation', r.status === 400);
r = await api('POST', '/communities', { name: 'مجتمع القراءة', description: 'لمحبي القراءة والكتب', category: 'ثقافة' }, A.tok);
check('create community', r.status === 201, JSON.stringify(r.body));
const pub = r.body.id;
r = await api('POST', '/communities', { name: 'مجتمع القراءة', description: 'لمحبي القراءة والكتب' }, B.tok);
check('duplicate name 409', r.status === 409);
r = await api('POST', '/communities', { name: 'مجتمع سري', description: 'مجتمع خاص جدا', privacy: 'private' }, A.tok);
const priv = r.body.id;

r = await api('POST', `/communities/${pub}/join`, {}, B.tok);
check('join public', r.body.joined === true);
r = await api('POST', `/communities/${priv}/join`, {}, B.tok);
check('private community is invite-only', r.status === 403);
r = await api('POST', `/communities/${priv}/members`, { userId: B.id }, B.tok);
check('non-member cannot invite', r.status === 403);
r = await api('POST', `/communities/${priv}/members`, { userId: B.id }, A.tok);
check('owner adds member', r.status === 201);
r = await api('POST', `/communities/${priv}/members`, { userId: B.id }, A.tok);
check('duplicate add 409', r.status === 409);

r = await api('POST', '/posts', { content: 'منشور في المجتمع الخاص', communityId: priv }, B.tok);
check('member posts in private community', r.status === 201 && r.body.post.communityName === 'مجتمع سري');
const privPost = r.body.post.id;
r = await api('POST', '/posts', { content: 'تسلل', communityId: priv }, C.tok);
check('outsider cannot post', r.status === 403);
r = await api('GET', `/posts/${privPost}`, undefined, C.tok);
check('outsider cannot read private post', r.status === 404);
r = await api('GET', '/posts', undefined, C.tok);
check('private post not in outsider feed', !r.body.items.some((p) => p.id === privPost));
r = await api('GET', `/communities/${priv}`, undefined, C.tok);
check('outsider sees community but no posts', r.status === 200 && r.body.community.posts.length === 0 && r.body.community.isMember === false);
r = await api('GET', `/communities/${priv}`, undefined, B.tok);
check('member sees posts', r.body.community.posts.length === 1 && r.body.community.membersCount === 2 && r.body.community.myRole === 'member');
r = await api('POST', `/posts/${privPost}/comments`, { content: 'x' }, C.tok);
check('outsider cannot comment on private post', r.status === 404);
r = await api('POST', `/posts/${privPost}/react`, { reactionType: 'like' }, C.tok);
check('outsider cannot react to private post', r.status === 404);

r = await api('POST', '/posts', { content: 'منشور المالك', communityId: priv }, A.tok);
const ownerPost = r.body.post.id;
r = await api('GET', `/posts/${ownerPost}`, undefined, B.tok);
check('member reads owner private post', r.status === 200);
r = await api('DELETE', `/communities/${priv}/members/${A.id}`, undefined, B.tok);
check('cannot remove owner', r.status === 403 || r.status === 400);
r = await api('DELETE', `/communities/${priv}/members/${B.id}`, undefined, A.tok);
check('owner removes member', r.status === 200);
r = await api('GET', `/posts/${ownerPost}`, undefined, B.tok);
check('removed member loses access', r.status === 404);
r = await api('POST', `/communities/${priv}/join`, {}, A.tok);
check('owner cannot leave', r.status === 400);
r = await api('GET', '/communities?q=القراءة', undefined, C.tok);
check('community search', r.body.communities.length === 1 && r.body.communities[0].membersCount === 2 && r.body.communities[0].isMember === false);

// questions
r = await api('POST', '/posts', { content: 'ما أفضل كتاب؟', type: 'question' }, A.tok);
const q = r.body.post.id;
r = await api('POST', `/questions/${q}/answers`, { content: 'الأيام' }, B.tok);
check('answer', r.status === 201);
const ans = r.body.id;
r = await api('POST', `/questions/${q}/answers`, { content: 'مجهول', isAnonymous: true }, C.tok);
check('anon answer', r.status === 201);
r = await api('POST', `/answers/${ans}/vote`, { value: 1 }, C.tok);
check('upvote', r.body.score === 1);
r = await api('POST', `/answers/${ans}/vote`, { value: 1 }, C.tok);
check('same vote toggles off', r.body.score === 0);
await api('POST', `/answers/${ans}/vote`, { value: -1 }, C.tok);
r = await api('GET', `/questions/${q}/answers`, undefined, C.tok);
check('answers listed with shield', r.body.answers.length === 2 && r.body.answers.some((a) => a.author === null) && r.body.answers.find((a) => a.id === ans).userVote === -1);
r = await api('POST', `/questions/${q}/best-answer`, { answerId: ans }, B.tok);
check('only asker picks best', r.status === 403);
r = await api('POST', `/questions/${q}/best-answer`, { answerId: ans }, A.tok);
check('best answer', r.status === 200);
r = await api('GET', `/posts/${q}`, undefined, A.tok);
check('question meta', r.body.post.question.answersCount === 2 && r.body.post.question.bestAnswerId === ans);
r = await api('GET', '/auth/me', undefined, B.tok);
check('best answer badge', r.body.user.badges.some((b) => b.slug === 'best_answerer'));

// polls
r = await api('POST', '/posts', { content: 'أيهما؟', type: 'poll', pollOptions: ['شاي', 'قهوة'], pollShowResults: 'after_vote' }, A.tok);
const poll = r.body.post;
r = await api('GET', `/posts/${poll.id}`, undefined, C.tok);
check('poll results hidden before vote', r.body.post.poll.showResults === false && r.body.post.poll.options[0].votesCount === null);
r = await api('POST', `/polls/${poll.id}/vote`, { optionId: poll.poll.options[1].id }, C.tok);
check('vote', r.status === 200 && r.body.post.poll.totalVotes === 1 && r.body.post.poll.userVotedOptionId === poll.poll.options[1].id && r.body.post.poll.options[1].percent === 100);
r = await api('POST', `/polls/${poll.id}/vote`, { optionId: poll.poll.options[0].id }, C.tok);
check('one vote per account', r.status === 409);
r = await api('POST', `/polls/${poll.id}/vote`, { optionId: 999 }, B.tok);
check('invalid option', r.status === 400);

// daily question + challenges (created directly, admin routes tested separately)
const dq = await insert('daily_questions', { question_text: 'سؤال اليوم؟', date_key: '2026-11-27', is_active: 1, created_at: nowIso() });
const ch = await insert('challenges', { title: 'تحدي', description: 'وصف', category: 'عام', points_reward: 20, badge_slug: 'challenge_participant', starts_at: nowIso(), ends_at: new Date(Date.now() + 864e5).toISOString(), status: 'active', created_at: nowIso() });
r = await api('GET', '/daily-question');
check('daily question', r.body.activeQuestion.id === dq.id && r.body.answers.length === 0);
r = await api('POST', `/daily-question/${dq.id}/answer`, { content: 'جوابي' }, B.tok);
check('daily answer', r.status === 201);
r = await api('GET', '/daily-question');
check('daily answers listed', r.body.answers.length === 1);
r = await api('POST', `/challenges/${ch.id}/enter`, { content: 'مشاركتي' }, B.tok);
check('challenge enter', r.status === 201);
r = await api('GET', '/challenges', undefined, B.tok);
check('challenges list', r.body.challenges[0].entriesCount === 1 && r.body.challenges[0].userParticipated === true && r.body.challenges[0].entries.length === 1);
r = await api('GET', '/auth/me', undefined, B.tok);
check('challenge badge', r.body.user.badges.some((b) => b.slug === 'challenge_participant'));

// explore / trending
r = await api('GET', '/explore', undefined, C.tok);
check('explore', r.status === 200 && Array.isArray(r.body.trendingPosts) && r.body.activeCommunities.length >= 1 && !JSON.stringify(r.body).includes('منشور في المجتمع الخاص'));
r = await api('GET', '/explore?q=الأيام', undefined, C.tok);
check('explore search', r.status === 200 && Array.isArray(r.body.posts));
r = await api('GET', '/explore?q=member', undefined, C.tok);
check('explore user search', r.body.users.length === 1);
r = await api('GET', '/trending');
check('trending', r.status === 200 && Array.isArray(r.body.posts) && Array.isArray(r.body.topics));

console.log(`\n${results.pass} passed, ${results.fail} failed`);
server.close();
process.exit(results.fail ? 1 : 0);
