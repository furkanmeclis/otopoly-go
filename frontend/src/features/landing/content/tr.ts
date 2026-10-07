import type { LandingContent } from "./types";

export const tr: LandingContent = {
  locale: "tr",
  htmlLang: "tr",
  meta: {
    title: "Otopoly — Oto Yıkama ve Detailing İşletme Yazılımı",
    description:
      "Oto yıkama, detailing ve oto bakım işletmeleri için iş emri, WhatsApp bildirimleri, OTP onaylı dijital sözleşme, cari, kasa ve stok yönetimi. 14 gün ücretsiz deneyin.",
    ogLocale: "tr_TR",
    appCategory: "Oto yıkama ve detailing işletme yönetimi",
    offer: "14 gün ücretsiz deneme",
  },
  a11y: {
    mainNav: "Ana menü",
    home: "Otopoly ana sayfa",
    menuOpen: "Menüyü aç",
    menuClose: "Menüyü kapat",
    sections: "Sayfa bölümleri",
    account: "Hesap",
    services: "Desteklenen hizmetler",
    weeklyChart: "Haftalık gelir grafiği örneği",
  },
  language: { label: "Dil", switchTo: "English", href: "/en" },
  nav: [
    { href: "#ozellikler", label: "Özellikler" },
    { href: "#bir-gun", label: "Nasıl işler" },
    { href: "#fiyatlar", label: "Fiyatlar" },
    { href: "#whatsapp", label: "WhatsApp" },
    { href: "#sss", label: "SSS" },
  ],
  hero: {
    eyebrow: "Oto yıkama · Detailing · Oto bakım",
    titleLead: "Aracın kabulünden teslimine,",
    titleAccent: "tüm işletmeniz tek ekranda.",
    description:
      "İş emirleri, WhatsApp bildirimleri, OTP onaylı dijital sözleşmeler, cari, kasa ve stok. Otopoly, yıkama ve detailing işletmenizin günlük akışını kağıtsız ve hatasız yönetir.",
    primaryCta: "14 gün ücretsiz dene",
    secondaryCta: "Giriş yap",
    trust: [
      "Kredi kartı gerekmez",
      "Kurulum yok, tarayıcıdan çalışır",
      "Tablet ve telefon uyumlu",
    ],
  },
  services: [
    "İç-dış yıkama",
    "Seramik kaplama",
    "PPF kaplama",
    "Detaylı iç temizlik",
    "Pasta cila",
    "Motor yıkama",
    "Boya koruma",
    "Cam filmi",
    "Jant temizliği",
    "Koltuk yıkama",
  ],
  sections: {
    features: {
      eyebrow: "Özellikler",
      title: "Kağıt, defter ve Excel yerine tek bir akış.",
      description:
        "Araç kabulünden ödemeye kadar her adım kayıt altında. Personeliniz ne yapacağını, siz de işletmenin durumunu anlık görürsünüz.",
    },
    how: {
      eyebrow: "Başlamak",
      title: "Bugün kaydolun, yarın sabah kullanın.",
      description:
        "Kurulum, eğitim veya donanım gerekmez. Üç adımda işletmeniz hazır.",
    },
    faq: {
      eyebrow: "Sık sorulan sorular",
      title: "Aklınıza takılanlar",
      description:
        "Deneme süresi, kurulum, ödeme, WhatsApp bağlantısı ve dijital sözleşmeler hakkında en çok sorulanlar.",
    },
  },
  features: [
    {
      icon: "jobs",
      title: "İş emirleri ve operasyon panosu",
      description:
        "Her araç için hizmet satırları, sorumlu personel ve durum. İşlemde → Hazır → Teslim akışını tek bakışta görün.",
      points: [
        "Plaka ile hızlı kabul",
        "Personel ataması",
        "Ödeme durumu ayrı takip",
        "Birkaç gün süren işler teslim gününe yazılır",
      ],
      size: "lg",
    },
    {
      icon: "contract",
      title: "OTP onaylı dijital sözleşme",
      description:
        "Seramik, PPF gibi işler için sözleşmeyi tablette imzalatın. Müşteriye WhatsApp'tan onay kodu ve KVKK aydınlatması gider; PDF delil kaydıyla oluşur.",
      points: [
        "İsimler otomatik dolar",
        "Hasar fotoğrafı ekleri",
        "Zaman damgalı PDF",
      ],
      size: "lg",
    },
    {
      icon: "whatsapp",
      title: "Kendi numaranızdan WhatsApp",
      description:
        "Araç kabul, hazır, teslim ve ödeme mesajları işletmenizin WhatsApp hattından otomatik gider.",
      points: [
        "QR ile bağlanır",
        "Düzenlenebilir şablonlar",
        "Gün sonu özeti ve ekip uyarıları",
      ],
      size: "md",
    },
    {
      icon: "cari",
      title: "Cari ve veresiye",
      description:
        "Veresiye işleri müşteri carisine işlenir; tahsilatı ve ekstreyi tek tıkla görün.",
      points: ["Açık bakiye takibi", "Borç/alacak kolonlu ekstre PDF"],
      size: "md",
    },
    {
      icon: "finance",
      title: "Kasa ve finans",
      description:
        "Nakit ve kart kasaları, gelir-gider kategorileri, kasalar arası transfer.",
      points: ["Günlük kasa özeti", "Otomatik gelir kaydı"],
      size: "md",
    },
    {
      icon: "stock",
      title: "Ürün satışı ve stok",
      description:
        "Şampuan, koku, aksesuar satışı; hizmet reçeteleri sayesinde her işte kullanılan ürün stoktan kendiliğinden düşer.",
      points: ["Hızlı satış", "Hizmet reçetesi", "Tedarikçi alımı"],
      size: "md",
    },
    {
      icon: "reports",
      title: "Raporlar",
      description:
        "Gelir, gider, hizmet dağılımı ve en iyi müşteriler. PDF, Excel ve CSV dışa aktarma.",
      points: ["Gün / hafta / ay", "Dışa aktarma"],
      size: "lg",
    },
    {
      icon: "staff",
      title: "Personel ve yetkiler",
      description:
        "Kasa personeline ayrı hesap açın; iptal ve finans gibi kritik işlemler yalnızca işletme sahibinde.",
      points: ["Rol bazlı yetki", "İşlem geçmişi"],
      size: "lg",
    },
  ],
  steps: [
    {
      title: "İşletmenizi kaydedin",
      description:
        "İki dakikada hesap açın. 14 günlük deneme hemen başlar, kart bilgisi istenmez.",
    },
    {
      title: "WhatsApp'ı ve hizmetlerinizi ekleyin",
      description:
        "QR kodu okutarak işletme hattınızı bağlayın, hizmet ve fiyat listenizi girin.",
    },
    {
      title: "İlk aracı kabul edin",
      description:
        "Plakayı yazın, hizmetleri seçin, gerekiyorsa sözleşmeyi imzalatın. Gerisini Otopoly takip eder.",
    },
  ],
  whatsappMessages: [
    {
      time: "09:12",
      title: "Aracınız Kabul Edildi",
      body: "Sayın Ayşe Kaya, 34 TKO 34 plakalı aracınız servisimize alındı. Gelişmeleri size bildireceğiz.",
    },
    {
      time: "09:14",
      title: "Sözleşme onay kodu",
      body: "Seramik Kaplama Sözleşmesi (SZL-0012) için onay kodunuz: *482913* · KVKK aydınlatma metni ektedir.",
    },
    {
      time: "15:40",
      title: "Aracınız Hazır",
      body: "Aracınızın işlemi tamamlandı, teslime hazır. İyi günler dileriz.",
    },
    {
      time: "16:05",
      title: "Ödemeniz Alındı",
      body: "Ödemeniz alındı. Tutar: 4.250,00 TRY. Bizi tercih ettiğiniz için teşekkürler.",
    },
  ],
  whatsappSection: {
    eyebrow: "WhatsApp entegrasyonu",
    title: "Müşteriniz aramadan önce haberi olsun.",
    description:
      "Otopoly, işletmenizin kendi WhatsApp hattından doğru anda doğru mesajı gönderir. Müşteri “araç hazır mı?” diye aramaz; siz telefona değil işe odaklanırsınız.",
    points: [
      "İşletme numaranız QR ile bağlanır, ek ücretli API gerekmez",
      "Kabul, hazır, teslim ve ödeme mesajları otomatik",
      "Sözleşme onayı için tek kullanımlık kod ve KVKK metni",
      "Mesaj şablonlarını kendi dilinizle düzenleyin",
    ],
  },
  whatsappAccount: "işletme hesabı",
  whatsappToday: "Bugün",
  reportsSection: {
    eyebrow: "Raporlar",
    title: "Hangi hizmet kazandırıyor, net görün.",
    description:
      "Gelir-gider, hizmet ve ürün dağılımı, açık cari bakiyeler ve en iyi müşteriler. Filtreleyin, tek tıkla PDF veya Excel olarak paylaşın.",
    mixTitle: "Hizmet dağılımı",
    bars: [
      { label: "Pzt", value: 42 },
      { label: "Sal", value: 58 },
      { label: "Çar", value: 51 },
      { label: "Per", value: 66 },
      { label: "Cum", value: 83 },
      { label: "Cmt", value: 100 },
      { label: "Paz", value: 71 },
    ],
    mix: [
      { label: "Seramik kaplama", share: 38 },
      { label: "Detaylı temizlik", share: 27 },
      { label: "İç-dış yıkama", share: 21 },
      { label: "Ürün satışı", share: 14 },
    ],
  },
  productMock: {
    title: "Operasyon · Bugün",
    revenueToday: "Bugünkü ciro",
    readyToast: "{{plate}} plakalı aracınız teslime hazır. İyi günler dileriz.",
    now: "şimdi",
    numberLocale: "tr-TR",
    columns: ["İşlemde", "Hazır", "Teslim"],
    jobs: [
      {
        plate: "34 TKO 34",
        vehicle: "Toyota Corolla",
        service: "Seramik kaplama",
        price: "₺4.250",
        staff: "AU",
      },
      {
        plate: "06 BRK 061",
        vehicle: "VW Passat",
        service: "Detaylı iç temizlik",
        price: "₺1.400",
        staff: "MK",
      },
      {
        plate: "35 EGE 35",
        vehicle: "Renault Clio",
        service: "İç-dış yıkama",
        price: "₺450",
        staff: "SY",
      },
      {
        plate: "16 BRS 116",
        vehicle: "BMW 320i",
        service: "Pasta cila",
        price: "₺2.100",
        staff: "AU",
      },
      {
        plate: "41 KCL 41",
        vehicle: "Fiat Egea",
        service: "Motor yıkama",
        price: "₺600",
        staff: "MK",
      },
      {
        plate: "34 PPF 07",
        vehicle: "Tesla Model Y",
        service: "PPF kaplama",
        price: "₺38.000",
        staff: "SY",
      },
    ],
  },
  journey: {
    eyebrow: "Bir aracın günü",
    title: "Siz işe odaklanın, gerisini Otopoly halleder.",
    description:
      "Bir seramik kaplama işini adım adım ilerletin. Her adımda müşteriye giden mesajı ve arka planda kendiliğinden işlenenleri görün.",
    next: "Sonraki adım",
    restart: "Baştan başlat",
    customerPhone: "Müşterinin telefonu",
    ownerPhone: "işletme sahibine",
    behindTitle: "Arka planda",
    stepLabel: "Adım {{n}} / {{total}}",
    plate: "34 TKO 34",
    vehicle: "Toyota Corolla · Ayşe Kaya",
    stages: [
      {
        label: "Araç kabul",
        time: "09:12",
        message: {
          to: "customer",
          title: "Aracınız kabul edildi",
          body: "Sayın Ayşe Kaya, 34 TKO 34 plakalı aracınız servisimize alındı. Gelişmeleri size bildireceğiz.",
        },
        effects: [
          {
            kind: "job",
            text: "İş emri açıldı: Seramik kaplama + İç-dış yıkama, ₺4.250",
          },
        ],
      },
      {
        label: "Sözleşme",
        time: "09:14",
        message: {
          to: "customer",
          title: "Sözleşme onay kodu",
          body: "Seramik Kaplama Sözleşmesi için onay kodunuz: *482913*. KVKK aydınlatma metni ektedir.",
        },
        effects: [
          {
            kind: "contract",
            text: "Müşteri kodu onayladı, imzalı sözleşme PDF olarak arşivlendi",
          },
        ],
      },
      {
        label: "Uygulama",
        time: "11:30",
        effects: [
          {
            kind: "stock",
            text: "Hizmet reçetesi: Seramik şişe −1, Şampuan −60 ml stoktan düştü",
          },
          {
            kind: "team",
            text: "Ekibe uyarı: 34 TKO 34 işlemde 2 saati geçti",
          },
        ],
      },
      {
        label: "Hazır",
        time: "15:40",
        message: {
          to: "customer",
          title: "Aracınız hazır",
          body: "Aracınızın işlemi tamamlandı, teslime hazır. İyi günler dileriz.",
        },
        effects: [{ kind: "job", text: "Kart “Hazır” sütununa geçti" }],
      },
      {
        label: "Teslim ve ödeme",
        time: "16:05",
        message: {
          to: "customer",
          title: "Ödemeniz alındı",
          body: "Ödemeniz alındı. Tutar: 4.250,00 TRY. Bizi tercih ettiğiniz için teşekkürler.",
        },
        effects: [
          { kind: "cash", text: "Kart kasasına ₺4.250 gelir kaydı işlendi" },
        ],
      },
      {
        label: "Gün sonu",
        time: "21:00",
        message: {
          to: "owner",
          title: "Günün özeti",
          body: "Bugün 18 araç teslim edildi, ciro ₺42.300. En çok: iç-dış yıkama. Yarın 6 randevu var.",
        },
        effects: [
          {
            kind: "summary",
            text: "Gün sonu özeti işletme sahibine WhatsApp'tan gitti",
          },
        ],
      },
    ],
  },
  pricing: {
    eyebrow: "Fiyatlar",
    title: "İşletmenizin büyüklüğüne göre plan seçin.",
    description:
      "14 gün ücretsiz deneyin, sonra size uyan planla devam edin. Fiyatlara KDV dahildir; yıllık ödemede indirim uygulanır.",
    monthly: "Aylık",
    yearly: "Yıllık",
    perMonth: "/ ay",
    perYear: "/ yıl",
    vatIncluded: "KDV dahil",
    yearlySaving: "Yıllıkta {{value}} indirim",
    trialCard: {
      name: "Ücretsiz deneme",
      price: "₺0",
      description: "14 gün boyunca kart bilgisi olmadan deneyin.",
      points: ["Günlük 10 işlem", "2 personel", "Dijital sözleşme"],
      cta: "Denemeyi başlat",
    },
    choose: "Bu planla başla",
    configure: "Limitlerinizi seçin",
    configureHint: "Kaydırıcıları oynatın, fiyat anında güncellenir.",
    unlimited: "Sınırsız",
    included: "Dahil",
    notIncluded: "Dahil değil",
    footnote:
      "Havale/EFT ile ödeme, e-Arşiv fatura. İstediğiniz zaman plan değiştirin; kalan süreniz yeni plandan düşülür.",
    popular: "Önerilen",
    stepPrice: "her {{step}} {{unit}} için +{{price}}",
    units: {},
    plans: {},
  },
  faqs: [
    {
      q: "Ücretsiz deneme var mı?",
      a: "Evet. Kayıt olduğunuz anda 14 günlük deneme başlar. Kredi kartı bilgisi istenmez; deneme boyunca tüm özellikleri kullanabilirsiniz.",
    },
    {
      q: "Kurulum yapmam gerekiyor mu?",
      a: "Hayır. Otopoly bulut tabanlıdır; bilgisayar, tablet veya telefondan tarayıcı ile çalışır. Sözleşme imzası için tablet kullanmanızı öneririz.",
    },
    {
      q: "WhatsApp mesajları hangi numaradan gider?",
      a: "İşletmenizin kendi WhatsApp numarasından. Mesajlaşma ayarlarında gösterilen QR kodu telefonunuzdan okutmanız yeterli; hangi olaylarda mesaj gideceğini siz seçersiniz.",
    },
    {
      q: "Dijital sözleşmeler nasıl doğrulanıyor?",
      a: "Müşteri imzadan önce WhatsApp'a gelen tek kullanımlık kodu onaylar; mesajda sözleşme bilgileri ve KVKK aydınlatması yer alır. Doğrulama zamanı, maskeli telefon ve imza zamanı sözleşme PDF'ine işlenir.",
    },
    {
      q: "Personelim her şeyi görebilir mi?",
      a: "Hayır. Kasa personeli iş emri, satış ve sözleşme işlemlerini yapabilir; iptal, finans ve katalog gibi kritik işlemler yalnızca işletme sahibine açıktır.",
    },
    {
      q: "Verilerimi dışa aktarabilir miyim?",
      a: "Evet. Listeler ve raporlar PDF, Excel (XLSX), CSV ve JSON olarak dışa aktarılabilir; PDF'ler işletmenizin antetiyle oluşur.",
    },
    {
      q: "Ödemeyi nasıl yapıyorum, fatura kesiliyor mu?",
      a: "Planınızı panelden seçip havale/EFT ile ödersiniz; dekontu yüklediğiniz ödeme onaylanınca aboneliğiniz başlar ve e-Arşiv faturanız otomatik oluşur. Yıllık ödemede indirim uygulanır.",
    },
    {
      q: "Deneme bitince verilerim silinir mi?",
      a: "Hayır. Süre bitince birkaç günlük ek süre tanınır, sonra hesap salt okunur moda geçer: verilerinizi görür ve dışa aktarırsınız, planı yenilediğinizde her şey kaldığı yerden devam eder.",
    },
  ],
  finalCta: {
    title: "Yarın sabah ilk aracı Otopoly ile kabul edin.",
    description:
      "Kaydı bugün açın, WhatsApp'ınızı bağlayın, hizmetlerinizi ekleyin. 14 gün boyunca ücretsiz.",
    cta: "Ücretsiz hesap oluştur",
  },
  footer: {
    tagline:
      "Oto yıkama ve hizmet yönetim platformu. İş emirlerinden sözleşmeye, carilerden raporlara kadar tek platform.",
    product: "Ürün",
    account: "Hesap",
    register: "Ücretsiz hesap oluştur",
    login: "Giriş yap",
    rights: "Tüm hakları saklıdır.",
    privacy: "Gizlilik Politikası",
  },
};
