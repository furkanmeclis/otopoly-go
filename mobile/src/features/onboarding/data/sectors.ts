/**
 * Business types offered by the "create your business" wizard (organization `sector`, sent with
 * POST /v1/auth/organizations and editable in business settings). The choice also picks the starter service
 * template (catalog services created with the new business); the names follow the app language and every
 * price stays editable. Prices are TRY starting points.
 */
import type { components } from '@/api/generated/api';

import type { StarterService } from './starter-services';

export type SectorKey = NonNullable<components['schemas']['OrganizationSector']>;

type Template = { key: string; tr: string; en: string; price: string; selected?: boolean };

const WASH: Template[] = [
  { key: 'exterior', tr: 'Dış yıkama', en: 'Exterior wash', price: '250', selected: true },
  { key: 'full', tr: 'İç-dış yıkama', en: 'Interior & exterior wash', price: '450', selected: true },
  { key: 'interior', tr: 'Detaylı iç temizlik', en: 'Deep interior cleaning', price: '1400', selected: true },
  { key: 'engine', tr: 'Motor yıkama', en: 'Engine wash', price: '600' },
  { key: 'seats', tr: 'Koltuk yıkama', en: 'Seat shampoo', price: '900' },
  { key: 'polish', tr: 'Pasta cila', en: 'Polish & wax', price: '2100', selected: true },
];

export const SECTOR_TEMPLATES: Record<SectorKey, Template[]> = {
  car_wash: WASH,
  detailing: [
    { key: 'interior', tr: 'Detaylı iç temizlik', en: 'Deep interior cleaning', price: '1400', selected: true },
    { key: 'polish', tr: 'Pasta cila', en: 'Polish & wax', price: '2100', selected: true },
    { key: 'ceramic', tr: 'Seramik kaplama', en: 'Ceramic coating', price: '4250', selected: true },
    { key: 'headlight', tr: 'Far temizleme', en: 'Headlight restoration', price: '750' },
    { key: 'ppf', tr: 'PPF kaplama', en: 'Paint protection film', price: '38000' },
    { key: 'full', tr: 'İç-dış yıkama', en: 'Interior & exterior wash', price: '450' },
  ],
  ppf_tint: [
    { key: 'ppf_full', tr: 'Tam PPF kaplama', en: 'Full paint protection film', price: '38000', selected: true },
    { key: 'ppf_front', tr: 'Ön paket PPF', en: 'Front-end PPF', price: '14000', selected: true },
    { key: 'window', tr: 'Cam filmi', en: 'Window tint', price: '3500', selected: true },
    { key: 'wrap', tr: 'Renk değişimi kaplama', en: 'Colour change wrap', price: '45000' },
    { key: 'ceramic', tr: 'Seramik kaplama', en: 'Ceramic coating', price: '4250' },
  ],
  auto_service: [
    { key: 'oil', tr: 'Periyodik bakım', en: 'Scheduled maintenance', price: '3500', selected: true },
    { key: 'brake', tr: 'Fren balatası değişimi', en: 'Brake pad replacement', price: '1800', selected: true },
    { key: 'diagnostic', tr: 'Arıza tespiti', en: 'Diagnostics', price: '750', selected: true },
    { key: 'ac', tr: 'Klima gazı dolumu', en: 'A/C recharge', price: '1200' },
    { key: 'battery', tr: 'Akü değişimi', en: 'Battery replacement', price: '600' },
  ],
  tyres: [
    { key: 'swap', tr: 'Lastik değişimi (4 adet)', en: 'Tyre change (4)', price: '800', selected: true },
    { key: 'balance', tr: 'Balans ayarı', en: 'Wheel balancing', price: '600', selected: true },
    { key: 'alignment', tr: 'Rot ayarı', en: 'Wheel alignment', price: '900', selected: true },
    { key: 'storage', tr: 'Lastik oteli (sezonluk)', en: 'Seasonal tyre storage', price: '1500' },
    { key: 'repair', tr: 'Lastik tamiri', en: 'Puncture repair', price: '300' },
  ],
  other: WASH.map((s) => ({ ...s, selected: false })),
};

export const SECTOR_KEYS = Object.keys(SECTOR_TEMPLATES) as SectorKey[];

/** Wizard drafts saved before the keys followed the API (`film` → `ppf_tint`, …). */
const LEGACY_KEYS: Record<string, SectorKey> = { film: 'ppf_tint', service: 'auto_service', tire: 'tyres' };

export function toSectorKey(value: unknown): SectorKey | null {
  if (typeof value !== 'string' || !value) return null;
  if ((SECTOR_KEYS as string[]).includes(value)) return value as SectorKey;
  return LEGACY_KEYS[value] ?? null;
}

/** Starter services for the sector in the app language. */
export function servicesFor(sector: SectorKey, locale: string): StarterService[] {
  return SECTOR_TEMPLATES[sector].map((s) => ({ key: s.key, name: locale === 'en' ? s.en : s.tr, price: s.price, selected: Boolean(s.selected) }));
}
