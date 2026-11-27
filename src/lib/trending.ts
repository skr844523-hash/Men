export interface TrendingInput {
  likesCount: number;
  supportsCount: number;
  commentsCount: number;
  sharesOrSavesCount: number;
  contentLength: number;
  reportsCount: number;
  ageHours: number;
}

/**
 * Multi-factor trending score:
 * Combines weighted engagement (comments & support weigh more than simple likes),
 * content quality bonus, recency decay, and subtracts report penalties.
 * Never relies on likes alone.
 */
export function computeTrendingScore(input: TrendingInput): number {
  const likes = Math.max(0, input.likesCount);
  const supports = Math.max(0, input.supportsCount);
  const comments = Math.max(0, input.commentsCount);
  const shares = Math.max(0, input.sharesOrSavesCount);
  const reports = Math.max(0, input.reportsCount);
  const ageHours = Math.max(0, input.ageHours);

  // Meaningful discussion & support carry higher weight than passive likes
  const engagementScore =
    likes * 1.0 +
    supports * 1.8 +
    comments * 2.5 +
    shares * 2.2;

  // Quality bonus for thoughtful posts (40-400+ chars), capped so walls of spam don't dominate
  const qualityBonus = input.contentLength >= 40 ? Math.min(6, Math.floor(input.contentLength / 60)) : 0;

  // Report penalty reduces visibility of flagged content
  const reportPenalty = reports * 12;

  const rawScore = Math.max(0, engagementScore + qualityBonus - reportPenalty);

  // Gravity decay over time so fresh content rises cleanly
  const gravity = Math.pow(ageHours + 2, 1.35);
  return Number((rawScore / gravity).toFixed(4));
}
