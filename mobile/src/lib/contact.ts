import { Linking } from 'react-native';

import { createLogger } from '@/lib/logger';

const log = createLogger('contact');

/** Digits only, Turkish numbers in international form (0532… / 532… → 90532…) for wa.me. */
export function internationalPhone(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 11) return `9${digits}`;
  if (digits.length === 10 && digits.startsWith('5')) return `90${digits}`;
  return digits;
}

function open(url: string) {
  Linking.openURL(url).catch((error: unknown) => log.warn('Cannot open link', { scheme: url.split(':')[0], error: String(error) }));
}

export const contact = {
  call: (phone: string) => open(`tel:${phone.replace(/[^\d+]/g, '')}`),
  sms: (phone: string, body?: string) => open(`sms:${phone.replace(/[^\d+]/g, '')}${body ? `?body=${encodeURIComponent(body)}` : ''}`),
  /** wa.me opens the WhatsApp app when installed, the browser otherwise (no query-scheme entitlement needed). */
  whatsapp: (phone: string, text?: string) => open(`https://wa.me/${internationalPhone(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`),
  email: (address: string) => open(`mailto:${address}`),
};
