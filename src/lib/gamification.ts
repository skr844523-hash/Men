export interface LevelInfo {
  levelIndex: number;
  name: string;
  minPoints: number;
  nextLevelPoints: number | null;
  progressPercent: number;
}

export interface BadgeDefinition {
  slug: string;
  title: string;
  description: string;
  iconName: string;
  pointsRequired: number;
}

export const LEVELS: Array<{ name: string; minPoints: number }> = [
  { name: 'مبتدئ', minPoints: 0 },
  { name: 'عضو نشط', minPoints: 50 },
  { name: 'عضو مميز', minPoints: 200 },
  { name: 'نجم المجتمع', minPoints: 500 },
  { name: 'أسطورة مين', minPoints: 1000 },
];

export const BADGE_CATALOG: BadgeDefinition[] = [
  {
    slug: 'new_member',
    title: 'عضو جديد',
    description: 'انضممت إلى عائلة مين؟ وبدأت رحلتك.',
    iconName: 'UserPlus',
    pointsRequired: 0,
  },
  {
    slug: 'first_post',
    title: 'أول منشور',
    description: 'نشرت أول قصة أو فضفضة في مين؟.',
    iconName: 'Feather',
    pointsRequired: 10,
  },
  {
    slug: 'first_comment',
    title: 'أول تعليق',
    description: 'شاركت برأيك وتفاعلت مع منشور آخر.',
    iconName: 'MessageCircle',
    pointsRequired: 5,
  },
  {
    slug: 'supporter',
    title: 'داعم الآخرين',
    description: 'أرسلت دعمًا حقيقيًا لـ 5 منشورات أو فضفضات.',
    iconName: 'HeartHandshake',
    pointsRequired: 25,
  },
  {
    slug: 'best_answerer',
    title: 'صاحب إجابات مميزة',
    description: 'تم اختيار إجابتك كأفضل إجابة على سؤال.',
    iconName: 'Award',
    pointsRequired: 50,
  },
  {
    slug: 'challenge_participant',
    title: 'مشارك التحديات',
    description: 'شاركت في تحدي إيجابي داخل المجتمع.',
    iconName: 'Trophy',
    pointsRequired: 30,
  },
  {
    slug: 'active_community',
    title: 'عضو مجتمع نشط',
    description: 'انضممت وتفاعلت داخل المجتمعات.',
    iconName: 'Users',
    pointsRequired: 40,
  },
];

export type PointAction =
  | 'signup'
  | 'create_post'
  | 'create_comment'
  | 'give_support'
  | 'answer_question'
  | 'best_answer'
  | 'challenge_entry'
  | 'community_join'
  | 'daily_question';

export const ACTION_POINTS: Record<PointAction, number> = {
  signup: 10,
  create_post: 10,
  create_comment: 5,
  give_support: 3,
  answer_question: 8,
  best_answer: 25,
  challenge_entry: 20,
  community_join: 5,
  daily_question: 15,
};

export function getLevelInfo(points: number): LevelInfo {
  const safePoints = Math.max(0, Math.floor(points));
  let idx = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (safePoints >= LEVELS[i].minPoints) {
      idx = i;
    }
  }
  const current = LEVELS[idx];
  const next = LEVELS[idx + 1] ?? null;
  if (!next) {
    return {
      levelIndex: idx + 1,
      name: current.name,
      minPoints: current.minPoints,
      nextLevelPoints: null,
      progressPercent: 100,
    };
  }
  const span = next.minPoints - current.minPoints;
  const gained = safePoints - current.minPoints;
  const progressPercent = Math.min(100, Math.max(0, Math.round((gained / span) * 100)));
  return {
    levelIndex: idx + 1,
    name: current.name,
    minPoints: current.minPoints,
    nextLevelPoints: next.minPoints,
    progressPercent,
  };
}

export function calculateAwardablePoints(params: {
  action: PointAction;
  content?: string;
  recentSameContents?: string[];
  actionsTodayCount?: number;
  dailyCap?: number;
}): { awarded: number; reason?: string } {
  const {
    action,
    content = '',
    recentSameContents = [],
    actionsTodayCount = 0,
    dailyCap = 40,
  } = params;

  if (actionsTodayCount >= dailyCap) {
    return { awarded: 0, reason: 'تم الوصول للحد اليومي للنقاط لمنع التكرار.' };
  }

  // Anti-spam check for text-based actions
  if (action === 'create_post' || action === 'create_comment' || action === 'answer_question') {
    const normalized = content.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalized.length < 6) {
      return { awarded: 0, reason: 'المحتوى قصير جدًا للحصول على نقاط.' };
    }
    if (recentSameContents.some((prev) => prev.trim().toLowerCase().replace(/\s+/g, ' ') === normalized)) {
      return { awarded: 0, reason: 'لا تُمنح نقاط على المحتوى المكرر.' };
    }
  }

  return { awarded: ACTION_POINTS[action] };
}
