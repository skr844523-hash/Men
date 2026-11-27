export type AppSection =
  | 'home'
  | 'confessions'
  | 'explore'
  | 'questions'
  | 'polls'
  | 'communities'
  | 'messages'
  | 'friends'
  | 'trending'
  | 'daily'
  | 'challenges'
  | 'notifications'
  | 'profile'
  | 'saved'
  | 'gamification'
  | 'settings'
  | 'help'
  | 'admin';

export interface LevelInfo {
  levelIndex: number;
  name: string;
  minPoints: number;
  nextLevelPoints: number | null;
  progressPercent: number;
}

export interface BadgeItem {
  slug: string;
  title: string;
  description: string;
  icon_name: string;
  awarded_at?: string;
}

export interface User {
  id: number;
  uid?: string;
  username: string;
  email: string | null;
  phone: string | null;
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'suspended' | 'banned';
  createdAt: string;
  displayName: string;
  avatar: string;
  bio: string;
  interests: string[];
  privacyLevel: 'public' | 'friends' | 'limited';
  showActivity: boolean;
  allowMessagesFrom: 'everyone' | 'friends' | 'none';
  allowCommentsFrom: 'everyone' | 'friends' | 'none';
  showPostsTo: 'everyone' | 'friends' | 'only_me';
  allowAnonMentions: boolean;
  notifyPrefs: Record<string, boolean>;
  isPremium: boolean;
  points: number;
  level: LevelInfo;
  badges: BadgeItem[];
  unreadNotifications: number;
  unreadMessages: number;
}

export interface PostAuthor {
  id: number;
  username: string;
  displayName: string;
  avatar: string;
}

export interface PollOption {
  id: number;
  label: string;
  votesCount: number | null;
  percent: number | null;
}

export interface PollData {
  endsAt: string | null;
  showResultsMode: 'always' | 'after_vote';
  userVotedOptionId: number | null;
  totalVotes: number;
  showResults: boolean;
  options: PollOption[];
}

export interface QuestionData {
  questionType: string;
  allowVoting: boolean;
  bestAnswerId: number | null;
  answersCount: number;
}

export interface Post {
  id: number;
  type: 'post' | 'confession' | 'question' | 'poll' | 'challenge_entry';
  category: string;
  moodType: string | null;
  content: string;
  mediaUrl: string | null;
  isAnonymous: boolean;
  isOwner: boolean;
  allowComments: boolean;
  audience: string;
  communityId: number | null;
  communityName: string | null;
  communitySlug: string | null;
  dailyQuestionId: number | null;
  challengeId: number | null;
  author: PostAuthor | null;
  likesCount: number;
  supportsCount: number;
  commentsCount: number;
  savesCount: number;
  sharesCount: number;
  trendingScore: number;
  userLiked: boolean;
  userSupported: boolean;
  userSaved: boolean;
  userFollowingPost: boolean;
  poll: PollData | null;
  question: QuestionData | null;
  createdAt: string;
}

export interface CommentReply {
  id: number;
  commentId: number;
  content: string;
  isAnonymous: boolean;
  isOwner: boolean;
  author: PostAuthor | null;
  createdAt: string;
}

export interface CommentItem {
  id: number;
  postId: number;
  content: string;
  isAnonymous: boolean;
  isOwner: boolean;
  author: PostAuthor | null;
  createdAt: string;
  replies: CommentReply[];
}

export interface AnswerItem {
  id: number;
  questionPostId: number;
  content: string;
  isAnonymous: boolean;
  isOwner: boolean;
  isBest: boolean;
  score: number;
  userVote: number;
  author: PostAuthor | null;
  createdAt: string;
}

export interface Community {
  id: number;
  name: string;
  slug: string;
  description: string;
  category: string;
  avatarUrl: string;
  coverUrl: string;
  rules: string;
  privacy: 'public' | 'private';
  whoCanPost: 'members' | 'moderators';
  membersCount: number;
  postsCount?: number;
  isMember?: boolean;
  myRole?: string | null;
  createdAt: string;
}

export interface Conversation {
  id: number;
  status: 'active' | 'request' | 'declined';
  isInitiator: boolean;
  lastMessageAt: string;
  unreadCount: number;
  peer: {
    id: number;
    username: string;
    displayName: string;
    avatar: string;
    isOnline: boolean;
  };
  lastMessage: {
    id: number;
    senderId: number;
    content: string;
    messageType: 'text' | 'image' | 'audio';
    status: 'sent' | 'delivered' | 'read';
    createdAt: string;
  } | null;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number;
  content: string;
  mediaUrl: string | null;
  messageType: 'text' | 'image' | 'audio';
  replyToId: number | null;
  replyContent?: string | null;
  status: 'sent' | 'delivered' | 'read';
  deleted: boolean;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  body: string;
  target_type: string | null;
  target_id: number | null;
  is_read: number;
  created_at: string;
}

export interface GlobalNotificationSettings {
  instantAlertsEnabled: boolean;
  browserPushEnabled: boolean;
  quietModeEnabled: boolean;
  allowReactionNotifs: boolean;
  allowCommentNotifs: boolean;
  allowFriendNotifs: boolean;
  allowMessageNotifs: boolean;
  allowBroadcastBanner: boolean;
}

export interface AppConfig {
  categories: string[];
  announcement: string;
  termsText: string;
  privacyText: string;
  monetization: {
    adsEnabled: boolean;
    premiumEnabled: boolean;
    supporterBadgesEnabled: boolean;
    announcementSlot: string;
  };
  notificationSettings?: GlobalNotificationSettings;
}
