#!/usr/bin/env python3
"""Build two isolated, progressively enhanced views in a single HTML document.

Listings remain in the document, including when scripts do not run. The builder
only reads the existing source data and never downloads or embeds remote photos.
"""
from __future__ import annotations

from merge_views import merge
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent


def scoped_map_script(script: str) -> str:
    """Scope the existing single-view map implementation to each generated view."""
    start = "  'use strict';\n"
    end = '})();\n'
    if script.count(start) != 1 or not script.endswith(end):
        raise ValueError('map.js structure changed; review the combined-view adapter')
    script = script.replace(start, start + '''  document.querySelectorAll('[data-berlin-view]').forEach(root => {
  const byId = name => root.querySelector(`[id="${root.dataset.idPrefix || ''}${name}"]`);
''', 1)
    script = re.sub(r"document\.querySelector\('#([\w-]+)'\)", r"byId('\1')", script)
    script = re.sub(r"dialog\.querySelector\('#([\w-]+)'\)", r"byId('\1')", script)
    script = script.replace('document.querySelectorAll(', 'root.querySelectorAll(')
    script = script.replace('document.querySelector(', 'root.querySelector(')
    script = script.replace("root.querySelectorAll('[data-berlin-view]')", "document.querySelectorAll('[data-berlin-view]')", 1)
    script = script.replace('document.addEventListener(', 'root.addEventListener(')
    # Once loaded by either view, the same Leaflet library can serve both maps.
    script = script.replace('if (window.L && leafletReady) return Promise.resolve(window.L);', 'if (window.L) return Promise.resolve(window.L);')
    return script[:-len(end)] + '  });\n' + end


def icon_sprite() -> str:
    """Embed the vendored Lucide icons once; cards reference them with <use>."""
    symbols = []
    for path in sorted((HERE / 'vendor' / 'lucide').glob('*.svg')):
        source = path.read_text(encoding='utf-8')
        match = re.search(r'<svg\b[^>]*>(.*)</svg>', source, flags=re.S)
        if not match or '<script' in source.lower():
            raise ValueError(f'Unexpected icon file: {path.name}')
        inner = ' '.join(match[1].split())
        symbols.append(f'<symbol id="i-{path.stem}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                       f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{inner}</symbol>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" '
            'aria-hidden="true" focusable="false">' + ''.join(symbols) + '</svg>')


def icon_mask_css() -> str:
    """Card icons are CSS masks: one decoded image per icon instead of an SVG tree per use (iOS memory)."""
    from urllib.parse import quote
    rules = ['span.i{display:inline-block;width:1em;height:1em;background-color:currentColor;'
             '-webkit-mask:var(--im) center/contain no-repeat;mask:var(--im) center/contain no-repeat}']
    for path in sorted((HERE / 'vendor' / 'lucide').glob('*.svg')):
        inner = ' '.join(re.search(r'<svg\b[^>]*>(.*)</svg>', path.read_text(encoding='utf-8'), flags=re.S)[1].split())
        svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" '
               f'stroke-linecap="round" stroke-linejoin="round">{inner}</svg>')
        rules.append(f'.i-{path.stem}{{--im:url("data:image/svg+xml,{quote(svg, safe=" =:/,.-")}")}}')
    return '<style>' + ''.join(rules) + '</style>'


def view_body(page: str, adults: int, liquid_script: str, map_script: str) -> str:
    prefix = f'p{adults}-'
    opening = '<div data-berlin-view data-id-prefix="">'
    script_tail = f'<script>{liquid_script}</script><script>{map_script}</script>'
    try:
        body = page.split('<body>', 1)[1].rsplit('</body>', 1)[0]
    except IndexError as exc:
        raise ValueError('Single-view document has no body') from exc
    if body.count(opening) != 1 or not body.endswith(script_tail):
        raise ValueError('Single-view document structure changed; review the combined-view adapter')
    body = body[:-len(script_tail)]
    ids = re.findall(r'(?<![\w-])id="([^"]+)"', body)
    if len(ids) != len(set(ids)):
        raise ValueError(f'{adults}-person view has duplicate IDs')
    id_set = set(ids)
    body = re.sub(r'(?<![\w-])id="([^"]+)"', lambda m: f'id="{prefix}{m[1]}"', body)
    body = re.sub(r'(?<![\w-])href="#([^"]+)"', lambda m: f'href="#{prefix}{m[1]}"' if m[1] in id_set else m[0], body)

    def references(match: re.Match[str]) -> str:
        attr, values = match.groups()
        return f'{attr}="' + ' '.join(prefix + value if value in id_set else value for value in values.split()) + '"'

    body = re.sub(r'(?<![\w-])(aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"', references, body)
    body = re.sub(r'<option value="(villa-daire|full-daire|full-villa)">', lambda m: f'<option value="{prefix}{m[1]}">', body)
    return body.replace(opening, f'<div class="party-view party-view-{adults}" data-berlin-view data-id-prefix="{prefix}">', 1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HERE / 'preview.html', help='Combined HTML output path')
    parser.add_argument('--favorites-endpoint', help='Verified Apps Script web-app endpoint; no group token')
    parser.add_argument('--availability-file', type=Path, default=HERE / 'availability-status.json')
    parser.add_argument('--live', action='store_true',
                        help='Canlı sürüm: önizleme yazıları çıkar, gerçek ortak favoriler zorunlu, '
                             'sayfa açılışta yanındaki availability-status.json dosyasını okur')
    args = parser.parse_args()
    if args.live and not args.favorites_endpoint:
        parser.error('--live için --favorites-endpoint gerekli; canlı sitede deneme favorisi kullanılmaz')
    liquid_script = (HERE / 'liquid.js').read_text(encoding='utf-8')
    map_script = (HERE / 'map.js').read_text(encoding='utf-8')
    css = (HERE / 'liquid.css').read_text(encoding='utf-8')
    map_css = (HERE / 'map.css').read_text(encoding='utf-8')
    gallery_css = (HERE / 'gallery-mobile.css').read_text(encoding='utf-8')
    gallery_script = (HERE / 'gallery-mobile.js').read_text(encoding='utf-8')
    cards_css = (HERE / 'cards.css').read_text(encoding='utf-8')
    map_css = map_css.replace('#map-canvas', '.map-canvas').replace('#card-dialog-content', '.card-dialog-content')
    if '</script' in (liquid_script + map_script + gallery_script).lower() or '</style' in (css + map_css + gallery_css + cards_css).lower():
        raise ValueError('Asset cannot be embedded safely')
    favorite_bootstrap = ''
    if args.favorites_endpoint:
        endpoint = urlsplit(args.favorites_endpoint)
        if (endpoint.scheme != 'https' or endpoint.netloc != 'script.google.com' or endpoint.query or endpoint.fragment
                or not re.fullmatch(r'/macros/s/[A-Za-z0-9_-]+/exec', endpoint.path)):
            raise ValueError('Expected an HTTPS Apps Script /exec endpoint without a query or fragment')
        transport = (HERE.parent / 'ortak-favoriler' / 'transport.js').read_text(encoding='utf-8')
        if '</script' in transport.lower():
            raise ValueError('Favorite transport cannot be embedded safely')
        endpoint_literal = json.dumps(args.favorites_endpoint).replace('<', '\\u003c')
        # Public anonymous favorites need no bearer token. Remove an old
        # token fragment from the address bar while preserving plan navigation.
        clean_fragment = r'''<script>(function(){try{if(!/(?:^#|[&?])fav=[A-Za-z0-9_-]{43}(?:&|$)/.test(location.hash))return;const route=location.hash.slice(1).split('?')[0];history.replaceState(history.state,'',location.pathname+location.search+(route&&!route.startsWith('fav=')?'#'+route:''))}catch(_){}})();</script>'''
        favorite_bootstrap = f'''{clean_fragment}<script>{transport}</script><script>(function(){{window.BerlinFavoritesEndpointConfigured=true;if(location.protocol==='https:')window.BerlinFavoritesTransport=window.createBerlinFavoritesTransport({endpoint_literal});}})();</script>'''
    else:
        # A prototype must never write test votes to the shared production list.
        favorite_bootstrap = '''<script>(function(){window.BerlinPrototype=true;window.BerlinFavoritesEndpointConfigured=true;let items=[];const key=x=>JSON.stringify([x.id,x.checkIn,x.checkOut]);window.BerlinFavoritesTransport={list:async()=>items.slice(),add:async x=>{if(!items.some(y=>key(x)===key(y)))items.push({...x,count:1,mine:true});return items.slice()},remove:async x=>{items=items.filter(y=>key(x)!==key(y));return items.slice()}};})();</script>'''
    views = {}
    with tempfile.TemporaryDirectory(prefix='berlin-views-') as temp_dir:
        for adults in (7, 6):
            path = Path(temp_dir) / f'{adults}.html'
            subprocess.run(['python3', str(HERE / 'build_liquid.py'), '--output', str(path)],
                           env={**os.environ, 'BERLIN_ADULTS': str(adults)}, check=True)
            views[adults] = view_body(path.read_text(encoding='utf-8'), adults, liquid_script, map_script)
    controls = '''
.party-selector{display:flex;align-items:center;justify-content:center;gap:8px;min-height:58px;padding:5px 12px;background:rgba(255,252,249,.96);border-bottom:1px solid #e5d8ce}
.party-selector span{font-size:13px;font-weight:700;margin-right:5px}
.party-selector a{padding:9px 17px;border:1px solid #ccbcb0;border-radius:999px;font-size:14px;font-weight:700;text-decoration:none}
.party-selector a:hover,.party-selector a:focus-visible{background:#88523f;border-color:#88523f;color:#fff}
.party-section>summary{padding:10px 20px;background:#e9ded4;border-bottom:1px solid #d8c7bb;cursor:pointer;font-weight:700}
.party-section:target>summary{background:#decabe}
@media(max-width:480px){.party-selector{min-height:50px}.party-selector a{padding:7px 15px}.party-selector span{font-size:12px}}
'''
    combined = merge(views[7], views[6])
    # Keep plan choices in the filter sidebar on desktop and readily available
    # above the results on small screens. Both menus address the same plans.
    plan_links = ('''<a href="#hepsi">Hepsi</a><a href="#p7-full-daire">Daire</a>'''
                  '''<a href="#p7-full-villa">Villa / Ev</a>'''
                  '''<a href="#p7-villa-daire">Daire + Villa / Ev</a>''')
    mobile_plans = f'<nav class="group-nav plan-nav-mobile" aria-label="Konaklama planı">{plan_links}</nav>'
    combined, nav_count = re.subn(r'<nav class="group-nav"[^>]*>.*?</nav>',
                                  lambda _: mobile_plans, combined, count=1, flags=re.S)
    if nav_count != 1:
        raise ValueError('Konaklama planı menüsü bulunamadı')
    new_filter = '''<div class="new-filter-row" id="p7-new-filter-row"><button type="button" class="new-filter" id="p7-new-filter" aria-pressed="false">Son Eklenenler</button><span id="p7-new-filter-status" role="status" aria-live="polite"></span></div>'''
    combined, new_count = re.subn(r'<div class="new-filter-row"[^>]*>.*?</div>',
                                  lambda _: new_filter, combined, count=1, flags=re.S)
    if new_count != 1:
        raise ValueError('Son eklenenler filtresi bulunamadı')
    combined = combined.replace('2 Gece Daire + 2 Gece Villa', 'Daire + Villa / Ev')
    availability = json.loads(args.availability_file.read_text(encoding='utf-8'))
    if availability.get('version') != 1 or not isinstance(availability.get('records'), list):
        raise ValueError('Müsaitlik kaydı beklenen şemada değil')
    keys = set()
    for record in availability['records']:
        if (not isinstance(record, dict) or record.get('scope') not in ('card', 'offer')
                or record.get('status') not in ('available', 'unavailable')
                or record.get('adults') not in (6, 7) or isinstance(record.get('adults'), bool)
                or not isinstance(record.get('id'), str) or not record['id'].strip()
                or not isinstance(record.get('evidence'), str) or not record['evidence'].strip()):
            raise ValueError('Kaynaklı müsaitlik kaydı eksik')
        date.fromisoformat(record['checkIn']); date.fromisoformat(record['checkOut'])
        timestamp = datetime.fromisoformat(record['checkedAt'])
        if timestamp.tzinfo is None or urlsplit(record.get('sourceUrl', '')).scheme != 'https':
            raise ValueError('Müsaitlik kaydında saat dilimi veya HTTPS kaynak eksik')
        if 'lastAvailableAt' in record:
            # Optional: the last dated check that still found the offer available.
            previous = datetime.fromisoformat(record['lastAvailableAt'])
            if record['status'] != 'unavailable' or previous.tzinfo is None or previous > timestamp:
                raise ValueError('lastAvailableAt yalnız müsait olmayan kayıtta, saat dilimli ve kontrol zamanından önce olmalı')
        key = tuple(record[k] for k in ('scope', 'id', 'checkIn', 'checkOut', 'adults'))
        if key in keys:
            raise ValueError('Müsaitlik kaydı tekrarlanıyor')
        keys.add(key)
    status_json = json.dumps(availability, ensure_ascii=False).replace('<', '\\u003c')
    preview_strip = '' if args.live else '''<div class="prototype-strip"><b>ÖNİZLEME</b><span>Bu sürüm canlı siteden ayrıdır. Filtreler ve müsaitlik görünümü deneme içindir.</span></div>'''
    # The live page explains the grey, crossed-out card; the preview shows a sample.
    status_legend = ('<b>Gri ve Çarpılı Kart</b><small>Son günlük kontrolde bu tarihler müsait değildi.</small>' if args.live
                     else '<b>Bu Tarihlerde Müsait Değil</b><small>Örnek görünüm: Bir ilanın gerçek durumu değildir.</small>')
    prototype_controls = preview_strip + '''
    <button type="button" class="mobile-filter-toggle" aria-expanded="false" aria-controls="prototype-filters">☷ Filtreler <span class="active-filter-count"></span></button><div class="results-layout">
    <aside id="prototype-filters" class="filter-panel" aria-label="Konaklama filtreleri"><div class="filter-panel-heading"><div><b>Filtreler</b><small>Seçtikçe sonuçlar güncellenir</small></div><button type="button" class="filters-clear">Temizle</button></div>''' + f'''
      <div class="plan-filter"><b>Konaklama Planı</b><nav class="group-nav plan-nav-sidebar" aria-label="Konaklama planı">{plan_links}</nav><p class="plan-hint">İlk 2 gece daire, son 2 gece villa/ev. İki ayrı rezervasyon.</p></div>''' + '''
      <div class="filter-fields">
        <label>Kişi Başı Paylaşım<select class="filter-guests"><option value="6">6 Kişiye Böl</option><option value="7">7 Kişiye Böl</option></select></label>
        <label>Gösterilen Fiyat<select class="filter-price"><option value="all">Fiyat Sınırı Yok</option><option value="3300">En Çok 3.300 €</option><option value="4000">En Çok 4.000 €</option><option value="5000">En Çok 5.000 €</option><option value="6000">En Çok 6.000 €</option></select></label>
        <label>Tresor’a Araçla<select class="filter-travel"><option value="all">Tüm Süreler</option><option value="15">En Çok 15 dk</option><option value="20">En Çok 20 dk</option><option value="30">En Çok 30 dk</option><option value="35">En Çok 35 dk</option><option value="45">En Çok 45 dk</option></select></label>
        <label>Müsaitlik<select class="filter-availability"><option value="all">Tüm Durumlar</option><option value="available">Yalnız Müsait Görünenler</option><option value="hide-unavailable">Müsait Olmayanları Gizle</option><option value="unavailable">Yalnız Müsait Olmayanlar</option><option value="missed">Yalnız Kaçırılanlar</option></select></label>
      </div>
      <div class="check-filters">
        <fieldset class="check-filter" data-filter="capacity"><legend>İlan Kapasitesi</legend><div class="check-options"><label><input type="checkbox" value="6">Tam 6 kişilik</label><label><input type="checkbox" value="7">7 kişi ve üzeri</label></div></fieldset>
        <fieldset class="check-filter check-grid" data-filter="rooms"><legend>Yatak Odası</legend><div class="check-options"><label><input type="checkbox" value="1">1</label><label><input type="checkbox" value="2">2</label><label><input type="checkbox" value="3">3</label><label><input type="checkbox" value="4">4</label><label><input type="checkbox" value="5" data-chip="5 ve üzeri">5+</label></div></fieldset>
        <fieldset class="check-filter check-grid" data-filter="baths"><legend>Banyo Sayısı</legend><div class="check-options"><label><input type="checkbox" value="1">1</label><label><input type="checkbox" value="2">2</label><label><input type="checkbox" value="3" data-chip="3 ve üzeri">3+</label><label class="check-wide"><input type="checkbox" value="unknown">Teyitsiz / çelişkili</label></div></fieldset>
        <fieldset class="check-filter" data-filter="features"><legend>Özellikler</legend><div class="check-options"><label><input type="checkbox" value="separate-beds">Herkese ayrı yatak</label><label><input type="checkbox" value="separate-wc">Ayrı WC</label></div></fieldset>
      </div><p class="filter-explainer">Kapasite ve fiyat teyidi değildir. Aynı başlıkta birden çok kutu seçilirse herhangi birine uyanlar, Özellikler’de seçilenlerin hepsine uyanlar gösterilir. Banyo sayısı tam banyodur; yarım banyo ve ayrı WC sayılmaz. Banyo kutusu seçiliyken, banyo sayısı kaynakta çelişkili ya da teyitsiz ilanlar yalnız “Teyitsiz / çelişkili” de seçilirse görünür. Müsaitlik seçimi son günlük kontrole dayanır; kontrol edilmemiş ilanlar yalnız “Müsait Olmayanları Gizle”de kalır. Kaçırılan, önce müsait görünüp sonra kapanan ilandır. Kişi başı tutar gösterilen fiyatın paylaşımıdır. İki duraklı planda fiyat her konaklama için ayrı uygulanır.</p><p class="filter-results" aria-live="polite"></p>
      <div class="status-example"><span class="status-example-visual" aria-hidden="true">×</span><span>''' + status_legend + '''</span></div>
      <button type="button" class="mobile-filter-done">Sonuçları Gör</button></aside><div class="results-content">'''
    marker = '<p class="best-criteria">'
    if combined.count(marker) != 1:
        raise ValueError('Filtrelerin ekleneceği alan bulunamadı')
    combined = combined.replace(marker, prototype_controls + marker, 1)
    if combined.count('<footer class="footer">') != 1:
        raise ValueError('Filtre yerleşimi sonu bulunamadı')
    combined = combined.replace('<footer class="footer">', '</div></div><footer class="footer">', 1)
    combined = combined.replace('Grubumuz altı kişi. Kişi başı tutarlar gösterilen toplamın altıya bölünmesidir.', 'Grubumuz 6 veya 7 kişi olabilir. Kişi başı tutarlar gösterilen toplamın seçilen kişi sayısına bölünmesidir.')
    combined = combined.replace('Teklifler altı yetişkin için alınmıştır;', 'Teklifler 6 veya 7 yetişkin için ayrı alınmıştır;')
    combined = combined.replace('Tresor’a araçla genellikle en çok 30 dakika; 4.000 € üzerindeki toplamlar için altı ayrı yatağı doğrulanmış seçeneklerde en çok 35 dakika.', 'Daireler Tresor’a yaklaşık 30 dakikaya kadar. Evlerde 45 dakikaya kadar olanlar kartlarında belirtilir; 4.000 € üzerindeki seçeneklerde en çok 35 dakika ve herkese ayrı yatak aranır.')
    combined = combined.replace('· 6 Kişi</span>', '· 6 veya 7 Kişi</span>')
    combined = combined.replace('6 Kişi · 4 Gece · En Çok 6.000 € · 6 Ayrı Yatak', '6 veya 7 Kişi · 4 Gece · Ayrı Yatak Öncelikli')
    combined = combined.replace('30 Aralık 2026 → 3 Ocak 2027 · 6 Yetişkin</span>', '30 Aralık 2026 → 3 Ocak 2027 · 6 veya 7 Yetişkin</span>')
    combined = combined.replace('6 Yetişkin · 4 Gece · En Çok 6.000 € · 6 Ayrı Yatak Öncelikli', '6 veya 7 Yetişkin · 4 Gece · Ayrı Yatak Öncelikli')
    combined = combined.replace('>6 Ayrı Yatak ve Tresor</option>', '>Ayrı Yatak ve Tresor</option>')
    combined = combined.replace('Kişi başı pay, gösterilen toplamın altıya bölünmesidir.', 'Kişi başı pay, gösterilen toplamın seçilen kişi sayısına bölünmesidir; bu hesap yeni bir fiyat teklifi değildir.')
    combined = combined.replace('Kaynak gözlemleri: 5 ve 6 Kasım 2026.', 'Önceki kaynak gözlemleri: 5 ve 6 Kasım 2026; son kontroller ilgili kartlarda gösterilir.')
    title = 'Berlin Konaklamaları | 30 Aralık – 3 Ocak' if args.live else 'Berlin Konaklamaları | Önizleme'
    # Live: the embedded snapshot shows at once, then the page reads the daily
    # availability-status.json published next to it, so a daily check needs no rebuild.
    live_source = ' data-live-src="availability-status.json"' if args.live else ''
    # Large-view panels stay as script text until a card is opened (see
    # build_liquid.py and liquid.js BerlinInflateMore).
    starts, ends = combined.count('\u27e6card-more\u27e7'), combined.count('\u27e6/card-more\u27e7')
    if starts != ends or not starts:
        raise SystemExit(f'Ayrıntı paneli işaretleri eşleşmiyor: {starts}/{ends}')
    combined = re.sub('\u27e6card-more\u27e7(.*?)\u27e6/card-more\u27e7',
                      lambda m: f'<script type="text/x-card-more" class="card-more-src">{m.group(1)}</script>',
                      combined, flags=re.S)
    page = f'''<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>{css}\n{map_css}\n{controls}\n{gallery_css}\n{cards_css}</style></head><body>
{icon_sprite()}{icon_mask_css()}{combined}<script type="application/json" id="availability-data"{live_source}>{status_json}</script>{favorite_bootstrap}<script>{liquid_script}</script><script>{scoped_map_script(map_script)}</script><script>{gallery_script}</script></body></html>'''
    # Hash the full pre-meta document to avoid a circular hash; it changes
    # whenever listings, styles, scripts, or the configured transport change.
    release = hashlib.sha256(page.encode('utf-8')).hexdigest()[:16]
    page = page.replace('<meta charset="utf-8">', f'<meta charset="utf-8"><meta name="berlin-release" content="{release}">', 1)
    # A visible version mark: tells which copy a phone actually opened.
    page = page.replace('</body></html>', f'<p class="release-mark">Sürüm {release[:8]}</p></body></html>', 1)
    args.output.write_text(page, encoding='utf-8')
    print('Combined bytes:', len(page.encode('utf-8')), 'output:', args.output)


if __name__ == '__main__':
    main()
