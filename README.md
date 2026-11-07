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
- `redesign-prototip/cards.css`: standart boylu, liquid glass kart katmanı. Kartta yalnız fotoğraf, fiyat, kişi başı pay, yatak, Tresor/RSO süresi, oda ve en önemli uyarı görünür; diğer bilgiler kartın `.card-more` bölümünde durur ve büyük görünümde sekmelerle (Özet, Yataklar, Ulaşım, Fiyat, Notlar, Kaynaklar) açılır. JavaScript yoksa tüm bölümler kartta sırayla görünür.
- `redesign-prototip/vendor/lucide/`: kartlardaki ikonlar (Lucide, ISC lisansı). Üretici bunları sayfaya bir kez gömer; ağ erişimi gerekmez.
- `six/prepared/`, kökteki `galeri-veri.json` ve `bolunmus-*.json`: üreticinin kullandığı tarihli ilan verileri.
- `redesign-prototip/verified-full-galleries.json`: ilan sayfasında görülen tam galeriler. Booking görselleri sayfadaki `?k=` imzasıyla birlikte kaydedilmelidir; Booking imzasız adrese 401 döndürür ve kartta fotoğraf açılmaz. Üretici imzasız Booking görseli bulursa durur (7 Kasım 2026'da üç ilanda bu yüzden fotoğraf görünmedi).
- `redesign-prototip/availability-status.json`: kaynak, tarih, kişi ve sağlayıcı bazında doğrulanmış en son gözlemler. 7 Kasım verileri tüm ilanların kontrol edildiği anlamına gelmez.
- `ortak-favoriler/transport.js`: gerçek ortak favori bağlantı kodu. Varsayılan prototip yalnız oturum içi deneme favorisi kullanır; gerçek beğenileri okumaz veya değiştirmez.

Özgün yerel araştırma dosyalarına ait mutlak yol önekleri bu Git kopyasında `./` olarak göreli hale getirildi. Bazı tarihsel kanıt dosyaları Git kopyasına alınmamıştır; bunlar yerel araştırma klasöründedir.

## Canlıya yayın

7 Kasım 2026'da kullanıcının açık onayıyla bu daldaki filtreli arayüz `main` dalına, yani GitHub Pages'e alındı. `main` yalnız yayın dosyalarını tutar: `index.html` ve günlük müsaitlik için `availability-status.json` (eski `availability-status.js/.css` dosyaları yeni sayfada kullanılmaz). Sonraki her canlı güncelleme de kullanıcının açık onayını ister.

Canlı sayfa şöyle derlenir; `--live` önizleme yazılarını kaldırır ve gerçek ortak favori servisini zorunlu kılar:

```sh
git fetch origin main
git show origin/main:availability-status.json > /tmp/availability-status.json
python3 redesign-prototip/build_combined.py --live \
  --favorites-endpoint "$(git show origin/main:index.html | grep -o 'https://script.google.com/macros/s/[A-Za-z0-9_-]*/exec' | head -1)" \
  --availability-file /tmp/availability-status.json --output /tmp/index.html
```

Ardından yalnız `/tmp/index.html`, güncel `main` üzerinde `index.html` olarak işlenir; `main` dalına bu daldaki kaynak klasörler taşınmaz. Yayından önce canlıdaki her kartın `data-id`, `data-check-in`, `data-check-out` üçlüsünün yeni sayfada bulunduğu kontrol edilir; ortak favoriler bu üçlüyle tutulur. Bir ilan kaldırılırsa ona verilmiş beğeniler sayfada görünmez olur.

Günlük müsaitlik: Canlı sayfa açılışta yanındaki `availability-status.json` dosyasını önbelleksiz okur ve kartları ona göre günceller. Günlük kontrolün canlıya yansıması için `main` dalında yalnız bu dosyanın güncellenmesi yeterlidir; `index.html` yeniden üretilmez. Bilgisayardaki eski canlı üretici artık kullanılmamalıdır; o üretici `index.html` dosyasını eski görünümle değiştirir. Yeni ilan veya arayüz değişikliği önce bu dalda yapılır, sonra onayla canlıya derlenir.

Kur: Fiyatlar kaynaktaki para biriminde gösterilir; yanında euro ve TL karşılığı (dolar fiyatında ikisi) yazar. Sayfa her açılışta Frankfurter üzerinden günün ECB referans kurunu (`api.frankfurter.dev/v1/latest`) alır ve tüm ≈ tutarları, TL fiyatlı ilanların filtre ve sıralamadaki euro değerini buna göre günceller. Kur alınamazsa tarayıcıdaki son kur, o da yoksa derlemedeki referans kur (`build_liquid.py` içindeki `TRY_PER_EUR`) kullanılır. "En uygun" etiketleri derleme anındaki kurla belirlenir.

Kişi sayısı: Ev ve daireler bütün olarak kiralandığı için gösterilen fiyat 6 ve 7 kişi için aynı kabul edilir (7 Kasım 2026 kullanıcı kararı). Ayrıntı `redesign-prototip/MUSAITLIK.md` içindedir.

Harita: İki işaret türü vardır. Konaklama, noktanın üstünde fiyat etiketidir; ortak favori kiremit renkte ve kalp ile beğeni sayısını taşır, son kontrolde dolu olan gri ve fiyatı çizili görünür. Kulüp gökkuşağı halkalı yuvarlak işarettir; Tresor ve RSO daha büyük ve koyu çerçevelidir. Etiketler üst üste binmez: yer yoksa ilan yalnız nokta olarak kalır, yakınlaştırınca etiketi açılır. İşarete dokununca haritanın üstünde kısa ilan kartı açılır (beğen, ayrıntılar, ilan bağlantısı); "Yalnız Favoriler" düğmesi haritayı ortak favorilere indirir.

Açık filtreler: Kenar paneldeki seçimler, En Uygun Daire/Villa ve Son Eklenenler sonuçların üstünde etiket olarak listelenir; her etiket tek dokunuşla kaldırılır. Favoriler görünümünde filtre bazı favorileri gizliyorsa kaç tanesinin gizlendiği yazılır.

## Eşitleme ve sınırlar

Bu dal, 7 Kasım 2026 yerel prototipinin GitHub çalışma kopyasıdır. Bilgisayardaki eski önizleme ve günlük kontrol kaynağı `Projects/Skills-ve-MCPler/denemeler/berlin-konaklama-arama` altında kalır; bu iki kopya otomatik eşitlenmez. Değişiklikleri taşımadan önce iki taraftaki en son sürümü ve ortak beğenilerin korunmasını kontrol edin. Yeni bulunan ilanlar, kullanıcı seçmeden prototipe veya canlı siteye eklenmez. Fiyat ve müsaitlik değişebilir; kişi kapasitesi tek başına fiyat veya müsaitlik kanıtı değildir.
