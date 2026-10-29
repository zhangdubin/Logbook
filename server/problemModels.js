/**
 * server/problemModels.js —— 题目「模型」识别与具体化建议
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件？
 *
 * 用户提的第二个诉求是「**并能给出准确的建议**」。
 *
 * 之前的建议（ROOT_CAUSE_BANK / TIP_BANK / buildCorrectSteps）虽然按错因分了 7 类，
 * 但**每类模板对所有题都长一个样**：
 *
 *   「分步书写，步骤之间留出间距」
 *   「关键步骤必须写出中间过程，不跳步、不心算」
 *
 * 这类话对「鸡兔同笼」和「分数加减」是同一句，对「相遇问题」和「长方形面积」
 * 也还是同一句 —— 学生看完不知道**这道题**该怎么下手。
 *
 * 根子在于：建议的**锚点太粗**。锚点是「错因类型」（知识盲点/审题不清/计算失误…），
 * 而错因类型只说"你错在哪一类"，不说"这道题是什么模型、该套哪个公式"。
 *
 * 这个文件做两件事：
 *   1. 从题干里认出**题目模型**（相遇/追及/工程/浓度/鸡兔同笼/长方形面积…）
 *   2. 从题干里抽出**具体数值**，把模型套上去，算出**这道题自己的解法**
 *
 * 于是建议就从「通用废话」变成：
 *   「速度和 = 60 + 40 = 100 千米/时；相遇时间 = 300 ÷ 100 = 3 小时」
 *
 * 纯规则实现，不依赖任何模型，离线可用；识别不出来时**老实说不知道**，
 * 退回原有的通用模板（见 ai.js）。
 */

/* ========================================================================== */
/* 数值抽取                                                                  */
/* ========================================================================== */

/** 单位 → 归一化类别 */
const UNIT_KIND = {
  千米: 'distance', 公里: 'distance', 米: 'distance', 分米: 'distance', 厘米: 'distance',
  毫米: 'distance', 里: 'distance', 海里: 'distance',
  小时: 'time', 时: 'time', 分钟: 'time', 分: 'time', 秒: 'time', 天: 'time', 日: 'time',
  千克: 'mass', 公斤: 'mass', 吨: 'mass', 克: 'mass', 斤: 'mass',
  元: 'money', 角: 'money', 块: 'money',
  '吨/小时': 'rate', '千米/小时': 'rate', '米/秒': 'rate', 升: 'volume', 毫升: 'volume',
  人: 'count', 只: 'count', 棵: 'count', 个: 'count', 件: 'count', 本: 'count', 台: 'count',
  平方米: 'area', 立方米: 'volume', 平方厘米: 'area', 立方厘米: 'volume',
}

/**
 * 从题干里抽出带单位的数值。
 *
 * 例："甲乙两地相距 300 千米，小明每小时行 60 千米"
 *   → [{value:300, unit:'千米', kind:'distance', label:'distance'},
 *      {value:60,  unit:'千米', kind:'distance', label:'speed'}]
 *
 * label 靠数值**前面**的词判断（"相距/距离/路程" → distance，
 * "每小时/速度" → speed，"……后/用了" → time）。
 *
 * @param {string} text
 * @returns {Array<{value:number, unit:string, kind:string, label:string, raw:string}>}
 */
export function extractQuantities(text) {
  const src = String(text ?? '')
  const out = []
  if (!src) return out

  // 数值 + 可选单位（含"每小时 60 千米"这种速率）
  const re = /(\d+(?:\.\d+)?)\s*(千克|公斤|千米|公里|小时|分钟|平方米|立方米|厘米|毫米|分米|米|吨|元|角|块|克|斤|秒|时|天|日|分|里|人|只|棵|个|件|本|台|升|毫升)/g
  let m
  while ((m = re.exec(src)) !== null) {
    const value = Number(m[1])
    if (!Number.isFinite(value)) continue
    const unit = m[2]
    const kind = UNIT_KIND[unit] ?? 'other'

    // 往前看 12 个字，判断这个数在题目里扮演什么角色
    const before = src.slice(Math.max(0, m.index - 12), m.index)
    let label = 'other'
    if (/每小时|每分钟|速度|时速|走了|行了|跑|开/.test(before)) label = 'speed'
    // 立体图形的尺寸：长/宽/高/厚/棱长/半径/直径
    // 「高速」要排除掉 —— 那是速度不是高度
    else if (/(?:长|宽|高|厚|棱长|半径|直径)(?![速度])/.test(before)) label = 'dimension'
    else if (/相距|距离|路程|全长|边长/.test(before)) label = 'distance'
    else if (/时间|用了|花费|经过|后|之内|分钟|小时/.test(before)) label = 'time'
    else if (/价格|售价|成本|买|卖|花了|元/.test(before)) label = 'money'
    else if (/重|质量|称/.test(before)) label = 'mass'
    else if (/面积/.test(before)) label = 'area'

    // 「每小时行 60 千米」→ 速率，单独记一个 label
    if (/每小时|每分钟/.test(before)) {
      out.push({ value, unit: `${unit}/时`, kind: 'rate', label: 'speed', raw: m[0] })
      continue
    }

    out.push({ value, unit, kind, label, raw: m[0] })
  }
  return out
}

/** 按 label 取值 */
function pick(list, label) {
  return list.filter((q) => q.label === label)
}

/* ========================================================================== */
/* 题目模型库                                                                */
/* ========================================================================== */

/**
 * 每个模型带：
 *   name      —— 模型名（会写进建议里）
 *   subject   —— 适用学科
 *   match     —— 识别用的正则
 *   weight    —— 匹配权重（多条的权重之和决定置信度）
 *   formula   —— 核心公式（写给同学看）
 *   think     —— 解题第一步该怎么想
 *   pitfalls  —— 这类题最容易错的地方
 */
/**
 * 模型的「别名」—— 用来判断模型是否已经被某个知识点覆盖。
 * 若已有知识点的名字命中别名，就不再重复插入模型名。
 */
const MODEL_ALIASES = {
  // 别名只用**区分性**关键词。
  // 之前 meet 的别名里带了「行程」，结果「行程问题」把更具体的「相遇问题」吞掉了 ——
  // 知识点写着"行程问题"，步骤却在讲相遇，俩人对不上。
  meet: ['相遇'],
  chase: ['追及'],
  journey: ['行程'],
  work: ['工程', '工作效率'],
  concentration: ['浓度', '溶液'],
  profit: ['利润', '经济'],
  average: ['平均'],
  chicken_rabbit: ['鸡兔', '假设'],
  tree: ['植树', '间隔'],
  geometry: ['面积', '周长', '几何', '长方形', '正方形', '三角形', '梯形', '圆'],
  solid: ['体积', '表面积', '立体'],
  fraction: ['分数', '百分'],
  sum_diff: ['和差', '和倍', '差倍'],
  ratio: ['比', '比例'],
  number_theory: ['数论', '因数', '倍数', '整除'],
  recite: ['默写', '古诗', '诗文'],
  grammar_cn: ['病句', '语病', '句子'],
  reading: ['阅读', '阅读理解'],
  ancient_cn: ['文言'],
  tense: ['时态', '语法', '语态'],
  cloze: ['完形'],
  reading_en: ['阅读'],
  physics_force: ['力', '运动', '摩擦'],
  physics_pressure: ['压强', '浮力', '密度'],
  chemistry: ['化学', '方程式'],
}

export const PROBLEM_MODELS = {
  /* ------------------------------- 数学 ------------------------------- */
  meet: {
    key: 'meet',
    name: '相遇问题',
    subject: '数学',
    match: [/相向/, /相遇/, /迎面/, /同时.{0,6}出发.{0,12}(对面|相向)/, /两人.{0,4}同时.{0,10}出发/],
    formula: '路程和 ÷ 速度和 = 相遇时间',
    think: '两人相向而行，每小时一共靠近「速度和」那么远。所以先求速度和，再用总路程除以它。',
    pitfalls: [
      '把「相向」当成「同向」，用了速度差而不是速度和',
      '总路程只算了一段，忘了两人合起来走的距离',
    ],
  },
  chase: {
    key: 'chase',
    name: '追及问题',
    subject: '数学',
    match: [/同向/, /追及/, /追上/, /追上前面/, /后面.{0,6}出发.{0,12}前面/],
    formula: '追及路程 ÷ 速度差 = 追上所需时间',
    think: '同向而行时，后面的人每分钟只能追近「速度差」那么远。先求速度差，再用追及路程除以它。',
    pitfalls: [
      '同向却用了速度和（和相遇问题搞混）',
      '把「追及路程」当成了两人走的总路程',
    ],
  },
  journey: {
    key: 'journey',
    name: '行程问题',
    subject: '数学',
    match: [/行驶|行车|走路|骑车|每(?:小时|天|分钟)行/, /路程|速度|千米\/小时/],
    formula: '速度 × 时间 = 路程',
    think: '先分清谁是「速度」、谁是「时间」、谁是「路程」，缺哪个就用另外两个乘除补上。',
    pitfalls: [
      '单位不统一（小时和分钟混用）',
      '往返、加上停留时间没有算进去',
    ],
  },
  work: {
    key: 'work',
    name: '工程问题',
    subject: '数学',
    match: [/工程|工作效率|单独完成|合作完成|一起做|合修|修好|完工/],
    formula: '工作总量 ÷ 工作效率 = 工作时间',
    think: '把总工作量看成「1」，每个人的效率就是「1 ÷ 他单独做要的时间」。合作时效率相加。',
    pitfalls: [
      '把合作效率当成其中一个人的效率',
      '中途有人加入/退出，没有分段计算',
    ],
  },
  concentration: {
    key: 'concentration',
    name: '浓度问题',
    subject: '数学',
    match: [/浓度|溶质|溶剂|溶液|盐水|含糖|兑水|加水|稀释/],
    formula: '溶质质量 ÷ 溶液质量 = 浓度',
    think: '盯住「溶质」这一份东西。加水时溶质不变、加糖时溶液变大，抓住不变的那份就清楚了。',
    pitfalls: [
      '加水时把溶质也算成了增加的',
      '分母用了溶液质量而不是总质量',
    ],
  },
  profit: {
    key: 'profit',
    name: '利润问题',
    subject: '数学',
    match: [/利润|售价|成本价|进价|打折|促销|盈亏/],
    formula: '利润 = 售价 − 成本；利润率 = 利润 ÷ 成本',
    think: '先找出成本价这个「单位1」，其他量都相对它来说。打几折就是售价变成成本的百分之几。',
    pitfalls: [
      '利润率的分母用了售价而不是成本',
      '「打八折」算成了「减 80%」',
    ],
  },
  average: {
    key: 'average',
    name: '平均数问题',
    subject: '数学',
    match: [/平均(?:数|成绩|速度|身高|体重)/, /平均/],
    formula: '总数 ÷ 份数 = 平均数',
    think: '平均数乘份数就是总数。先用「平均数 × 份数」求出总数，再加减变化量。',
    pitfalls: [
      '份数数错（几个人/几门课）',
      '求「增加后的平均数」时忘了把新增的数也加进总数',
    ],
  },
  chicken_rabbit: {
    key: 'chicken_rabbit',
    name: '鸡兔同笼',
    subject: '数学',
    match: [/鸡兔同笼/, /鸡和兔/, /头.{0,6}脚/, /多少只鸡.*多少只兔/],
    formula: '假设全按一种算 → 算出与实际相差的总数 → 用差值换算',
    think: '先假设全是鸡，算出脚的总数；跟实际比，每多一只兔就多 2 只脚，用差值除以差就能换算。',
    pitfalls: [
      '假设后忘了换算回另一种的数量',
      '差值除错了（脚/头 的差）',
    ],
  },
  tree: {
    key: 'tree',
    name: '植树问题',
    subject: '数学',
    match: [/植树|种树|每隔.{0,4}米.{0,8}种|路灯|排队/],
    formula: '间隔数 = 总长 ÷ 间隔；棵数 = 间隔数 + 1（两端都种）',
    think: '先算间隔数，再根据「两端都种 / 只种一端 / 两端都不种 / 圆形」调整棵数。',
    pitfalls: [
      '忘了加 1（两端都种时棵数比间隔数多 1）',
      '没看清题目说的是哪种植树情况',
    ],
  },
  geometry: {
    key: 'geometry',
    name: '几何面积与周长',
    subject: '数学',
    // ⚠️ 「体积」「表面积」**故意不含进来** ——
    //   「立体图形体积与表面积」里有「面积」两个字，混进来会把
    //   体积题判成面积题，然后拿面积公式去讲体积题。
    //   体积/表面积由 solid（立体图形）模型接。
    //
    // ⚠️⚠️ 注意**正则里 `|` 的优先级最低**：
    //   /(?<!表)面积|正方形|圆/  实际是  (?<!表)面积  或  正方形  或  圆
    //   —— 否定环视**只作用于第一个分支**，后两个分支照样能命中。
    //   所以每个需要排除的分支都要**各自带上**环视，
    //   不能把环视写在整条正则的最前面就以为全管住了。
    match: [
      // 「表面积」不算平面面积
      /(?<!表)面积/,
      // 「圆柱」「圆锥」是立体图形，不是平面上的圆
      /(?<!立)圆(?![柱锥])/,
      /长方形|正方形|三角形|梯形|平行四边形/,
      /周长/,
    ],
    formula: '长方形 S=ab，C=2(a+b)；三角形 S=ah÷2；圆 S=πr²，C=2πr',
    think: '先分清题目求的是「面积」还是「周长」—— 公式完全不同。面积题要找到对应的底和高。',
    pitfalls: [
      '周长和面积用混了公式',
      '三角形/梯形忘记除以 2',
      '底和高不对应（用了斜边）',
    ],
  },
  solid: {
    key: 'solid',
    name: '立体图形体积与表面积',
    subject: '数学',
    match: [/体积|表面积|立方|长方体|正方体|圆柱|圆锥|球体|正方体/],
    formula:
      '长方体 V=abc、S=2(ab+bc+ac)；正方体 V=a³、S=6a²；圆柱 V=πr²h、S=2πr²+2πrh；圆锥 V=⅓πr²h',
    think:
      '先分清求的是「体积」还是「表面积」，再看是什么立体图形。体积是「占多少空间」，表面积是「外面一共多少皮」—— 公式完全不同，千万别混。',
    pitfalls: [
      '体积公式和表面积公式用混了',
      '正方体表面积忘了乘 6（6 个面）',
      '圆柱底面积算成了 2πr（周长）而不是 πr²',
      '单位没换算：体积用立方单位、表面积用平方单位',
    ],
  },
  fraction: {
    key: 'fraction',
    name: '分数百分数应用题',
    subject: '数学',
    // 注意要能命中「25%」这种写法 —— 很多卷子只写百分号不写「百分之几」
    match: [/百分之|分数|折/, /\d+(?:\.\d+)?\s*%/, /占.{0,6}的/],
    formula: '单位「1」× 对应率 = 对应量',
    think: '百分数应用题只有一个诀窍：**找准单位「1」**。「比 A 多 20%」的单位1是 A，「比 A 少 20%」也一样。',
    pitfalls: [
      '单位「1」找错了（A 的 20% 和 B 的 20% 不是一回事）',
      '连续两次的百分数直接相加（应相乘）',
    ],
  },
  sum_diff: {
    key: 'sum_diff',
    name: '和差问题',
    subject: '数学',
    match: [/和.*差/, /共.*多.*少/, /两数.{0,4}(和|差)/],
    formula: '大数 =（和 + 差）÷ 2，小数 =（和 − 差）÷ 2',
    think: '用「和差问题公式」：把差加到和里就变成了两个大数，除以 2 得到大数。',
    pitfalls: ['公式记反了，把和当成了差', '除以 2 时算错'],
  },
  ratio: {
    key: 'ratio',
    name: '比与比例问题',
    subject: '数学',
    match: [/比例/, /比值/, /按.*比/, /∶/],
    formula: '每份 = 总量 ÷ 总份数；各部分 = 每份 × 各自份数',
    think: '把比写成「几比几」，总份数 = 前后项相加，再用总量除以总份数求出「1 份」是多少。',
    pitfalls: ['总份数算错', '前后项弄反了'],
  },
  number_theory: {
    key: 'number_theory',
    name: '数论问题',
    subject: '数学',
    match: [/最大公约数|最小公倍数|整除|余数|能被.{0,6}整除|因数|倍数/],
    formula: '短除法求最大公约数与最小公倍数',
    think: '用短除法：两边都能被同一个质数整除就除下去，直到不能整除为止。',
    pitfalls: ['最大公约数和最小公倍数用反了', '短除法漏掉某一步'],
  },

  /* ------------------------------- 语文 ------------------------------- */
  recite: {
    key: 'recite',
    name: '古诗文默写与名句填空',
    subject: '语文',
    match: [/默写|填空|补充完整|上句|下句|诗句/],
    formula: '按原文逐字书写，注意错别字',
    think: '这类题靠的是**积累**。把错的那一句单独抄下来，旁边标上出处（哪首诗、哪篇课文）。',
    pitfalls: ['同音字写错（形近字更常错）', '漏字或多字', '标点符号写错'],
  },
  grammar_cn: {
    key: 'grammar_cn',
    name: '病句辨析与修改',
    subject: '语文',
    match: [/病句|修改病句|语病|句子.*(修改|改正)/],
    formula: '先找主干（主谓宾），再看修饰语和关联词',
    think: '改病句分两步：**先缩句找主干**，主干不通就是缺主语/搭配不当；主干通就查**修饰语**（用词重复、语序颠倒、前后不对应）。',
    pitfalls: [
      '没有缩句就改，改了表面现象',
      '一种病因改了又引入另一种',
      '改完后意思变了（过度改写）',
    ],
  },
  reading: {
    key: 'reading',
    name: '现代文阅读理解',
    subject: '语文',
    match: [/阅读(?:下面|短文|理解|材料)?/, /根据.{0,6}(短文|文章|语段)/, /阅读全文/],
    formula: '先审题 → 回原文定位 → 结合语境作答',
    think: '阅读题**答案在原文里**，不在你的想象里。先看题目问什么，再回原文找那一段，答案要用原文的话改写。',
    pitfalls: [
      '答案脱离原文，用自己的主观感受代替',
      '题目问「作用」答成了「内容」',
      '问「几个方面」只答了一点',
    ],
  },
  ancient_cn: {
    key: 'ancient_cn',
    name: '文言文阅读',
    subject: '语文',
    match: [/文言/, /之乎者也/, /通假字|实词|虚词/],
    formula: '重点实词逐字落实，虚词看位置判断',
    think: '文言文翻译按「留、删、补、换、调」处理：人名地名留，助词删，缺字补，通假换，语序调。',
    pitfalls: ['关键实词没落实', '句子成分没理清导致译不通'],
  },

  /* ------------------------------- 英语 ------------------------------- */
  tense: {
    key: 'tense',
    name: '时态与语法填空',
    subject: '英语',
    // 除了直接写「时态」，还要能认出「括号填词」这种题型格式：
    //   He ____ (go) to school yesterday.
    // 这种句子里虽然没有「时态」二字，但空格里给的是动词原形、旁边有时间状语，
    // 考的就是时态。
    match: [
      /时态|语态|主谓一致|第三人称单数|过去式|现在完成/,
      /[_＿]{2,}\s*[（(]/,
      /\b(yesterday|tomorrow|now|every|since|already|yet|before|last|next)\b/i,
    ],
    formula: '先找时间状语 → 再定动词形式',
    think: '先圈出句子里表示时间的词（yesterday / now / since / by the time…），时间决定动词形式；再检查主语和动词是否一致。',
    pitfalls: ['第三人称单数忘了加 -s/-es', 'have/has 用错', '过去式和过去分词混用'],
  },
  cloze: {
    key: 'cloze',
    name: '完形填空',
    subject: '英语',
    match: [/完形填空|完型填空/],
    formula: '先通读全文把握大意 → 再逐空看上下文逻辑',
    think: '完形**先看全文再填空**。空缺处往往靠上下文的逻辑词（but / however / therefore）提示，答案多为同义复现。',
    pitfalls: ['孤立看每个空，忽略上下文', '被首句误导，没把握全文主旨'],
  },
  reading_en: {
    key: 'reading_en',
    name: '英语阅读理解',
    subject: '英语',
    match: [/阅读理解|阅读短文|根据.{0,6}短文/],
    formula: '先看题干定位 → 带着关键词回原文 → 排除干扰项',
    think: '英语阅读**先看题目再读文章**，带着题干里的关键词去找句子。选项里的绝对化表述（all / never / only）通常是要排除的。',
    pitfalls: ['被原文里没提到的信息误导', '选了「原文有但题目没问」的句子'],
  },

  /* --------------------------- 物理 / 化学 --------------------------- */
  physics_force: {
    key: 'physics_force',
    name: '力与运动',
    subject: '物理',
    match: [/摩擦力|受力分析|牛顿第二定律|合力|二力平衡/],
    formula: 'F合 = ma；平衡时 F合 = 0',
    think: '受力分析要**按顺序**：重力 → 支持力 → 摩擦力 → 拉力。摩擦力的方向永远与相对运动方向相反。',
    pitfalls: ['漏掉某个力（尤其是摩擦力）', '摩擦力方向画反'],
  },
  physics_pressure: {
    key: 'physics_pressure',
    name: '压强与浮力',
    subject: '物理',
    match: [/压强|浮力|密度|阿基米德/],
    formula: 'p = F/S；F浮 = ρ液·g·V排',
    think: '压强题先求压力再除以受力面积；浮力题**用排开液体的体积**，不是物体体积（漂浮时尤其容易错）。',
    pitfalls: ['浮力用了物体总体积', '压强面积算成表面积', '单位没换算成国际单位'],
  },
  chemistry: {
    key: 'chemistry',
    name: '化学方程式与溶液',
    subject: '化学',
    match: [/化学方程式|配平|质量守恒|溶液配制|摩尔/],
    formula: '写 → 配平 → 标条件 → 检查',
    think: '化学方程式四步走：**写对化学式 → 配平 → 标注反应条件（点燃/加热）→ 检查两边原子数**。',
    pitfalls: ['化学式写错', '漏标反应条件', '配平时改了化学式'],
  },
}

/* ========================================================================== */
/* 模型识别                                                                  */
/* ========================================================================== */

/**
 * 从题干里认出题目模型。
 *
 * @param {string} text 题干
 * @param {string} subject 学科
 * @returns {{key:string,name:string,confidence:number,evidence:string[],formula:string,think:string,pitfalls:string[]}|null}
 */
export function detectProblemModel(text, subject) {
  const src = String(text ?? '')
  if (!src.trim()) return null

  const scores = []
  for (const model of Object.values(PROBLEM_MODELS)) {
    if (subject && model.subject !== subject) continue
    const evidence = []
    let weight = 0
    for (const re of model.match) {
      const hit = src.match(re)
      if (hit) {
        weight += 1
        evidence.push(hit[0])
      }
    }
    if (weight > 0) {
      // 命中数越多越可信，但收益递减；上限 0.95
      const confidence = Math.min(0.95, 0.55 + (weight - 1) * 0.18)
      scores.push({ model, weight, evidence, confidence })
    }
  }

  if (!scores.length) return null
  scores.sort((a, b) => b.weight - a.weight || b.confidence - a.confidence)
  const top = scores[0]
  // 和第二名咬得太紧就不下判断（宁可说不知道，也不要给个错的模型）
  if (scores[1] && top.weight - scores[1].weight < 1) {
    return {
      key: top.model.key,
      name: top.model.name,
      confidence: Math.min(top.confidence, 0.45),
      evidence: top.evidence,
      formula: top.model.formula,
      think: top.model.think,
      pitfalls: top.model.pitfalls,
      ambiguous: true,
    }
  }
  return {
    key: top.model.key,
    name: top.model.name,
    confidence: top.confidence,
    evidence: top.evidence,
    formula: top.model.formula,
    think: top.model.think,
    pitfalls: top.model.pitfalls,
    ambiguous: false,
  }
}

/* ========================================================================== */
/* 把模型套上具体数值 → 这道题自己的解法                                     */
/* ========================================================================== */

/**
 * 针对具体题目生成「带真实数字」的解题步骤。
 *
 * 例：相遇问题，"相距 300 千米，每小时行 60 千米 / 40 千米"
 *   → 第 2 步：「速度和 = 60 + 40 = 100 千米/时」
 *   → 第 3 步：「相遇时间 = 300 ÷ 100 = 3 小时」
 *
 * @param {object} model detectProblemModel 的结果
 * @param {string} text 题干
 * @returns {{steps: Array<{title:string,detail:string}>, computed: string|null, formulas: string[]}}
 */
export function buildWorkedSteps(model, text) {
  if (!model || model.ambiguous) return { steps: [], computed: null, formulas: [] }

  const q = extractQuantities(text)
  const speeds = pick(q, 'speed')
  const distances = pick(q, 'distance')
  const times = pick(q, 'time')
  const steps = []
  const formulas = [model.formula]
  let computed = null

  /** 长度单位 → 面积单位（米 → 平方米） */
  const areaUnit = (u) => {
    if (!u) return '平方单位'
    if (u.includes('平方')) return u
    return `${u}平方`.replace('米平方', '平方米')
  }
  /** 长度的单位（去掉速率里的 "/时"） */
  const lenUnit = (u) => String(u ?? '').replace('/时', '')
  const num = (v) => (Number.isInteger(v) ? v : Number(v.toFixed(2)))

  switch (model.key) {
    case 'meet': {
      const total = distances[0]
      const v1 = speeds[0]
      const v2 = speeds[1]
      const vUnit = lenUnit(v1?.unit ?? v2?.unit ?? '千米/时')
      const dUnit = lenUnit(total?.unit ?? '千米')
      steps.push({
        title: '认出这是相遇问题',
        detail: `题目里出现「${model.evidence[0] ?? model.name}」，两人相向而行。${model.think}`,
      })
      if (v1 && v2) {
        const sum = num(v1.value + v2.value)
        steps.push({
          title: '求速度和',
          detail: `速度和 = ${num(v1.value)} + ${num(v2.value)} = ${sum} ${vUnit}/时（两人每小时一共靠近 ${sum} ${dUnit}）`,
        })
        if (total) {
          const t = total.value / sum
          const tTxt = num(t)
          computed = `相遇时间 = ${num(total.value)} ÷ ${sum} = ${tTxt} 小时`
          steps.push({
            title: '求相遇时间',
            detail: `相遇时间 = 总路程 ÷ 速度和 = ${num(total.value)} ÷ ${sum} = ${tTxt} 小时`,
          })
        }
      } else {
        steps.push({
          title: '列式',
          detail: `相遇时间 = 总路程 ÷ 速度和（把两个速度先加起来）`,
        })
      }
      break
    }
    case 'chase': {
      const v1 = speeds[0]
      const v2 = speeds[1]
      const gap = distances[0]
      const vUnit = lenUnit(v1?.unit ?? v2?.unit ?? '千米/时')
      const dUnit = lenUnit(gap?.unit ?? '千米')
      steps.push({
        title: '认出这是追及问题',
        detail: `题目里出现「${model.evidence[0] ?? model.name}」，两人同向而行。${model.think}`,
      })
      if (v1 && v2) {
        const diff = num(Math.abs(v1.value - v2.value))
        steps.push({
          title: '求速度差',
          detail: `速度差 = ${num(Math.max(v1.value, v2.value))} − ${num(Math.min(v1.value, v2.value))} = ${diff} ${vUnit}/时（每小时追近 ${diff} ${dUnit}）`,
        })
        if (gap) {
          const t = gap.value / diff
          const tTxt = num(t)
          computed = `追上所需时间 = ${num(gap.value)} ÷ ${diff} = ${tTxt} 小时`
          steps.push({
            title: '求追上所需时间',
            detail: `追上时间 = 追及路程 ÷ 速度差 = ${num(gap.value)} ÷ ${diff} = ${tTxt} 小时`,
          })
        }
      }
      break
    }
    case 'geometry': {
      // 尺寸优先用 dimension（长/宽/高/棱长），没有再退回 distance
      const dimQs = q.filter((x) => x.label === 'dimension')
      const geomQs = dimQs.length ? dimQs : distances
      const a = geomQs[0]
      const b = geomQs[1]
      steps.push({
        title: '先分清求的是面积还是周长',
        detail: `${model.think}`,
      })
      if (a && b) {
        const u = lenUnit(a.unit ?? b.unit ?? '米')
        const s = num(a.value * b.value)
        const c = num(2 * (a.value + b.value))
        computed = `面积 = ${num(a.value)} × ${num(b.value)} = ${s} ${areaUnit(u)}；周长 = 2 × (${num(a.value)} + ${num(b.value)}) = ${c} ${u}`
        steps.push({
          title: '代入公式',
          detail: `长 = ${num(a.value)} ${u}、宽 = ${num(b.value)} ${u} → 面积 = ${num(a.value)} × ${num(b.value)} = ${s} ${areaUnit(u)}；周长 = 2 × (${num(a.value)} + ${num(b.value)}) = ${c} ${u}`,
        })
      }
      break
    }
    case 'solid': {
      // 尺寸优先用 dimension（长/宽/高/棱长/半径），
      // 没有就退回 distance（题干没写"长"字，只给了数字）
      const dimQs = q.filter((x) => x.label === 'dimension')
      const dims = (dimQs.length ? dimQs : distances).slice(0, 3)
      steps.push({
        title: '先分清求的是体积还是表面积',
        detail: `${model.think}`,
      })
      const wantVolume = /体积/.test(text ?? '')
      const wantSurface = /表面积|表面积/.test(text ?? '')
      // 识别立体图形种类
      let shape = ''
      if (/正方体|立方体/.test(text ?? '')) shape = '正方体'
      else if (/长方体/.test(text ?? '')) shape = '长方体'
      else if (/圆柱/.test(text ?? '')) shape = '圆柱'
      else if (/圆锥/.test(text ?? '')) shape = '圆锥'
      else if (/球/.test(text ?? '')) shape = '球'
      if (shape) {
        steps.push({
          title: `认出是${shape}`,
          detail: `${shape}的${
            wantVolume && !wantSurface
              ? '体积公式'
              : wantSurface && !wantVolume
                ? '表面积公式'
                : '体积与表面积公式'
          }：${model.formula}`,
        })
      }
      // 能算出就直接算（正方体只要 1 个尺寸，长方体要 3 个）
      if (dims.length >= 1) {
        const u = lenUnit(dims[0].unit ?? '米')
        const cu = `立方${u}`
        const [a, b, c] = dims
        if (shape === '正方体' && a) {
          const v = num(a.value ** 3)
          const sArea = num(6 * a.value ** 2)
          computed = `体积 = ${num(a.value)}³ = ${v} ${cu}；表面积 = 6 × ${num(a.value)}² = ${sArea} 平方${u}`
          steps.push({
            title: '代入公式',
            detail: `棱长 = ${num(a.value)} ${u} → 体积 = ${num(a.value)} × ${num(a.value)} × ${num(a.value)} = ${v} ${cu}；表面积 = 6 × ${num(a.value)} × ${num(a.value)} = ${sArea} 平方${u}`,
          })
        } else if (shape === '长方体' && a && b && c) {
          const v = num(a.value * b.value * c.value)
          const sArea = num(2 * (a.value * b.value + b.value * c.value + a.value * c.value))
          computed = `体积 = ${num(a.value)} × ${num(b.value)} × ${num(c.value)} = ${v} ${cu}；表面积 = 2 × (${num(a.value)}×${num(b.value)} + ${num(b.value)}×${num(c.value)} + ${num(a.value)}×${num(c.value)}) = ${sArea} 平方${u}`
          steps.push({
            title: '代入公式',
            detail: `长 = ${num(a.value)} ${u}、宽 = ${num(b.value)} ${u}、高 = ${num(c.value)} ${u} → 体积 = ${v} ${cu}；表面积 = ${sArea} 平方${u}`,
          })
        } else if (a && b) {
          steps.push({
            title: '代入公式',
            detail: `识别到的尺寸：${dims.map((d) => `${num(d.value)} ${d.unit ?? ''}`).join('、')} → ${model.formula}`,
          })
        }
      }
      break
    }
    case 'average': {
      const avg = times[0] ?? distances[0]
      steps.push({
        title: '先求总数',
        detail: `${model.think}`,
      })
      if (avg) {
        steps.push({
          title: '总数 = 平均数 × 份数',
          detail: `总数 = ${num(avg.value)} ${avg.unit ?? ''} × 份数（份数是人数/科目数，别数错）`,
        })
      }
      break
    }
    case 'fraction': {
      steps.push({
        title: '先找单位「1」',
        detail: `${model.think}`,
      })
      const pcts = [...String(text ?? '').matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => m[1])
      if (pcts.length) {
        steps.push({
          title: '把每个百分数对应到「单位1」',
          detail:
            `题目里出现了 ${pcts.map((p) => `${p}%`).join('、')}。` +
            `每个百分数都是相对于**它自己的单位「1」**的 —— 先在题目上把每个单位「1」圈出来，再算。`,
        })
      }
      // 如果能确定单位1 的量（题干里「全长/总数」后面的那个数），把结果也算出来
      const base = distances.find((d) => /全长|总共|一共|原有|原来|总共/.test(
        String(text ?? '').slice(Math.max(0, d.rawIndex ?? 0), (d.rawIndex ?? 0) + 10),
      ))
      if (base && pcts.length) {
        const part = num((base.value * Number(pcts[0])) / 100)
        steps.push({
          title: '算第一段',
          detail: `单位「1」是 ${num(base.value)} ${base.unit ?? ''}，` +
            `${pcts[0]}% 对应 ${num(base.value)} × ${pcts[0]}% = ${part} ${base.unit ?? ''}`,
        })
      }
      break
    }
    case 'work': {
      steps.push({
        title: '把工作总量看成 1',
        detail: `${model.think}`,
      })
      const timesIn = pick(q, 'time')
      if (timesIn.length >= 2) {
        const r1 = 1 / timesIn[0].value
        const r2 = 1 / timesIn[1].value
        const sum = r1 + r2
        steps.push({
          title: '把效率写成分数',
          detail: `甲的效率 = 1 ÷ ${num(timesIn[0].value)} ${timesIn[0].unit ?? ''}，乙的效率 = 1 ÷ ${num(timesIn[1].value)} ${timesIn[1].unit ?? ''}，合作效率 = ${r1.toFixed(2)} + ${r2.toFixed(2)} = ${sum.toFixed(2)}`,
        })
        steps.push({
          title: '求合作时间',
          detail: `合作时间 = 1 ÷ ${sum.toFixed(2)} ≈ ${(1 / sum).toFixed(2)}（注意是「至少」还是「恰好」）`,
        })
      }
      break
    }
    default: {
      steps.push({
        title: `这是${model.name}`,
        detail: `${model.think}`,
      })
      steps.push({
        title: '套用公式',
        detail: `${model.formula}`,
      })
    }
  }

  return { steps, computed, formulas }
}

/**
 * 针对这道题的「专属易错提醒」。
 * @returns {string[]}
 */
export function buildModelPitfalls(model) {
  if (!model) return []
  return (model.pitfalls ?? []).map((p) => `【${model.name}】${p}`)
}

/**
 * 把「模型」拼进知识点里，供 AI 引擎或 UI 使用。
 * @param {object} model
 * @param {Array<string|{name:string}>} kps
 */
export function mergeModelIntoKnowledgePoints(model, kps) {
  const names = (kps ?? [])
    .map((k) => (typeof k === 'string' ? k : k?.name))
    .filter(Boolean)
  if (!model || model.ambiguous) return names
  if (names.includes(model.name)) return names
  // 已有知识点已经覆盖了这个模型（别名命中）→ 不重复插入
  const aliases = MODEL_ALIASES[model.key] ?? []
  const covered = names.some((n) => aliases.some((a) => String(n).includes(a)))
  if (covered) return names
  // 模型比泛化的知识点更具体，放在最前面
  return [model.name, ...names].slice(0, 4)
}

export default {
  PROBLEM_MODELS,
  detectProblemModel,
  extractQuantities,
  buildWorkedSteps,
  buildModelPitfalls,
  mergeModelIntoKnowledgePoints,
}
