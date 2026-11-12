"""Source gallery expansion; remote media stays on its provider's servers."""
import json,re
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit,parse_qsl,urlencode
HERE=Path(__file__).resolve().parent

def high_res(url):
 u=urlsplit(url)
 if u.hostname=='cf.bstatic.com':return re.sub(r'/xdata/images/hotel/[^/]+/', '/xdata/images/hotel/max1920x1080/',url)
 if u.hostname=='a0.muscache.com':
  q=[(k,v) for k,v in parse_qsl(u.query,keep_blank_values=True) if k not in ('im_w','im_q')]
  q.append(('im_w','1440'))
  return urlunsplit((u.scheme,u.netloc,u.path,urlencode(q),u.fragment))
 return url

def identity(url):
 u=urlsplit(url)
 if u.hostname=='cf.bstatic.com':return u.hostname+'/'+u.path.rsplit('/',1)[-1]
 return u.hostname+u.path

def verified_galleries():
 """Use only galleries observed in the actual source listing or unit."""
 path=HERE/'verified-full-galleries.json'
 if not path.exists():return {}
 records=json.loads(path.read_text(encoding='utf-8')).get('records',[])
 result={}
 allowed={'img.holidu.com','a0.muscache.com','media.vrbo.com','cf.bstatic.com','images.traum-ferienwohnungen.de'}
 for rec in records:
  source=urlsplit(rec.get('source',''))
  photos=rec.get('photos',[])
  if source.scheme!='https' or not source.hostname or not photos or len(photos)!=rec.get('expected'):
   raise ValueError('Doğrulanmış galeri kaynağı veya sayısı geçersiz')
  seen=set()
  for photo in photos:
   url=photo.get('src',''); parsed=urlsplit(url)
   if parsed.scheme!='https' or parsed.hostname not in allowed or identity(url) in seen or re.search(r'/im/pictures/(?:user/|AirbnbPlatformAssets|airbnb-platform-assets)',parsed.path,re.I):
    raise ValueError('Doğrulanmış galeri görseli geçersiz veya tekrarlı')
   seen.add(identity(url))
  for target in rec.get('targets',[]):
   if target in result:raise ValueError(f'Tekrarlanan galeri hedefi: {target}')
   result[target]=rec
 return result

def apply_verified_galleries(rows, records):
 """Keep curated cover photos, then add the rest of the same verified gallery."""
 applied=[]
 for row in rows:
  rec=records.get(str(row.get('id','')))
  if not rec:continue
  ordered={identity(photo['src']):photo for photo in rec['photos']}
  images=[]; seen=set()
  for label,url in row.get('photos',[]):
   k=identity(url)
   if k in ordered and k not in seen:
    # Use the verified source URL at its best observed/resolved size.
    images.append([label,high_res(ordered[k]['src'])]);seen.add(k)
  for k,photo in ordered.items():
   if k not in seen:
    images.append([f'İlan Galerisi · Fotoğraf {len(images)+1}',high_res(photo['src'])]);seen.add(k)
  row['photos']=images
  previous=str(row.get('_photo_coverage') or row.get('photoNote') or '').strip()
  previous=previous.replace(' Kaynak kaydında erişilen galeri eklendi; ek karelerde oda adları ve fotoğrafın güncelliği ayrıca doğrulanmadı.','')
  if str(row.get('id'))=='six-holidu-56239528-full':
   # The former five-image Airbnb selection has been replaced completely.
   previous='Görseller Holidu ilanının kendi galerisinden; oda eşleşmeleri ayrıca doğrulanmadı.'
  elif str(row.get('id'))=='1611035619222657901':
   previous='Görseller Airbnb ilanının kendi galerisinden; oda eşleşmeleri ayrıca doğrulanmadı.'
  count_note=f'Kaynak galerisinde doğrulanan {len(images)} farklı fotoğraf gösteriliyor.'
  if rec.get('sourceShownCount') and rec['sourceShownCount']!=len(images):
   count_note+=f' Kaynakta {rec["sourceShownCount"]} fotoğraf gösterilse de yinelenen görsel bir kez sayıldı.'
  if rec.get('unitId'):
   count_note+=' Fotoğraflar seçili daire tipinin galerisinden; oda etiketleri ayrıca doğrulanmadı.'
  if 'vrbo.com' in rec['source']:
   count_note+=' Dış alan ve çevre fotoğrafları tesisin ortak bölümlerini de gösterebilir.'
  row['_photo_coverage']=(previous+' '+count_note).strip()
  applied.append((row.get('id'),len(images)))
 return applied

def expand(rows):
 catalog={}
 for dataset in json.loads((HERE/'all-photo-datasets.json').read_text()):
  for item in dataset.get('items',[]):
   if not re.fullmatch(r'\d+',str(item.get('id',''))):continue
   slot=catalog.setdefault(str(item['id']),{})
   for photo in item.get('images',[]):
    url=photo.get('imageUrl','')
    if urlsplit(url).hostname=='a0.muscache.com':slot[identity(url)]=url
 mapping={str(x['targetId']):str(x['sourceId']) for x in json.loads((HERE/'photos-extra-evidence.json').read_text())['records']}
 stats=[]
 for row in rows:
  sid=str(row.get('sourceId') or mapping.get(str(row.get('id')),'') or '')
  if not sid:
   match=re.search(r'airbnb\.[^/]+/rooms/(\d+)',str(row.get('link','')))
   if match:sid=match[1]
  images=[];seen=set()
  for label,url in row.get('photos',[]):
   k=identity(url)
   if k not in seen:images.append([label,high_res(url)]);seen.add(k)
  initial=len(images)
  # Keep uncertain unit matches as the previously vetted selection.
  excluded={'1755900812664134118'}
  for k,url in (catalog.get(sid,{}) if sid not in excluded else {}).items():
   if k not in seen:
    images.append([f'İlan Galerisi · Fotoğraf {len(images)+1}',high_res(url)]);seen.add(k)
  row['photos']=images
  if len(images)>initial:
   row['_photo_coverage']=str(row.get('_photo_coverage') or row.get('photoNote') or '')+' Kaynak kaydında erişilen galeri eklendi; ek karelerde oda adları ve fotoğrafın güncelliği ayrıca doğrulanmadı.'
  stats.append({'id':row['id'],'sourceId':sid,'before':initial,'after':len(images)})
 return stats
