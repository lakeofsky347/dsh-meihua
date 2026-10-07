import json,re,pathlib
from pypdf import PdfReader
from PIL import Image,ImageDraw,ImageFont
root=pathlib.Path(__file__).parent
ps=[]
for f in ('wikisource-1-50.json','wikisource-51-100.json'): ps+=json.loads((root/f).read_text())['query']['pages']
entries=[]
for p in sorted(ps,key=lambda x:int(x['title'].split('/')[-1])):
 w=p['revisions'][0]['slots']['main']['content'];n=int(p['title'].split('/')[-1]);head=w.split('聖意')[0]
 m=re.search(r'<poem>(.*?)</poem>',head,re.S)
 if m: lines=[x.strip() for x in m[1].strip().splitlines() if x.strip()]
 else:
  part=head.split('\n\n')[2];part=re.sub(r'\([^)]*\)','',part)
  lines=[x.strip() for x in re.split(r'[。\n]+',part) if x.strip()]
 assert len(lines)==4,(n,lines)
 assert all(len(x)==7 for x in lines),(n,lines)
 grade=re.search(r'(大吉|上上|上吉|上平|中吉|中平|下吉|下平|下下)',head)[1]
 entries.append({'number':n,'lines':lines,'grade':grade,'revid':p['revisions'][0]['revid'],'title':p['title'],'header':head.splitlines()[0]})
(root/'transcription-extracted.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2)+'\n')
r=PdfReader(root/'qing-edition.pdf');font=ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc',18)
for start in range(0,100,5):
 out=Image.new('RGB',(1450,1130),'white');d=ImageDraw.Draw(out)
 for i,e in enumerate(entries[start:start+5]):
  n=e['number'];im=[x.image for x in r.pages[n+1].images if x.image.width>500][0].convert('RGB')
  crop=im.crop((875,195,1165,im.height-8))
  x=i*290
  d.text((x+5,0),f"{n} / PDF {n+2} / {e['grade']}",font=font,fill='black')
  for k,line in enumerate(e['lines']):d.text((x+5,26+k*24),line,font=font,fill='black')
  out.paste(crop,(x,145))
 out.save(root/f'review/check-{start+1:03}-{start+5:03}.jpg',quality=92)
print('100 source poems, 20 proof sheets')
