import type { BetaLandingContent } from "./types";

export const tr: BetaLandingContent = {
  locale: "tr",
  meta: {
    title: "Otopoly — Araç girişinden teslimata tek akış",
    description:
      "Plakayla kabul, iş emri, canlı operasyon panosu, kendi numaranızdan WhatsApp bildirimi, OTP onaylı dijital sözleşme ve kendiliğinden kapanan gün sonu raporu.",
  },
  nav: [
    { href: "#film", label: "Nasıl işler" },
    { href: "#fiyatlar", label: "Fiyatlar" },
    { href: "#sss", label: "SSS" },
  ],
  languageHref: "/en/beta-landing",
  film: {
    label: "Otopoly ile bir iş günü",
    scrollHint: "Kaydırın",
    chapterNav: "Bölümler",
    goToChapter: "{{n}}. bölüme git",
    chapters: [
      {
        eyebrow: "Plakayla kabul",
        title: "Araç kapıdan girer, işletmeniz tek ekrandan yönetilir.",
        body: "Plakayı yazın; müşteri, araç geçmişi ve yeni iş saniyeler içinde açılır. Kabulden teslimata kadar defter, fiş ya da kayıp not yok.",
      },
      {
        eyebrow: "İş emri",
        title: "Hizmetler ve ekip aynı kartta buluşur.",
        body: "Yıkama, seramik, iç temizlik… Her kalem ayrı satırda, her işin bir sorumlusu var. Biten adım tek dokunuşla işaretlenir.",
      },
      {
        eyebrow: "Canlı pano",
        title: "Hangi araç, hangi aşamada? Tek bakışta.",
        body: "Bekleyen, işlemde ve hazır araçlar ayrı sütunlarda durur. Kartı ileri taşıdığınızda durum tüm ekip için anında güncellenir.",
      },
      {
        eyebrow: "WhatsApp bildirimi",
        title: "Müşteriniz sizin numaranızdan haber alır.",
        body: "Araç hazır olduğunda mesaj kendiliğinden gider. “Arabam ne zaman biter?” telefonları azalır, ekip işine bakar.",
      },
      {
        eyebrow: "Dijital sözleşme",
        title: "İmza atıldı, onay kodu doğrulandı.",
        body: "Seramik ve PPF gibi işlerde müşteri tablette imzalar, telefonuna gelen kodla onaylar. Sözleşmenin PDF’i iş kartında saklanır.",
      },
      {
        eyebrow: "Kasa ve raporlar",
        title: "Gün, kendi hesabını kendisi kapatır.",
        body: "Tahsilatlar, açık hesaplar ve günün cirosu otomatik toplanır. Akşam tek ekrana bakıp ne kazandığınızı görürsünüz.",
      },
    ],
  },
};
