# Yeni aday arama kuralları (7 Kasım 2026, Yasin)

Amaç: Sitede olmayan yeni daire ve villa adaylarını bulmak. Adaylar kullanıcı seçmeden siteye (`index.html`, `bolunmus-*.json`, `galeri-veri.json`) veya `main`'e eklenmez. Çıktı yalnız bu klasöre yazılır.

## Kriterler

- Grup: 6 yetişkin (bazen 7). Kapasitesi 7 olanları not et.
- Yalnız evin/dairenin tamamı. Otel odası, paylaşımlı daire yok.
- Herkese ayrı yatacak yer: 6 kişinin her birine ayrı yatak. Çift kişilik yatak tek kişi sayılır (paylaşım yok). Bir kişinin kanepe/çekyatta yattığı düzen kabul, ama `kanepeli: true` ve not olarak açıkça belirtilir. İki kişi kanepeye düşüyorsa aday değildir.
- Tarih pencereleri (ikisi de aranır):
  - Tek konaklama: 30 Aralık 2026 → 3 Ocak 2027 (4 gece).
  - Bölünmüş: 30 Aralık → 1 Ocak ve 1 Ocak → 3 Ocak (2+2 gece). Her yarı ayrı aday olabilir.
- Mesafe (otomobil/taksi, Tresor, Köpenicker Straße 70, 10179 Berlin, 52.5106807, 13.419484):
  - Daire: en çok 30 dakika.
  - Villa / müstakil ev: en çok 50–55 dakika.
- Bütçe: Daire için 4 gece toplam ≈ 6.000 € üst sınırı. Villa için fiyat sınırı yok.
- Berlin içindeki ilanlarda 17 haneli Registriernummer var mı, not et (yoksa uyarı).

## Bakılacak kaynaklar

Airbnb, Booking.com, Vrbo / FeWo-direkt, Holidu, Google Vacation Rentals (Google Haritalar "Tatil kiralıkları"), HomeToGo, Traum-Ferienwohnungen, e-domizil, Ferienhausmiete.de, Travanto, Casamundo/Belvilla.

## Her aday için toplanacak metadata

`platform`, `platformId`, `url` (sorgu parametresiz kalıcı bağlantı), `title`, `hostName` (ev sahibi / işletme), `address` (tam adres varsa), `coords` {lat, lon, accuracy: "adres" | "ilan-yaklasik"}, `district`, `kind` (daire / villa / ev), `m2`, `bedrooms`, `baths`, `beds` (oda oda yatak dökümü), `capacity`, `kanepeli`, `registrationNumber`, `checkInTime`, `checkOutTime`, `rating`, `reviewCount`, `photos` (ilk 3 görsel URL'si), `prices` (pencere başına: tutar, para birimi, vergi/ücret dahil mi, iptal koşulu), `tresorCarMin` (ve kaynağı), `observedAt` (ISO zaman), `samePropertyAs` (aynı mülkün diğer ilanlarının anahtarları), `notes`.

## Mükerrer kontrolü

1. Anahtar: `airbnb:<rooms id>`, `booking:<hotel slug>`, diğerlerinde `<platform>:<sayısal ilan no>`. `gorulen-ilanlar.json` içinde aynı anahtar varsa aday değildir.
2. Aynı mülkün başka sitedeki ilanı: aşağıdakilerden ikisi tutuyorsa aynı mülk say ve `samePropertyAs` ile bağla, ayrı aday olarak sunma:
   - Koordinat 150 m içinde veya aynı sokak + numara,
   - Aynı yatak odası sayısı ve m² (±10 %) ya da aynı yatak dökümü,
   - Aynı Registriernummer veya aynı ev sahibi / işletme adı,
   - Aynı fotoğraflar (aynı oda görüntüsü),
   - Başlıkta aynı özel ad (ör. "Turmvilla").
3. Belirsizse aday olarak sun ama `olasiMukerrer` alanına eşleşebileceği anahtarı yaz.
4. Sunulan her aday `gorulen-ilanlar.json`'a `status: "aday-sunuldu"` ve `firstSeen` tarihiyle eklenir; elenenler `status: "elendi"` ve `elemeNedeni` ile eklenir. 2–3 günde bir yapılan yeni aramada bunlar tekrar sunulmaz (yalnız fiyat/müsaitlik değişimi ayrıca raporlanabilir).
