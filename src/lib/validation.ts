export interface AgeCheckResult {
  valid: boolean;
  age: number;
  error?: string;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@+/, '');
}

export function validateUsername(raw: string): { valid: boolean; value: string; error?: string } {
  const value = normalizeUsername(raw);
  if (!value || value.length < 3 || value.length > 24) {
    return { valid: false, value, error: 'اسم المستخدم يجب أن يكون بين 3 و24 حرفًا.' };
  }
  if (!/^[a-z0-9_]+$/.test(value)) {
    return {
      valid: false,
      value,
      error: 'اسم المستخدم يقبل أحرفًا إنجليزية وأرقامًا والشرطة السفلية (_) فقط.',
    };
  }
  const reserved = new Set(['admin', 'meen', 'anonymous', 'system', 'support', 'root', 'moderator']);
  if (reserved.has(value)) {
    return { valid: false, value, error: 'اسم المستخدم هذا محجوز للنظام.' };
  }
  return { valid: true, value };
}

export function validateEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export function validatePhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  return /^\+?[0-9]{8,15}$/.test(cleaned);
}

// The most-guessed passwords. Kept short on purpose: the length and character
// rules do most of the work, this only blocks the obvious ones.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1',
  '1234567890', '12345678', '123456789', '0123456789', '1111111111',
  'qwerty1234', 'qwertyuiop', 'qwerty12345', 'iloveyou1', 'iloveyou12',
  'admin12345', 'admin123456', 'administrator', 'welcome123', 'welcome1234',
  'letmein123', 'abc123456', '1q2w3e4r5t', 'aa12345678', 'asdfghjkl1',
  'mohamed123', 'mohamed1234', 'ahmed12345', 'egypt12345', 'masr123456',
  'football12', 'barcelona1', 'whatsapp12', 'instagram1', 'facebook12',
  'changeme123', 'trustno1234', 'superman12', 'sunshine12', 'princess12',
  'mohamed12345', 'ahmed123456', 'egypt123456', 'masr1234567', 'salah123456',
]);

export function validatePassword(
  password: string,
  context: { username?: string; email?: string } = {}
): { valid: boolean; error?: string } {
  if (typeof password !== 'string' || password.length < 10) {
    return { valid: false, error: 'كلمة المرور يجب أن تكون 10 أحرف على الأقل.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'كلمة المرور طويلة جدًا.' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, error: 'كلمة المرور دي شائعة جدًا وسهلة التخمين، اختر واحدة أقوى.' };
  }
  const handle = String(context.username || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (handle.length >= 3 && password.toLowerCase().includes(handle)) {
    return { valid: false, error: 'كلمة المرور لا يجب أن تحتوي على اسم المستخدم.' };
  }
  const localPart = String(context.email || '').split('@')[0].trim().toLowerCase();
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return { valid: false, error: 'كلمة المرور لا يجب أن تحتوي على بريدك الإلكتروني.' };
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 2) {
    return { valid: false, error: 'كلمة المرور لازم تحتوي على حروف وأرقام أو رموز، مش نوع واحد بس.' };
  }
  return { valid: true };
}

export function checkMinimumAge(birthDateStr: string, minAge = 13, now = new Date()): AgeCheckResult {
  const parsed = new Date(birthDateStr);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, age: 0, error: 'تاريخ الميلاد غير صالح.' };
  }
  let age = now.getUTCFullYear() - parsed.getUTCFullYear();
  const m = now.getUTCMonth() - parsed.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < parsed.getUTCDate())) {
    age--;
  }
  if (age < minAge) {
    return {
      valid: false,
      age,
      error: `عذرًا، يجب أن يكون عمرك ${minAge} سنة على الأقل لاستخدام مين؟ بأمان.`,
    };
  }
  if (age > 110) {
    return { valid: false, age, error: 'تاريخ الميلاد غير منطقي.' };
  }
  return { valid: true, age };
}

const UNSAFE_PATTERNS: RegExp[] = [
  /انتحار|اقتل\s*نفسك|إيذاء\s*النفس|أذى\s*جسدي/i,
  /تهديد\s*بالقتل|هقتلك|سأقتلك|ابتزاز/i,
];

const DOXXING_PATTERNS: RegExp[] = [
  // Egyptian / Gulf / International phone numbers pasted inside public confessions/challenges
  /(?:\+?20|01[0125])[0-9]{8,9}/,
  /(?:\+?966|05)[0-9]{8}/,
  // 14-digit national ID pattern
  /\b[23][0-9]{13}\b/,
];

export function checkContentSafety(
  text: string,
  options: { allowContactInfo?: boolean } = {}
): { safe: boolean; reason?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { safe: false, reason: 'المحتوى لا يمكن أن يكون فارغًا.' };
  }
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        safe: false,
        reason: 'المحتوى يخالف قواعد السلامة (يمنع التحريض على إيذاء النفس أو التهديد أو الابتزاز).',
      };
    }
  }
  if (!options.allowContactInfo) {
    for (const pattern of DOXXING_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          safe: false,
          reason: 'لحماية الخصوصية، يمنع نشر أرقام الهواتف أو الأرقام القومية في المنشورات العامة.',
        };
      }
    }
  }
  return { safe: true };
}

// Only our own paths and the two hosts we actually produce media on. Anything
// else (an avatar or a post image hosted on someone's own server) is an IP
// tracking pixel aimed at everyone who scrolls past it.
const MEDIA_HOSTS = ['ibb.co', 'googleusercontent.com'];
function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return MEDIA_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

export function sanitizeMediaUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return null;
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' && hostAllowed(parsed.hostname)) {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}
