"""Rebuild the fixed 100-lot editorial pack from public source snapshots. No network."""
import json,pathlib,hashlib,urllib.parse
root=pathlib.Path(__file__).parent
load=lambda f:json.loads((root/f).read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
source=load('sources/transcription-extracted.json');editorial=load('editorial.json')
assert len(editorial)==100
# Numbered, inspected collation decisions. Line numbers are 1-based.
fix={
1:{2:'玉殿仙官第一班'},7:{1:'仙風道骨本天成'},8:{4:'士農商賈百無憂'},
18:{1:'知君指擬似空華'},24:{1:'一春無事苦憂煎'},26:{4:'田疇沾足雨滂沱'},28:{3:'人事即從天理見'},29:{3:'更若操修無倦已'},
31:{2:'春到門庭大吉昌'},38:{3:'等待榮華貴公子'},39:{1:'北山門外好安居'},40:{4:'崎嶇歷遍見亨衢'},
48:{3:'不遇虎頭人一喚',4:'全家誰保汝重歡'},50:{2:'也須步步要周旋'},52:{4:'決計扁舟渡北朝'},54:{3:'爭奈乘風流未便'},
74:{4:'長江一道放春回'},75:{1:'生前結得好姻緣'},78:{1:'家道豐腴自飽溫'},81:{3:'幸有當堂明月鏡'},83:{3:'主張門戶成難事'},
86:{1:'一般行貨好招邀'},87:{2:'舟中敵國笑中刀'},90:{4:'徒勞生事苦咨嗟'},92:{2:'物價喧騰倍昔年'},
93:{1:'春來雨水大連綿',3:'節氣直交三伏後'},95:{1:'知君袖裏有驪珠'},99:{1:'貴人相遇水雲鄉'}
}
gradefix={4:'下下',6:'下下',10:'下下',50:'上吉',80:'下下',83:'中平',84:'下下'}
additional={
31:[{'field':'poemLines[3]','scanReading':'菅堂快樂未渠央','chosenReading':'萱堂快樂未渠央','reason':'原刻菅字；采用固定转录版本的萱堂校订，意指母亲。保留原刻异文，不声称字形完全相同。'}],
74:[{'field':'poemLines[0]','scanReading':'崔巍崔魏復崔巍（巍/魏字形相近）','chosenReading':'崔巍崔魏復崔巍','reason':'固定转录所读；保留巍/魏的字形说明，不统一为现代通行写法。'}],
84:[{'field':'poemLines[0]','scanReading':'箇中事緒更紛狀','chosenReading':'箇中事緒更紛然','reason':'原刻末字为狀；采用固定转录的然作明确校订，原刻读法留在记录。'}],
98:[{'field':'poemLines[0:2]','scanReading':'經營百出費□□／□□□馳運未新（扫描磨损）','chosenReading':'經營百出費精神／南北奔馳運未新','reason':'第100页前两句局部磨损，以關聖帝君靈籤/98固定修订补足；道藏/98第二句相同，第一句有經商/經營异文，未混换本包首字。'}],
99:[{'field':'poemLines[0]','scanReading':'貴人相遇木雲鄉','chosenReading':'貴人相遇水雲鄉','reason':'原刻木；固定转录读水，采用水雲鄉作明确校订；相遇依底本，非转录的遭遇。'}]
}
rawpages=[]
for fn in ('wikisource-1-50.json','wikisource-51-100.json'):rawpages+=load('sources/'+fn)['query']['pages']
raw={int(p['title'].split('/')[-1]):p for p in rawpages}
scan=load('sources/scan-metadata.json')['query']['pages'][0]['imageinfo'][0]
lots=[];collation=[]
for e,ed in zip(source,editorial):
 n=e['number'];lines=e['lines'].copy();changes=[]
 for ln,value in fix.get(n,{}).items():
  if lines[ln-1]!=value:changes.append({'field':f'poemLines[{ln-1}]','transcriptionReading':lines[ln-1],'scanReading':value,'chosenReading':value,'reason':'逐页图像核对后依所选清刊本，不无声混用通行版本。'})
  lines[ln-1]=value
 grade=gradefix.get(n,e['grade'])
 if grade!=e['grade']:changes.append({'field':'traditionalGrade','transcriptionReading':e['grade'],'scanReading':grade,'chosenReading':grade,'reason':'等级依PDF原刻标题。'})
 changes+=additional.get(n,[])
 assert len(lines)==4 and all(len(x)==7 for x in lines),(n,lines)
 desc,keys=ed.split('|');page=raw[n];rev=page['revisions'][0]
 url='https://zh.wikisource.org/w/index.php?'+urllib.parse.urlencode({'title':e['title'],'oldid':rev['revid']})
 status='damaged_glyphs_restored' if n==98 else ('scan_collated_with_documented_variants' if changes else 'scan_collated')
 provenance={'scanSourceId':'harvard-53239458-qing','pdfPage':n+2,'transcriptionUrl':url,'revisionId':rev['revid'],'revisionTimestamp':rev['timestamp'],'wikitextSha256':sha(rev['slots']['main']['content'].encode()),'checkedOn':'2026-10-07','status':status,'reviewKind':'agent_visual_collation','reviewSheet':f'sources/review/check-{((n-1)//5)*5+1:03}-{((n-1)//5)*5+5:03}.jpg','notes':changes}
 lots.append({'id':f'guandi-qing-{n:03}','number':n,'title':f'第{n}签','traditionalGrade':grade,'poemLines':lines,'keywords':keys.split(','),'originalInterpretation':desc,'interpretationLicense':'MIT','provenance':provenance,'assets':[]})
 collation.append({'number':n,'pdfPage':n+2,'status':status,'revisionId':rev['revid'],'changes':changes})
pack={'schemaVersion':1,'libraryId':'guandi-qing-collated-100','version':'1.0.0','displayName':'关帝灵签 · 清刊本校勘版100签','entryCount':100,'editorialPolicy':'以姑苏钮氏藏板清刊本签号与等级为准，固定维基文库转录辅助；底本与转录不同逐项登记，个别可疑刻字采用有记录的校订，第98签磨损字以固定古籍转录补足。异体字以可显示的Unicode汉字转写，保留繁体，不自动简繁或历法转换。','lots':lots}
(root/'lots.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n')
(root/'collation.json').write_text(json.dumps({'checkedOn':'2026-10-07','reviewerType':'agent','humanSecondReview':'NOT_CHECKED','lotCount':100,'scanPagesRead':list(range(3,103)),'entries':collation},ensure_ascii=False,indent=2)+'\n')
paths=['lots.json','editorial.json','collation.json','schema.json','LICENSES.md','README.md','build-content.py','validate.mjs','validate.d.mts','sources/qing-edition.pdf','sources/wikisource-1-50.json','sources/wikisource-51-100.json','sources/scan-metadata.json','sources/edition-and-98-corroboration.json']
paths += [str(p.relative_to(root)) for p in sorted((root/'sources/review').glob('check-*.jpg'))]
manifest={'schemaVersion':1,'libraryId':pack['libraryId'],'version':pack['version'],'checkedOn':'2026-10-07','runtimeFiles':['lots.json'],'sourceFiles':[p for p in paths if p.startswith('sources/')],'entries':100,'poemLines':400,'totalVerseCharacters':2800,'assets':[],'assetPolicy':'文字版；不复用寺庙照片、标识或现代签解。未来视觉素材须原创或独立明确授权。','licenses':{'poems':'Public domain; original ancient work','scan':'Public domain as declared by Wikimedia Commons metadata; Harvard-Yenching source','interpretations':'MIT','wikisourceSnapshot':'CC-BY-SA-4.0 for editorial/transcription metadata; ancient text remains public domain'},'scanSource':{'id':'harvard-53239458-qing','title':'關帝靈籤.姑蘇鈕氏藏板.清刊本','editionPeriod':'between 1736 and 1861 per source metadata','holdingLibrary':'Harvard-Yenching Library','harvardManifest':'https://iiif.lib.harvard.edu/manifests/view/drs:53239458','url':scan['url'].split('?')[0],'metadataUrl':scan['descriptionurl'],'pdfPages':104,'lotPageOffset':2,'licenseDeclared':scan['extmetadata']['LicenseShortName']['value']},'files':[{'path':p,'bytes':(root/p).stat().st_size,'sha256':sha((root/p).read_bytes())} for p in paths],'acceptance':{'completeLibrary':'PASS','numberPoemSourceCollation':'PASS_WITH_DOCUMENTED_VARIANTS','interpretationCoverage':'PASS','originalAssetLicense':'PASS_NO_EXTERNAL_ASSETS','humanSecondReview':'NOT_CHECKED','runtimeModuleImplemented':False}}
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Built 100 lots / 400 lines / 2800 verse characters;',sum(bool(x['changes']) for x in collation),'documented-variant entries')
