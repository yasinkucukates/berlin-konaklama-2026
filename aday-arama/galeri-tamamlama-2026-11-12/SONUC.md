# Sonuç | 12 Kasım 2026: Galeriler tamamlandı, ilgisiz görseller çıkarıldı

Dal: `claude/project-thread-thj3xb`. `prototip/filtreli-arayuz` (93a07b4, 20 sweep12 ilanı dahil) bu dala birleştirildi; force yok. main, canlı site, Apps Script ve `claude/project-thread-l6i9jq` değişmedi. Rezervasyon veya mesaj yok.

## 1. İlgisiz görseller

- **Desen temizliği** (`a0.muscache.com/im/pictures/user/`, `AirbnbPlatformAssets`): veri dosyalarından 95 kayıt silindi (`galeri-veri.json` 36, `galeri-sweep-20261110-yeni.json` 48, `galeri-sweep-20261107.json` 11). Önceki sayfada 5 kartta 48 tane görünüyordu (Schöneberg 11, TMS1 11, TRIO Superior 11, Spree Loft 14, fairAPART 1). sweep12 verisinde bu desen **0** (yalnız açıklama metninde geçiyor).
- **Gözle kontrol**: derlenen sayfadaki 3056 + sweep12'deki 560 benzersiz görsel küçük boyutta indirilip temas sayfalarında tek tek incelendi. İlan fotoğrafı olmayan **123 görsel** `six/prepared/foto-ilgisiz-20261112.json` dosyasına gerekçesiyle yazıldı ve tüm veri dosyalarından silindi (`verified-full-galleries.json` kayıtlarında `expected` güncellendi):
  - şehir simgesi / mahalle tanıtımı (Brandenburg Kapısı, TV kulesi, Reichstag, konser, tekne, bisikletliler, park kalabalığı): 81
  - metin/bilgi/reklam kartı, logo (online check-in, "Quiet house", "Towels not included", ev kuralları, köpek ilanı, dilo/MyGold logosu, tarihî görseller): 23
  - harita veya platform ekran görüntüsü: 5
  - stok ürün görseli (mama sandalyesi, seyahat yatağı, kahve kapsülü): 3
  - yemek/kahvaltı yakın çekimi: 9
  - tanıtım amaçlı kişi grubu (bar partisi): 2
  - Ayrıca yeni galeriler eklenirken Spree Loft'ta 8 (projektör, hoparlör, parti teklifi kartı, parti teknesi, Siegessäule, Tiergarten, Spree teknesi, iletişim bilgili kare), Prime Living'de 1 (Superhost rozeti), Wilde'de 2 (Checkpoint Charlie tabelası, Die Welt balonu), Apartmenthaus Mitte'de 7 (başka daire tipleri ve çevre) kare baştan alınmadı.
  - Kalan: ev/daire içi ve dışı, bina, bahçe, pencereden manzara, kat planı. Fotoğrafın üstüne çizilmiş olanak simgeleri (2 kare) ve duvar süsleri evin fotoğrafı olduğu için bırakıldı.
- **Derleyici koruması**: `build_liquid.py` iki muscache desenini ve `foto-ilgisiz-20261112.json` listesini her karttan çıkarır, kalırsa uyarı yazar; `photo_catalog.py` doğrulanmış galeride bu desenleri reddeder.
- Son sayfada `im/pictures/user/` veya `AirbnbPlatformAssets`: **0**; listedeki görsellerden kalan: **0**; imzasız Booking görseli: **0**.

## 2. Tam galeri (önce → sonra)

| Kart | Önce | Sonra | Kaynak |
|---|---|---|---|
| Schöneberg 6 Tek Yataklı (1107298370548666445) | 25 (11 ilgisiz) | 22 | Airbnb fotoğraf turu 22 |
| TMS1 Moabit (1610146635685764854) | 28 (11 ilgisiz) | 31 | fotoğraf turu 31 |
| TRIO İki Yatak Odalı Superior (20671210) | 26 (11 ilgisiz) | 28 | fotoğraf turu 28 |
| Moabit Spree Loft (1383517943466250521) | 28 (14 ilgisiz) | 49 | fotoğraf turu 57, 8 ilgisiz kare alınmadı |
| fairAPART (1532802572102238291) | 13 (1 ilgisiz) | 16 | fotoğraf turu 16 |
| Herthastraße (Booking 951491101) | 23 | 23 | kaynakta 23, zaten tamdı |
| Kreutzigerstraße (Booking 1242731801) | 41 | 41 | kaynakta 41, zaten tamdı |
| TRIO Üç Odalı (35666163) | 26 | 26 | fotoğraf turu 26, zaten tamdı |
| Prime Living (1740651283805171847) | 48 | 47 | fotoğraf turu 48, Superhost rozeti çıkarıldı |
| sweep7-airbnb-1805168581752936023 | 10 | 10 | kaynakta yalnız 10 |
| yeni-locke-2-family | 7 | 27 | daire penceresi 7 (tamamı) + tesis ortak alanı/bina 20 |
| yeni-wilde-2-daire | 7 | 27 | daire penceresi 7 (tamamı) + tesis ortak alanı/bina 20 |
| six-airbnb-1152005761587998986-full | 8 | 8 | kaynakta yalnız 8 |
| six-booking-osthafen-790949501-full | 11 | 11 | kaynakta yalnız 11 |
| sweep7-booking-ferienhaus-berlin-6-pax | 6 | 6 | kaynakta yalnız 6 |
| sweep6-booking-1252191308 (Apartmenthaus Mitte) | 4 | 10 | daire penceresi 4 (tamamı) + bina/koridor/avlu 6 |

Airbnb görselleri asıl yoldan (im_w yok; üretici 1440 ekler), Booking görselleri sayfadaki `?k=` imzasıyla `max1920x1080` olarak kaydedildi; eklenen 121 yeni adresin hepsi 200 döndü. Galeri içi tekrar: dHash ile 3 benzer çift bulundu, gözle bakıldı; üçü de farklı kurulum (katlanmış/açık yatak, açık/kapalı kapı, ayrı/birleşik yataklar), tekrar yok. Kaynakta erişilemeyen ilan olmadı.

Görsel çıkarma nedeniyle sayısı azalan diğer kartlar (önce → sonra): six-airbnb-1656340-full 48→32, 565270388295704317 70→57, bolunmus-alexa 88→80, sweep6-airbnb-1552405041368851207 24→16, six-airbnb-1452938883567081364 32→25, sweep12-booking-britzer-tor 46→37, travanto 809908/809910/809914 ve vrbo-145069 24→21, sweep6-german-p5553503 71→67, sweep7-airbnb-1363888262051860529 22→18, sweep12-airbnb-31500359 25→21; geri kalan 20 kartta 1-3 kare.

## 3. Derleme ve doğrulama

- `python3 redesign-prototip/build_combined.py --output index.html` hatasız; 153 kart (146 benzersiz kart/tarih), 20 sweep12 kartı var.
- Kart `data-id`, giriş/çıkış tarihi, fiyat ve müsaitlik öznitelikleri `prototip/filtreli-arayuz` derlemesiyle aynı; tek fark fotoğraf kapsam notu eklenen kartlarda `data-note-count`.
- Ekran görüntüleri (bu klasörde): `kart-*.png` (kart), `galeri-*.png` (galeri penceresi), `galeri-tum-kareler-*.jpg` (galeri penceresinde tek tek gezilen tüm kareler: TRIO Superior 28, Spree Loft 49, Locke 27). Gözle kontrol edildi; ilgisiz görsel yok.
