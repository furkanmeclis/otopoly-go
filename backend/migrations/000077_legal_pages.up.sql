-- Public legal pages (privacy policy / KVKK aydınlatma metni, later terms).
-- One row per slug; Markdown body + title per locale. tr is required, en
-- falls back to tr when empty. Edited by the platform admin.
CREATE TABLE legal_pages (
    id          BIGSERIAL    PRIMARY KEY,
    slug        VARCHAR(64)  NOT NULL,
    title_tr    TEXT         NOT NULL,
    title_en    TEXT         NOT NULL DEFAULT '',
    body_tr     TEXT         NOT NULL,
    body_en     TEXT         NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by  BIGINT       NULL REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT uq_legal_pages_slug UNIQUE (slug),
    CONSTRAINT chk_legal_pages_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT chk_legal_pages_title_tr CHECK (btrim(title_tr) <> ''),
    CONSTRAINT chk_legal_pages_body_tr CHECK (btrim(body_tr) <> '')
);

CREATE TRIGGER trg_legal_pages_set_updated_at
    BEFORE UPDATE ON legal_pages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO legal_pages (slug, title_tr, title_en, body_tr, body_en) VALUES (
'privacy',
'Gizlilik Politikası ve KVKK Aydınlatma Metni',
'Privacy Policy',
$md$Bu metin, Otopoly platformunu (otopoly.app web sitesi, web uygulaması ve mobil uygulamalar) kullanırken kişisel verilerinizin nasıl işlendiğini açıklar ve 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") m.10 uyarınca aydınlatma metni niteliğindedir.

## 1. Veri sorumlusu

Otopoly platformu **[Şirket unvanı]** ("Otopoly", "biz") tarafından işletilmektedir.

- **Adres:** [Adres]
- **MERSİS no:** [MERSİS no]
- **E-posta:** [contact@otopoly.app](mailto:contact@otopoly.app)

Otopoly'nin rolü, verinin kime ait olduğuna göre değişir:

- **Platform kullanıcıları** (Otopoly'ye kayıt olan işletme sahipleri ve çalışanları) bakımından Otopoly **veri sorumlusudur**.
- **İşletmelerin müşterileri** (araç sahipleri, iş emri, teklif veya sözleşme muhatapları) bakımından ilgili verilerin **veri sorumlusu, Otopoly'yi kullanan işletmedir**. Otopoly bu verileri yalnızca işletme adına ve işletmenin talimatıyla, hizmetin sunulması amacıyla işleyen **veri işleyendir**. Bu verilerle ilgili talepleriniz için öncelikle hizmet aldığınız işletmeye başvurmanızı rica ederiz.

## 2. İşlenen kişisel veriler

### Platform kullanıcıları

- **Kimlik ve iletişim:** ad, soyad, e-posta adresi, telefon numarası.
- **Hesap bilgileri:** şifrenin özeti (şifrenin kendisi saklanmaz), passkey kayıtları, rol ve yetkiler, dil tercihi, Google, Apple, Facebook veya GitHub ile giriş yapıldığında bu hizmetlerin paylaştığı hesap bilgileri.
- **İşletme ve fatura bilgileri:** işletme unvanı, adresi, logosu, vergi bilgileri, abonelik ve ödeme kayıtları.
- **İşlem güvenliği verileri:** oturum kayıtları, IP adresi, tarayıcı/cihaz bilgisi, giriş zamanları, işlem (audit) kayıtları, mobil bildirim cihaz kimlikleri.

### İşletmelerin müşterileri

- **Kimlik ve iletişim:** ad, soyad, telefon numarası, varsa e-posta adresi.
- **Araç bilgileri:** plaka, marka, model ve araçla ilgili notlar.
- **Hizmet kayıtları:** iş emirleri, teklifler, satışlar, cari hesap hareketleri, randevu ve bildirim kayıtları.
- **Sözleşme ve imza verileri:** sözleşme içeriği, onay için gönderilen doğrulama kodları, elektronik imza görüntüsü, onay zamanı ve IP adresi.
- **Mesajlaşma kayıtları:** işletme adına gönderilen WhatsApp, SMS ve e-posta mesajlarının içeriği ve iletim durumu.

## 3. İşleme amaçları

- Platform hesabının oluşturulması, kimlik doğrulama ve oturum yönetimi,
- İşletmelerin iş emri, teklif, sözleşme, satış, stok ve cari süreçlerini yürütebilmesi,
- İşletme adına müşterilere bilgilendirme mesajları (ör. iş durumu, teklif bağlantısı, sözleşme doğrulama kodu) gönderilmesi,
- Abonelik, faturalama ve ödeme süreçlerinin yürütülmesi,
- Destek taleplerinin yanıtlanması ve sizinle iletişim kurulması,
- Bilgi güvenliğinin sağlanması, kötüye kullanımın önlenmesi, hataların tespiti ve giderilmesi,
- Hukuki yükümlülüklerin yerine getirilmesi ve yetkili mercilerin taleplerinin karşılanması.

## 4. Hukuki sebepler

Kişisel verileriniz KVKK m.5/2 kapsamında şu hukuki sebeplere dayanılarak işlenir:

- Bir sözleşmenin kurulması veya ifasıyla doğrudan ilgili olması (platform üyeliği ve abonelik; işletme ile müşterisi arasındaki hizmet ilişkisi),
- Veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi (ör. vergi ve ticaret mevzuatı),
- Bir hakkın tesisi, kullanılması veya korunması,
- İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaati (ör. bilgi güvenliği, hizmetin iyileştirilmesi),
- Bu sebeplerin bulunmadığı hâllerde açık rızanız.

Otopoly, hizmetin işleyişi için özel nitelikli kişisel veri (KVKK m.6) talep etmez. İşletmelerin serbest metin alanlarına bu nitelikte veri girmemesi gerekir.

## 5. Aktarım

Kişisel veriler yalnızca yukarıdaki amaçlarla ve gerekli olduğu ölçüde şu alıcılara aktarılabilir:

- **Barındırma ve altyapı hizmet sağlayıcıları:** sunucu, veritabanı, dosya depolama ve yedekleme hizmetleri.
- **E-posta ve SMS hizmet sağlayıcıları:** doğrulama kodları ve bildirimlerin iletilmesi.
- **WhatsApp (Meta Platforms):** işletme adına gönderilen WhatsApp mesajları, WhatsApp Business Cloud API üzerinden Meta altyapısıyla iletilir. Bu kapsamda alıcının telefon numarası ve mesaj içeriği Meta'ya aktarılır.
- **Mobil bildirim hizmetleri:** mobil uygulama bildirimlerinin iletilmesi için bildirim altyapısı sağlayıcıları (ör. Expo, Apple, Google).
- **Yapay zekâ asistanı sağlayıcıları:** işletme platformdaki yapay zekâ asistanını kullandığında, sorulan soru ve yanıt için gereken kayıtlar seçilen model sağlayıcısına iletilebilir.
- **Hata izleme hizmeti:** uygulama hatalarının tespiti için teknik hata kayıtları.
- **Sosyal giriş sağlayıcıları:** Google, Apple, Facebook veya GitHub ile giriş yapmayı seçtiğinizde, kimlik doğrulama için ilgili sağlayıcı.
- **Yetkili kamu kurum ve kuruluşları:** kanunen yetkili mercilerin talebi hâlinde.

**Yurt dışına aktarım:** Yukarıdaki hizmet sağlayıcıların bir kısmının sunucuları yurt dışında (ör. ABD ve Avrupa Birliği) bulunabilir. Yurt dışına aktarım KVKK m.9'da öngörülen şartlara uygun olarak; yeterlilik kararı, standart sözleşme gibi uygun güvencelerden birinin bulunması veya bunların mümkün olmadığı hâllerde m.9/6'daki istisnai hâllerden birine dayanılarak gerçekleştirilir.

## 6. Saklama süresi

Kişisel veriler, işleme amacının gerektirdiği süre ve ilgili mevzuatta öngörülen zamanaşımı ve saklama süreleri boyunca saklanır. Platform hesabı kapatıldığında veya işletme ile sözleşme sona erdiğinde veriler, yasal saklama yükümlülükleri saklı kalmak üzere silinir, yok edilir veya anonim hâle getirilir. İşletmelerin müşterilerine ait veriler, veri sorumlusu olan işletmenin talimatları doğrultusunda saklanır ve silinir.

## 7. Güvenlik

Verilerinizi korumak için makul teknik ve idari tedbirler uygularız. Örneğin:

- Tarayıcı ile platform arasındaki iletişim şifreli bağlantı (HTTPS) üzerinden yapılır,
- Şifreler geri döndürülemez biçimde özetlenerek saklanır; entegrasyon erişim anahtarları şifrelenmiş olarak tutulur,
- Rol ve yetki tabanlı erişim kontrolü uygulanır; işletmeler yalnızca kendi verilerine erişebilir,
- Hassas işlemler için yeniden kimlik doğrulama istenebilir ve önemli işlemler kayıt altına alınır.

## 8. Çerezler

Platform yalnızca hizmetin çalışması için zorunlu çerezleri kullanır: oturumunuzu açık tutan ve güvenliği sağlayan oturum çerezleri ile arayüz tercihleriniz (ör. kenar menüsünün açık veya kapalı olması). Reklam veya pazarlama amaçlı çerez kullanılmaz. Zorunlu çerezleri tarayıcı ayarlarından engellerseniz platforma giriş yapamayabilirsiniz.

## 9. KVKK m.11 kapsamındaki haklarınız

KVKK m.11 uyarınca veri sorumlusuna başvurarak:

- Kişisel verilerinizin işlenip işlenmediğini öğrenme,
- İşlenmişse buna ilişkin bilgi talep etme,
- İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,
- Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,
- Eksik veya yanlış işlenmişse düzeltilmesini isteme,
- KVKK m.7'de öngörülen şartlar çerçevesinde silinmesini veya yok edilmesini isteme,
- Düzeltme, silme ve yok etme işlemlerinin verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,
- İşlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme,
- Kanuna aykırı işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme

haklarına sahipsiniz.

## 10. Başvuru

Haklarınıza ilişkin taleplerinizi, kimliğinizi doğrulamamıza yetecek bilgilerle birlikte [contact@otopoly.app](mailto:contact@otopoly.app) adresine e-posta ile veya [Adres] adresine yazılı olarak iletebilirsiniz. Başvurunuz, talebin niteliğine göre en geç otuz gün içinde ücretsiz olarak sonuçlandırılır; işlemin ayrıca bir maliyet gerektirmesi hâlinde Kişisel Verileri Koruma Kurulu tarafından belirlenen tarife uygulanabilir.

Bir işletmenin müşterisiyseniz ve talebiniz işletmenin sizinle ilgili kayıtlarına ilişkinse, başvurunuzu doğrudan ilgili işletmeye yapmanız gerekir; bize ulaşan bu tür talepleri ilgili işletmeye yönlendiririz.

## 11. Değişiklikler

Bu metni zaman zaman güncelleyebiliriz. Güncel sürüm her zaman bu sayfada yayımlanır; sayfanın üst kısmındaki tarih son güncelleme tarihini gösterir.

Son güncelleme: 7 Ekim 2026
$md$,
$md$This page explains how personal data is processed when you use the Otopoly platform (the otopoly.app website, web app and mobile apps). The Turkish version is the binding version and also serves as the information notice under the Turkish Personal Data Protection Law No. 6698 ("KVKK").

## 1. Who we are

Otopoly is operated by **[Şirket unvanı]** ("Otopoly", "we"), [Adres], MERSİS no [MERSİS no]. Contact: [contact@otopoly.app](mailto:contact@otopoly.app).

- For **platform users** (business owners and staff who sign up), Otopoly is the **data controller**.
- For **customers of businesses** (vehicle owners, recipients of work orders, quotes or contracts), the **business using Otopoly is the data controller** and Otopoly acts as a **data processor** on its behalf. Please contact that business first about this data.

## 2. Data we process

- **Platform users:** name, e-mail, phone number, account and login data (password hash, passkeys, social login details), business and billing details, session and log data (IP address, device/browser, timestamps, audit records).
- **Customers of businesses:** name, phone number, vehicle and plate details, work orders, quotes, sales and account records, contract and signature data (contract text, verification codes, signature image, time and IP address of approval), and messages sent on the business's behalf.

## 3. Purposes and legal bases

We process data to provide and secure the platform, let businesses run their work orders, quotes, contracts and customer communication, handle subscriptions and billing, provide support and meet legal obligations. Legal bases are those in KVKK Art. 5 (performance of a contract, legal obligation, establishing or defending rights, legitimate interest) and, where none applies, your explicit consent.

## 4. Sharing and transfers abroad

Data is shared only as needed with hosting and storage providers, e-mail and SMS providers, **WhatsApp (Meta Platforms)** for messages sent through the WhatsApp Business Cloud API, push notification services, the AI assistant model provider when a business uses that feature, an error monitoring service, social login providers you choose, and authorities where legally required. Some of these providers may store data outside Türkiye (e.g. in the USA or the EU); such transfers follow KVKK Art. 9.

## 5. Retention and security

We keep data for as long as the purpose and the applicable statutory periods require, then delete, destroy or anonymise it. Customer data of businesses is kept and deleted on the business's instructions. We use encrypted connections (HTTPS), hashed passwords, encrypted integration credentials and role-based access control.

## 6. Cookies

We only use cookies that are strictly necessary: session cookies that keep you signed in and secure, and interface preferences (e.g. whether the sidebar is open). We do not use advertising or marketing cookies.

## 7. Your rights

Under KVKK Art. 11 you may ask whether your data is processed, request information, learn the purpose and recipients, request correction or deletion, object to solely automated decisions against you and claim compensation for unlawful processing. Send requests to [contact@otopoly.app](mailto:contact@otopoly.app). Customers of businesses should contact the business directly; we forward such requests to it.

Last updated: 7 October 2026
$md$
);

-- Permissions.
INSERT INTO permissions (name, slug) VALUES
    ('Read legal pages', 'platform.legal.read'),
    ('Write legal pages', 'platform.legal.write')
ON CONFLICT (slug) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.slug IN ('platform.legal.read', 'platform.legal.write')
WHERE r.slug = 'super_admin' ON CONFLICT DO NOTHING;
