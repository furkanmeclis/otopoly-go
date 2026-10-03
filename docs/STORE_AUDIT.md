# Otopoly Mobil — App Store ve Google Play red riski denetimi

Tarih: 2026-10-02 · Dal: `feat/store-audit` (`integration/wave1-2` + PR #6 + PR #7 üzerine)

Kaynaklar (denetim günü güncel metinler okundu, ezberden yazılmadı):
- Apple App Review Guidelines: 1.2, 2.1, 2.3.1, 2.4.1, 3.1.1, 3.1.3, 4.2, 4.8, 5.1.1 (i, ii, iv, v), 5.1.2(i) ("third-party AI" ifadesi dahil)
- Apple "Offering account deletion in your app" ve "Privacy manifest / required reason API" sayfaları, Expo "Apple privacy" rehberi
- Google Play: User Data politikası (Account deletion bölümü), Account deletion yardım sayfası (web bağlantısı şartı), Photo and Video Permissions politikası, Target API level şartı

Önem: 🔴 büyük olasılıkla ret · 🟠 inceleyene göre ret çıkabilir · 🟡 düşük risk, düzeltilmesi iyi olur

Durum: **✅ bu PR'da düzeltildi** · **👤 kullanıcı yapacak** · **🛠 backend/web**

---

## 1. En önemli bulgular

| # | Risk | Önem | Kural | Durum |
|---|---|---|---|---|
| 1 | **Hesap silme yalnızca pasife alma.** Apple: *"Only offering to temporarily deactivate or disable an account is insufficient."* Google: *"Temporary account deactivation, disabling, or 'freezing' the app account does not qualify as account deletion."* ROADMAP'teki "veri silinmez" kararı iki mağazada da ret sebebi. | 🔴 | Apple 5.1.1(v), Play User Data / Account deletion | 🛠 Backend: pasife alma anında kalsın, ardından (ör. 30 gün içinde) kişisel veriler (ad, soyad, e-posta, telefon, push cihazları, bağlı Apple/Google kimlikleri, oturumlar, yapay zekâ sohbetleri) **silinsin ya da anonimleştirilsin**. Yalnızca yasal saklama yükümlülüğü olan kayıtlar (VUK md. 253 — 5 yıl, TTK md. 82 — 10 yıl) saklansın ve gizlilik politikasında açıkça yazılsın. Uygulamadaki metin bu davranışa göre güncellenmeli (şu an "kapatılır" diyor, doğru ama eksik). |
| 2 | **Play için web üzerinden hesap silme isteği bağlantısı yok.** Data safety formunda zorunlu; uygulama adı geçmeli, giriş yapmadan da talep edilebilmeli. | 🔴 | Play Account deletion | 🛠 Web: `https://otopoly.app/account/delete` (e-posta koduyla doğrulanan form). 👤 Play Console'a girilecek. |
| 3 | **Mağaza sürümüne mock/demo girme riski.** `EXPO_PUBLIC_API_MODE` verilmezse uygulama varsayılan olarak mock çalışıyordu: demo hesap kartı, `otopoly://login?demo=owner` ile şifresiz giriş, QA turu, demo Apple/Google kimlik seçici, Tanılama ekranı. | 🔴 | Apple 2.1, 2.3.1; Play Misleading claims | ✅ `EXPO_PUBLIC_APP_ENV=production` mağaza sürümünü işaretliyor: mock, demo, QA turu ve Tanılama tamamen kapalı; canlı API varsayılanı `https://api.otopoly.app`. `app.config.js` yanlış yapılandırmada build'i durduruyor. `eas.json`'a `production` profili eklendi. 👤 Xcode Cloud mağaza workflow'una `EXPO_PUBLIC_APP_ENV=production` eklenmeli. |
| 4 | **Gizlilik politikası uygulama içinde yoktu.** | 🔴 | Apple 5.1.1(i), Play User Data | ✅ Giriş, Profil → Yasal, yapay zekâ izin ekranı ve hesap silme ekranında bağlantı var (`EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`). 👤🛠 `https://otopoly.app/privacy` ve `/terms` sayfaları yayında olmalı. İçerik: toplanan veriler, yapay zekâ sağlayıcısı (adıyla), WhatsApp/e-posta gönderimi, saklama süreleri, silme ve izin geri çekme yolu. |
| 5 | **İnceleme için demo hesap.** Giriş zorunlu; inceleyici canlı backend'de dolu verisi olan bir hesapla girebilmeli. | 🔴 | Apple 2.1(a), Play App access | 👤🛠 `AUTH_REVIEW_ACCOUNTS` canlı backend'de tanımlanmalı, hesabın işletmesine örnek veri (müşteri, iş, finans) yüklenmeli. Metin aşağıda. |
| 6 | **iPad: `supportsTablet: true`, ama tablet düzeni yok.** Expo iPad'de çoklu görev için dört yönü de açıyor; telefon ekranları yatay iPad'de 1000+ px'e yayılıyor. İnceleme iPad'de yapılırsa "4.0 Design" reddi sık görülür. | 🟠 | Apple 2.4.1, 4.0 | 👤 Karar: aşağıdaki öneriye bakın (kapatma önerilir). |
| 7 | **Yapay zekâ sağlayıcısı adı belirsiz kalabiliyor.** `openai_compatible` için "OpenAI uyumlu bir yapay zekâ sunucusu" yazıyor. 5.1.2(i) verinin **nereye** gittiğinin açıkça söylenmesini istiyor. | 🟠 | Apple 5.1.2(i) | 🛠 `/v1/tenant/ai/status` gerçek sağlayıcı adını (`provider_name`) dönmeli; uygulama zaten gelen adı aynen gösteriyor. İzin ekranı, verilen bilgiler ve geri çekme yolu ✅ (PR #7). Gizlilik bağlantısı ✅ (bu PR). |
| 8 | **WhatsApp bağlantısı QR ile "bağlı cihaz" olarak kuruluyor** (resmî WhatsApp Business Platform değilse). Apple 5.2.2 (üçüncü taraf hizmet izni) ve WhatsApp kullanım koşulları açısından şikâyet/ret riski; marka adı ekranda. | 🟠 | Apple 5.2.1/5.2.2, Play IP | 👤🛠 Resmî WhatsApp Business (Cloud) API kullanılıyorsa inceleme notunda belirtin. Değilse, mağaza sürümünde WhatsApp kurulum ekranını web'e bırakmayı düşünün. |
| 9 | **Apple ile ilk kez giriş yapan, işletmesi olmayan kullanıcı boş "Bağlı işletme yok" ekranında kalıyor.** İnceleyici Sign in with Apple'ı denerse uygulama "işlevsiz" görünür. | 🟠 | Apple 2.1, 4.2 | 👤 İnceleme notunda "Uygulama işletmelere satılan bir hizmetin mobil istemcisidir; yeni Apple hesabı işletme davetiyle anlam kazanır, lütfen demo hesabı kullanın" yazın. Ekranda Hesabı sil ve Çıkış zaten var ✅. |
| 10 | **Erişimi sona ermiş/askıya alınmış işletmede kullanıcı Profil'e ulaşamıyordu** (hesap silmeye giden yol yoktu). | 🟠 | Apple 5.1.1(v) | ✅ Erişim ekranına "Hesabımı sil" eklendi. |
| 11 | **Gizlilik manifesti yoktu.** Bağımlılıkların kullandığı required-reason API'leri (UserDefaults, FileTimestamp, DiskSpace, SystemBootTime) ve App Group UserDefaults (widget) bildirilmemişti. | 🟠 | Apple privacy manifest (ITMS-91053 uyarısı) | ✅ `ios.privacyManifests` eklendi (aşağıda). |
| 12 | **Android'de gereksiz izinler.** Expo şablonu `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE` ekliyor; fotoğraf izni politikası geniş medya iznini yasaklıyor. | 🟠 | Play Permissions, Photo & Video Permissions | ✅ `android.blockedPermissions` (medya, depolama, konum, mikrofon, rehber, AD_ID vb.). Fotoğraflar sistem seçicisiyle alınıyor, izin gerekmiyor. |
| 13 | İzin açıklamaları yalnızca Türkçeydi; uygulama İngilizce de destekliyor. | 🟡 | Apple 5.1.1(ii) | ✅ `expo.locales` ile tr/en kamera ve fotoğraf açıklamaları. |
| 14 | Satın alma / yönlendirme dili | — | Apple 3.1.1, 3.1.3(c)/(f); Play Payments | ✅ Temiz. Fiyat, "yükselt", "web'den satın al" yok. Limit ve kilit metinleri nötr ("Ayrıntıları e-posta adresinize gönderdik"). Satın alma bağlantısı yalnızca uygulama dışındaki e-postada. |

---

## 2. Ekran ekran denetim

| Ekran (route) | Risk | Önem | Kural | Durum |
|---|---|---|---|---|
| `_layout` (kök) | Tanılama modalı her sürümde açılabiliyordu | 🟠 | 2.1, 2.3.1 | ✅ `Stack.Protected guard={devToolsEnabled}` |
| `(auth)/login` | Demo hesap kartı, demo kod ipuçları, `?demo=` derin bağlantısıyla şifresiz giriş, demo Apple/Google seçici, Tanılama bağlantısı; gizlilik/koşullar bağlantısı yok | 🔴 | 2.1, 2.3.1, 5.1.1(i) | ✅ Hepsi `isMock`/`devToolsEnabled` arkasında, mağaza sürümünde kapalı. Gizlilik + koşullar bağlantısı ve onay notu eklendi. |
| `(auth)/login` — Apple/Google | Google iOS'ta yalnızca Apple ile birlikte gösteriliyor; sistem Apple butonu | — | 4.8 | ✅ Uygun. 👤 `EXPO_PUBLIC_GOOGLE_*` tanımlı değilse Google gizli kalır (sorun değil). |
| `(auth)/forgot-password` | — | — | — | ✅ |
| `select-org` | İşletmesi olmayan yeni kullanıcı boş ekran (bkz. #9) | 🟠 | 2.1, 4.2 | Hesabı sil ✅, 👤 inceleme notu |
| `delete-account` | Pasife alma (bkz. #1); kod e-postaya gidiyor (uygun: destek/telefon istemiyor) | 🔴 | 5.1.1(v), Play | 🛠 Silme/anonimleştirme. ✅ Gizlilik bağlantısı ve saklama açıklaması eklendi. Demo kod ipucu yalnızca mock'ta. |
| `diagnostics` | Loglar (kişisel veri içerebilir), API adresi, demo senaryoları, demo kodları | 🟠 | 2.3.1, 5.1.1 | ✅ Mağaza sürümünde route kapalı ve tüm girişler gizli |
| `link`, `+native-intent` | Evrensel linkler; başka organizasyona geçiş | — | — | ✅ |
| `login/qr/[id]`, `(app)/qr-scan` | Kamera izni; reddedilince Ayarlar'a yönlendirme; "Demo oturum" butonu | 🟡 | 5.1.1(iv), 2.3.1 | ✅ Demo butonu yalnızca mock. Mağaza sürümünde geliştirici web host'u (`EXPO_PUBLIC_WEB_URL`) kabul edilmiyor. 👤 İnceleme notunda QR girişin nasıl deneneceğini yazın. |
| `q/[token]` | Müşteriye ait teklif linki; uygulama paylaşmayı öneriyor | — | — | ✅ |
| `(app)/_layout` | QA turu | 🔴 | 2.3.1 | ✅ `qaTourEnabled` mağaza sürümünde her zaman false |
| `(tabs)/index` (Pano) | WhatsApp kurulum adımı kartı | 🟡 | 5.2 | bkz. #8 |
| `(tabs)/operations`, `customers`, `finance` | İş kayıtları, müşteri kişisel verileri (ad, telefon, plaka) | 🟡 | 5.1.1 | ✅ Uygulama işlevi; 👤 gizlilik etiketlerinde "Diğer kullanıcı içeriği" |
| `(tabs)/menu` | Tanılama satırı, "demo/live" etiketi | 🟠 | 2.3.1 | ✅ Mağaza sürümünde gizli; yalnızca sürüm numarası |
| `assistant` | Üçüncü taraf yapay zekâya veri gönderimi | 🔴→✅ | 5.1.2(i) | ✅ İlk kullanımda açık izin (PR #7), Tercihler'den geri çekme, gizlilik bağlantısı eklendi. 🛠 Sağlayıcı adı (#7). Sohbet içeriği UGC değil (yalnızca kullanıcıya görünür). |
| `jobs/[id]`, `jobs/new`, `contracts/*` | Fotoğraf/dosya ekleme: kamera izni gerektiğinde isteniyor, galeri sistem seçicisiyle (izin yok), PDF belge seçici. Müşteri imzası/OTP | 🟡 | 5.1.1(iv), Play Photo & Video | ✅ Uygun. 👤 Elektronik imzanın hukuki geçerliliği iddia ediliyorsa metadata'da abartmayın. |
| `imports/*`, `exports/*` | Belge seçici, paylaşım sayfası | — | — | ✅ |
| `customers/[id]`, `suppliers/[id]`, `leads/[id]` | `tel:`/`mailto:` bağlantıları | — | — | ✅ |
| `quotes/*` | `wa.me` bağlantısı, teklif linkini tarayıcıda açma; modül kapalıyken kilit ekranı | 🟡 | 4.2.3(i) | ✅ WhatsApp yüklü değilse web'de açılır, uygulama WhatsApp'a bağımlı değil |
| `settings/usage` | Plan adı, sayaçlar; fiyat ve satın alma yok | — | 3.1.1 | ✅ |
| `settings/messaging` | WhatsApp QR bağlantısı | 🟠 | 5.2.2 | bkz. #8 |
| `settings/letterhead` | — | — | — | ✅ |
| `profile/index` | Hesabı sil erişilebilir; gizlilik bağlantısı yoktu | 🔴 | 5.1.1(i), (v) | ✅ "Yasal" bölümü (Gizlilik Politikası, Kullanım Koşulları) eklendi |
| `profile/linked-accounts` | Sosyal hesap bağlantısını kaldırma; demo kimlik seçici | 🟡 | 5.1.1(v) | ✅ Kaldırma var; demo seçici yalnızca mock |
| `profile/preferences` | Push izni açıklamasıyla isteniyor ("Şimdi değil" var); yapay zekâ iznini geri çekme | — | 5.1.1(iv), 5.1.2 | ✅ |
| `profile/password` | — | — | — | ✅ |
| `notifications` | Bildirim gelen kutusu; kilit ekranında hassas veri yok (backend) | — | — | ✅ |
| `staff`, `todos`, `reports`, `catalog/*`, `cari/*`, `finance/*`, `purchases/*`, `sales/*`, `suppliers/*`, `leads/*` | Standart iş ekranları; yer tutucu veya "yakında" ekranı yok. TOTP/passkey satırları "web panelinden yapılabilir" diyor (satın alma değil) | 🟡 | 2.1, 4.2 | ✅ |
| Erişim kapısı (süresi dolmuş/askıda) | Hesap silmeye yol yoktu; Tanılama butonu | 🟠 | 5.1.1(v) | ✅ "Hesabımı sil" eklendi; Tanılama yalnızca mock+geliştirici sürümü |
| Widget ve Live Activity | Kilit ekranında günlük tahsilat tutarı | 🟡 | 5.1.1 | Kullanıcının kendi eklediği widget; sorun değil |
| Tüm ekranlar — karanlık mod | Tema tokenları her iki modda tanımlı | — | — | ✅ (yeni bileşen de tema renklerini kullanıyor) |
| Tüm ekranlar — iPad | Tablet düzeni yok (bkz. #6) | 🟠 | 2.4.1, 4.0 | 👤 Karar |

---

## 3. Bu PR'da yapılan değişiklikler

- `src/config/env.ts`: `EXPO_PUBLIC_APP_ENV` (`development` | `preview` | `production`). `production` iken mock, QA turu, geliştirici web host'u ve Tanılama kapalı; API modu zorla `live`, varsayılan `https://api.otopoly.app`. Ayarlanmazsa: Metro'da `development`, diğer derlemelerde `preview` (mevcut TestFlight demo derlemeleri değişmez).
- `app.config.js`: `EXPO_PUBLIC_APP_ENV=production` iken `API_MODE=mock`, `QA_TOUR=1` ya da https olmayan API adresi varsa yapılandırma hata veriyor (Xcode Cloud `expo prebuild` adımında durur).
- `eas.json`: `production` profili (AAB, `APP_ENV=production`, `API_MODE=live`), `preview` profiline `APP_ENV=preview`.
- Gizlilik ve koşullar: `EXPO_PUBLIC_PRIVACY_URL` (varsayılan `https://otopoly.app/privacy`), `EXPO_PUBLIC_TERMS_URL` (`/terms`). `LegalLinks` bileşeni giriş, profil, yapay zekâ izni ve hesap silme ekranlarında.
- Erişim kapısına "Hesabımı sil".
- `app.json`:
  - `ios.privacyManifests`: `NSPrivacyTracking: false`; required-reason API'ler: UserDefaults `CA92.1` + `1C8F.1` (widget App Group), FileTimestamp `C617.1`, `0A2A.1`, `3B52.1`, DiskSpace `E174.1`, `85F4.1`, SystemBootTime `35F9.1` (React Native, expo-file-system, expo-constants, expo-localization, expo-notifications, expo-application, AsyncStorage manifestlerinden); toplanan veri türleri (ad, e-posta, telefon, kullanıcı kimliği, cihaz kimliği, fotoğraflar, diğer kullanıcı içeriği — hepsi kimliğe bağlı, takip yok, amaç: uygulama işlevi).
  - `android.blockedPermissions`: `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_*`, `ACCESS_MEDIA_LOCATION`, `RECORD_AUDIO`, konum, `READ_CONTACTS`, `SCHEDULE_EXACT_ALARM`, `USE_FULL_SCREEN_INTENT`, `com.google.android.gms.permission.AD_ID`. Kalanlar: `INTERNET`, `CAMERA`, `VIBRATE`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`.
  - `expo.locales` (tr/en) ve `CFBundleAllowMixedLocalizations`: izin açıklamaları iki dilde.
- `scripts/smoke/store-build.smoke.ts`: mağaza sürümünde mock/QA/Tanılama'nın kapalı olduğunu doğrular.

Hedef API: React Native 0.86 `targetSdk = 36` → Play'in 31 Ağustos 2026'dan itibaren yeni uygulama ve güncellemeler için istediği API 36 karşılanıyor ✅.

---

## 4. iPad önerisi: **şimdilik kapatın** (`"supportsTablet": false`)

Gerekçe:
1. Ekranların hiçbiri geniş ekran için tasarlanmadı: içerik genişliği sınırı, iki sütunlu düzen, yatay mod yok. Expo, iPad çoklu görev için dört yönü de zorunlu açıyor, yani `orientation: portrait` iPad'de geçerli olmayacak.
2. iPad desteği açıkken Apple incelemeyi iPad'de de yapabiliyor ve iPad ekran görüntüleri (13") isteniyor. Bozuk görünen bir düzen "4.0 Design" reddi alır.
3. **Tek yönlü kapı:** iPad desteğiyle yayımlanan bir uygulamada sonraki sürümlerde iPad desteği kaldırılamaz. Kapalı başlayıp düzen hazır olunca açmak her zaman mümkün.
4. Kapalıyken uygulama iPad'de iPhone uyumluluk modunda çalışır. Kullanıcı kaybı olmaz, 2.4.1 ("iPhone apps should run on iPad whenever possible") karşılanır.

İleride açmak için: `Screen` bileşenine en fazla ~720 pt içerik genişliği, listelerde iki sütun ve yatay mod testleri.

---

## 5. Gönderim öncesi kontrol listesi

### 5.1 Derleme ve yapılandırma
- [ ] Xcode Cloud **App Store** workflow'u ortam değişkenleri: `EXPO_PUBLIC_APP_ENV=production`, `EXPO_PUBLIC_API_URL=https://api.otopoly.app`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. İsteğe bağlı: `EXPO_PUBLIC_PRIVACY_URL`, `EXPO_PUBLIC_TERMS_URL`. Demo amaçlı TestFlight workflow'u `preview` olarak kalabilir.
- [ ] Android: `npx eas-cli@latest build --platform android --profile production` (aynı Google değişkenleri EAS ortamında).
- [ ] iPad kararı uygulandı (`supportsTablet`).
- [ ] Mağaza sürümünü açınca giriş ekranında demo kartı, Tanılama bağlantısı ve "demo" etiketi **görünmemeli**.

### 5.2 Backend ve web (🛠)
- [ ] Hesap silme: pasife alma + kişisel verilerin silinmesi/anonimleştirilmesi (bkz. #1), Apple token iptali (yapıldı).
- [ ] `https://otopoly.app/account/delete`: giriş yapmadan e-posta koduyla hesap silme talebi; sayfada "Otopoly" adı, silinen ve saklanan veriler, süre.
- [ ] `https://otopoly.app/privacy` ve `/terms` yayında; yapay zekâ sağlayıcısı adıyla, saklama süreleri, silme yolu, WhatsApp/e-posta/SMS gönderimleri.
- [ ] `/v1/tenant/ai/status` gerçek sağlayıcı adını döndürmeli.
- [ ] `AUTH_REVIEW_ACCOUNTS`: inceleme hesabı (ör. `review@otopoly.app`) sabit kodla, örnek verili bir işletmenin sahibi. TOTP kapalı olmalı.

### 5.3 App Store Connect — Gizlilik etiketleri (App Privacy)
Takip (Tracking): **Hayır**. Reklam/analitik SDK'sı yok; loglar cihazda kalıyor.

| Veri türü | Hangi özellik | Kimliğe bağlı | Amaç |
|---|---|---|---|
| İletişim bilgisi → Ad | Profil, personel | Evet | Uygulama işlevi |
| İletişim bilgisi → E-posta adresi | Giriş, e-posta kodu, bildirim | Evet | Uygulama işlevi |
| İletişim bilgisi → Telefon numarası | Profil (WhatsApp/SMS bildirimleri) | Evet | Uygulama işlevi |
| Kullanıcı içeriği → Fotoğraflar veya videolar | Sözleşme/iş fotoğrafları | Evet | Uygulama işlevi |
| Kullanıcı içeriği → Diğer kullanıcı içeriği | Müşteri/araç/iş/finans kayıtları, asistan mesajları, içe aktarılan dosyalar | Evet | Uygulama işlevi |
| Tanımlayıcılar → Kullanıcı kimliği | Hesap UUID | Evet | Uygulama işlevi |
| Tanımlayıcılar → Cihaz kimliği | Push token (`push_devices`) | Evet | Uygulama işlevi |

Not: İşletme finans kayıtları kullanıcının kendi ödeme bilgisi değil, bu yüzden "Diğer kullanıcı içeriği" altında. Temkinli olmak için "Finansal bilgi → Diğer finansal bilgi" de işaretlenebilir. Gizlilik manifesti bu tabloyla tutarlı.

### 5.4 Google Play — Data safety cevapları
- Veri toplanıyor mu: **Evet**. Aktarımda şifreli: **Evet** (HTTPS). Kullanıcı silme talep edebilir: **Evet** → web bağlantısı: `https://otopoly.app/account/delete`.
- Paylaşım: **Hayır**. Yapay zekâ sağlayıcısı, e-posta ve WhatsApp gönderim hizmetleri adınıza çalışan "hizmet sağlayıcı" sayıldığından Play tanımında paylaşım değildir. Gizlilik politikasında ise adlarıyla yazılmalı.
- Toplanan türler (hepsi: zorunlu, amaç *App functionality* + *Account management*):
  - Kişisel bilgiler: Ad, E-posta adresi, Telefon numarası, Kullanıcı kimlikleri
  - Fotoğraflar ve videolar: Fotoğraflar
  - Dosyalar ve belgeler: içe aktarma dosyaları, sözleşme PDF'leri
  - Uygulama etkinliği: Diğer kullanıcı tarafından oluşturulan içerik (kayıtlar, asistan mesajları)
  - Cihaz veya diğer kimlikler: push token
  - (Temkinli) Finansal bilgi → Diğer finansal bilgi: işletme kasa/cari kayıtları
- Konum, rehber, sağlık, tarama geçmişi, reklam kimliği: **Toplanmıyor**.
- Diğer Play beyanları: Reklam içeriyor → Hayır; Reklam kimliği → Hayır (AD_ID engellendi); Finansal özellikler → "Uygulamam finansal özellik sunmuyor" (borç/kredi/ödeme aracı değil, muhasebe kaydı); Hükûmet, sağlık → Hayır.

### 5.5 İnceleme notu (App Review Information → Notes ve Play → App access)

```
Otopoly is the mobile client of a B2B management service for auto-care businesses
(jobs, customers, finance, contracts). Accounts are created for businesses by the
service; there is no in-app purchase and no purchase link or price in the app.
Plans are sold to businesses outside the app (Guideline 3.1.3(c)/(f)).

Demo account (owner of a sample business with data):
  1) On the sign-in screen choose "E-mail code".
  2) E-mail: review@otopoly.app   →   code: <AUTH_REVIEW_ACCOUNTS code>
  (Password sign-in also works: <password>)

Sign in with Apple creates a new account that is not yet a member of a business,
so it shows an empty organization list; please use the demo account to review features.

Account deletion: Profile → "Hesabımı sil" (Delete my account). A code is e-mailed to
the account; personal data is deleted within 30 days except records the law requires
us to keep (tax/commercial records), as described in the privacy policy.

AI assistant (Menu → Assistant): before the first message the app shows which provider
(<provider name>) receives which data and asks for explicit consent. Consent can be
withdrawn in Profile → Notification preferences (Bildirim tercihleri) → AI assistant.

QR sign-in: open https://otopoly.app/login on a computer, choose "QR code", then scan it
from Menu → "Approve QR sign-in" (QR ile giriş onayla) in the app and approve.

The app language follows the device (Turkish / English).
```

### 5.6 Ekran görüntüleri
- iPhone 6.9" (zorunlu): Pano, İşler, Müşteri detayı, Finans, Asistan (izin sonrası), Sözleşme fotoğrafları. Giriş ekranı tek başına yeterli değil (2.3.3).
- iPad 13": yalnızca iPad desteği açık kalırsa gerekli. Önerimiz kapatmak.
- Play: telefon ekran görüntüleri + 1024×500 özellik grafiği. Demo/mock etiketi görünmemeli.

### 5.7 İhracat uyumu (Export compliance)
- `ios.config.usesNonExemptEncryption: false` mevcut ✅. Yalnızca HTTPS/TLS ve işletim sisteminin şifrelemesi kullanılıyor, bu yüzden muaf. App Store Connect'te soru sorulmaz.

### 5.8 Yaş derecelendirmesi
- Apple: anketteki tüm içerik sorularına "Yok". Kullanıcılar arası açık iletişim, sınırsız web erişimi ve kumar yok. Yapay zekâ asistanı yalnızca işletme verisiyle sınırlı. Beklenen sonuç: en düşük derece.
- Play (IARC): kategori "Utility/Productivity". Kullanıcı etkileşimi, konum paylaşımı ve dijital satın alma yok.

### 5.9 Metadata
- Gizlilik politikası URL'si (App Store Connect + Play) = `EXPO_PUBLIC_PRIVACY_URL` ile aynı adres.
- Destek URL'si ve iletişim e-postası (Apple 1.5).
- Açıklamada fiyat ya da "web'den abone olun" ifadesi olmamalı (3.1.3).
