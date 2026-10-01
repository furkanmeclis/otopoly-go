# Otopoly Mobil — Yol Haritası ve Koordinasyon

> Bu dosya koordinasyonun tek kaynağıdır. Her dalga bittiğinde güncellenir.
> Yeni bir oturumda devam etmek için en alttaki **Devam promptu** bölümünü kopyalayıp yapıştır.

Son güncelleme: 2026-10-01

## Çalışma modeli

- Claude **koordinatör**: kod yazmaz. İşi alt ajanlara brief'ler, sonuçları kontrol eder, bu dosyayı günceller.
- Alt ajanlar kendi dallarında çalışır, commit atar, push eder ve GitHub Actions CI yeşil olana kadar düzeltir.
- **`main`'e merge'ü kullanıcı yapar.** Ajanlar merge etmez, bu adım izin kontrolüne takılıyor.
  - Mobil repo: dal ve PR (CI PR'da çalışır).
  - otopoly-go: dal push (CI her dalda çalışır), worktree `../otopoly-go-wt/<ad>`.
- Bir dalga bitmeden sonraki başlamaz.
- Repolar:
  - Mobil: `~/Documents/MobileApps/otopoly-mobile-app`
  - Backend (Go API) ve web (Next.js + NextAuth v5): `~/Documents/Projects/otopoly-go`
- iOS build'leri Xcode Cloud'da alınır. Yerelde `pod install`, `expo run:ios` ya da `xcodebuild` çalıştırılmaz. Android önizlemesi EAS'la alınır.
- Demo: Metro başlatılır, kullanıcı QR'ı okutur.

## Kesinleşen ürün kararları

### Ödeme ve limitler
- **Uygulama içinde satın alma yok.** Buton, fiyat, "web'den yükseltin" gibi ifadeler ya da satın alma linki kullanılmaz (Apple 3.1.1/3.1.3, Google Play ödeme politikası).
- Abonelik ekranının yerine salt okunur **"Kullanım ve limitler"** ekranı gelir: plan adı, sayaçlar, dönem sonu.
- `LIMIT_REACHED` mesajı role göre değişir:
  - Tenant sahibi: "Aylık {özellik} limitinize ulaştınız (x/y). Ayrıntıları e-posta adresinize gönderdik."
  - Personel: "İşletmenizin aylık {özellik} limiti doldu. İşletme yöneticinize bilgi verildi."
- Backend yüzde 80 ve yüzde 100 eşiklerinde ve abonelik bitiminden 7 gün önce **tenant sahibine** kendiliğinden e-posta atar. Her eşik için dönemde bir kez gider. Satın alma linki yalnızca bu e-postada bulunur.
- `FEATURE_DISABLED` için tek, ortak bir kilit ekranı kullanılır. Mesaj nötrdür.

### Bildirimler
- Bildirim tercihleri web'dekiyle aynı. Uygulama içinde bir bildirimler ekranı olur: liste, okunmamış rozeti, okundu işaretleme, bildirim üzerindeki aksiyonlar.
- Push, Expo Push ile gönderilir. Backend'de yeni bir `push_devices` tablosu tutulur. Tarayıcı push'u (`push_subscriptions`) aynen kalır.
- Bildirim metni her alıcının kendi dilinde (tr/en) hazırlanır. Kilit ekranında hassas veri gösterilmez.
- Deeplink'ler web'le **aynı adresleri** kullanır (`/t/{slug}/...`, `/q/...`, `/login/qr/...`). `otopoly://` şemasının yanında evrensel link (Universal Links / App Links) kurulur. Link başka bir organizasyona aitse önce o organizasyona geçilir.

### Giriş
- **Web'de NextAuth kalır.** Mobil, Go API'deki yerel `id_token` endpoint'lerini kullanır.
- **E-posta ile kod girişi** hem web'de hem mobilde olur:
  - 6 hane, 10 dakika geçerli, en fazla 5 deneme, veritabanında hash'li saklanır.
  - Kayıtlı olup olmadığı dışarıdan anlaşılmaz (yanıt her durumda aynı).
  - Kullanıcıda TOTP açıksa TOTP de sorulur.
  - Mağaza incelemesi için demo hesaba sabit bir kod tanımlanır.
- **Apple ve Google ile giriş.** Apple'ın gizli e-postası (`@privaterelay.appleid.com`) gelir ve kullanıcı bulunamazsa uygulama "Hesabım var mı?" diye sorar:
  - **Var:** Gerçek e-postaya kod gider, doğrulanınca Apple hesabı bağlanır.
  - **Yok:** Yeni hesap açılır.
  - Bu akış **yalnızca gizli e-postalar için** geçerlidir. Diğer e-postalarda web'deki davranış aynen uygulanır.
- **Hesap silme** uygulama içinde bulunur, ama backend hesabı yalnızca **pasife alır, veri silinmez.**
  - Tüm oturumlar kapatılır, hiçbir giriş yolu çalışmaz.
  - Hesap Apple'a bağlıysa Apple'daki yetki geri çekilir.
  - Gizlilik politikasına "yasal saklama yükümlülüğü" açıklaması eklenir.
- **QR ile giriş:**
  1. Web giriş sayfası bir QR gösterir.
  2. Mobilde QR, uygulama içi kamerayla ya da telefonun kendi kamerasıyla okutulur. Evrensel link uygulamayı açar.
  3. Uygulamada web isteğinin IP'sine göre yaklaşık konum, tarayıcı bilgisi ve Onayla/Reddet çıkar.
  4. Onaylanınca web sekmesinin girişi açılır.
  - Web ile backend arasındaki haberleşme **polling ile değil**, o giriş oturumuna ve sekmeye özel, kimlik doğrulama istemeyen **Centrifugo** kanalıyla yapılır.
  - QR kısa ömürlüdür ve tek kullanımlıktır.

## Dalgalar

### 1. Dalga: backend temeli ve limitler — ✅ bitti, merge bekliyor
| İş paketi | Repo / dal | Kapsam | Durum |
|---|---|---|---|
| Giriş yöntemleri | otopoly-go / `feat/auth-otp-native-oauth` | E-posta kodu (API ve web), `/v1/auth/oauth/{provider}/native`, gizli e-posta bağlama akışı, hesabı pasife alma | ✅ CI yeşil (önce bu merge edilmeli, migration 000068) |
| Push, deeplink, limit e-postaları | otopoly-go / `feat/expo-push-limits` | `push_devices` tablosu ve Expo gönderimi, AASA ve assetlinks, eşik e-postaları, `LIMIT_REACHED` hata detayı, kullanım endpoint'i | ✅ CI yeşil (head 569bc63, migration'lar 000069 ve 000070; auth'tan sonra merge) |
| Kullanım ve limitler | mobil / `feat/usage-limits` ([PR #1](https://github.com/furkanmeclis/otopoly-mobile-app/pull/1)) | Abonelik ekranı yerine limitler ekranı, rol bazlı limit penceresi, ortak kilit ekranı, mock senaryoları | ✅ CI yeşil, merge bekliyor |

Endpoint şemaları: `docs/backend/WAVE1_CONTRACTS.md`.

**⚠️ Merge öncesinde bilinmesi gerekenler:**
- otopoly-go CI'ındaki `auto-pr` job'u yeşil olan her dalı `main`'e kendiliğinden merge ediyor. Ajanların her commit mesajında `[no-automerge]` olmalı.
- Merge sırası: önce giriş yöntemleri (auth), sonra push ve limit e-postaları.
- Auth dalındaki `frontend/src/generated/api.d.ts` elle düzenlendi. Merge sonrasında `pnpm api:generate` bir kez çalıştırılmalı.
- `compose.prod.yml` dosyasına yeni env değişkenleri elle eklenmeli. Ajanlar prod ayarlarına dokunmadı.
  - Backend: `AUTH_REVIEW_ACCOUNTS`, `AUTH_APPLE_NATIVE_CLIENT_IDS`, `AUTH_GOOGLE_NATIVE_CLIENT_IDS`, `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`, `AUTH_APPLE_PRIVATE_KEY`, `EXPO_ACCESS_TOKEN`
  - Frontend: `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS`
- Konsol ayarları:
  - Apple:
    - App ID'de Sign in with Apple ve Associated Domains açılmalı.
    - Sign in with Apple için bir .p8 anahtarı oluşturulmalı.
    - Gizli e-posta adreslerine posta gidebilmesi için gönderen alan adı Apple'ın Private Email Relay ayarlarına kaydedilmeli.
  - Google: iOS ve Android için OAuth client'ları oluşturulmalı.
  - Expo/EAS: APNs anahtarı ve FCM V1 anahtarı yüklenmeli.
- Bilinen açıklar:
  - IP bazlı istek sınırları `X-Forwarded-For` başlığını okuyor. Mobil API'ye doğrudan bağlandığı için bu başlık taklit edilebilir. E-posta bazlı sınırlar etkilenmiyor.
  - Tarayıcı push'u hâlâ bildirimin tam metnini gönderiyor. Kilit ekranına uygun kısa metin sadece Expo push'ta kullanılıyor.

**otopoly-go merge sırası:** önce `feat/auth-otp-native-oauth`, sonra `feat/qr-login` (auth'un üzerine kurulu), en son `feat/expo-push-limits`.

Dalga bittiğinde: PR ve dalları kullanıcı inceleyip merge eder. Ajan raporlarındaki endpoint şemaları bu dosyaya işlenir. Migration numaraları çakışıyorsa merge öncesinde düzeltilir.

### 2. Dalga: mobil bildirimler, mobil giriş, QR ile giriş — ✅ bitti, merge bekliyor. Başlangıçta (kullanıcı 2026-10-01 gece tüm aşamalara durmadan devam edilmesini istedi; dallar merge edilmemiş 1. dalga dallarının üzerine kuruluyor)
- **Mobil bildirimler:**
  - `expo-notifications` eklenir.
  - Bildirim izni, açıklama ekranından sonra istenir.
  - Push cihazı girişte kaydedilir, çıkışta silinir.
  - Tercihler ekranı ve bildirimler ekranı yapılır.
  - Web adresleri uygulama ekranlarına eşlenir, gerekirse organizasyon değiştirilir.
  - Evrensel link ayarları `app.json`'a eklenir (associatedDomains, intentFilters).
  - Önce mock'la yapılır.
- **Mobil giriş:**
  - E-posta kodu ekranı. iOS'ta `oneTimeCode` ile koddan otomatik doldurma.
  - `expo-apple-authentication` ve yerel Google girişi.
  - Gizli e-posta akışındaki seçim ekranları.
  - Profilde "Hesabımı sil" (pasife alma) ve kimlik doğrulama adımı.
- **QR ile giriş** (backend, web ve mobil):
  - Backend: QR oturumu oluşturma, kimlik doğrulama istemeyen Centrifugo kanal token'ı, onay/ret endpoint'leri, tek kullanımlık takas token'ı, IP'den yaklaşık konum.
  - Web: QR bileşeni, kanal aboneliği, NextAuth ile oturum takası.
  - Mobil: `expo-camera` ile tarayıcı, onay ekranı, `/login/qr/*` evrensel linki.
- Yeni native modüller (notifications, camera, apple-authentication, google sign-in) development build gerektirir. Build Xcode Cloud ve EAS'ta alınır.

**2. dalganın durumu:**
- [PR #2](https://github.com/furkanmeclis/otopoly-mobile-app/pull/2) (bildirimler): ✅ CI yeşil.
  - Demo: Tanılama → "Deneme bildirimi gönder".
- [PR #3](https://github.com/furkanmeclis/otopoly-mobile-app/pull/3) (mobil giriş): ✅ CI yeşil.
  - E-posta kodu demo kodu: `246810`.
  - TOTP açık demo kullanıcı: `ali@parlakoto.com` (TOTP kodu `123456`).
  - Mock modunda Apple ve Google butonları bir demo kimlik seçici açıyor.
  - Google girişi `react-native-nitro-google-signin` ile yapıldı.
  - Yeni bir dev build gerekiyor.
- QR ile giriş: ✅ CI yeşil.
  - otopoly-go dalı: `feat/qr-login`. Auth dalının üzerine kurulu, migration yok, durum Redis'te tutuluyor.
  - Mobil: [PR #4](https://github.com/furkanmeclis/otopoly-mobile-app/pull/4).
  - Centrifugo'ya `qrlogin` namespace'i eklendi. Deploy sırasında Centrifugo'nun yeniden başlatılması gerekiyor.
  - İsteğe bağlı env değişkenleri: `AUTH_QR_TRUST_GEO_HEADERS` (yalnızca Cloudflare arkasında) ve `AUTH_QR_GEOIP_DB`.
  - Web'de QR, "QR kod ile giriş" butonuna basınca açılıyor. Böylece giriş sayfasını açan her ziyaretçi için bir oturum ve websocket açılmamış oluyor.
  - Gerçek bir Centrifugo sunucusuna karşı uçtan uca denenmedi.

**Merge sonrasında yapılacak entegrasyon işleri:**
- Hesap silme akışı, token'lar temizlenmeden önce `unregisterPushDevice()` çağırmalı.
- `/login/qr/[token]` sayfası şimdilik "yakında" diyen bir taslak. QR PR'ının sayfası bunun yerine geçecek.
- Kullanılmayan `mobile.catalog.push_mobile_hint` çeviri anahtarı silinecek.
- PR #2 ile PR #3 birlikte merge edilince push kaydı ve silme işlemleri `completeSignIn(tokens)` ve `logout({serverRevoked})` fonksiyonlarına bağlanacak. `select-org` ve `_layout` dosyalarında çakışma beklenir.
- Mobil env: `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` ve `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Xcode Cloud ve EAS'ta tanımlanacak.
- Google iOS yönlendirmesi ile SceneDelegate birlikte cihazda doğrulanmadı. Gerekirse bunun için bir config plugin yazılacak.

### 3. Dalga: eksik ekranlar ve mağaza denetimi — 🟡 başladı. İlk adım: mobil PR #1–#4 tek bir `integration/wave1-2` dalında birleştirilecek, sonra eksik ekranlar ve denetim bu dalın üzerine kurulacak.
- **Eksik ekranlar:**
  - İçe aktarma dosyası yükleme (`expo-document-picker`).
  - Sözleşmeye fotoğraf/dosya ekleme (`expo-image-picker`).
  - İş detayında sözleşme bölümü.
  - Asistanın onay kartları.
  - Profilde "Bağlı hesaplar" ekranı: Apple ve Google bağlama/kaldırma (`/v1/auth/identities`). `OAUTH_ACCOUNT_NOT_LINKED` mesajı kullanıcıyı buraya yönlendiriyor.
  - Teklif ve potansiyel müşteri modülü kapalıyken gösterilecek kilit ekranı (`module.quotes`).
  - Erişimi olmayan, süresi dolmuş ve askıya alınmış hesaplar için ekranlar.
  - `PORT_CHECKLIST.md` gerçek duruma göre güncellenecek.
- **Mağaza denetimi** (her ekran Apple ve Google açısından ayrı ayrı; çıktı: ekran / risk / önem / çözüm):
  - Bilinen riskler:
    - Hesap silme (2. dalgada çözülüyor).
    - Yapay zekâ asistanı: veri üçüncü taraf bir modele gidiyorsa açık bilgilendirme ve izin (Apple 5.1.2(i)).
    - Demo hesabı; mock'a özel demo giriş linki ve test turu canlı sürüme girmemeli.
    - Gizlilik politikası, Apple gizlilik manifesti, App Store gizlilik etiketleri, Play Data safety formu.
    - `supportsTablet: true` açık: ya iPad düzeni düzeltilecek ya da iPad desteği kapatılacak (**karar bekliyor**).
    - WhatsApp yönlendirmesi, sözleşme imzalamadaki OTP, izin açıklama metinleri.

### 4. Dalga: backend'e bağlama — ⏸
- `docs/backend/MOBILE_API_SPEC.md` ile karşılaştırılır. Her alan (dashboard, işler, müşteriler, finans, ticaret, CRM, katalog, dokümanlar, ayarlar) sırayla mock'tan gerçek API'ye geçirilir.
- Her alan için mock ile gerçek API'nin aynı sonucu verdiği test edilir.
- Backend'de eksik endpoint çıkarsa spesifikasyona eklenir.

## Açık sorular
1. iPad desteği: kapatılacak mı, düzenlenecek mi?
2. ~~Evrensel link alan adı~~ → `otopoly.app` (API: `api.otopoly.app`).
3. Personel gerçekten kullanılıyor mu, yoksa her tenant tek kişi mi? (Rol bazlı mesajlar iki durumda da çalışır.)
4. Teklif oluşturmaya limit konacak mı? Şu an backend'de yok. PR #1'de teklif için örnek, teklifin işe dönüştürülmesi (günlük iş limiti) üzerinden yapıldı.
5. Plan süresi dolunca (`SUBSCRIPTION_READ_ONLY`) de limit penceresi mi açılsın? Şu an nötr bir bildirim çıkıyor, limitler ekranında da salt okunur uyarısı var.
6. Teklif ve potansiyel müşteri modülü kapalıyken (`module.quotes`) gösterilecek kilit ekranı henüz yok. 3. dalgaya eklenecek.

## Tamamlananlar
- 2026-09-30: Yol haritası ve ödeme kararı (uygulamada satın alma yok).
- 2026-10-01: Bildirimler, giriş yöntemleri, QR ile giriş ve hesap silme kararları. 1. dalga başlatıldı.
- 2026-10-01: PR #1 (kullanım ve limitler) hazır, CI yeşil.
  - Demo: Menü → Tanılama → "Plan senaryosu". Tenant sahibi `demo@otopoly.com`, personel `personel@otopoly.com`, şifre `demo1234`.
  - Mesajlarda "Aylık / Günlük / Toplam" limitin türüne göre seçiliyor.
  - Mock'taki saat dilimi hatası da düzeltildi (CI'da UTC 21-24 arasında düşüyordu).

---

## Devam promptu

Yeni bir Claude Code oturumunda mobil repo içinde aşağıdakini yapıştır:

```
Otopoly mobil projesinde koordinatörsün, kod yazmıyorsun. İşleri alt ajanlarla yürütüyorsun.
Önce docs/ROADMAP.md dosyasını baştan sona oku. Kararlar, dalgalar, çalışma kuralları ve açık sorular orada.

Sonra durumu kontrol et:
- Mobil repo: `gh pr list`, `gh pr checks <pr>`
- ~/Documents/Projects/otopoly-go: `git fetch`, `git branch -r`, `gh run list -L 10`, `git worktree list`

Bunlara göre ROADMAP'teki durum sütunlarını güncelle.
Aktif dalga bitmediyse eksik kalan iş paketlerini yeni alt ajanlarla tamamlat.
Bittiyse bana özet ver ve merge onayımı bekle. Bir sonraki dalgaya ben söylemeden geçme.

Kurallar:
- Ajanlar kendi dallarında çalışır, push eder, CI yeşil olana kadar düzeltir, main'e merge etmez.
- iOS için yerel build ya da pod install yok (Xcode Cloud).
- Uygulamada satın alma, fiyat ya da satın alma yönlendirmesi yok.
```
