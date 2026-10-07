# 本内容包的出处与许可

核对日期：2026-10-07。签库固定为 **《关帝灵签·姑苏钮氏藏板清刊本》校勘版，100签**，`guandi-qing-collated-100@1.0.0`。作者不详，不将附注标题中的“东坡解”等署名推断为历史作者事实。

- 古代签诗与原刻等级：公共领域古代作品。所据清刊本的馆藏元数据记为 1736—1861 年间；扫描来自 Harvard-Yenching Library。Wikimedia Commons 声明 Public domain / PD-old-70-expired / CC-PD-Mark，快照见 `sources/scan-metadata.json`。作品说明页：[清刊本扫描及许可](https://commons.wikimedia.org/wiki/File:關帝靈籤.姑蘇鈕氏藏板.清刊本.pdf)；原馆藏入口：[Harvard drs:53239458](https://iiif.lib.harvard.edu/manifests/view/drs:53239458)。馆藏水印表示来源，不用作本产品宣传标识。
- 自动压缩和未来AI解释不参与校订原诗；`originalInterpretation` 为本项目此次逐条原创的中文阅读提示，按仓库 MIT 许可提供。它不是复制现代寺庙、商业网站或译者的签解。
- 维基文库辅助转录及元信息：保留页面作者历史链接、每首 `oldid` 和修订时间，来源：[关圣帝君灵签](https://zh.wikisource.org/wiki/關聖帝君靈籤)。`sources/wikisource-*.json` 包含全部页面转录及编者注释，**这些快照中的新增编辑性内容按 CC-BY-SA-4.0 保留许可和署名链接**，不能当作仓库 MIT 内容重新声明。原有古代签诗的公共领域地位不因转录而改变；本包运行数据只提取古代原诗和等级，并另写原创释义。协议：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。
- 第98签局部磨损：使用本库固定转录补足，另对照公共领域《正统道藏》所收《护国嘉济江东王灵签》第98首固定版本。道藏首句为“經商…”而清刊本与本包为“經營…”，不把两书静默合并。其快照与差异在 `sources/edition-and-98-corroboration.json`、`collation.json` 留存。[第98首道藏转录](https://zh.wikisource.org/w/index.php?title=護國嘉濟江東王靈籤/98&oldid=1334869)。
- 插图、音频、字体、寺庙照片：内容包没有这些外部运行素材，`assets=[]`。未来页面使用系统字体和原创程序图形；如需复用图片，必须新增素材 ID、原作者、来源 URL、许可、许可快照和文件哈希，不借本包诗文许可推导图片许可。

`lots.json` 是校勘阅读版，**不是声称全部刻字皆清晰的逐字影印转录**。31的“菅堂”、84的“紛狀”、99的“木雲鄉”分别保留原刻记录并采用有来源的“萱堂”“紛然”“水雲鄉”校訂；98明确标记 `damaged_glyphs_restored`。34个有异文的条目均有逐项记录，其余仍保留每首来源、页码和 Agent 图像核对状态。尚未取得第二位人类校对者的复核；该状态为 `NOT_CHECKED`，不影响这份已完整记录来源和异文的开发内容包进入独立施工。
