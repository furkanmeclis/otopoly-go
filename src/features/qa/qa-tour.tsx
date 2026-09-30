import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { qaTourEnabled } from '@/config/env';
import { createLogger } from '@/lib/logger';

const log = createLogger('qa.tour');

/** Screens visited by the QA tour, in order. Only used by builds made with EXPO_PUBLIC_QA_TOUR=1. */
export const QA_TOUR: Href[] = [
  '/',
  '/operations',
  '/customers',
  '/finance',
  '/menu',
  '/finance/accounts',
  '/finance/transactions',
  '/reports',
  '/sales',
  '/sales/new',
  '/cari',
  '/suppliers',
  '/purchases',
  '/leads',
  '/quotes',
  '/todos',
  '/catalog',
  '/catalog/products',
  '/catalog/services',
  '/staff',
  '/profile',
  '/settings/messaging',
  '/settings/usage',
  '/settings/letterhead',
  '/assistant',
  '/contracts',
  '/contracts/templates',
  '/exports',
  '/imports',
];
export const QA_STEP_MS = 4000;

/** Walks through QA_TOUR once after sign-in so every screen can be screenshotted without touch input. */
export function QaTour() {
  useEffect(() => {
    if (!qaTourEnabled) return;
    let step = 0;
    const timer = setInterval(() => {
      if (step >= QA_TOUR.length) {
        clearInterval(timer);
        log.info('QA tour finished');
        return;
      }
      const href = QA_TOUR[step++];
      log.info('QA tour step', { step, href: String(href) });
      router.replace(href);
    }, QA_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  return null;
}
