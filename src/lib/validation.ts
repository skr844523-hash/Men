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

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (typeof password !== 'string' || password.length < 8) {
    return { valid: false, error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'كلمة المرور طويلة جدًا.' };
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

export function sanitizeMediaUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/src/assets/') || trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) return null;
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}
