# Kaynaklar ve güvenilirlik | 11.11.2026 taraması

Önceki taramalarda kullanılan platformlar (Airbnb, Booking.com, Vrbo/FeWo-direkt, Holidu, Google tatil kiralıkları, HomeToGo, Traum-Ferienwohnungen, e-domizil, Ferienhausmiete.de, Travanto, Casamundo/Belvilla) yerleşik platformlardır. Bu taramada **ilk kez** kullanılan veya bakılan siteler ve gerekçeleri:

| Site | Durum | Güvenilirlik gerekçesi |
|---|---|---|
| plumguide.com | Tarandı, aday yok | Londra merkezli, evleri tek tek denetleyen yerleşik platform; ödeme platform üzerinden, ev sahibi iptalinde yeniden yerleştirme güvencesi. Berlin'deki 3+ odalı evleri 6 ayrı yatak vermiyor; bu tarihlerde 6 kişi için müsait yok. |
| primeflats.de | Tarandı, aday yok | Berlin merkezli apart işletmesi (2016'dan beri); sitede Impressum, AGB, Datenschutz var; rezervasyon Beds24 motoruyla, havale zorunluluğu yok, 14 güne kadar ücretsiz iptal. Uygun tek birim (Apartment Puder) 30.12'de dolu. |
| guest.arbio.com | Yalnız aynı mülk tespiti | Arbio, Berlin merkezli profesyonel kısa dönem kiralama işletmecisi; kendi rezervasyon sitesi, Google Vacation Rentals ortağı. |
| Expedia / Hotels.com | Erişilemedi | Yerleşik platformlar (Expedia Group); bot doğrulaması ve HTTP/2 hatası nedeniyle taranamadı. |
| Agoda | Erişilemedi | Booking Holdings; arama hata verdi. |

Notlar:
- Traum-Ferienwohnungen (HomeToGo grubu, DFV sertifikalı, künyeli) yerleşik bir platform, ancak tek aday ilanında (93211) ödeme doğrudan ev sahibine (havale/PayPal/nakit) yapılıyor ve platform ödeme koruması yok. Aday `guvenilirlikRiski: true` ile işaretlendi.
- Booking.com, Playwright'ta Türkiye kaynaklı kısıt nedeniyle tarih/fiyat göstermedi; arama ve müsaitlik kontrolü Claude masaüstü uygulamasının yerleşik tarayıcı panelinden yapıldı (user-agent değiştirilmedi, bot kontrolü aşılmadı).
- Erişilemeyen, zorlanmayan siteler: Holidu (headless'ta fiyat yüklenmiyor), HomeToGo, e-domizil, Casamundo (Cloudflare), Vrbo/FeWo-direkt aramaları (bot doğrulaması), Belvilla (sayfa yok).
