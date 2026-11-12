# Görev 2 | 12 Kasım 2026: 20 adayı yeniden teyit et, müsait olanları siteye ekle

Kullanıcı (12.11.2026 22:39 TR): "O zaman available mı kontrol et" / "Available ise koy". Numara seçmedi: `adaylar-2026-11-11.json`'daki 20 adayın bugün müsait olanlarının tümü eklenecek.

Alt ajan kullanırsan Opus + medium, her birine ayrı tarayıcı bağlamı.

## 1. Bugünkü müsaitlik
Her aday için 30.12.2026–03.01.2027, 6 yetişkin. Sonuç `aday-musaitlik-2026-11-12.json` (MUSAITLIK.md şeması; `id` = adayın sitedeki yeni data-id'si). Fiyat değiştiyse yeni toplamı kullan. Dolu/belirsiz olan eklenmez; nedenini yaz.

## 2. Tam galeri
Müsait her aday için ilandaki TÜM fotoğraflar, yüksek kalite: Airbnb asıl yol (im_w yok), Booking `max1920x1080` + `?k=<imza>&o=` (imzasız adres 401 verir; derleme durur), Traum en büyük boyut. Galeri içi tekrar fotoğrafları (aynı kare) memory kuralına göre ayıkla (`six/prepared/foto-mukerrer-*.json` biçimi). `redesign-prototip/verified-full-galleries.json`'a ekle.

## 3. Prototipe ekle (şablon: commit 3746d29, "Add verified Berlin stays")
- O commit'in dokunduğu dosya türlerini aynı biçimde doldur: `six/prepared/galeri-sweep-20261112-yeni.json` (yeni dosya; 3746d29'daki `galeri-sweep-20261110-yeni.json` biçimi), `redesign-prototip/six/{eligibility,price-pairs,budget-normalized,routes-normalized,map-points,titles-tr}.json`, `bed-rooms-extra-apts.json`, `bed-breakdowns.json`, `bed-audit.json`, gerekirse `galeri-veri.json`.
- id biçimi: `sweep12-<platform>-<platformId>-20261230-20270103` (Booking için slug). Tarih yalnız 30.12–03.01, yalnız 6 kişilik görünüm. `addedAt` = eklediğin anın saat dilimli ISO zamanı.
- Türkçe başlık (`baslikTR`), oda/yatak yazıları Türkçe. Tresor ve RSO araç dakikaları (OSRM) ve kaynak bağlantısı.
- Uyarılar kartta görünür olmalı (eligibility `reason` / `priceNote` / features): Lichtenberg Traum ilanı "ödeme doğrudan ev sahibine havale, platform koruması yok"; Friedrichshain Petersburger "yalnız nakit, 4 yorum"; Schöneberg 4 odalı "oda oda yatak dökümü doğrulanmadı"; Attic "mutfak özel mi ortak mı çelişkili"; kanepeli olanlarda "1 kişi kanepede"; Marzahn'da ranza; Urban Flats'te "couch, çekyat olmayabilir"; Mariendorf'ta "Freesie/Enzian ile aynı bina, farklı daire"; Choice/Just Berlin "aynı işletmenin bitişik iki dairesi".
- Kanepeli adaylarda kart bunu üstte açıkça göstermeli (mevcut kanepe gösterimi neyse o).
- Mevcut kartlara, id'lerine, tarihlerine dokunma. `build_liquid.py`/arayüz kodunu değiştirme; gerekiyorsa yalnız veri kuralını karşılamak için ve gerekçesini commit'e yaz.
- `python3 redesign-prototip/build_combined.py --output index.html` hatasız çalışmalı; yeni kart sayısını say (124 + eklenen).
- `gorulen-ilanlar.json`'da eklenenlerin status'unu `siteye-eklendi` yap.

## Sınırlar
main'e, canlı siteye, Apps Script'e dokunma (yayını bulut tarafı yapacak; favori izin listesi ayrı adım). Dal `claude/project-thread-l6i9jq`, commit + push, force yok. Rezervasyon/ödeme/mesaj yok.

## Sonuç
Kısa özet: kaç aday müsait/eklendi, hangileri dolu, galeri sayıları, yeni data-id listesi, commit kimliği.
