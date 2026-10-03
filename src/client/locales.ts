export const zh = {
  hubPanel:'问象 · 占卜',
  panel:'梅花易数', eyebrow:'闲处观象 · 一念成卦', title:'梅花易数', subtitle:'把片刻闲暇，留给一卦与一份思考。',
  question:'所问之事', questionPlaceholder:'此刻，想问些什么？留空则作今日随占', questionHint:'一卦一问，写下心中所想即可',
  rule:'起卦方式', timeRule:'时间起卦', numberRule:'三数起卦', timeNow:'以此刻起卦', timeCustom:'指定时间', timeHint:'点击起卦时固定时间，以配置时区换算农历与时辰',
  numbersHint:'第一数取上卦，第二数取下卦，三数之和取动爻', firstNumber:'第一数', secondNumber:'第二数', thirdNumber:'第三数',
  context:'补充当下', contextHint:'可选：地点、天气、眼前所见或心情', contextPlaceholder:'例如：窗边，微雨，心境平静',
  cast:'起一卦', casting:'正在起卦', newCast:'另起一卦', waiting:'静候一念', waitingText:'先写下所问，再让六爻徐徐显现。',
  animationTitle:'静心 · 观象', animationText:'卦已定，墨未干', skip:'跳过动画', primary:'本卦', mutual:'互卦', changed:'变卦',
  body:'体', application:'用', moving:'动爻', lineSuffix:'爻', calculation:'查看起卦过程', basis:'计算依据',
  mutualSpecial:'纯乾纯坤：互其变卦', lunar:'农历', leap:'闰', month:'月', day:'日', year:'年', hour:'时',
  interpretation:'解读此卦', interpretationHint:'选择 DSH 已配置模型，生成本卦的一次完整解读', provider:'供应商', model:'模型',
  interpret:'开始解读', interpreting:'正在解读', cancel:'取消解读', complete:'完整解读', cancelled:'解读已取消', failed:'解读未完成',
  firstOnly:'本卦已保留第一次解读', copy:'复制结果', copied:'已复制', copyFailed:'复制未完成，请选择文字复制',
  noProviders:'还没有可用的模型，请先在 DSH 设置中配置供应商', noModels:'该供应商没有可选模型', refresh:'刷新模型目录',
  loadFailed:'插件读取未完成', loading:'正在准备', entertainment:'闲时一卦，供娱乐与自省', back:'返回起卦',
  outputPending:'解读将在这里徐徐展开', inputLocked:'本次解读进行中，请等待结束或先取消',
  unavailable:'所选模型已不可用，请刷新模型目录', timeout:'解读超时，已保留收到的内容', genericFailure:'解读未能完成，已保留收到的内容',
  authFailure:'供应商凭据不可用，请在 DSH 设置中检查', quotaFailure:'供应商额度或请求次数已用尽',
  numberPlaceholder:'正整数', localTime:'起卦时间', source:'使用模型', emptyQuestion:'今日随占'
} as const;
export type LocaleKey = keyof typeof zh;
export type Translate = (key:LocaleKey)=>string;
export const en:Record<LocaleKey,string> = {
  hubPanel:'Wenxiang · Divination',
  panel:'Meihua',eyebrow:'A quiet moment · A new reading',title:'Meihua Yishu',subtitle:'A small pause for symbols and reflection.',
  question:'Your question',questionPlaceholder:'What is on your mind? Leave blank for a daily reading.',questionHint:'One question for one reading',
  rule:'Casting method',timeRule:'Time',numberRule:'Three numbers',timeNow:'Use this moment',timeCustom:'Choose a time',timeHint:'The instant is fixed when you cast, using the configured time zone.',
  numbersHint:'First number: upper trigram. Second: lower. Their three-number sum: moving line.',firstNumber:'First',secondNumber:'Second',thirdNumber:'Third',
  context:'The present moment',contextHint:'Optional: place, weather, observations, or mood',contextPlaceholder:'For example: by the window, a light rain, feeling calm',
  cast:'Cast a reading',casting:'Casting',newCast:'New reading',waiting:'A quiet moment',waitingText:'Write your question, then watch the six lines unfold.',
  animationTitle:'Stillness · Symbols',animationText:'The reading is fixed; the ink unfolds',skip:'Skip animation',primary:'Primary',mutual:'Nuclear',changed:'Changed',
  body:'Body',application:'Application',moving:'Moving line',lineSuffix:'',calculation:'View calculation',basis:'Calculation',
  mutualSpecial:'Pure Qian/Kun: nuclear from changed',lunar:'Lunar date',leap:'Leap ',month:'/',day:'',year:' ',hour:' hour',
  interpretation:'Interpretation',interpretationHint:'Select a configured DSH model for one complete interpretation.',provider:'Provider',model:'Model',
  interpret:'Interpret',interpreting:'Interpreting',cancel:'Cancel',complete:'Complete interpretation',cancelled:'Cancelled',failed:'Incomplete interpretation',
  firstOnly:'The first interpretation is retained',copy:'Copy result',copied:'Copied',copyFailed:'Could not copy. Select and copy the text.',
  noProviders:'Configure a model provider in DSH Settings first.',noModels:'This provider has no available models.',refresh:'Refresh models',
  loadFailed:'Could not load the plugin',loading:'Preparing',entertainment:'For leisure and reflection',back:'Back to casting',
  outputPending:'The interpretation will appear here',inputLocked:'Wait for this interpretation or cancel it first.',
  unavailable:'The selected model is unavailable. Refresh the catalog.',timeout:'Timed out. Received text is retained.',genericFailure:'The interpretation could not complete. Received text is retained.',
  authFailure:'Check this provider’s credentials in DSH Settings.',quotaFailure:'The provider’s quota or request limit was reached.',
  numberPlaceholder:'Positive integer',localTime:'Cast time',source:'Model',emptyQuestion:'A daily reading'
};
