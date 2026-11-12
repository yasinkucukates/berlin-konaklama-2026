# Görev 4 | 12 Kasım 2026: 20 sweep12 üçlüsünü favori izin listesine ekle

Canlı yayın yapıldı (main 19ea9b2, galeri dalı thj3xb'den; 144 kart). main'e veya prototip dalına dokunma, yeni yayın yapma.
Kullanıcı onayı: "canlıya al" (12.11.2026 23:28 TR) — favorilerin bu kartlarda çalışması yayının parçası.

Üçlüler: `sweep12-ucluler.txt` (data-id, giriş, çıkış; 20 satır).

Adımlar (`~/Projects/berlin-clasp`): clasp pull → yerel git yedeği → bu 20 üçlüden `PUBLIC_ITEMS`'te olmayanları hesapla → yalnız onları tek `PUBLIC_ITEMS.push` bloğuyla `Kod.gs` sonuna ekle (mevcut blok biçimini taklit et) → clasp push → `clasp deploy -i <mevcut deploymentId>` (yeni dağıtım AÇMA, /exec main index.html'deki adresle aynı kalmalı) → public-list ok:true ve 20 üçlünün listede döndüğünü kontrol et. Test oyu yazma.
Sonuç: eklenen üçlü sayısı, dağıtım sürümü (@N), public-list sonucu.
