#!/usr/bin/env python3
"""Build a self-contained, progressively enhanced Berlin comparison preview.

Sources stay untouched. Eligibility is fail-closed and matched by id and dates.
Remote photos remain ordinary links to the listing provider; they are never cached.
"""
from __future__ import annotations

from photo_catalog import apply_verified_galleries, expand, identity, verified_galleries
import html
import argparse
import json
import math
import os
import re
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

HERE = Path(__file__).resolve().parent
ADULTS = int(os.environ.get('BERLIN_ADULTS', '7'))
if ADULTS not in (6, 7):
    raise ValueError('Yetişkin sayısı 6 veya 7 olmalı')
DATA = HERE.parent / 'six' / 'prepared' if ADULTS == 6 else HERE.parent
META = HERE / 'six' if ADULTS == 6 else HERE
ELIGIBILITY = META / 'eligibility.json'
ROUTES = META / 'routes-normalized.json'
PAIRS = META / 'price-pairs.json'
BUDGET = META / 'budget-normalized.json'
TITLES = META / 'titles-tr.json'
PHOTO_SHARDS = () if ADULTS == 6 else (HERE / 'photos-houses.json', HERE / 'photos-apartments.json', HERE / 'photos-booking.json')
MAP_POINTS = META / 'map-points.json'
BED_AUDIT = HERE / 'bed-audit.json'
BED_BREAKDOWNS = HERE / 'bed-breakdowns.json'
BED_ROOM_FILES = (HERE / 'bed-rooms.json', HERE / 'bed-rooms-extra-houses.json',
                  HERE / 'bed-rooms-extra-apts.json', HERE / 'bed-rooms-sweep-20261106.json',
                  HERE / 'bed-rooms-sweep-20261107.json', HERE / 'bed-rooms-sweep-20261108.json')
# English/German room and bed words copied from listing pages (7 Nov sweep).
FOREIGN_BED_TEXT = re.compile(r'\b(?:bed|beds|bedroom|living room|sofa bed|bunk|couch|couches|crib|mattress|mattresses|single|double'
                              r'|Bett|Betten|Einzelbett\w*|Doppelbett\w*|Schlafzimmer|Wohnzimmer|Queensize|Schlafsofa)\b', re.I)
# From the 7 November sweep on, sweep rows keep the provider's name as
# originalName and need a reviewed Turkish card title in titles-tr.json.
TITLE_REQUIRED_FROM = 'galeri-sweep-20261107.json'
# Same image uploaded more than once to a listing, found by a visual check on
# 7 November (exact file or the same frame with tiny exposure/crop changes).
PHOTO_DUPLICATES = HERE.parent / 'six' / 'prepared' / 'foto-mukerrer-20261107.json'
# Airbnb pages also carry host/reviewer portraits (im/pictures/user/) and the
# review-summary icons (AirbnbPlatformAssets). On 10-11 November they were
# collected as listing photos; they are never photos of the stay.
# Images that are not photos of the stay (city sights, info cards, maps),
# found by the 12 November visual check of every gallery.
NON_LISTING_LIST = HERE.parent / 'six' / 'prepared' / 'foto-ilgisiz-20261112.json'
NON_LISTING_PHOTO = re.compile(r'a0\.muscache\.com/im/pictures/(?:user/|AirbnbPlatformAssets|airbnb-platform-assets)', re.I)
OUT = HERE / ('preview-six.html' if ADULTS == 6 else 'preview-seven.html')
FOUR_IN, FOUR_OUT = '2026-12-30', '2027-01-03'
MONTHS = {11: 'Kasım', 12: 'Aralık', 1: 'Ocak'}
CATEGORIES = {'apartment', 'villa', 'private_house', 'multiunit'}
USD_PER_EUR = Decimal('1.1224')
TRY_PER_EUR = Decimal('56.1729')
GENERAL_CAP_EUR = Decimal('6000')
PREMIUM_THRESHOLD_EUR = Decimal('4000')
BEST_CAP_EUR = Decimal('3300')
# Kullanıcı isteğiyle, ev sahibi yanıtı gerektiren dört gecelik teklif listeden
# çıkarılır. Kaynak kaydı korunur: ../ikinci-dalga-yerel.md, Schönefeld bölümü.
AVAILABILITY_EXCLUSIONS = {
    (7, 'schonefeld-tesla', '2026-12-30', '2027-01-03'),
    # Booking displayed no availability for either six or seven adults on
    # 6 November. Keep the historical source record, not the stale card.
    (6, 'brusseler-kiez', '2026-12-30', '2027-01-03'),
    (7, 'brusseler-kiez', '2026-12-30', '2027-01-03'),
}
EXCLUDED_LISTING_IDS = {'1231775696843779125'}
# Source: Holidu 65364918 describes Frohburg near Leipzig and explicitly
# places Berlin roughly 2.5 hours away. The earlier location was wrong.
HARD_DISTANCE_EXCLUSIONS = {'bolunmus-ottenhain': 'Leipzig / Frohburg; kaynakta Berlin yaklaşık 2,5 saat'}
# This conditional listing has non-budget review warnings and a disputed
# third-room count. Two independent photo reviews establish at least seven
# normal beds; the warnings remain visible on its card. Do not generalize this
# exception to other conditional listings with unresolved property conditions.
CONDITIONAL_SIX_BED_PROOF_IDS = {'12541792'}
# The user liked this particular sauna house and accepted its longer route as
# a separate exception.  Keep its original dated IDs for the favorites service.
RUEBEZAHL_EXCEPTION_KEYS = {
    ('six-vrbo-145069-full', '2026-12-30', '2027-01-03'),
    ('six-vrbo-145069-last', '2027-01-01', '2027-01-03'),
}
# 13 Erle, 15 Zeder and 20 Mohn (Travanto 809908/809910/809914) were folded
# into the 145069 comparison table on 6 November. On 7 November the user chose
# to show them again as their own cards, under their original dated IDs.



def bath_facts(value):
    """Full bathrooms and a separate WC, only where the listing text is unambiguous.

    A half bath (1,5) or an extra WC is not a full bathroom. Contradictory or
    vague source text stays unknown instead of being guessed.
    """
    text = str(value if value is not None else '').strip()
    if not text or re.search(r'^Teyitsiz|kaynak çelişkili|belirsiz|^En az', text, re.I):
        return None, False
    match = re.match(r'(\d+)(?:[.,](\d))?', text)
    if not match:
        return None, False
    full = int(match.group(1))
    separate_wc = bool(match.group(2) and match.group(2) != '0') or bool(
        re.search(r'ayrı WC|tam \+ (?:1 )?WC|\+ 1 WC', text, re.I))
    return (full if full > 0 else None), separate_wc

def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))


def esc(value):
    text = str(value if value is not None else '')
    # "Normal yatak" was an internal shorthand for a bed other than a sofa.
    # Visitors need the actual type from the room breakdown instead.
    text = re.sub(r'(?i)\bnormal\s+(?=(?:tek\s+|çift\s+)?yatak)', '', text)
    return html.escape(text, quote=True)


def icon(name):
    """Reference a Lucide symbol embedded once by build_combined.py."""
    return f'<span class="i i-{name}" aria-hidden="true"></span>'


def safe_url(value):
    if not isinstance(value, str):
        return ''
    parsed = urlsplit(value)
    return value if parsed.scheme in ('http', 'https') and parsed.netloc else ''


def key(row):
    return (str(row.get('id', '')), row.get('checkIn', ''), row.get('checkOut', ''))


def ruebezahl_exception(row):
    return (ADULTS == 6 and key(row) in RUEBEZAHL_EXCEPTION_KEYS
            and row.get('sourceId') == 'vrbo-5130239')


def date_tr(value):
    d = date.fromisoformat(value)
    return f'{d.day} {MONTHS.get(d.month, str(d.month))} {d.year}'


def duration(row):
    return (date.fromisoformat(row['checkOut']) - date.fromisoformat(row['checkIn'])).days


def indexed_records(path):
    if not path.exists():
        return {}
    raw = read_json(path)
    records = raw.get('records') if isinstance(raw, dict) else None
    if not isinstance(records, list):
        raise ValueError(f'{path.name}: records must be an array')
    result = {}
    for rec in records:
        if not isinstance(rec, dict) or not all(rec.get(k) for k in ('id', 'checkIn', 'checkOut')):
            raise ValueError(f'{path.name}: every record requires id, checkIn, checkOut')
        k = key(rec)
        if k in result:
            raise ValueError(f'{path.name}: duplicate key {k}')
        result[k] = rec
    return result


def indexed_source_prices(path):
    if not path.exists():
        return {}
    raw = read_json(path)
    rows = raw.get('recordsPrice') if isinstance(raw, dict) else None
    if not isinstance(rows, list):
        raise ValueError(f'{path.name}: recordsPrice must be an array')
    result = {}
    for row in rows:
        if not isinstance(row, dict) or not all(row.get(k) for k in ('id', 'checkIn', 'checkOut')):
            raise ValueError(f'{path.name}: invalid price record')
        k = key(row)
        if k in result:
            raise ValueError(f'{path.name}: duplicate price key {k}')
        result[k] = row
    return result


def load_bed_audit():
    if not BED_AUDIT.exists():
        return {}
    raw = read_json(BED_AUDIT)
    if not isinstance(raw, dict):
        raise ValueError('bed-audit.json: ilan kimlikleri nesnesi bekleniyor')
    return raw


def load_bed_breakdowns():
    """Load source-backed summaries if a separate bed breakdown exists."""
    if not BED_BREAKDOWNS.exists():
        return {}
    raw = read_json(BED_BREAKDOWNS)
    if not isinstance(raw, dict):
        raise ValueError('bed-breakdowns.json: ilan kimlikleri nesnesi bekleniyor')
    return raw


def load_bed_rooms():
    """Load room-level claims without silently replacing conflicting records."""
    result = {}
    origins = {}

    def unique_object(pairs):
        obj = {}
        for name, value in pairs:
            if name in obj:
                raise ValueError(f'Tekrarlanan JSON anahtarı: {name}')
            obj[name] = value
        return obj

    for path in BED_ROOM_FILES:
        if path.name.startswith('bed-rooms-sweep-') and not path.exists():
            continue
        try:
            raw = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
        except ValueError as exc:
            raise ValueError(f'{path.name}: {exc}') from exc
        if not isinstance(raw, dict):
            raise ValueError(f'{path.name}: ilan kimlikleri nesnesi bekleniyor')
        for listing_id, record in raw.items():
            if listing_id in result:
                raise ValueError(f'Yatak oda kaydı çakışıyor: {listing_id} ({origins[listing_id]}, {path.name})')
            if not isinstance(record, dict):
                raise ValueError(f'{path.name}: {listing_id} kayıt nesnesi değil')
            source = record.get('source')
            parsed = urlsplit(source) if isinstance(source, str) else None
            rooms = record.get('rooms')
            if not parsed or parsed.scheme != 'https' or not parsed.netloc:
                raise ValueError(f'{path.name}: {listing_id} için geçerli HTTPS kaynak gerekli')
            if not isinstance(rooms, list) or not rooms or any(
                not isinstance(room, dict)
                or not isinstance(room.get('name'), str) or not room['name'].strip()
                or not isinstance(room.get('beds'), str) or not room['beds'].strip()
                for room in rooms
            ):
                raise ValueError(f'{path.name}: {listing_id} için oda adı ve yatak bilgisi gerekli')
            # Room tables are shown on the card as written; the bed badge also
            # counts only Turkish bed words, so source-language labels stop here.
            if any(FOREIGN_BED_TEXT.search(room['name']) or FOREIGN_BED_TEXT.search(room['beds']) for room in rooms):
                raise ValueError(f'{path.name}: {listing_id} oda veya yatak metni Türkçe değil')
            if not isinstance(record.get('note'), str) or not record['note'].strip():
                raise ValueError(f'{path.name}: {listing_id} için kaynak notu gerekli')
            if record.get('status') not in ('belirsiz', 'ilan', 'fotoğraflı'):
                raise ValueError(f'{path.name}: {listing_id} için bilinmeyen kaynak durumu')
            result[listing_id] = record
            origins[listing_id] = path.name
    return result


def matched_bed_rooms(row, records):
    """Match dated offer and provider IDs; reject inconsistent aliases."""
    ids = list(dict.fromkeys(str(value) for value in (row.get('id'), row.get('sourceId'))
                            if value is not None and str(value).strip()))
    matches = [(listing_id, records[listing_id]) for listing_id in ids if listing_id in records]
    if len(matches) > 1 and any(record != matches[0][1] for _, record in matches[1:]):
        raise ValueError(f"Yatak oda kaydı eşleşmesi çakışıyor: {', '.join(item[0] for item in matches)}")
    return matches[0][1] if matches else None


def bed_badge_label(record, verified_count):
    """Describe actual bed types without turning sleeping capacity into beds."""
    fallback = (f'{verified_count} ayrı yatak · Türleri aşağıda' if verified_count is not None
                else 'Yatak türleri aşağıda')
    if not record:
        return fallback
    counts = {'tek': 0, 'çift': 0}
    bunks = 0
    sofas = 0
    minimum = False
    for room in record['rooms']:
        text = room['beds'].lower()
        # Conflicting or overlapping room cards are not safe to add together.
        if re.search(r'\b(?:veya|olabilir|teyitsiz|belirsiz|toplu|katlanır|açıklamada)\b', text):
            return fallback
        if 'en az' in text:
            minimum = True
            text = text.split(';', 1)[0]
        for match in re.finditer(r'\b(\d+)\s+(?:(?:king|queen|büyük|küçük)\s+)?(tek|çift)\s+kişilik\b', text):
            counts[match.group(2)] += int(match.group(1))
        for match in re.finditer(r'\b(\d+)\s+ranza\b', text):
            bunks += int(match.group(1))
        for match in re.finditer(r'\b(\d+)\s+çekyat\b', text):
            sofas += int(match.group(1))
    # A standard bunk has two separate sleeping places; the sofa stays separate.
    total = sum(counts.values()) + 2 * bunks
    if not total or (verified_count is not None and total != verified_count):
        return fallback
    if counts['tek'] and counts['çift']:
        label = f"{counts['çift']} çift + {counts['tek']} tek kişilik yatak"
    elif counts['çift']:
        label = f"{counts['çift']} çift kişilik yatak"
    elif counts['tek']:
        label = f"{counts['tek']} tek kişilik yatak"
    else:
        label = ''
    if bunks:
        label += (' + ' if label else '') + f'{bunks} ranza'
    label = ('En az ' if minimum else '') + label
    label += f' + {sofas} çekyat' if sofas else ''
    return label + (' · teyit gerekli' if record.get('status') == 'belirsiz' else '')


def bed_rooms_html(record):
    """Render each sourced room in the card, leaving only the note collapsible."""
    rows = ''.join(
        f'<div class="bed-room-row"><dt>{esc(room["name"])}</dt><dd>{esc(room["beds"])}</dd></div>'
        for room in record['rooms']
    )
    caution = ('<p class="bed-rooms-caution">Yatak bilgisini rezervasyondan önce kaynakta kontrol edin.</p>'
               if record['status'] == 'belirsiz' else '')
    return f'''<section class="bed-rooms" aria-label="Oda oda yatak bilgisi">
      <div class="bed-rooms-head"><strong>Oda Oda Yataklar</strong><a href="{esc(record['source'])}" target="_blank" rel="noopener noreferrer">Yatak Kaynağı ↗</a></div>
      {caution}<dl class="bed-rooms-list">{rows}</dl>
    </section>'''


def bed_layout(row, records):
    """Prefer a sourced summary; otherwise expose the original source text."""
    record = next((records[str(value)] for value in (row.get('sourceId'), row.get('id'))
                   if value is not None and str(value) in records), None)
    if isinstance(record, dict):
        summary, source, certainty = record.get('summary'), record.get('source'), record.get('certainty')
        if isinstance(summary, str) and summary.strip() and isinstance(source, str) and source.strip():
            return summary.strip(), source.strip(), False, certainty.strip() if isinstance(certainty, str) else ''
    original = row.get('beds')
    if isinstance(original, str) and original.strip():
        return original.strip(), '', True, ''
    return 'Yatak türleri doğrulanmadı', '', False, ''


def omit_old_party_context(text):
    """Remove historical party-size clauses from visible text, preserving source details."""
    text = re.sub(r'\b6\.\s+ve\s+7\.\s+(yetişkin\w*)', r'Altıncı \1', text, flags=re.I)
    old_party = re.compile(r'\b(?:7\.?|yedi(?:nci)?)\s+(?:kişi\w*|yetişkin\w*|konuk\w*|misafir\w*)', re.I)
    if not old_party.search(text):
        return text, False
    clauses = re.split(r'(?<=[!?])\s+|(?<!\d)\.\s+|;\s*', text)
    kept = [clause.strip(' .;') for clause in clauses if clause.strip(' .;') and not old_party.search(clause)]
    return ('. '.join(kept) + ('.' if kept else '')), True


def visible_bed_layout(text, original):
    """Keep the old source intact in details; omit old party-size commentary on cards."""
    if ADULTS != 7 or not original:
        return text
    clean, _ = omit_old_party_context(text)
    return clean or 'Yatak türleri doğrulanmadı'


def verified_beds(row, records, breakdowns=None):
    # Exact offer id takes precedence. A provider id may describe the same
    # property across dated offers, but only an explicit sourced count is used.
    record = next((records[str(value)] for value in (row.get('id'), row.get('sourceId'))
                   if value is not None and str(value) in records), None)
    if not isinstance(record, dict):
        return None, ''
    count, source = record.get('normalBeds'), record.get('source')
    if not isinstance(count, int) or isinstance(count, bool) or count < 0 or not isinstance(source, str) or not source.strip():
        return None, ''
    # A more recent, sourced breakdown can narrow an audit, never add an
    # unaudited count. An unknown or contradictory count is not verified.
    if isinstance(breakdowns, dict):
        detail = next((breakdowns[str(value)] for value in (row.get('sourceId'), row.get('id'))
                       if value is not None and str(value) in breakdowns), None)
        if isinstance(detail, dict) and 'normalBeds' in detail:
            actual = detail.get('normalBeds')
            if not isinstance(actual, int) or isinstance(actual, bool) or actual != count:
                return None, ''
    return count, source.strip()


def load_rows():
    rows = []
    full_paths = [DATA / 'galeri-veri.json']
    if ADULTS == 6:
        full_paths.extend(sorted(DATA.glob('galeri-sweep-*.json')))
    for path in full_paths:
        full = read_json(path)
        if not isinstance(full, list):
            raise ValueError(f'{path.name} must contain a list')
        for raw in full:
            row = dict(raw)
            # The original four-night gallery has entries without dates.
            # New sweep rows must carry their actual search dates explicitly.
            if path.name == 'galeri-veri.json':
                row.setdefault('checkIn', FOUR_IN)
                row.setdefault('checkOut', FOUR_OUT)
            else:
                row.setdefault('_sourceFile', path.name)
            if (row.get('checkIn'), row.get('checkOut')) != (FOUR_IN, FOUR_OUT):
                raise ValueError(f"Unexpected full-stay dates: {row.get('id')}")
            row['_origin'] = 'full'
            rows.append(row)
    for path in sorted(DATA.glob('bolunmus-*.json')):
        batch = read_json(path)
        if not isinstance(batch, list):
            raise ValueError(f'{path.name} must contain a list')
        for raw in batch:
            row = dict(raw)
            if (row.get('checkIn'), row.get('checkOut')) not in {
                ('2026-12-30', '2027-01-01'), ('2027-01-01', '2027-01-03')
            } or row.get('nights') != 2:
                raise ValueError(f"Unexpected split-stay dates: {row.get('id')}")
            row['_origin'] = 'split'
            rows.append(row)
    keys = [key(row) for row in rows]
    if len(keys) != len(set(keys)):
        raise ValueError('Source records have duplicate id/date keys')
    return rows


def classify(row, audit):
    category = audit.get('category')
    if row['_origin'] == 'split':
        if row['checkIn'] == '2026-12-30' and category in ('apartment', 'multiunit'):
            return 'split_apartment'
        if row['checkIn'] == '2027-01-01' and category in ('villa', 'private_house', 'multiunit'):
            return 'split_house'
        return None
    if category in ('villa', 'private_house'):
        return 'full_house'
    if category == 'apartment':
        return 'full_apartment'
    if category == 'multiunit':
        kind = str(row.get('kind', '')).lower()
        return 'full_house' if 'villa' in kind or 'ev' in kind else 'full_apartment'
    return None


def winter_wellness_verified(row):
    """Longer trips require an explicitly sourced, date-specific winter amenity."""
    proof = row.get('winterWellnessProof')
    if not isinstance(proof, dict) or proof.get('verified') is not True or proof.get('winterAvailable') is not True or proof.get('openForStay') is not True:
        return False
    if (proof.get('checkIn'), proof.get('checkOut')) != (row.get('checkIn'), row.get('checkOut')):
        return False
    source = safe_url(proof.get('source'))
    if not source or urlsplit(source).scheme != 'https':
        return False
    kind = proof.get('kind')
    if kind == 'heated_indoor_pool':
        return proof.get('indoor') is True and proof.get('heated') is True
    if kind == 'heated_hot_tub':
        return proof.get('heated') is True
    return kind == 'sauna'


def distance_decision(row, route, group, max_minutes=30):
    """Return a source-bounded inclusion decision for the Tresor car route."""
    value = route.get('tresorCarMin')
    valid = (isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0
             and bool(route.get('notes') or row.get('routeSource') or row.get('routeSources')))
    if not valid:
        return 'unknown', None
    # A dated, traffic-aware range is stronger evidence than the older
    # traffic-free point estimate. Screen against its upper end when present.
    upper = route.get('tresorRangeUpperMin')
    if isinstance(upper, (int, float)) and not isinstance(upper, bool) and math.isfinite(upper) and upper >= value:
        value = upper
    # Only the explicitly liked 19 Mistel may pass this 37-minute exception.
    # The separate premium-bed and total-price checks still apply to all legs.
    limit = max(max_minutes, 37) if ruebezahl_exception(row) else max_minutes
    return ('include' if value <= limit else 'too_far'), value


def premium_beds_verified(row):
    """Only an explicit source-backed proof can unlock the premium exception.

    The attested count is distinct real beds, including a separable double as
    two only where that separation is established by the source. A generic
    sleeping capacity, sofa count or normalBeds field is not proof.
    """
    proof = row.get('premiumBedProof')
    if not isinstance(proof, dict) or proof.get('verified') is not True:
        return False
    count, source = proof.get('independentBeds'), safe_url(proof.get('source'))
    return (isinstance(count, int) and not isinstance(count, bool) and count >= ADULTS
            and bool(source) and urlsplit(source).scheme == 'https')


def preference_bed_count(row, count, room_records):
    """Do not promote a disputed room count as six verified beds."""
    if premium_beds_verified(row):
        return row['premiumBedProof']['independentBeds']
    room_record = matched_bed_rooms(row, room_records)
    exception = str(row.get('sourceId') or '') in CONDITIONAL_SIX_BED_PROOF_IDS
    if room_record and room_record.get('status') == 'belirsiz' and not exception:
        return None
    return count


def price_route_decision(amount_eur, legs):
    """Apply the four-night price cap to one stay or both split-stay legs."""
    if not isinstance(amount_eur, Decimal) or not amount_eur.is_finite() or amount_eur <= 0:
        return 'price_unknown'
    if amount_eur > GENERAL_CAP_EUR:
        return 'over_cap'
    premium = amount_eur > PREMIUM_THRESHOLD_EUR
    if premium and any(not premium_beds_verified(row) for row, _ in legs):
        return 'premium_beds_unverified'
    for row, route in legs:
        group = row.get('_listingGroup')
        # Less expensive houses may be up to 45 minutes; premium offers have
        # the tighter 35-minute and separately verified beds requirements.
        limit = 35 if premium else 45 if group in ('full_house', 'split_house') else 30
        decision, _ = distance_decision(row, route, group, limit)
        if decision != 'include':
            return decision
    return 'premium' if premium else 'standard'


def load_photo_duplicates():
    """Card id -> {repeated photo identity: identity of the copy that stays}."""
    if not PHOTO_DUPLICATES.exists():
        return {}
    result = {}
    for card in read_json(PHOTO_DUPLICATES).get('cardsWithDuplicates', []):
        drops = result.setdefault(str(card['id']), {})
        for group in card.get('groups', []):
            kept = identity(group['keep'])
            for url in group.get('duplicates', []):
                drops[identity(url)] = kept
        if set(drops) & set(drops.values()):
            raise ValueError(f"{PHOTO_DUPLICATES.name}: {card['id']} için tutulan fotoğraf aynı zamanda tekrar sayılmış")
    return result


def drop_duplicate_photos(rows, duplicates):
    """Remove repeated uploads of one image; the copy that stays must be present."""
    removed = 0
    for row in rows:
        drops = duplicates.get(str(row.get('id')))
        if not drops:
            continue
        photos = row.get('photos') or []
        url_of = lambda photo: str(photo[1]) if isinstance(photo, (list, tuple)) and len(photo) == 2 else ''
        present = {identity(url_of(photo)) for photo in photos if url_of(photo)}
        kept = [photo for photo in photos
                if not (url_of(photo) and drops.get(identity(url_of(photo))) in present)]
        removed += len(photos) - len(kept)
        row['photos'] = kept
    return removed


def drop_non_listing_photos(rows):
    """Remove profile portraits and platform icons wherever a gallery came from."""
    removed = 0
    listed = {identity(item['url']) for item in read_json(NON_LISTING_LIST).get('photos', [])} if NON_LISTING_LIST.exists() else set()
    def unrelated(photo):
        if not (isinstance(photo, (list, tuple)) and len(photo) >= 2):
            return False
        url = str(photo[1])
        return bool(NON_LISTING_PHOTO.search(url)) or identity(url) in listed
    for row in rows:
        photos = row.get('photos') or []
        kept = [photo for photo in photos if not unrelated(photo)]
        removed += len(photos) - len(kept)
        if len(kept) != len(photos):
            row['photos'] = kept
    return removed


def load_photo_overrides():
    overrides = {}
    for path in PHOTO_SHARDS:
        if not path.exists():
            continue
        payload = read_json(path)
        records = payload.get('records') if isinstance(payload, dict) else None
        if not isinstance(records, list):
            raise ValueError(f'{path.name}: records must be an array')
        for rec in records:
            if not isinstance(rec, dict) or not isinstance(rec.get('targetKeys'), list) or not isinstance(rec.get('photos'), list):
                raise ValueError(f'{path.name}: invalid photo record')
            photos = []
            for pair in rec['photos']:
                if not isinstance(pair, (list, tuple)) or len(pair) != 2 or not safe_url(pair[1]):
                    raise ValueError(f'{path.name}: invalid photo URL')
                photos.append([str(pair[0]), pair[1]])
            if not photos:
                continue
            for target in rec['targetKeys']:
                if not isinstance(target, (list, tuple)) or len(target) != 3:
                    raise ValueError(f'{path.name}: invalid target key')
                k = (str(target[0]), str(target[1]), str(target[2]))
                if k in overrides:
                    raise ValueError(f'Photo target repeated: {k}')
                overrides[k] = {'photos': photos, 'coverageNote': str(rec.get('coverageNote') or '').strip(), 'verifiedVisual': rec.get('verifiedVisual') is True}
    return overrides


def thumb_url(url: str) -> str:
    """Smaller copy of a photo for the card tiles; the gallery keeps the original.

    Full-size originals (1440-1920 px) on every tile made the page use so much
    memory that Chrome closed the tab. Only providers with a known size switch
    are changed; the page falls back to the original if a copy fails.
    """
    parsed = urlsplit(url)
    if parsed.hostname == 'a0.muscache.com':
        query = re.sub(r'(^|&)im_w=\d+', r'\1im_w=960', parsed.query) if 'im_w=' in parsed.query else (parsed.query + '&' if parsed.query else '') + 'im_w=960'
        return parsed._replace(query=query).geturl()
    if parsed.hostname == 'cf.bstatic.com' and '/max1920x1080/' in parsed.path:
        return parsed._replace(path=parsed.path.replace('/max1920x1080/', '/max1024x768/')).geturl()
    return url


def photos_html(row):
    images = []
    for photo in row.get('photos', []):
        if isinstance(photo, (list, tuple)) and len(photo) == 2:
            label, raw_url = photo
            url = safe_url(raw_url)
            if url:
                parsed = urlsplit(url)
                # Booking serves gallery images only with the signed k= query
                # copied from the listing; without it the card shows no photo.
                if parsed.hostname == 'cf.bstatic.com' and not parse_qs(parsed.query).get('k'):
                    raise ValueError(f"İmzasız Booking görseli (k= yok): {row.get('id')} {url}")
                images.append((str(label), url))
    if not images:
        return '<div class="empty-photo"><p>Fotoğraf bağlantısı yok. İlanı açın.</p></div>'
    thumbs = max(1, min(4, len(images) - 1))
    cls = f'photo-grid photo-count-{min(5, len(images))}' + (' single' if len(images) == 1 else '')
    tags = []
    more = []
    for i, (label, url) in enumerate(images):
        if i >= 5:
            # Photos after the fifth wait as data and become links only when the
            # gallery reaches them; thousands of hidden links made the page too
            # heavy for phones.
            more.append([str(label), url, thumb_url(url)])
            continue
        alt = f"{row.get('name', 'Konaklama')}: {label}"
        # Only the first two photos start loading from the page itself; the
        # carousel loads the rest as it reaches them (data-gm-src). Phones were
        # fetching five photos per card before the script could stop them.
        src_attr = 'src' if i < 2 else 'data-gm-src'
        cls_extra = ''
        tags.append(f'<a{cls_extra} href="{esc(url)}" target="_blank" rel="noopener noreferrer" data-photo-url="{esc(url)}" data-label="{esc(label)}" aria-label="{esc(alt)} Fotoğrafını Aç"><img {src_attr}="{esc(thumb_url(url))}" alt="{esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>')
    listing = safe_url(row.get('link'))
    action = f'<div class="photo-actions"><button class="gallery-open" type="button">Fotoğrafları Aç ({len(images)})</button><a class="gallery-all" href="{esc(listing)}" target="_blank" rel="noopener noreferrer">Tüm Fotoğrafları İlanda Gör ↗</a></div>' if listing else ''
    more_attr = f' data-total="{len(images)}" data-more="{esc(json.dumps(more, ensure_ascii=False, separators=(",", ":")))}"' if more else ''
    return f'<div class="{cls}" style="--thumb-count:{thumbs}"{more_attr}>{"".join(tags)}</div>{action}'


def detail_item(label, value):
    if value is None or str(value).strip() == '':
        return ''
    return f'<p><b>{esc(label)}:</b> {esc(value)}</p>'


def linked_detail(label, value):
    """Keep route evidence readable while retaining any original source links."""
    if not value:
        return ''
    text, parts, pos = str(value), [], 0
    for i, match in enumerate(re.finditer(r'https?://[^\s<>]+', text), 1):
        raw = match.group(0)
        url = raw.rstrip('.,;)')
        suffix = raw[len(url):]
        parts.append(esc(text[pos:match.start()]))
        parts.append(f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer">Kaynak {i} ↗</a>{esc(suffix)}')
        pos = match.end()
    parts.append(esc(text[pos:]))
    return f'<p><b>{esc(label)}:</b> {"".join(parts)}</p>'


def extra_links(row):
    links = []
    for field, label in [('samePropertyAirbnb', 'İlgili Airbnb ilanı'), ('possibleDuplicateAirbnb', 'Olası aynı ilan; doğrulanmadı')]:
        url = safe_url(row.get(field))
        if url:
            links.append(f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer">{esc(label)} ↗</a>')
    for i, item in enumerate(row.get('sourceLinks') or [], 1):
        url = safe_url(item)
        if url:
            links.append(f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer">İlan kaynağı {i} ↗</a>')
    for label, item in (row.get('routeSources') or {}).items():
        url = safe_url(item)
        if url:
            links.append(f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer">{esc(label.replace("_", " "))} kaynağı ↗</a>')
    return '<p class="extra-links">' + ' · '.join(links) + '</p>' if links else ''


def source_links_only(text):
    urls = []
    for match in re.finditer(r'https?://[^\s<>]+', str(text or '')):
        url = safe_url(match.group(0).rstrip('.,;)'))
        if url and url not in urls:
            urls.append(url)
    return '<p>' + ' · '.join(f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer">Ulaşım Kaynağı {i} ↗</a>' for i, url in enumerate(urls, 1)) + '</p>' if urls else ''


def route_value(row, route, original, numeric):
    if original == 'tresorCar' and row.get('_tresor_unverified'):
        return 'Süre teyit edilmedi'
    value = str(row.get(original) or '').strip()
    new = route.get(numeric)
    if not isinstance(new, (int, float)) or isinstance(new, bool) or not math.isfinite(new) or new < 0:
        return 'Bilgi alınamadı' if value.lower() in ('sorgu başarısız', 'sonuç alınamadı') else value or 'Doğrulanmadı'
    minutes = int(new)
    label = f'{minutes // 60} sa {minutes % 60} dk' if minutes >= 60 else f'{minutes} dk'
    if 'yürüyerek' in value.lower():
        return 'Yürüyerek ' + label
    if re.match(r'^\s*\d{1,2}[.:]\d{2}\s+sorgus', value.lower()):
        return label + ' (bekleme dahil)'
    return label


def euro(value):
    if not isinstance(value, (int, float, Decimal)) or isinstance(value, bool) or not math.isfinite(value):
        return ''
    return f'{value:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.') + ' €'


FX_TARGETS = {'EUR': ('TRY',), 'TRY': ('EUR',), 'USD': ('EUR', 'TRY')}


def thousands(value):
    return f'{int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)):,}'.replace(',', '.')


def fx_text(amount, currency):
    """Both euro and lira at the reference rate; the page refreshes these with the day's rate."""
    amount_eur = amount if currency == 'EUR' else amount / (TRY_PER_EUR if currency == 'TRY' else USD_PER_EUR)
    parts = ['≈ ' + thousands(amount_eur * TRY_PER_EUR) + ' TL' if target == 'TRY' else '≈ ' + thousands(amount_eur) + ' €'
             for target in FX_TARGETS[currency]]
    return ' · '.join(parts)


def fx_attrs(amount, currency):
    exact = amount.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    return f' data-fx-amount="{exact}" data-fx-currency="{currency}" data-fx-to="{",".join(FX_TARGETS[currency])}"'


def converted_html(row, price_record):
    """Show the matching displayed offer in the other currency (EUR ↔ TL; USD → EUR and TL)."""
    amount, currency = source_price(row, price_record)
    if amount is None or currency not in FX_TARGETS:
        return ''
    return f'<small class="converted-price"{fx_attrs(amount, currency)}>{esc(fx_text(amount, currency))}</small>'


def source_price(row, price_record):
    """Use only the dated numeric value corresponding to the displayed price."""
    shown = str(row.get('price') or '')
    if price_record.get('sourcePriceText') != shown:
        return None, None
    if '₺' in shown or 'TL' in shown:
        field, currency = 'numericTry', 'TRY'
    elif '€' in shown:
        field, currency = 'numericEur', 'EUR'
    elif '$' in shown or 'USD' in shown:
        field, currency = 'numericUsd', 'USD'
    else:
        return None, None
    value = price_record.get(field)
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or value < 0:
        return None, None
    return Decimal(str(value)), currency


def offer_eur(row, price_record):
    amount, currency = source_price(row, price_record)
    if amount is None or amount <= 0:
        return None
    return amount if currency == 'EUR' else amount / (TRY_PER_EUR if currency == 'TRY' else USD_PER_EUR)


def six_person_price_record(row, price_record):
    """A historical seven-person quote cannot establish a six-person price."""
    return (ADULTS == 6 and isinstance(price_record, dict)
            and price_record.get('adults') == 6
            and not isinstance(price_record.get('adults'), bool)
            and bool(safe_url(price_record.get('sourceUrl'))))


def selected_party_price_record(row, price_record):
    """Use a sourced quote only for the adult count it actually describes."""
    if ADULTS == 6:
        return six_person_price_record(row, price_record)
    return (isinstance(price_record, dict) and price_record.get('adults') == ADULTS
            and not isinstance(price_record.get('adults'), bool)
            and bool(safe_url(price_record.get('sourceUrl'))))


def effective_price_record(row, records):
    return row.get('_effectivePriceRecord') or records.get(key(row), {})


def effective_budget(row, records):
    return row.get('_effectiveBudget') or records.get(key(row), {})


def usd(value):
    rounded = value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return '$' + f'{rounded:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')


def meets_best_property_conditions(row, route, bed_count):
    minutes = route.get('tresorCarMin')
    return (ADULTS in (6, 7) and duration(row) == 4 and bed_count is not None and bed_count >= ADULTS
            and bool(route.get('notes') or row.get('routeSource') or row.get('routeSources'))
            and isinstance(minutes, (int, float)) and not isinstance(minutes, bool)
            and math.isfinite(minutes) and 0 <= minutes <= 20)


def is_best_offer(row, route, budget, price_record, bed_count):
    amount = offer_eur(row, price_record)
    return (meets_best_property_conditions(row, route, bed_count)
            and price_record.get('adults') == ADULTS and amount is not None and amount <= BEST_CAP_EUR
            and budget.get('sourcePriceText') == row.get('price')
            and budget.get('taxKnown') is True and budget.get('sourceTaxStatus') == 'included'
            and budget.get('taxReserveFlag') is False
            and price_record.get('taxStatus') == 'included')


def is_best_candidate(row, audit, route, budget, price_record, bed_count):
    """A dated six-person offer with only its final tax/fee total unresolved."""
    amount = offer_eur(row, price_record)
    source_status = price_record.get('taxStatus')
    conditional_review_resolved = str(row.get('sourceId') or '') in CONDITIONAL_SIX_BED_PROOF_IDS
    audit_allowed = (audit.get('group') == 'recommended'
                     or (audit.get('group') == 'conditional' and conditional_review_resolved))
    availability = str(row.get('availabilityNote') or '').lower()
    return (meets_best_property_conditions(row, route, bed_count)
            and (row.get('checkIn'), row.get('checkOut')) == (FOUR_IN, FOUR_OUT)
            and audit.get('eligible') is True and audit.get('privacy') == 'entire_private'
            and audit.get('category') in ('apartment', 'villa', 'private_house') and audit_allowed
            and row.get('sleepConfirmed') is True
            and not any(term in availability for term in ('ev sahibi', 'onay', 'talep'))
            and price_record.get('adults') == ADULTS and price_record.get('priceConfidence') in ('search', 'checkout')
            and bool(safe_url(price_record.get('sourceUrl'))) and amount is not None and amount <= BEST_CAP_EUR
            and budget.get('sourcePriceText') == row.get('price')
            and budget.get('taxKnown') is False and budget.get('taxReserveFlag') is True
            and source_status in ('unknown', 'conflict', 'excluded', 'included_reported')
            and budget.get('sourceTaxStatus') == source_status)


def booking_offers(row):
    """Keep a second provider's priced offer and evidence separate from Airbnb."""
    alt = row.get('bookingAlternative')
    if ADULTS != 6 or not isinstance(alt, dict) or alt.get('provider') != 'Booking.com':
        return None
    link = safe_url(alt.get('link'))
    room_source = safe_url(alt.get('roomSource'))
    matched = alt.get('samePropertyEvidence') if isinstance(alt.get('samePropertyEvidence'), dict) else {}
    room_id = str(alt.get('roomTypeId') or '')
    def booking_url(url):
        parsed = urlsplit(url)
        host = parsed.hostname or ''
        return parsed.scheme == 'https' and (host == 'booking.com' or host.endswith('.booking.com'))
    if (not link or not room_source or not booking_url(link) or not booking_url(room_source)
            or not room_id or urlsplit(room_source).fragment != 'room_' + room_id
            or urlsplit(link).path != urlsplit(room_source).path
            or matched.get('status') != 'matched' or not str(matched.get('details') or '').strip()
            or matched.get('bookingUnitSource') != room_source):
        return None
    request = alt.get('request') if isinstance(alt.get('request'), dict) else {}
    query = parse_qs(urlsplit(link).query)
    room_query = parse_qs(urlsplit(room_source).query)
    try:
        observed = date.fromisoformat(str(alt.get('observedAt') or ''))
    except ValueError:
        observed = None
    scope_valid = (observed is not None and (row['checkIn'], row['checkOut']) == (FOUR_IN, FOUR_OUT)
                   and request.get('checkIn') == row['checkIn'] and request.get('checkOut') == row['checkOut']
                   and all(isinstance(request.get(name), int) and not isinstance(request.get(name), bool) for name in ('adults', 'children', 'units'))
                   and request.get('adults') == 6 and request.get('children') == 0 and request.get('units') == 1
                   and request.get('currency') == 'USD'
                   and query.get('checkin') == [row['checkIn']] and query.get('checkout') == [row['checkOut']]
                   and query.get('group_adults') == ['6'] and query.get('group_children') == ['0']
                   and query.get('no_rooms') == ['1']
                   and all(room_query.get(name) == query.get(name) for name in ('checkin', 'checkout', 'group_adults', 'group_children', 'no_rooms')))
    raw_rates = alt.get('rates') if isinstance(alt.get('rates'), list) else []
    rates = []
    for rate in raw_rates:
        if not isinstance(rate, dict):
            continue
        numbers = [rate.get(k) for k in ('baseUSD', 'taxesAndFeesUSD', 'approximateTotalUSD')]
        numeric = all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 for v in numbers)
        base, fees, total = (map(lambda v: Decimal(str(v)), numbers) if numeric else (None, None, None))
        proved = (scope_valid and numeric and base + fees == total
                  and rate.get('approximateTotalIncludesDisplayedTaxesAndFees') is True
                  and rate.get('exactTotalDisplayed') is False)
        rates.append({'raw': rate, 'base': base, 'fees': fees, 'total': total,
                      'verified': proved, 'underBestCap': bool(proved and total / USD_PER_EUR <= BEST_CAP_EUR)})
    return {'link': link, 'roomSource': room_source, 'observed': observed, 'scopeValid': scope_valid, 'rates': rates}


def eligible_booking_offers(row, route):
    """Evaluate each separate provider rate against the same policy."""
    offers = booking_offers(row)
    if not offers:
        return None
    rates = []
    for item in offers['rates']:
        if not item['verified']:
            continue
        decision = price_route_decision(item['total'] / USD_PER_EUR, [(row, route)])
        if decision in ('standard', 'premium'):
            rates.append({**item, 'premium': decision == 'premium'})
    return {**offers, 'rates': rates} if rates else None


def promote_booking_offer(row, offer):
    """Use an eligible Booking rate when the displayed source quote fails."""
    item = min(offer['rates'], key=lambda rate: rate['total'])
    shown = '≈ ' + usd(item['total'])
    return {**row, 'link': offer['link'], 'price': shown, 'priceApproximate': True,
            'priceStatus': 'Gösterilen konaklama, vergi ve ücret kalemlerinin yaklaşık toplamı. Nihai tutar teyit edilmeli.',
            'priceNote': '', '_promotedBooking': True,
            '_effectivePriceRecord': {'sourcePriceText': shown, 'numericUsd': float(item['total']),
                                      'adults': 6, 'sourceUrl': offer['link'],
                                      'taxStatus': 'included_reported', 'priceConfidence': 'search'},
            '_effectiveBudget': {'sourcePriceText': shown, 'sourceTaxStatus': 'included_reported',
                                 'taxKnown': False, 'taxReserveFlag': True}}


def booking_html(offer, best_property):
    if not offer or not offer['rates']:
        return ''
    if offer['scopeValid']:
        scope = '6 yetişkin · 4 gece · ' + date_tr(offer['observed'].isoformat()) + ' kaynak gözlemi'
    else:
        scope = 'Tarih ve kişi sayısı yeniden doğrulanmalı.'
    rates = []
    for item in offer['rates']:
        rate = item['raw']
        valid = item['verified']
        if valid:
            price = '≈ ' + usd(item['total'])
            components = f'{usd(item["base"])} konaklama + {usd(item["fees"])} vergi ve ücret'
            share = '≈ ' + usd(item['total'] / Decimal(6)) + ' / kişi'
        else:
            price = str(rate.get('displayedTotal') or 'Tutar teyitsiz')
            components = 'Tutar ve vergi kapsamı ayrıca doğrulanmalı.'
            share = ''
        condition = str(rate.get('cancellation') or 'İptal koşulu teyitsiz')
        payment = str(rate.get('payment') or '').strip()
        qualifier = '<span class="booking-match">En Uygun fiyat ölçütünde</span>' if best_property and item['underBestCap'] else ''
        qualifier += '<span class="premium-badge">Pahalı · 4.000 € üzeri</span>' if item.get('premium') else ''
        rates.append(f'''<div class="booking-rate" data-verified-alternative="{str(valid).lower()}" data-best-alternative="{str(bool(best_property and item['underBestCap'])).lower()}"><div><strong>{esc(price)}</strong> {qualifier}<p>{esc(components)}</p>{f'<p>{esc(share)}</p>' if share else ''}<p>{esc(condition)}{(' · ' + esc(payment)) if payment else ''}</p></div><a href="{esc(offer['link'])}" target="_blank" rel="noopener noreferrer">Booking’de Tarifeyi Kontrol Et ↗</a></div>''')
    return f'''<section class="booking-alternative" aria-label="Booking ayrı teklifler"><h4>Booking.com · Ayrı Teklifler</h4><p>{esc(scope)}</p>{''.join(rates)}<p>Yaklaşık toplamlar yuvarlatılmış ekran kalemlerinin toplamıdır. Booking vergileri Airbnb fiyatına aktarılmaz; fiyat ve koşulları rezervasyon öncesinde yeniden kontrol edin.</p><a href="{esc(offer['roomSource'])}" target="_blank" rel="noopener noreferrer">Booking Oda Kaynağı ↗</a></section>'''


def share_table(total, currency, capacity, nights, approximate=False, max_adults=None):
    """Gösterilen tutarı seçilen kişi sayısına böler; yeni teklif iddia etmez."""
    rows = []
    limit = max_adults if isinstance(max_adults, int) else capacity if isinstance(capacity, int) else None
    for people in (6, 7):
        if total is None or currency not in ('TRY', 'EUR', 'USD'):
            value = '<span class="share-main">Hesaplanamadı</span>'
        else:
            raw_share = total / Decimal(people)
            rounded = raw_share.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
            formatted = f'{rounded:,.2f}'.replace(',', '_').replace('.', ',').replace('_', '.')
            prefix = '≈ ' if approximate else ''
            main = f'{formatted} €' if currency == 'EUR' else f'{formatted} TL' if currency == 'TRY' else f'${formatted}'
            # Each share is shown in euro and lira; the page refreshes the ≈ part with the day's rate.
            value = (f'<span class="share-main">{prefix}{main}</span>'
                     f'<span class="share-approx"{fx_attrs(raw_share, currency)}>{esc(fx_text(raw_share, currency))}</span>')
            if limit is not None and people > limit:
                value += f'<span class="share-limit">Kapasite yetmiyor. {people}. kişinin kabulü teyitsiz.</span>'
        rows.append(f'<tr data-share-people="{people}"{" hidden" if people == 7 else ""}><th scope="row">1/{people}</th><td>{value}</td></tr>')
    return f'''<table class="share-table" aria-label="{nights} gecelik toplamın kişi başı paylaşımı"><caption>Kişi başı · bu toplam</caption><tbody>{''.join(rows)}</tbody></table>'''


def tax_note(budget):
    state = budget.get('sourceTaxStatus')
    if state == 'excluded':
        return 'Vergiler bu fiyata dahil değil.'
    if state == 'conflict':
        return 'Vergi kapsamı kaynaklarda çelişkili.'
    if state == 'included' and budget.get('taxKnown') is True:
        return 'Vergi ve ücretler bu fiyata dahil.'
    if state in ('included', 'included_reported'):
        return 'Kaynak vergilerin dahil olduğunu bildiriyor. Ödeme ekranında teyit edilmedi.'
    return 'Vergilerin bu fiyata dahil olup olmadığı belirtilmemiş.'


def facts_table(title, rows):
    clean = [(label, value) for label, value in rows if value is not None and str(value).strip()]
    if not clean:
        return ''
    body = ''.join(f'<tr><th scope="row">{esc(label)}</th><td>{esc(value)}</td></tr>' for label, value in clean)
    return f'<table class="fact-table"><caption>{esc(title)}</caption><tbody>{body}</tbody></table>'


def point_coords(point):
    lat, lon = point.get('lat'), point.get('lon')
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lat, lon)) and -90 <= lat <= 90 and -180 <= lon <= 180:
        return lat, lon
    return None


def visible_note(text):
    # Whole homes are rented as a unit, so the source party size is not a
    # warning. Old party-size remarks stay in the evidence section only.
    if ADULTS == 7:
        clean, _ = omit_old_party_context(text)
        return clean
    return text


def public_conditions(text):
    """Keep short booking-relevant cautions, not research process notes."""
    keep = ('ranza', 'olumsuz', 'çelişk', 'teyit', 'ortak bahçe', 'ortak avlu')
    omit = ('araştırma', 'teknik', 'doğrulama dökümü', 'kaynak veri kümesi')
    sentences = re.split(r'(?<=\.)\s+', str(text or '').strip())
    return ' '.join(sentence for sentence in sentences
                    if any(term in sentence.lower() for term in keep)
                    and not any(term in sentence.lower() for term in omit))


def customer_warnings(row, audit):
    """Prefer curated visitor warnings and suppress only known duplicate claims."""
    warnings = row.get('displayWarnings') or []
    if isinstance(warnings, str):
        warnings = [warnings]
    if not isinstance(warnings, list) or any(not isinstance(warning, str) for warning in warnings):
        raise ValueError(f"{row.get('id')}: displayWarnings metin listesi olmalı")
    source_id = str(row.get('sourceId') or '')
    bath_inferred = row.get('bathPrivacy') == 'inferred' or audit.get('bathPrivacy') == 'inferred'
    drop = set()
    if bath_inferred:
        # The same qualification is already visible in the card privacy line.
        drop.add('Banyonun yalnız gruba özel kullanımı açıkça doğrulanmadı; rezervasyon öncesi teyit edin.')
    if source_id == '181193704':
        # The privacy line combines these three statements; the detailed bed
        # discrepancy below makes the shorter repeated bed warning redundant.
        drop.update({
            'Bir özel banyo koridorda; koridorun ve diğer banyoların kullanımını teyit edin.',
            'Tek daire değil: üç stüdyo. Bir özel banyo koridorda; koridorun yalnız gruba ait olduğu belirtilmiyor.',
            'Üç stüdyoya bölünmüş daire; bir özel banyo koridorda. Koridorun yalnız gruba ait olup olmadığı belirtilmiyor.',
            'İlk stüdyodaki tek yatak sayısı kaynakta 1 veya 2 olarak çelişiyor; en az 7 tek yatak bildiriliyor.',
        })
    elif source_id == '1559249085935822360':
        # The next warning explains this sofa-bed discrepancy in full.
        drop.add('Altı kişinin uyku düzeni kesin değil; çekyat bilgilerinde çelişki var.')
    elif source_id == '1415265646306539034':
        drop.add('Altı ayrı yetişkin yatağı oda bazında kesinleşmedi.')
    result, seen = [], set()
    for warning in warnings:
        warning = warning.strip()
        if warning in drop or not warning:
            continue
        if source_id == '1415265646306539034' and warning == 'Banyonun yalnız gruba özel kullanımı ayrı etiketle doğrulanmadı; yatakların türü ve sayısı belirsiz.':
            warning = 'Yatakların türü ve sayısı belirsiz; altı ayrı yetişkin yatağı oda bazında kesinleşmedi.'
        normalized = ' '.join(warning.casefold().split())
        if normalized not in seen:
            result.append(warning)
            seen.add(normalized)
    return result


def public_price_conditions(text):
    terms = ('%', 'depozito', 'havlu', 'çarşaf', 'nevresim', 'iptal', 'iade', 'nakit')
    sentences = re.split(r'(?<=\.)\s+', str(text or '').strip())
    return ' '.join(sentence for sentence in sentences if any(term in sentence.lower() for term in terms))


# These are explicitly labelled alternatives, not matches to the 15-minute,
# six-independent-bed criterion. Reasons are drawn from the audited room and
# route records; keep the selection conservative when source details change.
BEST_HOUSE_ALTERNATIVES = {
    '1611035619222657901': (1, 'Tresor yaklaşık 45 dk. İlan odalarda 7 tek yatak bildiriyor; iki ayrı dairenin tamamını ve fiyat kapsamını kontrol edin.'),
    '937599705398085803': (2, 'Tresor yaklaşık 15 dk. 4 yatak ve 1 çekyat var; altı kişi için yatak paylaşımı ve çekyat uygunluğu kontrol edilmeli.'),
    'idyllisches-haus': (3, 'Tresor yaklaşık 10 dk. 3 çift yatak ve 2 çekyat bildirilmiş; yatak paylaşımı ve çekyatlar kontrol edilmeli.'),
    'six-vrbo-145069-full': (4, 'Tresor yaklaşık 37 dk; sauna var. Altı kişiden ikisinin yatacağı yer kaynakta açık değil.'),
}
BEST_APARTMENT_ALTERNATIVES = {
    '1519600838702010375': (1, 'İlan 3 çift ve 5 tek yatak bildiriyor. Son iki odadaki tek yatakların ayrılabilirliği ve vergili toplam teyitsiz.'),
    'six-airbnb-1656340-full': (2, 'İlan 1 çift ve 5 tek yatak bildiriyor; son odadaki üçüncü tek yatak fotoğrafta doğrulanamadı. Vergi ve ekleri kontrol edin.'),
    '1389128667463860564': (3, 'İlan 3 çift ve 3 tek yatak bildiriyor; tek yatakların yetişkinlere uygunluğu teyitsiz.'),
}


def ruebezahl_comparison(row):
    """Dated, six-person observations for the four numbered houses."""
    if not ruebezahl_exception(row):
        return ''
    four_nights = duration(row) == 4
    fragment = ('von=30.12.2026&bis=03.01.2027&personen=6' if four_nights
                else 'von=01.01.2027&bis=03.01.2027&personen=6')
    offers = [
        ('13 Erle', '809908', '13-erle', '1.659,62 €' if four_nights else '892,64 €'),
        ('15 Zeder', '809910', '15-zeder', '1.682,36 €' if four_nights else '892,64 €'),
        ('19 Mistel', '809913', '19-mistel', '3.034,32 €' if four_nights else '1.568,62 €'),
        ('20 Mohn', '809914', '20-mohn', '1.705,11 €' if four_nights else '892,64 €'),
    ]
    items = []
    for house, listing_id, slug, price in offers:
        url = f'https://www.travanto.de/ferienhaus/sc/berlin/{listing_id}/ferienhaus-ferienhaus-{slug}-berlin.php#{fragment}'
        items.append(f'<tr data-source-id="travanto-{esc(listing_id)}"><th scope="row">{esc(house)}</th><td>{esc(price)}</td><td><a href="{esc(url)}" target="_blank" rel="noopener noreferrer">Travanto ↗</a><small>06.11.2026</small><span class="offer-availability" hidden></span></td></tr>')
        if listing_id == '809913':
            vrbo_price = '3.101 €' if four_nights else '1.603 €'
            items.append(f'<tr data-source-id="vrbo-5130239"><th scope="row">145069*</th><td>{vrbo_price}</td><td><a href="{esc(row["link"])}" target="_blank" rel="noopener noreferrer">Vrbo ↗</a><small>06.11.2026</small><span class="offer-availability" hidden></span></td></tr>')
    period = ('30 Aralık 2026 giriş · 3 Ocak 2027 çıkış · 4 gece'
              if four_nights else '1 Ocak 2027 giriş · 3 Ocak 2027 çıkış · 2 gece')
    brochure = 'https://ruebezahl-berlin.de/wp-content/uploads/2018/06/ferienhaus-berlin-erholung-2019-2020.pdf'
    return f'''<section class="ruebezahl-comparison" aria-label="Rübezahl evleri fiyat karşılaştırması">
      <h4>Aynı tesiste dört ayrı ev</h4>
      <p>13 Erle, 15 Zeder, 19 Mistel ve 20 Mohn ayrı numaralı evlerdir. Dört Travanto ilanındaki 24 fotoğrafın tamamı ortaktır; her fotoğrafın hangi eve veya odaya ait olduğu doğrulanmadı. * <a href="https://fewo.de/unterkunft/ferienhaus-mistel-140-145069/" target="_blank" rel="noopener noreferrer">FEWO kaydı ↗</a>, Travanto 19 Mistel ile Vrbo 145069 ilanları için güçlü bir eşleşme sunar; ev sahibinin kesin teyidi alınmadı.</p>
      <p class="ruebezahl-period">{esc(period)} · 6 yetişkin</p>
      <table class="ruebezahl-table"><thead><tr><th scope="col">Ev</th><th scope="col">Gösterilen fiyat</th><th scope="col">Kaynak · gözlem</th></tr></thead><tbody>{''.join(items)}</tbody></table>
      <p>Travanto fiyatlarında konaklama ve temizlik gösterildi; şehir vergisi, tüketim ve olası üçüncü oda ücretinin kapsamı net değil. Vrbo vergi ve ücretler dahil gösteriyor, ancak diğer kaynaklardaki olası eklerin kapsamı teyitsiz. 300 € depozito ayrıca belirtiliyor. Fiyat ve müsaitlik değişebilir.</p>
      <p>Travanto özetleri 130 m² ve iki yatak odası derken uzun açıklamalarda üç oda geçiyor. Vrbo 145069 için bir çift ve iki tek yataklı iki oda gösteriyor; diğer iki kişinin yatacağı yer teyitsiz. Altı ayrı yatak doğrulanmadı.</p>
      <p><a href="{esc(brochure)}" target="_blank" rel="noopener noreferrer">Tesisin 2019-2020 broşürü ↗</a> 130 m² tipinde iki oda için bir çift ve iki tek yatak, 140 m² tipinde üç oda için iki çift ve iki tek yatak gösterir. Bu eski plan, bu evlerin bugünkü oda düzenini veya üçüncü odanın seçili teklifte bulunmasını doğrulamaz.</p>
      <p>Tesisin <a href="https://reservation.one.dirs21.de/ruebezahl-berlinde/result?range=2027-01-01,2027-01-03&amp;sets=%5B%7B%22uuid%22%3A%224e0220b7-4f39-4f25-bba0-3e020c863bb8%22%2C%22occupancy%22%3A%7B%22adultCount%22%3A6%2C%22children%22%3A%5B%5D%7D%7D%5D&amp;los=2" target="_blank" rel="noopener noreferrer">doğrudan rezervasyon kanalında ↗</a> 6 Kasım kontrolünde, 1 Ocak girişli ve 3 Ocak çıkışlı 6 kişilik aramada sonuç çıkmadı. Diğer kanalların ilan ve fiyat göstermesi ayrı bir gözlemdir; kanalların güncel müsaitliği rezervasyondan önce kontrol edilmeli.</p>
    </section>'''


def card_html(row, audit, route, point, budget, card_index, price_record, bed_records, bed_breakdowns, bed_rooms):
    listing = safe_url(row.get('link'))
    if not listing:
        raise ValueError(f"No safe listing URL: {row.get('id')}")
    date_label = f"{date_tr(row['checkIn'])} → {date_tr(row['checkOut'])}"
    nights = duration(row)
    if nights not in (2, 4):
        raise ValueError(f'Wrong duration: {key(row)}')
    price_status = row.get('priceStatus') or 'Fiyat kapsamı doğrulanmadı'
    if audit.get('category') == 'multiunit':
        privacy = 'İlana göre daireler ve banyolar yalnız grubunuza ait.'
    elif audit.get('category') == 'apartment':
        privacy = 'Daire ve banyo/WC yalnız grubunuza ait (ilan bilgisi).'
    else:
        privacy = 'Ev ve banyo/WC yalnız grubunuza ait (ilan bilgisi).'
    is_three_studios = str(row.get('sourceId') or '') == '181193704' and audit.get('category') == 'multiunit'
    if is_three_studios:
        privacy = 'Üç stüdyo; bir özel banyo koridorda. Koridorun ve diğer banyoların yalnızca gruba ait olup olmadığı teyit edilmeli.'
    elif row.get('bathPrivacy') == 'inferred' or audit.get('bathPrivacy') == 'inferred':
        privacy = 'Konaklama birimi yalnız grubunuza ait; banyo/WC mahremiyeti ayrıca teyit edilmeli.'
    has_display_warnings = bool(row.get('displayWarnings'))
    display_warnings = customer_warnings(row, audit)
    reason = str(audit.get('reason') or '').strip()
    bed_count, bed_source = verified_beds(row, bed_records, bed_breakdowns)
    room_record = matched_bed_rooms(row, bed_rooms)
    if is_three_studios and room_record:
        room_record = {**room_record, 'rooms': [
            {**room, 'name': re.sub(r'^Yatak odası\s*', 'Stüdyo ', room['name'], flags=re.I)}
            for room in room_record['rooms']
        ]}
    preferred_beds = preference_bed_count(row, bed_count, bed_rooms)
    property_qualifies = meets_best_property_conditions(row, route, preferred_beds)
    alternate = eligible_booking_offers(row, route)
    main_best = is_best_offer(row, route, budget, price_record, preferred_beds)
    alternate_best = bool(property_qualifies and alternate and any(item['underBestCap'] for item in alternate['rates']))
    best_offer = main_best or alternate_best
    best_candidate = not best_offer and is_best_candidate(row, audit, route, budget, price_record, preferred_beds)
    best_basis = 'primary' if main_best else 'booking' if alternate_best else ''
    best_price_label = ('Booking ≈ ' + usd(min(item['total'] for item in alternate['rates'] if item['underBestCap']))) if best_basis == 'booking' else ''
    booking_note = '<p class="booking-qualification">En Uygun ölçütü, aşağıdaki yaklaşık vergili Booking teklifiyle sağlanıyor. Airbnb fiyatının vergi kapsamı ayrıdır.</p>' if alternate_best else ''
    amount_eur = offer_eur(row, price_record)
    premium = ((nights == 4 and amount_eur is not None and amount_eur > PREMIUM_THRESHOLD_EUR)
               or bool(row.get('_pairPremiumOnly')))
    bed_text = bed_badge_label(room_record, preferred_beds)
    candidate_note = '<p class="candidate-note">Gösterilen tutara vergi ve ek ücretlerin dahil olup olmadığı kesin değil. Nihai toplamı rezervasyondan önce kontrol edin.</p>' if best_candidate else ''
    alternative = None
    if nights == 4 and classify(row, audit) == 'full_house':
        alternative = BEST_HOUSE_ALTERNATIVES.get(str(row.get('id')))
    elif nights == 4 and audit.get('category') == 'apartment':
        alternative = BEST_APARTMENT_ALTERNATIVES.get(str(row.get('id')))
    alternative_note = f'<p class="best-alternative-why"><b>Alternatif:</b> {esc(alternative[1])}</p>' if alternative else ''
    layout, layout_source, original_layout, layout_certainty = bed_layout(row, bed_breakdowns)
    layout_prefix = 'Kaynak açıklaması: ' if original_layout else ''
    layout_url = safe_url(layout_source)
    layout_link = f' <a href="{esc(layout_url)}" target="_blank" rel="noopener noreferrer">Kaynak ↗</a>' if layout_url else ''
    bed_layout_html = f'<p class="bed-layout"><b>Yatak Düzeni:</b> {esc(layout_prefix + visible_bed_layout(layout, original_layout))}{layout_link}</p>'
    if room_record:
        bed_layout_html = bed_rooms_html(room_record)
    visible_notes = [tax_note(budget)]
    if str(row.get('id') or '') == '1175489093358086077':
        visible_notes.append('İlanda sauna yer alıyor; kullanım kapsamı ve kışın açık olup olmadığı teyit edilmeli.')
    photo_coverage = str(row.get('_photo_coverage') or row.get('photoNote') or '').lower()
    if len(row.get('photos') or []) < 5 or any(term in photo_coverage for term in ('doğrulanmadı', 'doğrulanamadı', 'teyitsiz', 'ayrıca incelenmeli')):
        visible_notes.append('Fotoğrafların tüm odaları ve oda eşleşmeleri doğrulanmadı.')
    if row.get('_photo_unverified'):
        visible_notes.append('Fotoğraf etiketleri görsel olarak doğrulanmadı.')
    bed_discrepancy_explained = (has_display_warnings and str(row.get('sourceId') or '')
                                 in {'1415265646306539034', '1559249085935822360'})
    if row.get('sleepConfirmed') is not True and not premium_beds_verified(row) and not bed_discrepancy_explained:
        visible_notes.append('6 yetişkinin yatak düzeni teyit edilmedi.')
    elif ADULTS == 6 and original_layout and not room_record and 'çekyat' in str(row.get('beds') or '').lower():
        visible_notes.append('Yatak düzeni: ' + str(row['beds']))
    user_conditions = '' if has_display_warnings else public_conditions(reason)
    if user_conditions:
        visible_notes.append(user_conditions)
    availability = str(row.get('availabilityNote') or '').strip()
    if availability and any(term in availability.lower() for term in ('ev sahibi', 'onay', 'talep')):
        visible_notes.append(availability)
    deposit_explained = (str(row.get('sourceId') or '') == 'fewo-p2714753'
                         and any('Kaution/depozito' in warning for warning in display_warnings))
    if budget.get('depositText') and not deposit_explained:
        visible_notes.append(str(budget['depositText']))
    visible_notes.extend(display_warnings)
    for sentence in re.split(r'(?<=\.)\s+', str(budget.get('notes') or '')):
        lower = sentence.lower()
        if any(term in lower for term in ('havlu', 'nevresim')) and any(term in lower for term in ('ücret', 'ayrı')):
            visible_notes.append(sentence)
    visible_notes = [visible_note(note) for note in visible_notes]
    note_html = ''.join(f'<p><b>Not:</b> {esc(note)}</p>' for note in dict.fromkeys(visible_notes) if note)
    caution_reasons = []
    if audit.get('group') == 'conditional' and user_conditions:
        caution_reasons.append(visible_note(user_conditions))
    if preferred_beds is None:
        caution_reasons.append('6 ayrı yatak doğrulanmadı; oda dökümünü inceleyin.')
    elif preferred_beds < 6:
        caution_reasons.append(f'Kaynakta {preferred_beds} ayrı yatak doğrulandı; türler oda dökümünde.')
    if not (budget.get('sourceTaxStatus') == 'included' and budget.get('taxKnown') is True):
        caution_reasons.append(tax_note(budget))
    if availability and any(term in availability.lower() for term in ('ev sahibi', 'onay', 'talep')):
        caution_reasons.append(visible_note(availability))
    if has_display_warnings:
        caution_reasons = ['Yatak, fiyat ve kullanım koşulları aşağıdaki notlarda açıklanır.']
    caution_list = ''
    caution_unique = list(dict.fromkeys(reason for reason in caution_reasons if reason)) if audit.get('group') == 'conditional' else []
    generic_caution = audit.get('group') == 'conditional' and not caution_unique
    if generic_caution:
        caution_unique = ['Notlardaki koşulları rezervasyondan önce kontrol edin.']
    if caution_unique:
        notes = ''.join(f'<li>{esc(note)}</li>' for note in caution_unique)
        caution_list = f'<div class="caution-list"><b>Dikkat Gerektiren Noktalar</b><ul>{notes}</ul></div>'
    budget_html = ''
    if nights == 4 and amount_eur is not None:
        _, currency = source_price(row, price_record)
        approx = '≈ ' if currency != 'EUR' or row.get('priceApproximate') else ''
        budget_html = f'<p class="budget-label">Gösterilen toplam · {approx}{esc(euro(amount_eur))}</p>'
        if budget.get('taxReserveFlag') and not has_display_warnings:
            note_html += '<p><b>Not:</b> Vergi veya ek ücretler netleşmeden bütçe kesinleşmez.</p>'
    cap = row.get('capacity') or 'Teyitsiz'
    rooms = row.get('rooms') if row.get('rooms') not in (None, '') else 'Teyitsiz'
    room_label = 'Stüdyo' if is_three_studios else 'Yatak Odası'
    baths = row.get('baths') if row.get('baths') not in (None, '') else 'Teyitsiz'
    route_fields = [('RSO', 'rsoCar', 'rsoTransit'), ('Tresor', 'tresorCar', 'tresorTransit')]
    route_observations = {
        '1166429151300530583': 'RSO ve Tresor süreleri 5 Kasım gündüz Google Haritalar gözlemidir; güncel trafik ve yılbaşı koşulları farklı olabilir.',
        '13868134': 'Tresor araç süresi önceki Google Haritalar gözlemidir; bu çalışmada yeniden ölçülmedi. Güncel trafik ve yılbaşı koşulları farklı olabilir.',
    }
    route_observation = route_observations.get(str(row.get('sourceId') or ''))
    route_observation_html = f'<p class="route-observation"><b>Rota:</b> {esc(route_observation)}</p>' if route_observation else ''
    route_rows = ''.join(f'<tr><th scope="row">{esc(label)}</th><td data-label="Taksi / Araç">{esc(route_value(row, route, car, car + "Min"))}</td><td data-label="Toplu / Yürüme">{esc(route_value(row, route, transit, transit + "Min"))}</td></tr>' for label, car, transit in route_fields)
    route_table = f'<table class="fact-table"><caption>Ulaşım</caption><thead><tr><th>Hedef</th><th>Taksi / Araç</th><th>Toplu / Yürüme</th></tr></thead><tbody>{route_rows}</tbody></table>'
    evidence = ''.join([
        linked_detail('Fiyat kaynağı', price_record.get('sourceUrl')),
        source_links_only(route.get('notes')),
        source_links_only(' '.join(row.get('transitSources') or [])),
        detail_item('Adres', row.get('address')),
        detail_item('Konum hassasiyeti', {'address': 'Adres eşleşmesi; giriş yeri doğrulanmadı', 'listing_approx': 'İlanın yaklaşık konumu', 'area': 'Yaklaşık bölge; bina teyitsiz', 'unknown': 'Teyitsiz'}.get(point.get('accuracy'))),
        source_links_only(point.get('source')),
        detail_item('Kontrol zamanı', row.get('checkedAt') or row.get('observedAtUTC')),
        linked_detail('Uygunluk kaynağı', audit.get('source')),
        linked_detail('Yatak kaynağı', bed_source),
        linked_detail('Yatak düzeni kaynağı', layout_source),
        linked_detail('Oda dağılımı kaynağı', room_record.get('source') if room_record else None),
        linked_detail('Ayrı yatak kaynağı', row.get('premiumBedProof', {}).get('source') if premium_beds_verified(row) else None),
        extra_links(row),
    ])
    capacity = row.get('capacity')
    if isinstance(capacity, str) and capacity.strip().isdigit():
        capacity = int(capacity.strip())
    if not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1:
        capacity = None
    max_adults = audit.get('maxAdults')
    if isinstance(max_adults, int) and not isinstance(max_adults, bool) and max_adults > 0:
        capacity = min(capacity, max_adults) if capacity is not None else max_adults
    room_count = row.get('rooms')
    if isinstance(room_count, str) and room_count.strip().isdigit():
        room_count = int(room_count.strip())
    if not isinstance(room_count, int) or isinstance(room_count, bool) or room_count < 1:
        room_count = None
    bath_full, bath_wc = bath_facts(row.get('baths'))
    sauna_listed = (ruebezahl_exception(row) or str(row.get('id') or '') == '1175489093358086077'
                    or (winter_wellness_verified(row) and row['winterWellnessProof']['kind'] == 'sauna'))
    data = f' data-capacity="{esc(capacity if capacity is not None else "")}" data-rooms="{esc(room_count if room_count is not None else "")}" data-sauna="{str(sauna_listed).lower()}" data-baths="{bath_full if bath_full is not None else ''}" data-separate-wc="{str(bath_wc).lower()}" data-offer-adults="{ADULTS}" data-price-eur="{esc(amount_eur if amount_eur is not None else "")}" data-normal-beds="{esc(preferred_beds if preferred_beds is not None else "")}" data-best-eligible="{str(best_offer).lower()}" data-best-candidate="{str(best_candidate).lower()}" data-best-alternative="{str(bool(alternative)).lower()}" data-alternative-rank="{alternative[0] if alternative else 99}" data-best-basis="{best_basis}" data-best-price-label="{esc(best_price_label)}"'
    for field in ('rsoCarMin', 'tresorCarMin', 'rsoTransitMin', 'tresorTransitMin'):
        val = route.get(field)
        if isinstance(val, (int, float)) and not isinstance(val, bool) and math.isfinite(val) and val >= 0:
            data += f' data-{re.sub(r"[A-Z]", lambda m: "-" + m.group(0).lower(), field)}="{esc(val)}"'
    coords = point_coords(point)
    if coords:
        data += f' data-lat="{esc(coords[0])}" data-lon="{esc(coords[1])}"'
        data += f' data-map-accuracy="{esc(point.get("accuracy") or "unknown")}"'
        maps_query = f'{coords[0]},{coords[1]}'
        point_label = 'Yaklaşık bölge · bina teyitsiz' if point.get('accuracy') == 'area' else 'Yaklaşık konum'
        maps_label = 'Yaklaşık Konumu Google Haritalar’da Aç ↗'
    else:
        maps_query = f"{row.get('name', '')} {row.get('area', '')}"
        maps_label = 'Haritada İsimle Ara ↗'
    maps_url = 'https://www.google.com/maps/search/?api=1&query=' + quote(maps_query, safe=',')
    title_tag = 'h4' if row['_origin'] == 'split' else 'h3'
    location_text = row.get('address') or row.get('area') or 'Konum Teyitsiz'
    converted = converted_html(row, price_record)
    share_amount, share_currency = source_price(row, price_record)
    share_html = share_table(share_amount, share_currency, row.get('capacity'), nights, approximate=bool(row.get('priceApproximate')), max_adults=audit.get('maxAdults'))
    quote_label = (f'Vrbo · {nights} Gece · 6 Yetişkin' if ruebezahl_exception(row)
                   else f'{nights} Gece · {ADULTS} Yetişkin')
    # The source quote belongs to its stated party size; the UI warns if the
    # selected party differs and no matching quote was recorded.
    quote_warning = ''
    quote_warning_html = f'<div class="offer-warning">{quote_warning}</div>' if quote_warning else ''
    source_file = str(row.get('_sourceFile') or '')
    new_listing = bool(row.get('addedAt')) or source_file in ('new-search.json', 'new-search-ek.json', 'wellness-new.json') or source_file.startswith('galeri-sweep-')
    # An explicit insertion time is preferred. Older sweeps only recorded the
    # search day; keep that precision instead of inventing a time of day.
    added_at = str(row.get('addedAt') or '')
    if not added_at:
        sweep_day = re.match(r'galeri-sweep-(\d{4})(\d{2})(\d{2})', source_file)
        if sweep_day:
            added_at = '-'.join(sweep_day.groups())
    if added_at and not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?', added_at):
        raise ValueError(f"Geçersiz eklenme tarihi: {row.get('id')}")
    refreshed_price = source_file == 'refreshed-search.json'
    fresh_text = 'Yeni Eklenen' if new_listing else 'Fiyat Güncellendi' if refreshed_price else ''
    shared_gallery = ''
    if row.get('sourceId') in {'travanto-809908', 'travanto-809910', 'travanto-809914'}:
        shared_gallery = '<p class="shared-gallery-warning"><b>Fotoğraf Notu:</b> 13 Erle, 15 Zeder ve 20 Mohn ilanlarında aynı 24 fotoğraf kullanılıyor. Görsellerin bu eve ait olduğu ayrı ayrı doğrulanmadı.</p>'
    exception_warning = ('<p class="ruebezahl-caution"><b>Özel istisna:</b> Tresor’a araçla yaklaşık 37 dk. Bu, 30 ila 35 dk sınırının üzerindedir; süre ve yılbaşı trafiği değişebilir.</p>'
                         if ruebezahl_exception(row) else '')
    travel_mins = route.get('tresorCarMin')
    far_house = (classify(row, audit) in ('full_house', 'split_house')
                 and isinstance(travel_mins, (int, float)) and not isinstance(travel_mins, bool)
                 and travel_mins > 35 and not ruebezahl_exception(row))
    resort_note = '<p class="resort-summary">Aynı tesiste 4 numaralı ev var. Evlerin fiyatları ve kaynakları aşağıdaki karşılaştırmada.</p>' if ruebezahl_exception(row) else ''
    premium_data = ' data-premium="true"' if premium else ''
    # ---- Compact card: the first glance carries only decision-critical facts.
    # Everything else stays in the document and opens in the large view tabs.
    name = row.get('name', 'Konaklama')
    tresor_car = route_value(row, route, 'tresorCar', 'tresorCarMin')
    tresor_transit = route_value(row, route, 'tresorTransit', 'tresorTransitMin')
    rso_car = route_value(row, route, 'rsoCar', 'rsoCarMin')
    rso_transit = route_value(row, route, 'rsoTransit', 'rsoTransitMin')
    bed_value = bed_text
    bed_sub = 'Oda oda düzeni gör'
    if bed_value.endswith(' · teyit gerekli'):
        bed_value, bed_sub = bed_value[:-len(' · teyit gerekli')], 'Teyit gerekli · düzeni gör'
    bed_value = bed_value.replace(' · Türleri aşağıda', '')
    if bed_value == 'Yatak türleri aşağıda':
        bed_value, bed_sub = 'Yatak sayısı teyitsiz', 'Kaynaktaki düzeni gör'
    bed_state = (' is-good' if preferred_beds is not None and preferred_beds >= 6 and not best_candidate
                 else ' is-warn' if preferred_beds is None or preferred_beds < 6 else '')
    room_unit = 'stüdyo' if is_three_studios else 'oda'
    room_value = ' · '.join(part for part in (
        f'{rooms} {room_unit}' if rooms != 'Teyitsiz' else 'Oda teyitsiz',
        f'{baths} banyo' if baths != 'Teyitsiz' else '') if part)

    def fact_tile(tab, icon_name, label, value, sub, state=''):
        aria = f'{label}: {value}. {re.sub(r"<[^>]+>", "", sub)}. Ayrıntıları aç'
        return (f'<button type="button" class="card-open fact-tile{state}" data-tab="{tab}" aria-label="{esc(aria)}">'
                f'<span class="fact-icon">{icon(icon_name)}</span><span class="fact-text"><small>{esc(label)}</small>'
                f'<b>{esc(value)}</b><span class="fact-sub">{sub}</span></span></button>')

    tiles = ''.join([
        fact_tile('beds', 'bed-double', 'Yataklar', bed_value, esc(bed_sub), bed_state),
        fact_tile('route', 'car-taxi-front', 'Tresor’a', tresor_car, esc(f'Taksi · toplu {tresor_transit}'),
                  ' is-warn' if far_house or ruebezahl_exception(row) else ''),
        fact_tile('route', 'disc-3', 'RSO’ya', rso_car, esc(f'Taksi · toplu {rso_transit}')),
        fact_tile('overview', 'door-open', 'Odalar', room_value,
                  f'Kapasite <span data-capacity-value>{esc(cap)}</span> kişi'),
    ])

    # The single most important caution is visible; all notes are one tap away.
    # A caution already listed at the top of the notes is not repeated below it.
    for repeated in caution_unique:
        note_html = note_html.replace(f'<p><b>Not:</b> {esc(repeated)}</p>', '')
    notes_panel_parts = [caution_list, exception_warning, shared_gallery, candidate_note,
                         alternative_note, f'<div class="note-block">{note_html}</div>' if note_html else '']
    notes_inner = ''.join(part for part in notes_panel_parts if part)
    note_count = len(re.findall(r'<(?:li|p)\b', notes_inner))
    alert_kind, alert_text = 'ok', privacy
    if ruebezahl_exception(row):
        alert_kind, alert_text = 'warn', 'Özel istisna: Tresor’a araçla yaklaşık 37 dk.'
    elif best_candidate:
        alert_kind, alert_text = 'warn', 'Vergili toplam kesin değil; rezervasyondan önce kontrol edin.'
    elif caution_unique and not generic_caution:
        alert_kind, alert_text = 'warn', caution_unique[0]
    elif far_house:
        alert_kind, alert_text = 'warn', f'Daha uzak: Tresor’a araçla yaklaşık {int(travel_mins)} dk.'
    elif generic_caution:
        alert_kind, alert_text = 'warn', caution_unique[0]
    elif 'teyit' in privacy:
        alert_kind = 'warn'
    alert_icon = 'triangle-alert' if alert_kind == 'warn' else 'shield-check'
    count_label = f'{note_count} not' if note_count else 'Notlar'
    alert_html = (f'<button type="button" class="card-open card-alert alert-{alert_kind}" data-tab="notes" '
                  f'aria-label="{esc(alert_text)} Tüm notları aç ({note_count})">{icon(alert_icon)}'
                  f'<span class="alert-text">{esc(alert_text)}</span><span class="alert-count">{esc(count_label)}</span></button>')

    flag_texts = []
    if fresh_text:
        flag_texts.append((f'flag-{"new" if new_listing else "updated"}', 'Yeni' if new_listing else 'Fiyat Güncellendi'))
    if premium:
        flag_texts.append(('flag-premium', '4.000 € Üzeri'))
    if ruebezahl_exception(row):
        flag_texts.append(('flag-warn', 'Özel İstisna'))
    elif far_house:
        flag_texts.append(('flag-warn', f'Daha Uzak · {int(travel_mins)} dk'))
    if best_offer:
        flag_texts.append(('flag-best', 'En Uygun'))
    elif best_candidate:
        flag_texts.append(('flag-warn', 'Koşullu Aday'))
    elif caution_unique:
        flag_texts.append(('flag-warn', 'Dikkat'))
    flags = ''.join(f'<span class="media-flag {cls}">{esc(text)}</span>' for cls, text in flag_texts)
    if alternative:
        flags += '<span class="media-flag flag-warn best-alternative-badge">Alternatif</span>'

    map_button = (f'<button class="map-show icon-action" type="button" aria-label="{esc(name)}: Haritada göster">{icon("map-pin")}<span>Harita</span></button>'
                  if coords else '')
    map_note = (f'<p class="map-hint-line">{icon("map-pin")} {esc(point_label)} · <a href="{esc(maps_url)}" target="_blank" rel="noopener noreferrer">{esc(maps_label)}</a></p>'
                if coords else f'<p class="map-hint-line">{icon("map-pin")} Koordinat teyit edilmedi · <a href="{esc(maps_url)}" target="_blank" rel="noopener noreferrer">{esc(maps_label)}</a></p>')
    address_line = f'<p class="route-address"><b>Konum:</b> {esc(location_text)}</p>'

    # Keep the amount on one line; its qualifier stays inside the same element.
    price_text = str(row.get('price') or 'Fiyat Teyitsiz')
    price_split = re.match(r'^(.*?\d[\d.,]*\s*(?:€|TL|\$|USD|EUR)?)(\s*(?:\(|\+|;|·).*)$', price_text)
    price_main = esc(price_split[1] if price_split else price_text)
    price_qualifier = f'<span class="price-qualifier">{esc(price_split[2])}</span>' if price_split else ''
    short_month = {12: 'Ara', 1: 'Oca'}
    short_dates = ' → '.join(f"{int(value[8:10])} {short_month.get(int(value[5:7]), date_tr(value).split()[1][:3])}"
                             for value in (row['checkIn'], row['checkOut']))
    tab_defs = [('overview', 'Özet'), ('beds', 'Yataklar'), ('route', 'Ulaşım'), ('price', 'Fiyat'),
                ('notes', f'Notlar{f" · {note_count}" if note_count else ""}'), ('sources', 'Kaynaklar')]
    tabs = ''.join(f'<button type="button" role="tab" class="detail-tab" data-tab="{key_}" aria-selected="{str(key_ == "overview").lower()}">{esc(label)}</button>'
                   for key_, label in tab_defs)
    titles = dict(tab_defs)

    def panel(key_, inner):
        return (f'<section class="detail-panel{" card-body" if key_ == "overview" else ""}" role="tabpanel" data-panel="{key_}" aria-label="{esc(titles[key_])}">'
                f'<h4 class="panel-title">{esc(titles[key_])}</h4>{inner}</section>')

    overview_inner = (f'{resort_note}{alternative_note}<p class="privacy-note">{icon("shield-check")} {esc(privacy)}</p>'
                      f'<div class="facts"><span><b>{esc(rooms)}</b> {esc(room_label)}</span><span><b>{esc(baths)}</b> Banyo</span><span><b>{esc(cap)}</b> İlan Kapasitesi</span></div>'
                      f'<dl class="overview-list"><div><dt>Yataklar</dt><dd>{esc(bed_text)}</dd></div>'
                      f'<div><dt>Tresor’a</dt><dd>Taksi {esc(tresor_car)} · Toplu {esc(tresor_transit)}</dd></div>'
                      f'<div><dt>RSO’ya</dt><dd>Taksi {esc(rso_car)} · Toplu {esc(rso_transit)}</dd></div>'
                      f'<div><dt>Fiyat kapsamı</dt><dd>{esc(tax_note(budget))}</dd></div></dl>{budget_html}{booking_note}')
    beds_inner = bed_layout_html + facts_table('Yataklar', [(room_label, rooms), ('Yatak Düzeni', layout if not room_record else None)])
    route_inner = route_table + route_observation_html + address_line + map_note
    price_inner = (quote_warning_html + budget_html + candidate_note + booking_note
                   + facts_table('Fiyat', [('Gösterilen Toplam', row.get('price')), ('Vergi ve Ücret', price_status), ('Depozito', budget.get('depositText')), ('Diğer Koşullar', public_price_conditions(row.get('priceNote')))])
                   + ruebezahl_comparison(row) + booking_html(alternate, property_qualifies))
    notes_body = notes_inner or '<p class="empty-note">Bu teklif için ek not yok.</p>'
    sources_inner = (facts_table('İlan', [('İlandaki Ad', row.get('_raw_name'))])
                     + facts_table('Olanaklar', [('İlan bilgisi', row.get('features')), ('Havuz / kış', row.get('poolWinter'))])
                     + facts_table('Giriş ve Çıkış', [('Giriş', date_tr(row['checkIn']) + (' · ' + str(row['checkInTime']) if row.get('checkInTime') else '')), ('Çıkış', date_tr(row['checkOut']) + (' · ' + str(row['checkOutTime']) if row.get('checkOutTime') else ''))])
                     + f'<details class="evidence" open><summary>Kaynak ve Belirsizlik</summary>{evidence}</details>'
                     + f'<div class="card-links"><a class="photo-source" href="{esc(listing)}" target="_blank" rel="noopener noreferrer">Fotoğraf Yüklenmediyse İlanda Aç ↗</a></div>')
    more = (f'<div class="card-more"><div class="detail-tabs" role="tablist" aria-label="{esc(name)} ayrıntıları">{tabs}</div>'
            + panel('overview', overview_inner) + panel('beds', beds_inner) + panel('route', route_inner)
            + panel('price', price_inner) + panel('notes', notes_body) + panel('sources', sources_inner) + '</div>')
    # The large view's panels are kept as text until a card is opened
    # (liquid.js BerlinInflateMore). 144 cards' hidden panels cost phones
    # ~75 MB of page memory at load (Safari measurement, 13 Nov 2026).
    if '</script' in more.lower() or '<!--' in more:
        raise ValueError(f"Ayrıntı paneli metin olarak saklanamıyor: {row.get('id')}")
    # build_combined.py turns the marked block into script text after the
    # views are merged (merge_views still checks the panels' contents).
    more = f'\u27e6card-more\u27e7{more}\u27e6/card-more\u27e7'

    related_html = ''
    for offer in row.get('relatedStays', []):
        url6, url7 = safe_url(offer.get('url6')), safe_url(offer.get('url7'))
        if not (url6 and url7 and offer.get('id') and offer.get('price6') and offer.get('price7')):
            raise ValueError(f"İlişkili konaklama teklifi eksik: {row.get('id')}")
        related_html += (f'<div class="related-stay-offer" data-source-id="{esc(offer["id"])}" '
                         f'data-price-six="{esc(offer["price6"])}" data-price-seven="{esc(offer["price7"])}" '
                         f'data-price-checked-at="{esc(offer.get("priceCheckedAt") or "")}" '
                         f'data-url-six="{esc(url6)}" data-url-seven="{esc(url7)}">'
                         f'<b>{esc(offer.get("title") or "Aynı tesiste seçenek")}</b>'
                         f'<span>{esc(offer.get("description") or "")}</span>'
                         f'<span class="related-stay-price">{esc(offer["price6"])} · 6 kişi</span>'
                         f'<span class="related-stay-status"></span>'
                         f'<a class="related-stay-link" href="{esc(url6)}" target="_blank" rel="noopener noreferrer">Tek daire ilanını ve fotoğraflarını aç ↗</a></div>')

    return f'''<article class="stay-card" id="konaklama-{card_index}" data-order="{card_index}" data-id="{esc(row['id'])}" data-check-in="{esc(row['checkIn'])}" data-check-out="{esc(row['checkOut'])}" data-category="{esc(audit.get('category') or '')}" data-new="{str(new_listing).lower()}" data-added-at="{esc(added_at)}" data-price-refreshed="{str(refreshed_price).lower()}" data-note-count="{note_count}"{premium_data}{data}>
      <div class="card-media">{photos_html(row)}<div class="media-flags"><p class="availability-status" hidden></p>{flags}</div><p class="party-quote-note" hidden></p><div class="favorite-control"><button type="button" class="favorite-button" disabled aria-pressed="false" aria-label="Ortak favoriler bağlanmadı"><span class="favorite-heart" aria-hidden="true">♡</span><span class="favorite-label">Kaydet</span></button><button type="button" class="share-button" aria-label="{esc(name)}: bağlantısını paylaş" title="Bu ilanın bağlantısını paylaş">{icon('share-2')}<span class="share-label">Paylaş</span></button><span class="favorite-unavailable">Ortak liste bağlı değil</span></div></div>
      <div class="card-head"><div class="card-title"><p class="card-kicker" title="{esc(date_label)}">{icon('calendar-days')} {esc(short_dates)} · {nights} Gece</p><{title_tag} title="{esc(name)}">{esc(name)}</{title_tag}><p class="area" title="{esc(row.get('kind') or 'Tür Teyitsiz')} · {esc(location_text)}">{esc(row.get('kind') or 'Tür Teyitsiz')} · {esc(location_text)}</p></div><div class="amount"><strong>{price_main}{price_qualifier}</strong>{converted}<small class="quote-label">{quote_label}</small>{share_html}</div></div>
      {related_html}<div class="fact-tiles">{tiles}</div>
      {alert_html}
      <div class="card-actions"><button type="button" class="card-open card-open-main" data-tab="overview" aria-label="{esc(name)} Ayrıntılarını Aç">{icon('maximize-2')}<span>Tüm Ayrıntılar</span></button>{map_button}<a class="listing icon-action" href="{esc(listing)}" target="_blank" rel="noopener noreferrer" aria-label="{esc(name)}: İlanı ve koşulları aç">{icon('square-arrow-out-up-right')}<span>İlan</span></a></div>
      {more}</article>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT, help='HTML output path')
    output = parser.parse_args().output
    rows = load_rows()
    photo_overrides = load_photo_overrides()
    for row in rows:
        photo = photo_overrides.get(key(row))
        if photo:
            row['photos'] = photo['photos']
            row['_photo_coverage'] = photo['coverageNote']
            row['_photo_unverified'] = not photo['verifiedVisual']
    gallery_stats = expand(rows)
    checked_galleries = verified_galleries()
    # An Airbnb hosting id can differ when a photo is reused by the same host.
    # Permit such an image only when that exact image was seen in this listing's
    # own gallery, never solely because it belongs to the same host.
    for row in rows:
        link = str(row.get('link') or '')
        match = re.search(r'https?://(?:www\.)?airbnb\.[^/]+/rooms/(\d+)', link)
        if not match:
            continue
        room_id = match.group(1)
        original = row.get('photos') or []
        verified = checked_galleries.get(str(row.get('id') or ''), {})
        authorized = {identity(photo['src']) for photo in verified.get('photos', [])}
        kept = []
        for photo in original:
            url = str(photo[1]) if isinstance(photo, (list, tuple)) and len(photo) >= 2 else ''
            hosting = re.search(r'/Hosting-(\d+)/', url)
            if hosting and hosting.group(1) != room_id and identity(url) not in authorized:
                continue
            kept.append(photo)
        if len(kept) != len(original):
            row['photos'] = kept
            row['_photo_coverage'] = 'İlana ait olduğu doğrulanamayan görseller çıkarıldı.'
    apply_verified_galleries(rows, checked_galleries)
    drop_duplicate_photos(rows, load_photo_duplicates())
    dropped = drop_non_listing_photos(rows)
    if dropped:
        print(f'Uyarı: {dropped} ilgisiz görsel (profil, platform simgesi veya foto-ilgisiz listesi) kaynak veride kalmış, karttan çıkarıldı.')
    if TITLES.exists():
        title_data = read_json(TITLES)
        titles = title_data.get('titles') if isinstance(title_data, dict) else None
        if not isinstance(titles, dict):
            raise ValueError('titles-tr.json: titles nesnesi bulunamadı')
    else:
        titles = {}
    for row in rows:
        row['_raw_name'] = row.get('name', '')
        title = titles.get(str(row.get('id')), {})
        source_file = str(row.get('_sourceFile') or '')
        if (source_file.startswith('galeri-sweep-') and source_file >= TITLE_REQUIRED_FROM
                and not (isinstance(title, dict) and str(title.get('displayName') or '').strip())):
            raise ValueError(f"Türkçe kart başlığı eksik ({TITLES.name}): {row.get('id')}")
        if isinstance(title, dict) and isinstance(title.get('displayName'), str) and title['displayName'].strip():
            row['name'] = title['displayName'].strip()
        if ruebezahl_exception(row):
            row['name'] = 'Rübezahl | 145069 · Özel Saunalı Ev'
        elif str(row.get('sourceId') or '') == '181193704':
            row['name'] = 'Freedom Studio Apartments | Üç Stüdyo'
    price_records = indexed_source_prices(PAIRS)
    bed_records = load_bed_audit()
    bed_breakdowns = load_bed_breakdowns()
    bed_rooms = load_bed_rooms()
    for row in rows:
        matched_bed_rooms(row, bed_rooms)
    audit = indexed_records(ELIGIBILITY)
    routes = indexed_records(ROUTES)
    points = indexed_records(MAP_POINTS)
    if not BUDGET.exists():
        raise ValueError('budget-normalized.json bulunamadı; bütçe süzgeci olmadan önizleme üretilmez')
    budget_data = read_json(BUDGET)
    budgets = indexed_records(BUDGET)
    if not isinstance(budget_data.get('pairs'), list):
        raise ValueError('Bütçe çiftleri beklenen şemada değil')
    if budget_data.get('fx', {}).get('rate') != 56.1729 or budget_data.get('fx', {}).get('referenceDate') != '2026-11-05':
        raise ValueError('Kur verisi görünür açıklama ile eşleşmiyor; yeni kur denetimi gerekli')
    raw_map = read_json(MAP_POINTS) if MAP_POINTS.exists() else {}
    clubs = raw_map.get('clubs', []) if isinstance(raw_map, dict) else []
    if not isinstance(clubs, list):
        raise ValueError('map-points.json: clubs must be an array')
    clubs = [club for club in clubs if isinstance(club, dict) and point_coords(club) and club.get('name')]
    clubs_json = json.dumps(clubs, ensure_ascii=False).replace('<', '\\u003c')
    buckets = {name: [] for name in ('split_apartment', 'split_house', 'full_apartment', 'full_house')}
    skipped = 0
    distance_exclusions = []
    private_candidates = {}
    for row in rows:
        listing_id = str(row.get('id') or '')
        source_id = str(row.get('sourceId') or '')
        if listing_id in HARD_DISTANCE_EXCLUSIONS:
            distance_exclusions.append({'id': listing_id, 'checkIn': row.get('checkIn'), 'checkOut': row.get('checkOut'), 'reason': HARD_DISTANCE_EXCLUSIONS[listing_id]})
            skipped += 1
            continue
        if any(source_id == excluded or listing_id == excluded or re.search(r'(?<!\d)' + re.escape(excluded) + r'(?!\d)', listing_id) for excluded in EXCLUDED_LISTING_IDS):
            distance_exclusions.append({'id': listing_id, 'checkIn': row.get('checkIn'), 'checkOut': row.get('checkOut'), 'reason': 'kullanıcı istemedi'})
            skipped += 1
            continue
        a = audit.get(key(row))
        if (ADULTS, *key(row)) in AVAILABILITY_EXCLUSIONS or not a or a.get('eligible') is not True or a.get('privacy') != 'entire_private' or a.get('group') not in ('recommended', 'conditional') or a.get('category') not in CATEGORIES:
            skipped += 1
            continue
        # User choice: private multiunit arrangements remain in the conditional
        # section even if their source audit recommends one of them.
        if a.get('category') == 'multiunit':
            a = {**a, 'group': 'conditional'}
        if ruebezahl_exception(row):
            a = {**a, 'group': 'conditional'}
        group = classify(row, a)
        if not group:
            skipped += 1
            continue
        route = routes.get(key(row), {})
        # Up to 35 minutes is provisional, except the named 19 Mistel route.
        # The complete stay still passes its price and premium-bed checks.
        row = {**row, '_listingGroup': group}
        decision, minutes = distance_decision(row, route, group, 45 if group in ('full_house', 'split_house') else 35)
        if decision != 'include':
            distance_exclusions.append({'id': listing_id, 'checkIn': row.get('checkIn'), 'checkOut': row.get('checkOut'), 'reason': decision, 'tresorCarMin': minutes})
            skipped += 1
            continue
        # Show and sort by the same conservative upper bound used by the gate.
        route = {**route, 'tresorCarMin': minutes}
        private_candidates[key(row)] = (row, a, route, group)

    # Build combinations from dated six-person offers, not historical budget
    # bands. Existing pair metadata is retained where the same pair exists.
    accepted_pairs = []
    pair_index = {(str(p.get('apartmentId')), str(p.get('villaId'))): p for p in budget_data['pairs'] if isinstance(p, dict)}
    first_legs = [(k, value) for k, value in private_candidates.items() if value[3] == 'split_apartment']
    second_legs = [(k, value) for k, value in private_candidates.items() if value[3] == 'split_house']
    pair_modes = {}
    for first_key, first in first_legs:
        for second_key, second in second_legs:
            first_record, second_record = price_records.get(first_key, {}), price_records.get(second_key, {})
            if not (selected_party_price_record(first[0], first_record) and selected_party_price_record(second[0], second_record)):
                continue
            first_eur, second_eur = offer_eur(first[0], first_record), offer_eur(second[0], second_record)
            if first_eur is None or second_eur is None:
                continue
            total_eur = first_eur + second_eur
            decision = price_route_decision(total_eur, [(first[0], first[2]), (second[0], second[2])])
            if decision not in ('standard', 'premium'):
                continue
            pair = pair_index.get((first_key[0], second_key[0]), {})
            leg_budgets = [budgets.get(first_key, {}), budgets.get(second_key, {})]
            tax_states = [b.get('sourceTaxStatus') or p.get('taxStatus') or 'unknown'
                          for b, p in zip(leg_budgets, (first_record, second_record))]
            tax_reserve = any(not (b.get('taxKnown') is True and b.get('sourceTaxStatus') == 'included') for b in leg_budgets)
            deposits = [str(b['depositText']) for b in leg_budgets if b.get('depositText')]
            currencies = [source_price(x[0], p)[1] for x, p in ((first, first_record), (second, second_record))]
            approximate = any(c != 'EUR' for c in currencies) or any(x[0].get('priceApproximate') for x in (first, second))
            pair = {**pair, 'apartmentId': first_key[0], 'villaId': second_key[0], 'sumEUR': total_eur,
                    'sourceTaxStatus': tax_states, 'taxReserveFlag': tax_reserve,
                    'depositText': deposits, 'approximate': bool(approximate), 'premium': decision == 'premium'}
            accepted_pairs.append((pair, first, second))
            pair_modes.setdefault(first_key, set()).add(decision)
            pair_modes.setdefault(second_key, set()).add(decision)

    for k, (row, a, route, group) in private_candidates.items():
        record = price_records.get(k, {})
        if group in ('split_apartment', 'split_house'):
            if k not in pair_modes:
                # Show the specifically requested two-night exception even if
                # there is no eligible apartment pairing; never invent a pair.
                amount = offer_eur(row, record) if selected_party_price_record(row, record) else None
                if not ruebezahl_exception(row) or price_route_decision(amount, [(row, route)]) not in ('standard', 'premium'):
                    skipped += 1
                    continue
            row = {**row, '_pairPremiumOnly': pair_modes.get(k) == {'premium'}}
        else:
            amount = offer_eur(row, record) if selected_party_price_record(row, record) else None
            decision = price_route_decision(amount, [(row, route)])
            alternate = eligible_booking_offers(row, route)
            if decision not in ('standard', 'premium'):
                if not alternate:
                    skipped += 1
                    continue
                row = promote_booking_offer(row, alternate)
        buckets[group].append((row, a, route))
    # This order also applies when JavaScript is disabled.
    def priority(item):
        row, candidate_audit, route = item
        beds, _ = verified_beds(row, bed_records, bed_breakdowns)
        beds = preference_bed_count(row, beds, bed_rooms)
        alternate = eligible_booking_offers(row, route)
        primary_best = is_best_offer(row, route, effective_budget(row, budgets), effective_price_record(row, price_records), beds)
        alternate_best = bool(meets_best_property_conditions(row, route, beds) and alternate and any(rate['underBestCap'] for rate in alternate['rates']))
        candidate = not (primary_best or alternate_best) and is_best_candidate(row, candidate_audit, route, effective_budget(row, budgets), effective_price_record(row, price_records), beds)
        minutes = route.get('tresorCarMin')
        if not isinstance(minutes, (int, float)) or isinstance(minutes, bool) or not math.isfinite(minutes) or minutes < 0:
            minutes = float('inf')
        amount = offer_eur(row, effective_price_record(row, price_records))
        return (0 if primary_best or alternate_best else 1 if candidate else 2, 1 if candidate_audit.get('category') in ('villa', 'private_house', 'multiunit') and minutes > 35 else 0, 0 if beds is not None and beds >= 6 else 1, minutes, amount if amount is not None else Decimal('Infinity'))

    index = 0
    rendered = {}
    approved = {}
    for group, items in buckets.items():
        parts = {'recommended': [], 'conditional': [], 'ruebezahl': []}
        for row, a, r in sorted(items, key=priority):
            index += 1
            part = 'ruebezahl' if ruebezahl_exception(row) else a['group']
            parts[part].append(card_html(row, a, r, points.get(key(row), {}), effective_budget(row, budgets), index, effective_price_record(row, price_records), bed_records, bed_breakdowns, bed_rooms))
            approved[key(row)] = (row, a)
        primary = '<div class="card-grid">' + ''.join(parts['recommended']) + '</div>'
        if ADULTS == 6 and not any(parts.values()):
            primary += '<div class="empty">Bu bölümde seçenek yok.</div>'
        conditional = ''
        if parts['conditional']:
            conditional = f'''<section class="conditional"><h3 class="conditional-title">Dikkat Edilmesi Gereken Seçenekler · {len(parts['conditional'])}</h3><p>Her kartta belirtilen koşul ayrıca değerlendirilmeli.</p><div class="card-grid">{''.join(parts['conditional'])}</div></section>'''
        exception = ''
        if parts['ruebezahl']:
            exception = f'''<section class="conditional ruebezahl-exception"><h3 class="conditional-title">Beğendiğiniz Rübezahl Evi · Özel İstisna</h3><p>Tresor’a araçla yaklaşık 37 dk; şehir için belirlenen süre sınırının üzerindedir. Yatak ve ek ücretler teyit gerektirir.</p><div class="card-grid">{''.join(parts['ruebezahl'])}</div></section>'''
        rendered[group] = primary + conditional + exception

    # Pair totals are pre-audited; the HTML never splits a four-night offer.
    pair_groups = {'recommended': [], 'conditional': []}
    for pair, first, second in sorted(accepted_pairs, key=lambda item: item[0]['sumEUR']):
        which = 'conditional' if 'conditional' in (first[1].get('group'), second[1].get('group')) else 'recommended'
        first_link, second_link = safe_url(first[0].get('link')), safe_url(second[0].get('link'))
        band = '≈ ' + usd(pair['sumEUR'] * USD_PER_EUR) + ' · gösterilen toplam'
        prefix = '≈ ' if pair.get('approximate') else ''
        taxes = pair.get('sourceTaxStatus') or []
        tax = 'Vergi veya ek ücretler net değil; toplam artabilir.' if pair.get('taxReserveFlag') else 'Kaynaklarda vergi ve ücretler dahil görünüyor.'
        if 'excluded' in taxes:
            tax = 'En az bir fiyat vergileri içermiyor; toplam artabilir.'
        elif 'conflict' in taxes:
            tax = 'Vergi bilgileri çelişkili; toplam artabilir.'
        deposit = ' '.join(str(x) for x in pair.get('depositText') or [])
        extra_cost = next((sentence for sentence in re.split(r'(?<=\.)\s+', str(pair.get('notes') or '')) if any(term in sentence.lower() for term in ('havlu', 'nevresim')) and 'ücret' in sentence.lower()), '')
        premium_badge = '<span class="premium-badge">Pahalı plan · 4.000 € üzeri</span>' if pair.get('premium') else ''
        checkout = pair.get('checkoutTime') or first[0].get('checkOutTime')
        checkin = pair.get('checkinTime') or second[0].get('checkInTime')
        transfer = ''
        if checkout and checkin:
            gap = pair.get('gapHours')
            gap_text = f' · {esc(gap)} saat aralık' if isinstance(gap, (int, float)) and not isinstance(gap, bool) else ''
            transfer = f'<p>1 Ocak: Çıkış {esc(checkout)} · Giriş {esc(checkin)}{gap_text}</p>'
        pair_limits = []
        for leg in (first, second):
            for limit in (leg[1].get('maxAdults'), leg[0].get('capacity')):
                if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0:
                    pair_limits.append(limit)
        pair_capacity = min(pair_limits) if pair_limits else None
        pair_share = share_table(Decimal(str(pair['sumEUR'])), 'EUR', pair_capacity, 4, approximate=bool(pair.get('approximate')), max_adults=pair_capacity)
        exception_note = '<p>Rübezahl özel istisnadır: Tresor’a araçla yaklaşık 37 dk; iki kişinin yatacağı yer teyitsiz.</p>' if ruebezahl_exception(second[0]) else ''
        pair_groups[which].append(f'''<div class="pair-row" data-first="{esc(pair['apartmentId'])}" data-second="{esc(pair['villaId'])}" data-sum-eur="{esc(pair['sumEUR'])}"><div>{premium_badge}<strong><a href="{esc(first_link)}" target="_blank" rel="noopener noreferrer">{esc(first[0]['name'])}</a> + <a href="{esc(second_link)}" target="_blank" rel="noopener noreferrer">{esc(second[0]['name'])}</a></strong><p>Daire: {esc(first[0]['price'])} · Ev: {esc(second[0]['price'])}</p>{exception_note}{transfer}<p>Not: {esc(tax)}</p>{f'<p>Not: {esc(deposit)}</p>' if deposit else ''}{f'<p>Not: {esc(extra_cost)}</p>' if extra_cost else ''}</div><div><strong>{prefix}{esc(euro(pair['sumEUR']))}</strong><span class="budget-label">{esc(band)}</span>{pair_share}</div></div>''')
    pair_html = ''
    for level, title in [('recommended', 'Örnek Eşleşmeler'), ('conditional', 'Koşullu Eşleşmeler / Kalabalık Oda Düzeni')]:
        chosen = pair_groups[level]
        if chosen:
            extra = f'<details class="more-pairs"><summary>Diğer Eşleşmeler · {len(chosen)-3}</summary>{"".join(chosen[3:])}</details>' if len(chosen) > 3 else ''
            opened = ' open' if level == 'conditional' else ''
            pair_html += f'''<details class="pairings"{opened}><summary>{title} · {len(chosen)}</summary><p>İki ayrı iki gecelik teklifin toplamı. İki yerin aynı anda müsait kalması garanti değil. Transfer ve ek ücretler ayrıca.</p>{''.join(chosen[:3])}{extra}</details>'''
    def count_label(names):
        vals = [item for name in names for item in buckets[name]]
        preferred = sum(item[1]['group'] == 'recommended' for item in vals)
        conditional = len(vals) - preferred
        return f'{preferred} Seçenek' + (f' · {conditional} Dikkat Gerektiren' if conditional else '')
    split_count = count_label(('split_apartment', 'split_house'))
    style = (HERE / 'liquid.css').read_text(encoding='utf-8')
    script = (HERE / 'liquid.js').read_text(encoding='utf-8')
    map_style = (HERE / 'map.css').read_text(encoding='utf-8')
    map_script = (HERE / 'map.js').read_text(encoding='utf-8')
    if '</script' in (script + map_script).lower() or '</style' in (style + map_style).lower():
        raise ValueError('Asset cannot be embedded safely')
    audit_status = '' if ELIGIBILITY.exists() else '<p class="audit-warning">Uygunluk denetim dosyası henüz yok; seçenekler güvenlik amacıyla gizlendi.</p>'
    exception_hero = ' Özel saunalı Rübezahl yaklaşık 37 dakikalık istisnadır.' if ADULTS == 6 else ''
    page = f'''<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Berlin Konaklama Seçenekleri</title><style>{style}\n{map_style}</style></head>
<body><div data-berlin-view data-id-prefix=""><a class="skip" href="#icerik">İçeriğe Geç</a><header class="topbar"><div class="wrap toprow"><a class="brand" href="#ust">Berlin Konaklamaları</a><span class="topmeta"><span class="desktop-meta">30 Aralık 2026 → 3 Ocak 2027 · {ADULTS} yetişkin</span><span class="mobile-meta">30 Ara → 3 Oca · {ADULTS} Kişi</span></span></div></header>
<main class="wrap" id="icerik"><section class="hero" id="ust"><p class="eyebrow"><span class="desktop-meta">{ADULTS} Yetişkin · 4 Gece · En Çok 6.000 € · 6 Ayrı Yatak Öncelikli</span><span class="mobile-meta">{ADULTS} Kişi · 4 Gece · En Çok 6.000 € · 6 Ayrı Yatak</span></p><h1>Berlin’de Birlikte Kalacak Yer</h1><p class="intro">İki duraklı bir plan ya da dört gece tek yerde kalış. RSO ve Tresor ulaşımı, yataklar ve fiyat kapsamı her kartta.</p><p class="hero-note">Herkesin kendine ait bir yatağı olması önceliklidir. Tresor’a araçla genellikle en çok 30 dakika; 4.000 € üzerindeki toplamlar için altı ayrı yatağı doğrulanmış seçeneklerde en çok 35 dakika.{exception_hero} Süreler tahmindir; yılbaşı trafiği ve taksi beklemesi dahil değil. Fiyat ve müsaitlik değişebilir.</p><p class="fx-note" data-fx-date="2026-11-05" data-fx-try="{TRY_PER_EUR}" data-fx-usd="{USD_PER_EUR}"><span class="fx-rate-short">≈ işaretli tutarlar 5 Kasım ECB kuruyla hesaplanır: 1 € = 56,17 TL.</span> <a href="#kur">Kur Bilgisi</a></p><details class="mobile-notes"><summary>Fiyat ve Plan Notları</summary><p>Herkesin yalnız kendine ait bir yatağı olması önceliklidir.</p><p>Dört gecelik gösterilen toplam en çok 6.000 €. Vergi veya ek ücretler toplamı artırabilir; ödeme öncesinde kontrol edin.</p><p>Tresor’a araçla genellikle en çok 30 dakika; 4.000 € üzerindeki toplamlar için altı ayrı yatağı doğrulanmış seçeneklerde en çok 35 dakika.{exception_hero} Süreler tahmindir; trafik ve taksi beklemesi dahil değil.</p><p>Fiyat ve müsaitlik değişebilir; kontrol tarihini ilanın kaynak ayrıntılarında görebilirsiniz. <span class="fx-rate-short">≈ işaretli tutarlar 5 Kasım ECB kuruyla hesaplanır: 1 € = 56,17 TL.</span> <a href="#kur">Kur Bilgisi</a></p><p>İki duraklı planda 1 Ocak çıkış, giriş ve transfer saatleri ayrıca kontrol edilmeli.</p></details>{audit_status}</section>
<div class="favorites-connection"><span id="favorites-status" role="status" aria-live="polite">Ortak favoriler bağlanmadı.</span><button id="favorites-retry" type="button" hidden>Yeniden Dene</button></div>
<div class="new-filter-row" id="new-filter-row"><button type="button" class="new-filter" id="new-filter" data-new-plan="full-daire" aria-pressed="false" aria-controls="full-daire">Yeni Daireler · <span class="new-count">0</span></button><button type="button" class="new-filter" id="new-villas-filter" data-new-plan="full-villa" aria-pressed="false" aria-controls="full-villa">Yeni Villalar · <span class="new-count">0</span></button><span id="new-filter-status" role="status" aria-live="polite"></span></div>
<div class="toolbar"><nav class="group-nav" aria-label="Konaklama Planları"><a href="#villa-daire" aria-current="location">2 Gece Daire + 2 Gece Villa</a><a href="#full-daire">Daire</a><a href="#full-villa">Villa</a></nav><div class="best-choices" role="group" aria-label="En uygun seçenekler"><button type="button" class="best-choice" data-best-plan="best-apartment" aria-pressed="false">En Uygun Daire</button><button type="button" class="best-choice" data-best-plan="best-house" aria-pressed="false">En Uygun Villa</button></div><button type="button" class="favorite-filter" id="favorite-filter" aria-pressed="false" disabled><span aria-hidden="true">♥</span> Favoriler <span class="favorite-count"></span></button><div class="controls" id="filter-controls"><label class="sort">Sırala <select id="sort" aria-label="Seçenekleri Sırala"><option value="best-priority">En Uygun Opsiyonlar</option><option value="priority">6 Ayrı Yatak ve Tresor</option><option value="price">Fiyat: Düşükten Yükseğe</option><option value="price-desc">Fiyat: Yüksekten Düşüğe</option><option value="recent">Yeniden Eskiye</option><option value="votes">En Çok Beğenilen</option><option value="balance">İki Kulübe Dengeli</option><option value="rso-car">RSO Taksi</option><option value="tresor-car">Tresor Taksi</option><option value="rso-transit">RSO Toplu</option><option value="tresor-transit">Tresor Toplu</option></select></label><span id="filter-status" class="visually-hidden" role="status" aria-live="polite"></span></div></div><p class="best-criteria">Tresor’a araçla en fazla 20 dakika ve herkes için ayrı yatak önceliklidir. Çift kişilik yatak, kaynakta ayrılabildiği doğrulanmadıkça bir yatak sayılır. Vergili toplamı teyitsiz adayları rezervasyondan önce kontrol edin.</p>
<noscript><p class="noscript">Sıralama, favoriler ve etkileşimli harita için JavaScript gerekir. Seçenekler aşağıdadır; kartlardaki harita araması ve fotoğraf bağlantıları kullanılabilir.</p></noscript>
<div class="view-choice" role="group" aria-label="Görünüm Seçimi"><button type="button" id="view-list" aria-pressed="true">Liste</button><button type="button" id="view-map" aria-pressed="false">Harita</button></div>
<dialog class="map-panel" id="map-panel" hidden aria-labelledby="map-title"><div class="map-heading"><div><h2 id="map-title">Harita</h2><p id="map-plan-label" class="map-plan-label" aria-live="polite">Plan: 2 Gece Daire + 2 Gece Villa</p></div><button type="button" class="map-close" id="map-close">Listeye Dön</button><div class="map-controls"><label>Plan <select id="map-group"><option value="villa-daire">2 Gece Daire + 2 Gece Villa</option><option value="full-daire">Daire</option><option value="full-villa">Villa</option><option value="best-apartment">En Uygun Daire</option><option value="best-house">En Uygun Villa</option><option value="hepsi">Hepsi</option></select></label><button type="button" id="map-fit" disabled>Tümünü Göster</button><button type="button" id="map-fit-clubs" disabled>Kulüplere Yaklaş</button></div></div><div id="map-canvas" class="map-canvas" role="region" aria-label="Konaklamalar ve kulüplerin yaklaşık konumları"></div><p class="map-notice" id="map-status" role="status" aria-live="polite">Harita yükleniyor.</p><button type="button" id="map-best-reset" class="map-best-reset" hidden>Hepsini Haritada Gör</button><p class="map-help">Fiyat etiketine dokunun; ilanın kısa kartı haritanın üstünde açılır. Birbirine yakın ilanlar bu ölçekte tek etikette toplanır; etiketteki “4 ilan” gibi sayı o etiketteki teklif sayısıdır, dokununca harita o bölgeye yaklaşır. Aynı noktadaki ilanların etiketi fiyat aralığını yazar; dokununca her biri kendi fiyat etiketiyle yan yana açılır ve fotoğraflı listesi çıkar. Kalp ortak favoriyi, gri etiket son kontrolde dolu tarihi gösterir. Kulüp adına dokunarak adres ve kaynağı açın. Harita açılmazsa kartlardaki Google Haritalar bağlantısını kullanın.</p></dialog>
<div class="groups"><section class="group" id="villa-daire"><div class="section-heading"><div><h2>2 Gece Daire + 2 Gece Villa</h2><p>İlk iki gece özel daire, son iki gece villa veya tamamı kiralanan özel ev. İki ayrı rezervasyon gerekir. Dört gecelik bütçeyi yalnız eşleşme toplamıyla değerlendirin.</p><p class="group-mobile">30 Ara → 1 Oca Daire · 1 → 3 Oca Ev</p></div><span class="group-count">{split_count}</span></div><p class="empty search-empty" hidden>Bu filtrelerle eşleşen seçenek yok.</p><div class="split-layout">
<div class="subsection"><div class="subheading"><h3>30 Aralık → 1 Ocak · 2 Gece Daire</h3></div>{rendered['split_apartment']}</div>
<div class="subsection"><div class="subheading"><h3>1 Ocak → 3 Ocak · 2 Gece Villa / Özel Ev</h3></div><p class="subnote">1 Ocak çıkışı ile sonraki giriş arasındaki süre ve transfer her eşleşmede ayrıca kontrol edilmeli.</p>{rendered['split_house']}</div></div>{pair_html}</section>
<section class="group" id="full-daire"><div class="best-apartment-intro" hidden><b>En Uygun Daireler ve Teyit Gerektiren Adaylar</b><p>Önce koşulları doğrulanan seçenekler, ardından yatak veya toplam fiyatı ayrıca kontrol edilmesi gereken adaylar gösterilir.</p></div><div class="best-empty empty" hidden><p>En uygun ölçütlerini kaynaklarla doğrulayan dört gecelik daire bulunamadı.</p><button type="button" class="best-reset">Tüm Daireleri Gör</button></div><div class="section-heading"><div><h2>Daire</h2><p>30 Aralık → 3 Ocak · dört gece özel daire veya ilanda açıkça belirtilen özel daire düzeni.</p><p class="group-mobile">30 Ara → 3 Oca · 4 Gece</p></div><span class="group-count">{count_label(('full_apartment',))}</span></div><p class="empty search-empty" hidden>Bu filtrelerle eşleşen seçenek yok.</p>{rendered['full_apartment']}</section>
<section class="group" id="full-villa"><div class="best-alternatives-intro" hidden><b>Koşullara En Yakın Villalar ve Evler</b><p>20 dakika ve altı ayrı yatak şartlarını birlikte doğrulayan villa bulunamadı. Aşağıdaki alternatiflerin farklarını her kartta belirttik.</p></div><div class="best-empty empty" hidden><p>En uygun ölçütlerini kaynaklarla doğrulayan dört gecelik villa bulunamadı.</p><button type="button" class="best-reset">Tüm Villaları Gör</button></div><div class="section-heading"><div><h2>Villa</h2><p>30 Aralık → 3 Ocak · dört gece villa veya tamamı kiralanan özel ev. Gerçek yapı türü kartta yazılıdır.</p><p class="group-mobile">30 Ara → 3 Oca · 4 Gece</p><button type="button" class="show-split-houses">1–3 Ocak · İki Gecelik Evleri Gör ↗</button></div><span class="group-count">{count_label(('full_house',))}</span></div><p class="empty search-empty" hidden>Bu filtrelerle eşleşen seçenek yok.</p>{rendered['full_house']}</section></div>
<footer class="footer"><p id="kur"><span class="fx-rate-long">5 Kasım 2026 tarihli ECB referans kurları: 1 € = 56,1729 TL; 1 € = 1,1224 USD.</span> Sayfa her açılışta günün ECB kurunu alır; alınamazsa son bilinen kur kullanılır. Referans kurlar banka veya tahsilat kuru değildir. <a href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html" target="_blank" rel="noopener noreferrer">ECB Kur Kaynağı ↗</a></p><p>Kaynak gözlemleri: 5 ve 6 Kasım 2026. Fiyat, vergiler, iptal ve kullanılabilirlik ilan ekranında yeniden kontrol edilmeli. Rezervasyon yapılmadı.</p><p>Araç süreleri taksi beklemesini ve yılbaşı trafiğini içermez; çoğu trafiksiz rota tahminidir. Toplu taşıma süreleri kaynakta belirtilen örneklerdir, yılbaşı tarifesi ve dönüş ayrıca kontrol edilmeli. {ADULTS} kişi için birden fazla araç gerekebilir.</p><p>Kişi başı pay, gösterilen toplamın altıya bölünmesidir. Gösterilen teklifin kişi sayısı kartta belirtilir; farklı kişi sayısında fiyat ve müsaitlik değişebilir. İlan kapasitesini aşan kişi ancak ev sahibinin açık onayıyla kalabilir; gösterilen matematiksel pay kabul anlamına gelmez.</p><p>Fotoğraflar ilan sağlayıcılarından yüklenir. Tarayıcı kaynak görseli engellerse karttaki ilan bağlantısını kullanın.</p></footer></main>
<dialog id="lightbox" class="lightbox" aria-label="Fotoğraf görüntüleyici"></dialog>
<dialog id="card-dialog" class="card-dialog" aria-labelledby="card-dialog-title"><div class="card-dialog-head"><strong id="card-dialog-title">Konaklama Ayrıntıları</strong><button type="button" id="card-dialog-close" aria-label="Konaklama Kartını Kapat">✕</button></div><div id="card-dialog-content" class="card-dialog-content"></div></dialog>
<script type="application/json" id="map-clubs">{clubs_json}</script></div><script>{script}</script><script>{map_script}</script></body></html>'''
    output.write_text(page, encoding='utf-8')
    print(json.dumps({'output': str(output), 'sourceRows': len(rows), 'matchedEligible': index, 'skipped': skipped, 'budgetPairs': len(accepted_pairs), 'photoOverrides': len(photo_overrides), 'groups': {k: len(v) for k, v in buckets.items()}, 'distanceExclusions': distance_exclusions, 'eligibilityPresent': ELIGIBILITY.exists(), 'routesPresent': ROUTES.exists()}, ensure_ascii=False))


if __name__ == '__main__':
    main()
