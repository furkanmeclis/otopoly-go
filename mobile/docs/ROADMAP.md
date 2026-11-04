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

**otopoly-go merge sırası:** `feat/auth-otp-native-oauth` → `feat/qr-login` → `feat/identity-native-link` → `feat/openapi-gaps`. Her biri bir öncekinin üzerine kurulu. En son `feat/expo-push-limits` merge edilir.

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

### 3. Dalga: eksik ekranlar ve mağaza denetimi — ✅ bitti, merge bekliyor
Mobil PR'lar `integration/wave1-2` dalına açıldı. Bu dal, PR #1–#4'ün toplandığı [PR #5](https://github.com/furkanmeclis/otopoly-mobile-app/pull/5)'in dalı.

| PR | Kapsam | Durum |
|---|---|---|
| [#6](https://github.com/furkanmeclis/otopoly-mobile-app/pull/6) | İçe aktarma sihirbazı (document-picker), sözleşmeye fotoğraf/dosya ekleme (image-picker), iş detayında sözleşme bölümü | ✅ CI yeşil |
| [#7](https://github.com/furkanmeclis/otopoly-mobile-app/pull/7) | Bağlı hesaplar, tenant erişim durumu ekranları, `module.quotes` kilidi, asistanın onay kartları, yapay zekâ veri onayı | ✅ CI yeşil |
| [#8](https://github.com/furkanmeclis/otopoly-mobile-app/pull/8) | Mağaza denetimi ve düzeltmeleri (#6 ve #7'yi de içeriyor): `docs/STORE_AUDIT.md`, `EXPO_PUBLIC_APP_ENV=production` canlı sürüm bayrağı, gizlilik manifesti, gizlilik ve kullanım koşulları linkleri, Android izinlerinin daraltılması | ✅ CI yeşil |

**Backend:** otopoly-go'da `feat/identity-native-link` dalı (qr-login dalının üzerine kurulu, migration 000071). İçeriği:
- `POST /v1/auth/identities/{provider}/native`
- Kimlik listesinde `has_password`
- Son giriş yöntemi kaldırılırken `409 LAST_SIGN_IN_METHOD`

Bilinen küçük açık: Migration'dan önce Apple ya da Google ile kayıt olup şifresini sıfırlamış kullanıcılar `has_password=false` görünüyor.

**Mağaza denetiminin kullanıcıdan istedikleri:**
1. 🔴 **Hesap silme kararı yeniden ele alınmalı.** Apple ve Google'ın güncel kurallarına göre hesabı sadece pasife almak hesap silme sayılmıyor. Apple: "Only offering to temporarily deactivate or disable an account is insufficient". Google: deactivating does "not qualify".
   - **Koordinatörün önerisi:** İşletme verileri (işler, faturalar, müşteri kayıtları) tenant'a ait oldukları için silinmesin. **Kullanıcının kişisel verileri** (ad, e-posta, telefon, bağlı hesaplar, oturumlar, push cihazları) anonimleştirilsin. Yasal saklama zorunluluğu gizlilik politikasında belirtilsin. Böylece "işletme verisi silinmesin" kararı korunur, mağaza kuralı da karşılanır. **Kullanıcının onayını bekliyor.**
2. Xcode Cloud'daki App Store workflow'una `EXPO_PUBLIC_APP_ENV=production` eklenmeli. Bu değişken olmadan alınan build'ler hâlâ mock modunda açılıyor.
3. Web'de `otopoly.app/privacy`, `/terms` ve `/account/delete` sayfaları yayınlanmalı. `/account/delete`, Play'in istediği web üzerinden silme talebi sayfası.
4. Backend: Yapay zekâ sağlayıcısının gerçek adı `/ai/status` yanıtında dönmeli. `AUTH_REVIEW_ACCOUNTS` tanımlanmalı ve demo veriyle doldurulmuş bir inceleme hesabı açılmalı.
5. iPad: Denetimin önerisi `supportsTablet: false`. Gerekçesi: iPad desteğiyle yayınlanan bir uygulamadan bu destek sonradan kaldırılamıyor, ama desteği olmayan bir uygulamaya sonradan eklenebiliyor.
6. App Store gizlilik etiketleri, Play Data safety formu ve inceleme notları `STORE_AUDIT.md`'deki taslaklardan doldurulmalı.
7. Henüz çözülmemiş riskler:
   - WhatsApp'ı QR ile "bağlı cihaz" olarak eklemeye dayanan entegrasyon.
   - Apple ile yeni kayıt olan ve henüz işletmesi olmayan kullanıcının karşısına çıkan boş ekran.

### 4. Dalga: backend'e bağlama — 🟡 kullanıcı olmadan yapılabilecek kısım bitti
| İş | Yer | Durum |
|---|---|---|
| Sözleşme uygunluk testi (`npm run test:contract`, CI'da): 246/246 endpoint, 0 hata. Bulunan hatalar: export takibi `pending` yerine `queued` bekliyordu; yanlış şifrede gelen 401 yüzünden token yenilenmeye çalışılıyordu; 43 endpoint'te durum kodu yanlıştı | mobil [PR #9](https://github.com/furkanmeclis/otopoly-mobile-app/pull/9) | ✅ CI yeşil |
| Asistanda akış (SSE) okuma: mock ve canlı aynı kod yolunu kullanıyor. `owner_notified=false` olduğunda nötr limit metni. Spec yenilendi, istisna listesi boşaltıldı | mobil [PR #10](https://github.com/furkanmeclis/otopoly-mobile-app/pull/10) | ✅ CI yeşil |
| OpenAPI'deki eksikler: iş emri, müşteri, ticaret, personel ve cari yanıt şemaları; finans kategorilerinin düzenleme ve silme endpoint'leri; dosya yükleme istekleri; eksik hata durum kodları. Go kodunda değişiklik yok | otopoly-go `feat/openapi-gaps` (identity-native-link'in üzerine kurulu) | ✅ CI yeşil |
| Hata ve performans takibi (Sentry protokolü, kendi sunucumuz): `EXPO_PUBLIC_SENTRY_DSN` yoksa kapalı; kişisel veri temizleniyor; kaynak haritası yüklenmiyor (`SENTRY_DISABLE_AUTO_UPLOAD`). Isınma denetimi: arka planda ve görünmeyen sekmelerde süren yoklamalar, durmayan sayaçlar, asistan akışında her token'da çizim düzeltildi. Ayrıntılar `docs/SENTRY.md` | mobil `feat/sentry-heat` | 🟡 PR açık, cihazda denenmedi |

Ayrıntılar `docs/backend/CONTRACT_REPORT.md` dosyasında.

**Mock'tan gerçek API'ye geçiş sırası:** giriş, QR, bildirimler ve limitler → dashboard ve katalog → CRM → müşteriler ve işler → finans ve ticaret → ayarlar ve dokümanlar → asistan.

**Kullanıcıyla birlikte yapılacaklar:**
- Dallar merge edildikten sonra staging ortamında ya da yerelde `docker compose` ile gerçek API'ye karşı uçtan uca deneme.
- Yeni native modüller için dev build: notifications, camera, apple-auth, google-signin, image-picker, document-picker.
- Cihazda kontrol edilecekler: push, universal link'ler, kamera, Google'ın iOS'ta uygulamaya geri dönüşü, QR akışında Centrifugo.

**Kod ile dokümantasyonun uyuşmadığı noktalar:**
- `GET /v1/tenant/jobs` dokümanındaki `payment_status` filtresi backend'de okunmuyor. Dokümanda "kullanımdan kalkacak" olarak işaretlendi.
- Platform yönetim endpoint'lerinden yaklaşık 70 tanesi dokümante edilmemiş. Mobilin kapsamı dışında.

## Açık sorular
1. iPad desteği: kapatılacak mı, düzenlenecek mi? Denetimin önerisi: kapatılsın (`false`).
2. ~~Evrensel link alan adı~~ → `otopoly.app` (API: `api.otopoly.app`).
3. Personel gerçekten kullanılıyor mu, yoksa her tenant tek kişi mi? (Rol bazlı mesajlar iki durumda da çalışır.)
4. Teklif oluşturmaya limit konacak mı? Şu an backend'de yok.
5. ~~`SUBSCRIPTION_READ_ONLY`~~ → PR #7'de ortak limit penceresi kullanılıyor.
6. **Hesap silme: pasife alma mı, kişisel verileri anonimleştirme mi?** (Yukarıda, 🔴)
7. Yapay zekâ veri onayı şimdilik sadece cihazda saklanıyor. Sunucuda da kaydı tutulsun mu?

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
- Mobil repo: `gh pr list` (PR #6–#10 `integration/wave1-2` dalına zincir halinde açıldı: #8 → #6 ve #7'yi içeriyor, #9 → #8'in üzerine, #10 → #9'un üzerine. En pratiği #10'u merge etmek, sonra PR #5'i `main`'e merge etmek), `gh pr checks <pr>`
- ~/Documents/Projects/otopoly-go: `git fetch`, `git branch -r`, `gh run list -L 10`, `git worktree list`

Bunlara göre ROADMAP'teki durum sütunlarını güncelle.
Aktif dalga bitmediyse eksik kalan iş paketlerini yeni alt ajanlarla tamamlat.
Bittiyse bana özet ver ve merge onayımı bekle. Bir sonraki dalgaya ben söylemeden geçme.

Kurallar:
- Ajanlar kendi dallarında çalışır, push eder, CI yeşil olana kadar düzeltir, main'e merge etmez.
- iOS için yerel build ya da pod install yok (Xcode Cloud).
- Uygulamada satın alma, fiyat ya da satın alma yönlendirmesi yok.
```
