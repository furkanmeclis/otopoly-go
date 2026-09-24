import { brand } from "@/config/brand";

/**
 * Public site URL used for canonical links, Open Graph, robots and sitemap.
 * Baked in at build time (static pages): the frontend Docker image receives
 * it as the `SITE_URL` build arg (defaults to `AUTH_URL` in compose.prod.yml).
 */
function resolveSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.AUTH_URL ||
    "http://localhost:3000";
  try {
    return new URL(raw).origin;
  } catch {
    return "http://localhost:3000";
  }
}

export const site = {
  url: resolveSiteUrl(),
  name: brand.productName,
  locale: "tr_TR",
  title: "Otopoly — Oto Yıkama ve Detailing İşletme Yazılımı",
  description:
    "Oto yıkama, detailing ve oto bakım işletmeleri için iş emri, WhatsApp bildirimleri, OTP onaylı dijital sözleşme, cari, kasa, stok ve raporları tek ekranda toplayan bulut yazılım. 14 gün ücretsiz deneyin.",
  keywords: [
    "oto yıkama yazılımı",
    "oto yıkama programı",
    "detailing yazılımı",
    "oto kuaför programı",
    "seramik kaplama sözleşmesi",
    "iş emri takibi",
    "cari takip programı",
    "WhatsApp müşteri bildirimi",
    "dijital sözleşme",
    "oto bakım işletme yönetimi",
  ],
} as const;
