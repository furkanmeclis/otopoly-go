/** Shared wording for loyalty rows (web `features/loyalty/lib/labels.ts`). */
import type { Tone } from '@/components/ui';

import type { LoyaltyCampaign, LoyaltyPlan, PackageState, StampCard, SubscriptionState } from '../types';

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Money = (value: string | number | null | undefined, currency?: string) => string;

export const PACKAGE_STATE_TONE: Record<PackageState, Tone> = { active: 'success', expired: 'neutral', used_up: 'neutral', cancelled: 'danger' };
export const SUBSCRIPTION_STATE_TONE: Record<SubscriptionState, Tone> = { active: 'success', past_due: 'warning', cancelled: 'danger' };

/** "Ücretsiz İç-Dış Yıkama", "%20 indirim", "₺100 indirim". */
export function rewardLabel(t: Translate, money: Money, c: Pick<LoyaltyCampaign, 'reward_type' | 'reward_value' | 'reward_service'> | StampCard) {
  if (c.reward_type === 'free_service') return t('loyalty.reward.free_service', { service: c.reward_service?.name ?? '—' });
  if (c.reward_type === 'percent') return t('loyalty.reward.percent', { value: Number(c.reward_value) });
  return t('loyalty.reward.fixed', { value: money(c.reward_value) });
}

/** "Her 1 ayda 4 kullanım" / "… sınırsız kullanım". */
export function planUsesLabel(t: Translate, p: Pick<LoyaltyPlan, 'period_months' | 'uses_per_period'>) {
  return p.uses_per_period ? t('loyalty.plans.uses_value', { months: p.period_months, count: p.uses_per_period }) : t('loyalty.plans.unlimited_value', { months: p.period_months });
}

/** Eligible services / categories as one line. */
export const eligibilityLabel = (p: { services: { name: string }[]; categories: { name: string }[] }) => [...p.categories.map((c) => c.name), ...p.services.map((s) => s.name)].join(', ');

/** "bugün", "3 gün sonra", "2 gün gecikti". */
export function renewalLabel(t: Translate, days: number) {
  if (days === 0) return t('loyalty.renewal.today');
  return days > 0 ? t('loyalty.renewal.in_days', { count: days }) : t('loyalty.renewal.overdue_days', { count: -days });
}

/** yyyy-MM-dd → a Date at noon (no time-zone shift when formatted). */
export const dayDate = (day: string | null | undefined) => (day ? `${day}T12:00:00` : null);
