# Görev 3 | 12 Kasım 2026: 20 yeni ilanı canlıya al

Kullanıcı onayı: "Available ise koy" (12.11 22:39 TR) ve "uykuda değil ekle hepsini" (12.11 23:09 TR). Bu onay yalnız 20 `sweep12-*` kartının canlıya eklenmesi ve favori izin listesine yazılması içindir. Dolu ilanların çıkarılma biçimi ve Locke sorusu hâlâ yanıtsız; onlara dokunma.

Bulut denetimi (5f9b3bd): canlıdaki 124 üçlünün tamamı yeni derlemede var, 20 yeni üçlü eklendi (toplam 144). Yeni kartlarda `user/` / `AirbnbPlatformAssets/` görseli yok. (Eski 5 Airbnb kartındaki 170 ilgisiz görsel `claude/project-thread-thj3xb` dalında ayrıca düzeltiliyor; bu yayında onlara dokunma.)

## Adımlar
1. `prototip/filtreli-arayuz`'u çek; `claude/project-thread-l6i9jq`'yu ona birleştir (fast-forward ya da normal merge; force yok). Çakışma olursa iki tarafı da koru, dur ve bildir. Push et.
2. README "Canlıya yayın" komutuyla `--live` derle (favori uç noktası ve `availability-status.json` güncel main'den).
3. Yayın öncesi kontrol: güncel main `index.html`'deki her (data-id, giriş, çıkış) üçlüsü yeni sayfada olmalı; yeni sayfadaki sürüm/kart sayısını yaz.
4. Güncel `origin/main` üzerinde yalnız `index.html`'i değiştir, commit ("Canlı: 20 yeni daire (12 Kasım taraması)") ve push et. main'e başka dosya taşıma.
5. Favori izin listesi (memory/README: `~/Projects/berlin-clasp`): clasp pull → yerel git yedeği → yeni sayfadaki üçlülerden `PUBLIC_ITEMS`'te olmayanları hesapla → yalnız onları tek `PUBLIC_ITEMS.push` bloğuyla ekle → clasp push → `clasp deploy -i <mevcut deploymentId>` (yeni dağıtım AÇMA, /exec değişmemeli). public-list `ok:true` dönmeli. Test oyu yazma.
6. Sonuç: main commit kimliği, prototip commit kimliği, eklenen üçlü sayısı, dağıtım sürümü, public-list sonucu.
