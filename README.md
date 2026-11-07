# Berlin Konaklamaları | Filtreli Prototip

Bu dal geliştirme ve önizleme içindir. GitHub Pages canlı sürümü `main` dalından sunar. Bu daldaki değişiklikler kendiliğinden canlı siteye geçmez. Canlıya aktarmadan önce kullanıcının prototipi görmesi ve açık yayın onayı vermesi gerekir.

## Çalıştırma

Python 3 dışında bağımlılık gerekmez:

```sh
python3 redesign-prototip/build_combined.py --output index.html
python3 -m http.server 8000
```

Tarayıcıda `http://localhost:8000/` adresini açın. `index.html`, bu dalda derlenmiş prototiptir. Görseller ve harita kütüphaneleri kaynak servislerden yüklenir, bu yüzden internete erişim gerekir.

## Kaynaklar

- `redesign-prototip/`: arayüz, harita, galeri, üreticiler, kurallar ve fiyat/yatak/konum verileri.
- `six/prepared/`, kökteki `galeri-veri.json` ve `bolunmus-*.json`: üreticinin kullandığı tarihli ilan verileri.
- `redesign-prototip/availability-status.json`: kaynak, tarih, kişi ve sağlayıcı bazında doğrulanmış en son gözlemler. 7 Kasım verileri tüm ilanların kontrol edildiği anlamına gelmez.
- `ortak-favoriler/transport.js`: gerçek ortak favori bağlantı kodu. Varsayılan prototip yalnız oturum içi deneme favorisi kullanır; gerçek beğenileri okumaz veya değiştirmez.

Özgün yerel araştırma dosyalarına ait mutlak yol önekleri bu Git kopyasında `./` olarak göreli hale getirildi. Bazı tarihsel kanıt dosyaları Git kopyasına alınmamıştır; bunlar yerel araştırma klasöründedir.

## Eşitleme ve sınırlar

Bu dal, 7 Kasım 2026 yerel prototipinin GitHub çalışma kopyasıdır. Bilgisayardaki eski önizleme ve günlük kontrol kaynağı `Projects/Skills-ve-MCPler/denemeler/berlin-konaklama-arama` altında kalır; bu iki kopya otomatik eşitlenmez. Değişiklikleri taşımadan önce iki taraftaki en son sürümü ve ortak beğenilerin korunmasını kontrol edin. Yeni bulunan ilanlar, kullanıcı seçmeden prototipe veya canlı siteye eklenmez. Fiyat ve müsaitlik değişebilir; kişi kapasitesi tek başına fiyat veya müsaitlik kanıtı değildir.
