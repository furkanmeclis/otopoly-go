/** Pure review helpers (no React Native imports, so smoke tests can use them). */
import type { Tone } from '@/components/ui';
import type { ReviewFollowUpStatus, ReviewStatus } from '@/features/reviews/types';

export function reviewStatusTone(status: ReviewStatus): Tone {
  switch (status) {
    case 'answered':
      return 'success';
    case 'sent':
    case 'opened':
    case 'scheduled':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function followUpTone(status: ReviewFollowUpStatus): Tone {
  if (status === 'required') return 'danger';
  if (status === 'done') return 'success';
  return 'neutral';
}

/** Delay presets of the settings screen (minutes, backend range 30–2880). */
export const REVIEW_DELAY_OPTIONS = [30, 60, 120, 240, 480, 1440, 2880];

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Same rule as the backend `ValidateGoogleURL` (empty clears it). */
export function isValidGoogleUrl(raw: string) {
  const v = raw.trim();
  if (!v) return true;
  return /^https:\/\/[^\s/]+\.[^\s]+$/i.test(v) && v.length <= 500;
}

/** Filled star count rendered as text (accessibility label / compact rows). */
export const starsText = (score: number | null | undefined) => (score ? '★'.repeat(score) + '☆'.repeat(5 - score) : '—');

/** Same variables as the backend renderer (`{{musteri_adi}}` or the short `{musteri_adi}`). */
export function renderReviewTemplate(tpl: string, vars: { musteri_adi: string; isletme_adi: string; link: string }) {
  return tpl.replace(/\{\{\s*\.?([a-z_]+)\s*\}\}|\{(musteri_adi|isletme_adi|link)\}/g, (_m, a: string | undefined, b: string | undefined) => {
    const key = (a ?? b) as keyof typeof vars;
    return vars[key] ?? '';
  });
}
