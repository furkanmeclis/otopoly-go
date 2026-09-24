/**
 * Landing page copy (Turkish, server-rendered for SEO).
 * Icons are resolved by key in the components so this stays plain data.
 */

export const landingNav = [
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#nasil-calisir", label: "Nasıl çalışır" },
  { href: "#whatsapp", label: "WhatsApp" },
  { href: "#sss", label: "SSS" },
] as const;

export const hero = {
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
} as const;

export const services = [
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
] as const;

export type FeatureIcon =
  | "jobs"
  | "whatsapp"
  | "contract"
  | "cari"
  | "finance"
  | "stock"
  | "reports"
  | "staff";

export const features: ReadonlyArray<{
  icon: FeatureIcon;
  title: string;
  description: string;
  points: readonly string[];
  size: "lg" | "md";
}> = [
  {
    icon: "jobs",
    title: "İş emirleri ve operasyon panosu",
    description:
      "Her araç için hizmet satırları, sorumlu personel ve durum. İşlemde → Hazır → Teslim akışını tek bakışta görün.",
    points: [
      "Plaka ile hızlı kabul",
      "Personel ataması",
      "Ödeme durumu ayrı takip",
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
    points: ["QR ile bağlanır", "Düzenlenebilir şablonlar"],
    size: "md",
  },
  {
    icon: "cari",
    title: "Cari ve veresiye",
    description:
      "Veresiye işleri müşteri carisine işlenir; tahsilatı ve ekstreyi tek tıkla görün.",
    points: ["Açık bakiye takibi", "Ekstre PDF"],
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
      "Şampuan, koku, aksesuar satışı; stok düşümü ve tedarikçi alımları otomatik.",
    points: ["Hızlı satış", "Tedarikçi alımı"],
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
];

export const steps = [
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
] as const;

export const whatsappMessages = [
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
] as const;

export const whatsappSection = {
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
} as const;

export const reportsSection = {
  eyebrow: "Raporlar",
  title: "Hangi hizmet kazandırıyor, net görün.",
  description:
    "Gelir-gider, hizmet ve ürün dağılımı, açık cari bakiyeler ve en iyi müşteriler. Filtreleyin, tek tıkla PDF veya Excel olarak paylaşın.",
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
} as const;

export const faqs = [
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
] as const;

export const finalCta = {
  title: "Yarın sabah ilk aracı Otopoly ile kabul edin.",
  description:
    "Kaydı bugün açın, WhatsApp'ınızı bağlayın, hizmetlerinizi ekleyin. 14 gün boyunca ücretsiz.",
  cta: "Ücretsiz hesap oluştur",
} as const;
