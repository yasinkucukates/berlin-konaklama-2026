"""Merge separately priced adult-count offers without changing their identities."""
from html.parser import HTMLParser
import math
import re
class N:
 def __init__(self,tag='',attrs=(),raw=''):self.tag=tag;self.attrs=dict(attrs);self.raw=raw;self.children=[]
 def has(self,c):return c in self.attrs.get('class','').split()
 def walk(self):
  yield self
  for x in self.children:
   if isinstance(x,N):yield from x.walk()
 def html(self):
  if not self.tag:return ''.join(x.html() if isinstance(x,N) else x for x in self.children)
  return self.raw+''.join(x.html() if isinstance(x,N) else x for x in self.children)+(f'</{self.tag}>' if self.tag not in {'img','input','br','hr','meta','link','source','wbr','area','embed','col','param'} else '')
class P(HTMLParser):
 def __init__(self,s):super().__init__(convert_charrefs=False);self.root=N();self.stack=[self.root];self.feed(s)
 def handle_starttag(self,t,a):
  n=N(t,a,self.get_starttag_text());self.stack[-1].children.append(n)
  if t not in {'img','input','br','hr','meta','link','source','wbr','area','embed','col','param'}:self.stack.append(n)
 def handle_endtag(self,t):
  if self.stack[-1].tag==t:self.stack.pop()
  else:raise ValueError('Unbalanced '+t)
 def handle_data(self,d):self.stack[-1].children.append(d)
 def handle_entityref(self,n):self.handle_data('&'+n+';')
 def handle_charref(self,n):self.handle_data('&#'+n+';')
 def handle_comment(self,d):self.handle_data('<!--'+d+'-->')
def first(n,fn):return next(x for x in n.walk() if fn(x))
def offer_key(card):
 values=tuple(card.attrs.get(name,'') for name in ('data-id','data-check-in','data-check-out'))
 if not all(values):raise ValueError('Konaklama kartında teklif kimliği veya tarih eksik')
 return values
def drop_old_matches(node,new_keys):
 # Offer identities are exactly the same key used by the favorites backend.
 # Never discard another date, even if it belongs to the same property.
 node.children=[child for child in node.children if not (isinstance(child,N) and child.has('stay-card') and offer_key(child) in new_keys)]
 for child in node.children:
  if isinstance(child,N):drop_old_matches(child,new_keys)
def combine(dest,children):
 for n in children:
  if not isinstance(n,N):continue
  if n.has('card-grid'):
   target=next((x for x in dest.children if isinstance(x,N) and x.has('card-grid')),None)
   if target:target.children.extend(n.children)
   else:dest.children.append(n)
  elif n.has('conditional'):
   target=next((x for x in dest.children if isinstance(x,N) and x.has('conditional')),None)
   if target:
    grid=first(target,lambda x:x.has('card-grid'));grid.children.extend(first(n,lambda x:x.has('card-grid')).children)
    heading=first(target,lambda x:x.tag in ('h3','h4'))
    count=sum(x.has('stay-card') for x in target.walk())
    heading.children=[f'Dikkat Edilmesi Gereken Seçenekler · {count}']
   else:dest.children.append(n)
def merge(seven,six):
 a=P(seven).root;b=P(six).root
 # A six-adult and a seven-adult quote with the same identity are separate
 # prices for the same property. Keep both; the view links them and displays
 # only the quote appropriate to the selected party size.
 for root,adults in ((a,7),(b,6)):
  for card in [n for n in root.walk() if n.has('stay-card')]:
   title=first(card,lambda n:n.has('card-title'))
   if adults==6:
    title.children.insert(0,'<span class="offer-party offer-party-6">Kaynak Teklifi: 6 Yetişkin</span>')
   else:
    title.children.insert(0,'<span class="offer-party offer-party-7">Kaynak Teklifi: 7 Yetişkin</span>')
 for name in ('villa-daire','full-daire','full-villa'):
  ag=first(a,lambda n:n.attrs.get('id')=='p7-'+name);bg=first(b,lambda n:n.attrs.get('id')=='p6-'+name)
  if name=='villa-daire':
   dest=[n for n in ag.walk() if n.has('subsection')];src=[n for n in bg.walk() if n.has('subsection')]
   for x,y in zip(dest,src):
    y.children=[n for n in y.children if not (isinstance(n,N) and (n.has('subheading') or n.has('subnote')))]
    combine(x,y.children)
   for g in (ag,bg):
    for p in [n for n in g.children if isinstance(n,N) and n.has('pairings')]:
     summary=first(p,lambda n:n.tag=='summary');summary.children.insert(0,'7 Kişilik Kaynak Teklifleri · ' if g is ag else '6 Kişilik Kaynak Teklifleri · ')
   ag.children.extend(n for n in bg.children if isinstance(n,N) and n.has('pairings'))
  else:
   combine(ag,bg.children)
 nav=first(a,lambda n:n.has('group-nav'))
 links=[n for n in nav.children if isinstance(n,N) and n.tag=='a']
 order={'#p7-full-daire':0,'#p7-full-villa':1,'#p7-villa-daire':2}
 nav.children=sorted(links,key=lambda n:order[n.attrs['href']])
 container=first(a,lambda n:n.has('groups'))
 container.children=sorted([n for n in container.children if isinstance(n,N) and n.has('group')],key=lambda n:order['#'+n.attrs['id']])
 # A single grid per plan/leg lets price order span all caution states.
 for container in [n for n in a.walk() if n.has('subsection') or (n.has('group') and n.attrs.get('id')!='p7-villa-daire')]:
  direct=[n for n in container.children if isinstance(n,N) and n.has('card-grid')]
  cautious=[n for n in container.children if isinstance(n,N) and n.has('conditional')]
  if not direct:continue
  grid=direct[0]
  for section in cautious:
   for card in [n for n in section.walk() if n.has('stay-card')]:
    card.raw=card.raw.replace('class="stay-card"','class="stay-card conditional-card" data-conditional="true"')
    if not any(n.has('caution-popover') for n in card.walk()):raise ValueError('Koşullu kartta kaynaklı dikkat açıklaması eksik')
    grid.children.append(card)
   container.children.remove(section)
 # Keep the same default order when JavaScript is unavailable. Sort only the
 # card slots; surrounding markup and each offer's identity remain untouched.
 def number(card,name):
  try:value=float(card.attrs.get(name,''))
  except (TypeError,ValueError):return float('inf')
  return value if math.isfinite(value) and value>=0 else float('inf')
 def priority(card):
  beds=number(card,'data-normal-beds')
  return (0 if card.attrs.get('data-best-eligible')=='true' else 1 if card.attrs.get('data-best-candidate')=='true' else 2,
          1 if card.attrs.get('data-category') in ('villa','private_house','multiunit') and number(card,'data-tresor-car-min')>35 else 0,
          0 if beds!=float('inf') and beds>=6 else 1,
          number(card,'data-tresor-car-min'),number(card,'data-price-eur'),number(card,'data-order'))
 for grid in [n for n in a.walk() if n.has('card-grid')]:
  cards=iter(sorted((n for n in grid.children if isinstance(n,N) and n.has('stay-card')),key=priority))
  grid.children=[next(cards) if isinstance(n,N) and n.has('stay-card') else n for n in grid.children]
 # Empty states and counts belong to the merged result, not its seven-person
 # scaffold. Keep dynamic filter and best-choice empty states untouched.
 for container in [n for n in a.walk() if n.has('subsection') or (n.has('group') and n.attrs.get('id')!='p7-villa-daire')]:
  container.children=[n for n in container.children if not (isinstance(n,N) and n.has('empty') and not n.has('search-empty') and not n.has('best-empty'))]
  if not any(n.has('stay-card') for n in container.walk()):
   container.children.append('<div class="empty">Bu bölümde seçenek yok.</div>')
 for group in [n for n in a.walk() if n.has('group')]:
  count=next((n for n in group.walk() if n.has('group-count')),None)
  cards=[n for n in group.walk() if n.has('stay-card')]
  conditional=sum(n.attrs.get('data-conditional')=='true' for n in cards)
  if count:count.children=[f'{len(cards)-conditional} Seçenek'+(f' · {conditional} Dikkat Gerektiren' if conditional else '')]
 result=a.html().replace('7 kişi için birden fazla araç gerekebilir.', '6 kişi için birden fazla araç gerekebilir.')
 result=result.replace('· 7 yetişkin','· 6 Yetişkin').replace('>7 Yetişkin ·','>6 Yetişkin ·').replace('· 7 Kişi</span>','· 6 Kişi</span>').replace('>7 Kişi ·','>6 Kişi ·')
 result=result.replace('İki duraklı bir plan ya da dört gece tek yerde kalış.', 'Grubumuz altı kişi. Kişi başı tutarlar gösterilen toplamın altıya bölünmesidir. Teklifler altı yetişkin için alınmıştır; fiyat ve müsaitlik değişebilir.')
 return result
