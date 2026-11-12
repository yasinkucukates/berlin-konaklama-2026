# Görev | 12 Kasım 2026: Galerileri tamamla, ilgisiz görselleri sil

Yasin (12.11.2026): "İlanların tüm fotoğrafları eklensin siteye", "sitede son eklenen ilanların tüm fotoğrafları siteye eklenmemiş", "Daire veya ev ile ilgisiz ikon fotoğrafları eklenmiş. Onları da silelim", "Nerden aldığı belirsiz alakasız ikon ve semboller eklenmiş".

Model: Opus 5.5, medium. Dal: `claude/project-thread-thj3xb` (taban `prototip/filtreli-arayuz` acee598). Commit + push, force yok.

## Bulut tespiti (canlı main c91a15a)
10-11 Kasım'da eklenen Airbnb kartlarında galeri, ilan sayfasındaki tüm `<img>`'lerden toplanmış:
- `a0.muscache.com/im/pictures/user/...` = ev sahibi ve yorumcu profil fotoğrafı (ör. "Coralie", "Esther", "Emily" başlıklı).
- `a0.muscache.com/im/pictures/AirbnbPlatformAssets/...` (Review-AI-Synthesis) = Airbnb'nin yorum özeti ikonları.
Etkilenen kartlar (canlı toplam / bunun ilgisiz olanı): Schöneberg 6 Tek Yataklı 1107298370548666445 (25/~11), TMS1 Moabit 1610146635685764854 (28/~11), TRIO İki Yatak Odalı Superior 20671210 (26/~11), Moabit Spree Loft 1383517943466250521 (28/~13), fairAPART 1532802572102238291 (13/1).
Aynı kartlar yalnız ana sayfadaki görselleri almış; tam fotoğraf turu (`/rooms/<id>/photos` veya "Tüm fotoğrafları göster") alınmamış.

## 1. İlgisiz görselleri her yerden çıkar
- Tüm veri dosyalarında (`six/prepared/galeri-sweep-*.json`, `galeri-veri.json`, `redesign-prototip/verified-full-galleries.json`, `photos-*.json`, `all-photo-datasets.json` vb.) ilan fotoğrafı olmayan görselleri ayıkla: yukarıdaki iki desen, profil/avatar, platform logosu, ikon, harita karosu, rozet, Booking/Holidu/Vrbo arayüz görselleri.
- Desene güvenip bırakma: kalan galerileri küçük boyutta indirip gözle de bak (ikon/logo/metin kartı/kişi portresi var mı). Evin içi, dışı, binası, bahçesi, manzarası ve kat planı ilan fotoğrafıdır; kalır.
- Tercihen derleyicide de (`build_liquid.py` fotoğraf toplama) bu iki muscache desenini reddeden bir koruma ekle, ki bir daha girmesin.

## 2. Tam galeri
Öncelik (son eklenenler): 3746d29 ile gelen 7 ilan (yukarıdaki 5 Airbnb + Booking 951491101 Herthastraße, Booking 1242731801 Kreutzigerstraße) ve 4352812 ile gelen 2 ilan (TRIO Üç Odalı 35666163, Prime Living 1740651283805171847).
Sonra az fotoğraflı kartlar: sweep7-airbnb-1805168581752936023 (10), yeni-locke-2-family (7), yeni-wilde-2-daire (7), six-airbnb-1152005761587998986-full (8), six-booking-osthafen-790949501-full (11), sweep7-booking-ferienhaus-berlin-6-pax (6), sweep6-booking-1252191308 (4).
Her biri için kaynak ilandaki TÜM ilan fotoğrafları, yüksek kalite: Airbnb asıl yol (im_w yok), Booking `max1920x1080` + `?k=<imza>&o=` (imzasız 401; derleme durur), Holidu l.jpg, Vrbo/Traum en büyük boyut. Kaynak gerçekten az fotoğraflıysa öyle not et; uydurma.
Galeri içi tekrarları (aynı kare) sha256/dHash + gözle ayıkla (`six/prepared/foto-mukerrer-*.json` biçimi). Sonucu `redesign-prototip/verified-full-galleries.json`'a yaz (mevcut `records` biçimi: source, targets, expected, method, photos).

## 3. Derle ve doğrula
- Kart id'leri, tarihleri, fiyat ve müsaitlik verisine dokunma.
- `python3 redesign-prototip/build_combined.py --output index.html` hatasız; her hedef kartın yeni foto sayısını ve hiçbir kartta `im/pictures/user/` veya `AirbnbPlatformAssets` kalmadığını say.
- Bir iki kartın galerisinin ekran görüntüsünü al, ilgisiz görsel olmadığını gözle doğrula; görüntüleri `aday-arama/galeri-tamamlama-2026-11-12/` altına koy.

## Sınırlar
main'e, canlı siteye, Apps Script'e dokunma (yayın ayrı onayla bulut tarafından). Rezervasyon/mesaj yok. Başka bir ajan aynı anda `claude/project-thread-l6i9jq` dalında 20 yeni ilan ekliyor; o dala ve onun yeni dosyalarına dokunma.

## Sonuç
`aday-arama/galeri-tamamlama-2026-11-12/SONUC.md`: kart başına önce/sonra foto sayısı, çıkarılan ilgisiz görsel sayısı, kaynakta erişilemeyenler, commit kimliği.
