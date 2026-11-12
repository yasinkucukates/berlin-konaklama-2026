# Tarama görevi | 11 Kasım 2026 (Yasin'in isteği)

Kullanıcının sözleri (11.11.2026 19:30 TR): "yeni ilanlar tarayalım. 2 + 2'yi kimse istemedi. Kimsenin umrunda değil villa. Kişi başı maksimum 25-30 bin liralık tresor ve rsoya taksiyle maksimum 15-20 dklık mesafelerdeki yerlere bakalım. Opus ajanlara ver işi opus medium. Yeni yerler varsa ekleyelim. Güncel yerleri de teyit edip available olmayanları çıkaralım." Ek: "bu zamana kadar ilanları bulduğumuz sitelere bakarsın, berlin için başka siteler varsa onlara da bakarsın" ve "Güvenilir olsun siteler".

Önce oku: `AGENTS.md`, `README.md` (Canlıya yayın), `redesign-prototip/MUSAITLIK.md`, `aday-arama/ARAMA-KURALLARI.md`, `aday-arama/gorulen-ilanlar.json`, bu klasördeki `canli-ilanlar-envanter.json` (canlı sitedeki 124 kart; `links` kaynak bağlantıları, `availability` 10 Kasım kayıtları).

Alt ajan kullanırsan model Opus, effort medium. Her ajana ayrı tarayıcı bağlamı ver (aynı sekmeyi paylaşmasınlar).

## Kesin sınırlar
- `main` dalına, canlı siteye, Apps Script favori sunucusuna DOKUNMA. Test oyu yazma.
- Çıktılar yalnız bu klasöre (`aday-arama/tarama-2026-11-11/`), dal `claude/project-thread-l6i9jq`; commit + push.
- Rezervasyon/ödeme/iletişim formu gönderme, hesap ayarı değiştirme.
- Belirsiz sonuçta "müsait değil" yazma. Kanıtsız kayıt üretme.

## A. Mevcut ilanların müsaitliği
- Kapsam: envanterde `checkIn=2026-12-30`, `checkOut=2027-01-03` olan 92 kart, 6 yetişkin. 2+2 (bölünmüş) kartları kontrol etme.
- Kartın her sağlayıcı bağlantısını (Airbnb/Booking/Holidu/Travanto vb.) aç; tarih ve 6 yetişkinle rezervasyon düğmesi/fiyat görünüyorsa available, açıkça "müsait değil / tarihler dolu / bu tarihlerde yok" görünüyorsa unavailable.
- Çıktı `musaitlik-2026-11-11.json`: `{version:1, records:[...]}`, MUSAITLIK.md şemasıyla (scope card/offer, id=data-id, checkIn, checkOut, adults:6, status, checkedAt saat dilimli ISO, sourceUrl, evidence, isteğe bağlı displayPrice). Çok sağlayıcılı kartta yalnız bir sağlayıcı doluysa o sağlayıcıyı `scope: offer` + `parentCardId` ile işaretle, kartı değil. 10 Kasım'da available olup şimdi unavailable olanlara `lastAvailableAt` = önceki `checkedAt`.
- Erişilemeyen/belirsiz olanları ayrıca `musaitlik-belirsiz-2026-11-11.json`'a nedeniyle yaz.
- Fiyat önemli ölçüde değiştiyse `displayPrice` ile not et.

## B. Yeni ilan araması
Kriterler (bu tarama için yeni ve öncelikli; ARAMA-KURALLARI.md ile çelişirse bunlar geçerli):
- Yalnız 30 Aralık 2026 → 3 Ocak 2027, 4 gece, tek konaklama. 2+2 (bölünmüş tarih) ARAMA.
- Villa / müstakil ev ARAMA; daire ve şehir içi evin tamamı.
- 6 yetişkin, evin tamamı, herkese ayrı yatak (çift yatak 1 kişi). En çok 1 kişi kanepede, `kanepeli: true` ile açıkça işaretle. 7 kapasiteyi not et.
- Mesafe: taksi/araçla hem Tresor (Köpenicker Str. 70, 52.5106807, 13.419484) hem RSO.Berlin (Schnellerstraße 137, 12439; 52.459911, 13.5053346) en çok 20 dk. OSRM trafiksiz süreyi ikisi için de yaz (`tresorCarMin`, `rsoCarMin`); 15 dk altını ayrıca işaretle. İkisinden biri 20 dk'yı aşarsa ele ama `elemeNedeni` ile kaydet.
- Bütçe: kişi başı en çok 25–30 bin TL → 4 gece toplam ≤ 180.000 TL (6×30 bin). Günün kurunu (TCMB veya ECB/Frankfurter) kaydet; €'yu TL'ye çevir. ≤150.000 TL olanları `butceIdeal: true` işaretle. Fiyat ödeme öncesi toplam (hizmet bedeli dahil); vergi kapsamını yaz.
- Kaynaklar: önceki siteler (Airbnb, Booking.com, Vrbo/FeWo-direkt, Holidu, Google Haritalar tatil kiralıkları, HomeToGo, Traum-Ferienwohnungen, e-domizil, Ferienhausmiete.de, Travanto, Casamundo/Belvilla) + Berlin için başka GÜVENİLİR siteler: yalnız ödeme koruması/şirket künyesi (Impressum) olan, yerleşik platformlar veya Berlin'de kayıtlı işletmelerin kendi sitesi (ör. Expedia/Hotels.com tatil evleri, Plum Guide, büyük apart işletmeleri). Doğrudan havale isteyen, künyesiz, yorumsuz siteleri kullanma. Yeni kullandığın her siteyi güvenilirlik gerekçesiyle `kaynaklar.md`'ye yaz.
- Mükerrer: ARAMA-KURALLARI.md'deki kurallar; envanterdeki 124 kart ve `gorulen-ilanlar.json`'daki tüm kayıtlar (aday-sunuldu ve elendi) tekrar sunulmaz. Aynı evin başka sitedeki ilanını bağla.
- Her aday için ARAMA-KURALLARI.md metadata + tam fotoğraf galerisi bağlantıları (Airbnb asıl yol; Booking `max1920x1080` ve `?k=` imzalı; Holidu `l.jpg`) + Türkçe kısa başlık önerisi + iptal koşulu + Registriernummer.
- Çıktı: `adaylar-2026-11-11.json` + okunur `adaylar-2026-11-11.md` (tablo: ad, bölge, Tresor/RSO dk, yatak düzeni, toplam € ve TL, kişi başı TL, iptal, link) ve `gorulen-ilanlar.json`'a eklenecek kayıtlar için `gorulen-ek-2026-11-11.json` (aday-sunuldu / elendi + neden). Asıl `gorulen-ilanlar.json`'ı da güncelle.

## Sonuç
Push ettikten sonra kısa özet ver: kaç kart available/unavailable/belirsiz, kaç yeni aday (ideal bütçe ve 15 dk altı ayrı), hangi siteler tarandı, erişim sorunları.
