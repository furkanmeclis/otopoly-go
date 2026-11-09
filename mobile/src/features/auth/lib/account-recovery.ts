import { env } from '@/config/env';
import type { AppLocale } from '@/lib/i18n/translate';

const DEFAULT_DELETE_URL = 'https://otopoly.app/account/delete';

/**
 * Web page that cancels a pending account deletion (30-day window, email code). Opened from the
 * ACCOUNT_DEACTIVATED sign-in error. The default otopoly.app page has an EN twin under `/en`.
 */
export function accountRecoveryUrl(locale: AppLocale): string {
  const base =
    env.accountDeleteUrl === DEFAULT_DELETE_URL && locale === 'en' ? 'https://otopoly.app/en/account/delete' : env.accountDeleteUrl;
  return `${base}${base.includes('?') ? '&' : '?'}mode=recover`;
}
