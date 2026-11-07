# Berlin konaklama prototipi

- Bu dal (`prototip/filtreli-arayuz`) prototipin ortak geliştirme alanıdır. Kullanıcı açıkça canlı yayın onayı vermeden `main` dalını değiştirme, bu dala birleştirme veya GitHub Pages'e yayın yapma.
- Kod değiştirmeden önce `README.md`, geçerli dalı ve çalışma ağacının durumunu incele; başka ajanın veya kullanıcının değişikliklerini koru.
- `index.html` üretilen prototiptir. Kaynak arayüz ve üreticiler `redesign-prototip/`, veri girdileri `six/prepared/` ve kökteki ilgili JSON dosyalarındadır. Güncel çıktı için `python3 redesign-prototip/build_combined.py --output index.html` çalıştır.
- Varsayılan prototip beğenileri yalnız denemedir. Gerçek ortak favorileri değiştirme veya üretim servisine test oyu gönderme.
- Kaynak tarihini, yetişkin sayısını, fiyat kapsamını ve konaklama/sağlayıcı kimliğini ayrı koru. Eski gözlemi güncel müsaitlik gibi sunma; kullanıcı seçmeden yeni adayları rehbere ekleme.
- Kullanıcının yerel günlük kontrolü ve önizlemesi bu Git kopyasıyla otomatik eşitlenmez. Bunlardan veri aktarılacaksa önce her iki tarafın güncel durumunu karşılaştır; kaynak ve kapsamı koru.
- 7 Kasım 2026: Kullanıcı onayıyla bu dalın arayüzü canlıya alındı. Canlı derleme ve `main` yayın kuralları `README.md` içindeki "Canlıya yayın" bölümündedir. Günlük müsaitlik kontrolü `main` dalında yalnız `availability-status.json` dosyasını günceller; canlı `index.html` dosyasını eski yerel üreticiyle yeniden yazma.
