/**
 * server/vision.js —— 视觉识别链路的核心
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 组织视觉模型提示词（只输出 JSON）
 *   2. 容错解析模型返回（剥离 ```json 围栏 / 修复被截断的 JSON）
 *   3. 字段校验与修正（枚举收敛、选项字母归一、答案合法性）
 *   4. **置信度融合**：ocrToken / modelSelf / structure / crossCheck 四个信号加权
 *
 * 依赖：server/modelClient.js（HTTP 调用）
 */

import { callChat } from './modelClient.js'

/* -------------------------------------------------------------------------- */
/* 枚举（与 src/lib/types.ts 保持一致）                                         */
/* -------------------------------------------------------------------------- */

export const SUBJECTS = [
  '语文', '数学', '英语', '物理', '化学', '生物', '地理', '历史', '政治', '道法',
]

export const QUESTION_TYPES = [
  '选择题', '填空题', '判断题', '计算题', '应用题', '解答题',
  '作文题', '阅读理解', '完形填空', '语法填空', '翻译题', '实验题', '证明题',
]

/* -------------------------------------------------------------------------- */
/* 提示词                                                                      */
/* -------------------------------------------------------------------------- */

export const VISION_SYSTEM_PROMPT = `你是 K12 错题结构化引擎，负责把学生拍下的错题照片转写并结构化。
【铁律】
1. 只输出一个 JSON 对象，不要输出任何解释文字、不要使用 Markdown 代码块。
2. 题干必须**逐字转写**，禁止改写、概括、润色或补充题目里没有的内容。
3. 数学/物理公式一律用 LaTeX 表示（行内用 $...$）。
4. 选项**原样保留**，去掉选项前面的字母前缀（A. / B、/ (C) 等），只保留选项内容本身。
5. 学生用**红笔/铅笔手写**的作答识别为 myAnswer；**印刷体**（黑色/蓝色印刷的）答案识别为 correctAnswer。
   如果照片里只有手写作答而没有印刷答案，correctAnswer 填 null。
6. 看不清或不确定的字段，给出**较低的 confidence**，并在 notes 中说明原因。
7. 必须输出的 JSON 结构（字段名一字不差）：
{
  "stem": "题干原文",
  "options": ["选项内容1", "选项内容2"],
  "myAnswer": "学生手写作答" 或 null,
  "correctAnswer": "印刷体正确答案" 或 null,
  "subject": "语文|数学|英语|物理|化学|生物|地理|历史|政治|道法",
  "questionType": "选择题|填空题|判断题|计算题|应用题|解答题|作文题|阅读理解|完形填空|语法填空|翻译题|实验题|证明题",
  "knowledgePoints": ["知识点1", "知识点2"],
  "difficulty": 3,
  "ocrText": "照片中识别到的全部文字",
  "fieldConfidence": {
    "stem": 0.0, "options": 0.0, "myAnswer": 0.0, "correctAnswer": 0.0, "knowledgePoints": 0.0
  },
  "notes": null
}
8. difficulty 必须是 1-5 的整数；fieldConfidence 必须是 0-1 的小数。
9. 可选：额外返回一个 "analysis" 对象（包含 summary / diagnosis / correctSteps / tips 等），
   用于给这道错题生成讲解；拿不准时省略该字段即可。`

/* -------------------------------------------------------------------------- */
/* JSON 容错解析                                                                */
/* -------------------------------------------------------------------------- */

/** 取出第一个完整配平的 JSON 对象 */
function extractBalanced(text) {
  let depth = 0
  let inStr = false
  let esc = false
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) return text.slice(start, i + 1)
      if (depth < 0) return null
    }
  }
  return null
}

/** 修复被截断的 JSON：补齐括号、去掉悬空键与尾逗号 */
function repairTruncatedJson(text) {
  const stack = []
  let inStr = false
  let esc = false
  let lastSafe = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') { inStr = false; lastSafe = i }
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); continue }
    if (ch === '}' || ch === ']') { stack.pop(); lastSafe = i; continue }
    if (!/\s/.test(ch)) lastSafe = i
  }
  let out = lastSafe >= 0 ? text.slice(0, lastSafe + 1) : ''
  out = out.replace(/,\s*"[^"]*"\s*:\s*$/, '')
  out = out.replace(/,\s*$/, '')
  out = out.replace(/:\s*$/, ':null')
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i]
  return out
}

/**
 * 容错解析模型返回的 JSON。
 * @returns {{data: object|null, repaired: boolean}}
 */
export function parseModelJson(text) {
  if (typeof text !== 'string') return { data: null, repaired: false }
  let t = text.trim()
  const fence = t.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  t = t.replace(/^json\s*/i, '').trim()
  const first = t.indexOf('{')
  if (first < 0) return { data: null, repaired: false }
  t = t.slice(first)

  try {
    return { data: JSON.parse(t), repaired: false }
  } catch {
    /* 继续尝试 */
  }

  const balanced = extractBalanced(t)
  if (balanced) {
    try {
      return { data: JSON.parse(balanced), repaired: false }
    } catch {
      /* 继续尝试修复 */
    }
  }

  const repaired = repairTruncatedJson(t)
  if (repaired) {
    try {
      return { data: JSON.parse(repaired), repaired: true }
    } catch {
      /* 放弃 */
    }
  }
  return { data: null, repaired: false }
}

/* -------------------------------------------------------------------------- */
/* 视觉识别调用                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 把图片直接发给视觉模型，取回结构化草稿。
 *
 * @param {object} p
 * @param {object} p.cfg         resolveProviderConfig() 的结果
 * @param {string} p.imageSrc    data url 或 http(s) 图片地址
 * @param {string} [p.hint]
 * @param {string} [p.grade]
 * @param {string} [p.subject]
 * @param {string} [p.ocrText]   本地 OCR 文本（作为补充线索）
 * @returns {Promise<{raw: object, repaired: boolean, model: string}>}
 */
export async function recognizeWithVision({ cfg, imageSrc, hint, grade, subject, ocrText } = {}) {
  const content = [
    {
      type: 'text',
      text: [
        '请识别这张错题照片并按系统提示的 JSON 结构输出。',
        grade ? `年级：${grade}` : '',
        subject ? `已知学科：${subject}` : '',
        hint ? `补充线索：${hint}` : '',
        ocrText ? `本地 OCR 识别到的文字（可能有误，请以图片为准）：\n${String(ocrText).slice(0, 1200)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
  // 图片必须是**完整 data URL**（data:image/jpeg;base64,...）：
  // OpenAI 兼容端点（含本地 vLLM）都要求这个格式，裸 base64 会被拒绝。
  if (imageSrc) content.push({ type: 'image_url', image_url: { url: imageSrc } })

  const text = await callChat({
    cfg,
    model: cfg.visionModelEffective || cfg.model,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    json: true,
    timeoutMs: cfg.timeoutMs ?? 25000,
    temperature: cfg.temperature ?? 0.3,
  })

  const { data, repaired } = parseModelJson(text)
  if (!data || typeof data !== 'object') throw new Error('模型返回的内容不是合法 JSON')
  return { raw: data, repaired, model: cfg.visionModelEffective || cfg.model }
}

/**
 * 纯文本结构化：模型不支持图片输入时，用「本地 OCR 文本 + 大模型」整理草稿。
 *
 * @param {object} p
 * @param {object} p.cfg
 * @param {string} p.ocrText
 * @returns {Promise<{raw: object, repaired: boolean, model: string}>}
 */
export async function recognizeFromOcrText({ cfg, ocrText, hint, grade, subject } = {}) {
  const prompt = [
    '下面是本地 OCR 引擎从一张错题照片中识别出的文字，请把它整理成结构化错题草稿。',
    '注意：OCR 可能把选项连成一行（例如 "A.12B.16C.20D.24"），请自行拆分成独立选项；',
    '单独成行的「答：X」通常是学生用红笔写下的作答，应填入 myAnswer。',
    grade ? `年级：${grade}` : '',
    subject ? `已知学科：${subject}` : '',
    hint ? `补充线索：${hint}` : '',
    `OCR 原文：\n${String(ocrText ?? '').slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n')

  const text = await callChat({
    cfg,
    messages: [
      { role: 'system', content: VISION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    json: true,
    timeoutMs: cfg.timeoutMs ?? 25000,
    temperature: cfg.temperature ?? 0.3,
  })

  const { data, repaired } = parseModelJson(text)
  if (!data || typeof data !== 'object') throw new Error('模型返回的内容不是合法 JSON')
  return { raw: data, repaired, model: cfg.model }
}

/* -------------------------------------------------------------------------- */
/* 启发式：学科 / 题型 / 知识点（**零 AI、零外部 API**，纯本地规则）               */
/* -------------------------------------------------------------------------- */
/*
 * 背景：没有配置视觉模型时，只能靠本地 OCR 的文本还原题目。此前学科被写死成
 * 「数学」、题型写死成「解答题」、知识点恒为空 —— 用户抱怨「连学科都识别不对」。
 * 这里用**多维特征打分**（不是单个关键词）做判定，并把「依据」一并返回给前端。
 *
 * 设计原则：
 *   1. 拿不到证据就返回**低置信度**，宁可让用户手选，也不给错答案还装得很确定；
 *   2. 语文/英语最容易混：语文看成词命中，英语看字母占比 + 语法词；
 *   3. 纯数字、短文本、题号缺失时一律压低置信度。
 */

/* ---- 学科词表（命中即计 1 分） ---- */
const SUBJECT_KEYWORDS = {
  数学: [
    '三角形', '周长', '面积', '体积', '表面积', '方程', '方程组', '函数', '解方程', '列方程',
    '化简', '约分', '通分', '分数', '分子', '分母', '质数', '合数', '素数', '因数', '倍数',
    '小数', '百分数', '比例', '正比例', '反比例', '平均数', '中位数', '众数', '余数', '整除',
    '简便计算', '脱式', '口算', '竖式', '算式', '圆锥', '圆柱', '平行四边形', '梯形', '长方形',
    '正方形', '数轴', '倒数', '绝对值', '运算', '乘法', '除法', '加减法', '相遇', '追及',
    '鸡兔同笼', '植树问题', '和差', '和倍', '差倍', '盈亏', '归一', '单位换算', '人民币',
    '一半', '平均分', '余下', '分成',
    '元角分', '认识图形', '位置与方向', '轴对称', '平移', '旋转', '条形统计', '扇形统计',
    '折线统计', '可能性', '综合与实践', '测量', '勾股定理', '三角形内角和', '平行线',
    '全等', '相似', '比例尺', '百分率', '增长率', '利息', '利润', '折扣', '单价', '总价',
    '工作效率', '工作总量', '行程', '数与代数', '图形与几何', '统计与概率', '不等式',
  ],
  语文: [
    '拼音', '音节', '组词', '近义词', '反义词', '多音字', '田字格', '看图写话', '病句',
    '修辞', '中心思想', '古诗', '文言文', '段落', '词语', '造句', '朗读', '背诵', '默写',
    '看图说话',
    '文学常识', '标点', '说明方法', '人物描写', '段意', '中心句', '生字', '字词', '阅读',
    '短文', '课文', '诗句', '扩句', '缩句', '改写', '拟人', '比喻', '排比', '夸张', '对偶',
    '病句修改', '习作', '口语交际', '综合性学习', '实词', '虚词', '通假', '积累与运用',
    '语文园地', '词语搭配', '量词', '主题', '开头', '结尾', '材料', '写作', '名句',
  ],
  英语: [
    '英语', '单词', '音标', '句型', '时态', '完形填空', '语法填空', '阅读理解', '翻译',
    '英汉', '汉译英', '短语', '搭配', '被动语态', '宾语从句', '定语从句', '状语从句',
    '第三人称单数', '复数', '介词', '冠词', '情态动词', '动词不定式', '动名词', '现在分词',
    '过去分词', '比较级', '最高级', '疑问句', '感叹句', '祈使句', '陈述句', '连词', '固定搭配',
    '选词填空', '首字母填空', '书面表达', '听力', '单词拼写', '句型转换',
  ],
  物理: [
    '速度', '路程', '加速度', '摩擦力', '摩擦', '压强', '浮力', '密度', '杠杆', '滑轮',
    '斜面', '二力平衡', '平衡力', '重力', '弹力', '惯性', '动能', '势能', '机械能', '功率',
    '内能', '比热容', '热量', '熔化', '凝固', '蒸发', '沸腾', '电阻', '电压', '电流', '电路',
    '串联', '并联', '磁场', '电功率', '凸透镜', '凹透镜', '焦距', '折射', '光的反射',
    '光的直线传播', '光的色散', '声波', '响度', '音调', '音色', '波长', '超声', '次声',
    '原子核', '质子', '中子', '电流表', '电压表', '量筒', '量杯', '天平', '测力计',
  ],
  化学: [
    '化学式', '摩尔', '溶液', '沉淀', '氧化还原', '化合价', '元素周期表', '相对原子质量',
    '离子', '酸碱', '氧化物', '置换反应', '复分解', '中和反应', '质量守恒', '化合反应',
    '分解反应', '稀释', '溶解度', '饱和溶液', '结晶', '元素符号', '化学方程式', '活泼性',
    '金属', '氧气', '二氧化碳', '氢气', '碳酸', '氢氧化钠', '硫酸', '盐酸', '试管', '酒精灯',
    '集气瓶', '铁架台', '过滤', '蒸发皿', '坩埚', '指示剂', '酚酞', '石蕊', '复分解反应',
    '化学性质', '物理变化', '化学变化',
  ],
  生物: [
    '细胞', '光合作用', '遗传', '染色体', '生态系统', '器官', '组织', '显微镜', '呼吸作用',
    '蒸腾作用', '血液循环', '神经', '反射', '生殖', '发育', 'DNA', '基因', '食物链',
    '生产者', '消费者', '分解者', '垃圾分类', '生态平衡', '消化', '吸收', '肺泡', '心脏',
    '肝脏', '肾脏', '关节', '肌肉', '神经元', '反射弧', '传粉', '受精', '种群', '环境保护',
  ],
  地理: [
    '经纬度', '气候', '地形', '板块', '洋流', '季风', '热带', '温带', '寒带', '等高线',
    '经线', '纬线', '比例尺', '半球', '海拔', '大洲', '大洋', '地形图', '天气', '降水量',
    '干湿', '农业', '工业', '人口', '城市', '聚落', '河流', '湖泊', '山脉', '平原', '盆地',
    '丘陵', '沙漠', '草原', '森林', '地中海气候', '温带季风', '亚热带季风', '长江', '黄河',
    '珠江', '黄土高原', '青藏高原', '东北平原', '柴达木', '地震', '火山', '台风', '寒潮',
    '梅雨', '矿产', '钢铁', '石油', '煤炭',
  ],
  历史: [
    '朝代', '战争', '条约', '辛亥革命', '文艺复兴', '秦朝', '汉朝', '唐朝', '明朝', '清朝',
    '三国', '楚汉', '甲骨文', '丝绸之路', '活字印刷', '指南针', '火药', '郑和', '哥伦布',
    '工业革命', '巴黎公社', '秦始皇', '汉武帝', '科举', '洋务', '戊戌', '义和团', '五四',
    '抗日', '长征', '遵义会议', '九一八', '鸦片战争', '南京条约', '甲午', '司马迁', '诸葛亮',
    '李白', '杜甫', '孔子', '兵马俑', '长城', '故宫', '莫高窟',
  ],
  道法: [
    '宪法', '公民', '权利', '义务', '道德', '法治', '中国共产党', '人民代表大会',
    '依法治国', '价值观', '诚信', '友爱', '亲近社会', '自我管理', '情绪', '青春期',
    '师生', '父母', '生命', '安全', '国家', '民族', '文化', '道德与法治', '国家利益',
    '集体利益', '个人利益', '正义', '规则', '法律', '未成年人', '劳动', '消费者',
    '合法权益', '道德修养', '孝敬', '感恩',
  ],
}

/* ---- 英语语法词（按整词匹配，命中计 1 分） ---- */
const ENGLISH_GRAMMAR_WORDS = [
  'is', 'are', 'was', 'were', 'am', 'be', 'been', 'being', 'has', 'have', 'had', 'did', 'does',
  'do', 'because', 'although', 'though', 'what', 'where', 'how', 'when', 'who', 'why',
  'and', 'but', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'this', 'that', 'these', 'those', 'can', 'will', 'would', 'should', 'could', 'may',
  'there', 'here', 'they', 'them', 'their', 'she', 'he', 'we', 'you', 'your', 'his',
  'her', 'our', 'not', 'if', 'then', 'than', 'also', 'very', 'some', 'any', 'each',
  'every', 'both', 'so', 'such', 'into', 'over', 'under', 'after', 'before', 'between',
  'during', 'without', 'again', 'question', 'answer', 'choose', 'read', 'listen', 'speak',
  'write', 'passage', 'according', 'blank', 'fill', 'correct', 'wrong', 'true', 'false',
  'complete', 'sentence', 'word', 'grammar', 'tense', 'present', 'past', 'future',
  'perfect', 'continuous', 'english', 'translate', 'meaning', 'example', 'following',
  'above', 'below', 'left', 'right', 'beginning', 'topic', 'email', 'letter', 'diary',
  'report', 'poster', 'notice', 'subject', 'brother', 'sister', 'friend', 'teacher',
  'student', 'school', 'family', 'happy', 'sad', 'beautiful', 'important', 'different',
]

/* ---- 拼音特征 ---- */
const PINYIN_MARKS = 'āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜüńňǹ'
const PINYIN_WORDS = ['拼音', '音节', '多音字', '田字格', '组词', '看图写话', '注音', '声母', '韵母', '整体认读']

/* ---- 知识点映射：学科 -> { 知识点名: 关键词[] } ---- */
const KNOWLEDGE_KEYWORD_MAP = {
  数学: {
    分数运算: ['分数', '分子', '分母', '约分', '通分', '分数乘', '分数除', '真分数', '假分数'],
    行程问题: ['相遇', '追及', '行程', '速度', '路程', '同时出发', '相向', '同向'],
    鸡兔同笼: ['鸡兔同笼', '抬腿', '买鸡', '养兔'],
    几何面积: ['面积', '周长', '三角形', '长方形', '正方形', '平行四边形', '梯形', '圆', '扇形'],
    立体图形: ['体积', '表面积', '正方体', '长方体', '圆柱', '圆锥', '容积'],
    代数方程: ['方程', '解方程', '列方程', '方程组', '不等式', '设未知数'],
    数的认识: ['质数', '合数', '因数', '倍数', '奇数', '偶数', '质因数', '整除', '最大公因数', '最小公倍数'],
    小数百分数: ['小数', '百分数', '百分率', '折扣', '利率', '增长率', '保留两位小数'],
    比例与比例尺: ['比例', '正比例', '反比例', '比例尺', '按比例'],
    统计与可能性: ['平均数', '中位数', '众数', '条形统计', '扇形统计', '折线统计', '可能性'],
    运算与简算: ['简便计算', '脱式', '运算律', '交换律', '结合律', '分配律', '简算', '口算'],
    数量关系: ['一共', '还剩', '剩下', '又买', '增加', '减少', '平均', '每份', '多多少', '少多少', '每组', '每盒', '每瓶', '一半', '分成'],
    综合与实践: ['综合与实践', '数学广角', '搭配', '沏茶', '烙饼', '田忌赛马'],
  },
  语文: {
    字词基础: ['生字', '组词', '多音字', '田字格', '注音', '部首', '笔画', '查字典'],
    拼音: ['拼音', '音节', '声母', '韵母', '整体认读', '标声调'],
    词语积累: ['近义词', '反义词', '词语搭配', '量词', '成语', '俗语', '四字词语'],
    句子: ['造句', '扩句', '缩句', '改写', '句式', '标点', '病句', '修辞'],
    修辞手法: ['比喻', '拟人', '排比', '夸张', '对偶', '反复', '设问', '反问'],
    阅读理解: ['阅读', '短文', '课文', '段意', '中心思想', '中心句', '概括', '体会情感'],
    古诗文: ['古诗', '默写', '文言文', '诗句', '唐诗', '宋词', '实词', '虚词', '翻译句子'],
    病句修改: ['病句', '修改病句', '语序', '搭配不当', '成分残缺'],
    作文审题: ['作文', '写话', '习作', '不少于', '材料', '开头', '结尾', '立意'],
    文学常识: ['文学常识', '作者', '朝代', '名句', '名著', '诗人'],
    口语交际: ['口语交际', '交际', '劝说', '建议'],
    综合性学习: ['综合性学习', '活动', '宣传', '标语', '倡议书'],
  },
  英语: {
    词汇与拼写: ['单词', '拼写', '词汇', '音标', '短语', '固定搭配', '单词拼写'],
    语法与时态: ['时态', '一般现在时', '一般过去时', '现在完成时', '过去完成时', '一般将来时', '第三人称单数', '情态动词'],
    句型转换: ['句型转换', '同义句', '改写', '否定句', '疑问句', '感叹句', 'there be'],
    完形填空: ['完形填空', '完形'],
    阅读理解: ['阅读理解', '阅读', 'passage', '短文'],
    语法填空: ['语法填空', '用括号内词的适当形式', '首字母填空', '选词填空'],
    翻译: ['翻译', '汉译英', '英汉互译'],
    写作: ['书面表达', '写作', '作文', '写一篇'],
    从句: ['宾语从句', '定语从句', '状语从句'],
    介词与冠词: ['介词', '冠词', 'in', 'on', 'at'],
    被动语态: ['被动语态', 'was done', 'were done'],
  },
  物理: {
    运动与力: ['速度', '路程', '加速度', '力', '重力', '弹力', '摩擦力', '惯性', '二力平衡', '平衡力'],
    压强: ['压强', '大气压', '压力', '受力面积'],
    浮力: ['浮力', '漂浮', '下沉', '排开液体', '阿基米德'],
    光现象: ['光的反射', '折射', '凸透镜', '凹透镜', '焦距', '色散', '直线传播'],
    声现象: ['声', '音调', '响度', '音色', '噪声', '超声', '次声'],
    电与电路: ['电压', '电流', '电路', '串联', '并联', '电阻', '电功率', '电路图'],
    功和机械能: ['功', '功率', '机械能', '动能', '势能', '滑轮', '杠杆', '斜面'],
    内能与热: ['内能', '比热容', '热量', '熔化', '凝固', '蒸发', '沸腾', '温度'],
    质量与密度: ['质量', '密度', '天平', '量筒', '体积'],
  },
  化学: {
    物质的构成: ['分子', '原子', '离子', '元素', '原子核', '质子', '中子', '电子'],
    元素与周期表: ['元素周期表', '相对原子质量', '元素符号', '金属', '非金属'],
    化学式与化合价: ['化学式', '化合价', '相对分子质量', '化学方程式'],
    质量守恒: ['质量守恒', '化学变化', '物理变化', '化学反应'],
    溶液: ['溶液', '溶解度', '饱和溶液', '结晶', '稀释', '溶质', '溶剂'],
    酸碱盐: ['酸', '碱', '盐', '中和反应', '指示剂', '酚酞', '石蕊', 'pH'],
    化学反应: ['化合反应', '分解反应', '置换反应', '复分解反应', '氧化还原'],
    实验与操作: ['试管', '酒精灯', '集气瓶', '铁架台', '过滤', '蒸发皿', '坩埚', '量筒', '滴管'],
  },
  生物: {
    细胞与组织: ['细胞', '组织', '器官', '系统', '显微镜', '细胞核', '细胞膜'],
    植物与光合作用: ['光合作用', '呼吸作用', '蒸腾作用', '根', '茎', '叶', '花', '种子', '传粉', '受精'],
    动物与呼吸: ['肺泡', '心脏', '血液循环', '消化', '吸收', '关节', '肌肉', '神经', '反射'],
    遗传与变异: ['遗传', '染色体', 'DNA', '基因', '生殖', '发育', '变异'],
    生态系统: ['生态系统', '食物链', '生产者', '消费者', '分解者', '种群', '生态平衡'],
    健康与安全: ['健康', '安全', '急救', '传染病', '垃圾分类', '营养'],
    实验探究: ['实验', '对照实验', '变量', '探究'],
  },
  地理: {
    地球与地图: ['地球', '经线', '纬线', '经度', '纬度', '半球', '比例尺', '方向', '地图'],
    天气与气候: ['天气', '气候', '降水', '干湿', '季风', '热带', '温带', '寒带', '台风', '寒潮'],
    地形与地貌: ['地形', '山地', '平原', '高原', '盆地', '丘陵', '山脉', '等高线', '海拔'],
    居民与聚落: ['人口', '城市', '乡村', '聚落', '人种', '语言', '宗教'],
    农业与工业: ['农业', '工业', '种植业', '畜牧业', '工业', '矿产', '钢铁', '石油', '煤炭'],
    区域地理: ['长江', '黄河', '珠江', '青藏高原', '黄土高原', '东北平原', '柴达木', '季风气候', '板块', '洋流', '地震', '火山'],
  },
  历史: {
    史前与早期国家: ['元谋人', '北京人', '半坡', '河姆渡', '炎帝', '黄帝', '夏', '商', '西周', '分封'],
    古代经济与科技: ['铁器', '牛耕', '丝绸之路', '活字印刷', '指南针', '火药', '瓷器', '科举'],
    近代史: ['鸦片战争', '南京条约', '洋务运动', '甲午', '戊戌变法', '义和团', '辛亥革命', '新文化运动'],
    现代史: ['五四', '中国共产党', '北伐', '长征', '遵义会议', '九一八', '七七事变', '抗日', '解放战争', '开国大典'],
    革命与战争: ['战争', '条约', '革命', '起义', '战役'],
    文化与思想: ['孔子', '百家争鸣', '司马迁', '李白', '杜甫', '唐诗', '宋词', '活字印刷', '文艺复兴'],
  },
  道法: {
    成长与心理: ['青春期', '情绪', '自我', '心理', '独立性', '逆反'],
    友谊与交往: ['朋友', '友谊', '交往', '师生', '父母', '真诚', '尊重'],
    法治教育: ['宪法', '法律', '法治', '权利', '义务', '违法犯罪', '依法治国', '未成年人'],
    生命与安全: ['生命', '安全', '急救', '自护', '防灾'],
    国家与社会: ['国家', '民族', '公民', '社会', '人民代表大会', '中国共产党', '价值观', '劳动者'],
    规则与诚信: ['规则', '诚信', '道德', '正义', '责任', '诚信经营'],
  },
}

/* ---- 特征计算 ---- */

/** 统计文本的字符构成 */
function computeTextFeatures(raw) {
  const text = String(raw ?? '')
  const compact = text.replace(/\s+/g, '')
  const chars = [...compact]
  const total = chars.length || 1

  let digits = 0
  let latin = 0
  let cjk = 0
  let mathSym = 0
  let cnPunct = 0
  let enPunct = 0

  for (const ch of chars) {
    if (ch >= '0' && ch <= '9') { digits++; continue }
    if (/[A-Za-z]/.test(ch)) { latin++; continue }
    if (/[\u4e00-\u9fa5]/.test(ch)) { cjk++; continue }
    if ('=+×÷√²³∠°%‰＜＞≥≤≠π½¼¾'.includes(ch)) { mathSym++; continue }
    if ('-－—'.includes(ch)) { mathSym++; continue }
    if (/[，。；：！？、（）《》「」【】“”‘’]/.test(ch)) { cnPunct++; continue }
    if (/[,.;:!?()\[\]"']/.test(ch)) { enPunct++; continue }
  }

  // 拉丁字母按**词**统计：
  //   - 排除选项标签（A/B/C/D）这类孤立单字母；
  //   - 排除单位类短词（cm、kg…），否则「8cm，5cm」会被误判成英语。
  const rawWords = text.split(/[^A-Za-z']+/).filter((w) => w.length >= 2)
  const words = rawWords.filter((w) => w.length >= 3 || ENGLISH_GRAMMAR_WORDS.includes(w.toLowerCase()))
  const wordLatin = words.join('').replace(/'/g, '').length

  // 英语语法词（整词匹配，忽略大小写；只认长度 ≥ 2 的词）
  const lower = text.toLowerCase()
  const englishHits = []
  for (const w of ENGLISH_GRAMMAR_WORDS) {
    if (w.length < 2) continue
    if (new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i').test(lower)) englishHits.push(w)
  }

  // 拼音
  const pinyinHits = []
  for (const w of PINYIN_WORDS) {
    if (compact.includes(w)) pinyinHits.push(w)
  }
  if ([...compact].some((ch) => PINYIN_MARKS.includes(ch))) pinyinHits.push('拼音声调符号')

  return {
    total,
    digits,
    latin,
    wordLatin,
    cjk,
    mathSym,
    cnPunct,
    enPunct,
    digitRatio: digits / total,
    latinRatio: wordLatin / total,
    chineseRatio: cjk / total,
    mathSymbolRatio: mathSym / total,
    englishHits,
    pinyinHits,
    textLength: compact.length,
  }
}

/** 归一化学科名（非法值返回空串） */
export function normalizeSubject(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  if (SUBJECTS.includes(s)) return s
  // 「道德与法治」统一归到「道法」
  if (s === '道德与法治' || s === '政治' || s === '思想品德') return '道法'
  return ''
}

/** 归一化题型名（非法值返回空串） */
export function normalizeQuestionType(value) {
  const s = String(value ?? '').trim()
  if (!s) return ''
  return QUESTION_TYPES.includes(s) ? s : ''
}

/**
 * 启发式学科判定（纯规则）。
 *
 * @param {string} text OCR 出来的全部文字
 * @param {Array<{text:string,score:number}>} [lines] OCR 行（可选，仅用于取证）
 * @returns {{subject: string, confidence: number, evidence: string[], candidates: {subject:string,score:number,confidence:number}[]}}
 */
export function inferSubjectFromText(text, lines = []) {
  const raw = String(text ?? '')
  const compact = raw.replace(/\s+/g, '')
  const feats = computeTextFeatures(raw)

  if (!compact.length) {
    return { subject: '', confidence: 0, evidence: [], candidates: [] }
  }

  /** 学科 -> { score, evidence[] } */
  const bag = {}
  const ensure = (subject) => {
    if (!bag[subject]) bag[subject] = { score: 0, evidence: [] }
    return bag[subject]
  }

  // 1) 词表命中
  for (const [subject, words] of Object.entries(SUBJECT_KEYWORDS)) {
    const slot = ensure(subject)
    for (const w of words) {
      if (compact.includes(w)) {
        slot.score += 1
        slot.evidence.push(w)
      }
    }
  }

  // 2) 特征加分
  if (feats.mathSymbolRatio >= 0.008) {
    const slot = ensure('数学')
    slot.score += 2.2
    slot.evidence.push(`运算符密度 ${(feats.mathSymbolRatio * 100).toFixed(1)}%`)
  }
  if (feats.digitRatio >= 0.08) {
    const slot = ensure('数学')
    slot.score += 1.2
    slot.evidence.push(`数字占比 ${(feats.digitRatio * 100).toFixed(0)}%`)
  }
  // 数量型提问（多少/几倍/几人）+ 数字 -> 数学应用题
  if (feats.digitRatio >= 0.03 && /多少|几倍|几人|几个|几元|几米|几克/.test(compact)) {
    const slot = ensure('数学')
    slot.score += 1.0
    slot.evidence.push('数量型提问')
  }
  if (feats.latinRatio >= 0.15) {
    const slot = ensure('英语')
    slot.score += 2.6
    slot.evidence.push(`字母占比 ${(feats.latinRatio * 100).toFixed(0)}%`)
  }
  if (feats.latinRatio >= 0.35) {
    const slot = ensure('英语')
    slot.score += 1.4
  }
  if (feats.englishHits.length >= 2) {
    const slot = ensure('英语')
    slot.score += 1.6
    slot.evidence.push(...feats.englishHits.slice(0, 3))
  }
  if (feats.pinyinHits.length) {
    const slot = ensure('语文')
    slot.score += 2.4
    slot.evidence.push(...feats.pinyinHits.slice(0, 3))
  }
  // 中文标点 + 英文标点混排（英语试卷的典型特征）—— 只能**佐证**，不能单独定罪
  if (feats.enPunct >= 2 && feats.cnPunct >= 1
    && (feats.latinRatio >= 0.1 || feats.englishHits.length >= 1)) {
    const slot = ensure('英语')
    slot.score += 0.8
    slot.evidence.push('中英文标点混排')
  }
  // 汉字占比高且没有任何学科词：语文的弱信号
  if (feats.chineseRatio >= 0.6 && feats.latinRatio < 0.05 && feats.mathSymbolRatio < 0.005) {
    const slot = ensure('语文')
    slot.score += 0.5
  }

  const entries = Object.entries(bag)
    .filter(([, v]) => v.score > 0)
    .map(([subject, v]) => ({ subject, score: Math.round(v.score * 100) / 100, evidence: v.evidence }))
    .sort((a, b) => b.score - a.score)

  if (!entries.length) {
    return { subject: '', confidence: 0, evidence: [], candidates: [] }
  }

  const total = entries.reduce((a, e) => a + e.score, 0)
  const top = entries[0]
  const second = entries[1]
  let confidence = top.score / total

  // 证据薄弱 -> 压低置信度
  if (feats.textLength < 8) confidence = Math.min(confidence, 0.4)
  else if (feats.textLength < 12) confidence *= 0.7
  // 前两名咬得紧 -> 压低置信度
  if (second && (top.score - second.score) / top.score < 0.2) confidence *= 0.7
  // 纯数字无运算符 -> 数学判定也要打折（可能只是编号/名单）
  if (top.subject === '数学' && feats.digitRatio > 0.5 && feats.mathSymbolRatio < 0.005) {
    confidence = Math.min(confidence, 0.35)
  } else if (top.subject === '数学' && feats.digitRatio > 0.2 && feats.mathSymbolRatio < 0.005) {
    confidence *= 0.75
  }
  // 没有任何具体词命中（只有特征加分）-> 打折
  const wordHits = top.evidence.filter((e) => !/[%0-9]/.test(e) && !/[占比密度]/.test(e) && !/提问/.test(e))
  if (!wordHits.length) confidence *= 0.8
  // 只有一个学科有证据时不要过度自信
  if (!second) confidence = Math.min(confidence, 0.92)

  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100))

  const candidates = entries.slice(0, 3).map((e) => ({
    subject: e.subject,
    score: e.score,
    confidence: Math.round((e.score / total) * 100) / 100,
  }))

  return {
    subject: top.subject,
    confidence,
    evidence: top.evidence.slice(0, 6),
    candidates,
  }
}

/**
 * 启发式题型判定（纯规则）。
 *
 * @param {string} text OCR 全部文字
 * @param {object} groups classifyOcrLines() 的分组结果（用于判断选项）
 * @param {{subject?: string}} [ctx]
 * @returns {{questionType: string, confidence: number, evidence: string[]}}
 */
export function inferQuestionTypeFromText(text, groups = {}, ctx = {}) {
  const raw = String(text ?? '')
  const compact = raw.replace(/\s+/g, ' ')
  const subject = normalizeSubject(ctx.subject)
  const evidence = []

  const options = Array.isArray(groups.options) ? groups.options : []
  if (options.length >= 2) {
    return { questionType: '选择题', confidence: 0.9, evidence: [`识别到 ${options.length} 个选项`] }
  }

  // 英语/语文的专有题型（比通用规则更具体，优先判断）
  if (/完形填空|完形/.test(compact)) {
    return { questionType: '完形填空', confidence: 0.9, evidence: ['命中「完形填空」'] }
  }
  if (/语法填空|用括号内词的适当形式|首字母填空|选词填空/.test(compact)) {
    return { questionType: '语法填空', confidence: 0.88, evidence: ['命中「语法填空」'] }
  }
  if (/翻译|汉译英|英汉互译|英译汉/.test(compact)) {
    return { questionType: '翻译题', confidence: 0.85, evidence: ['命中「翻译」'] }
  }
  if (/作文|写话|习作|不少于.{0,6}字/.test(compact)) {
    return { questionType: '作文题', confidence: 0.88, evidence: ['命中「作文/写话」'] }
  }
  if (/实验探究|设计实验|完成实验/.test(compact)) {
    return { questionType: '实验题', confidence: 0.78, evidence: ['命中「实验」'] }
  }
  if (subject === '语文' && /阅读|短文|课外阅读/.test(compact)) {
    return { questionType: '阅读理解', confidence: 0.72, evidence: ['语文 + 命中「阅读」'] }
  }
  if (/判断|对错|正确的打|打.{0,2}[√✓×✗]|[（(]\s*[√✓×✗]\s*[）)]|正确|错误/.test(compact)) {
    return { questionType: '判断题', confidence: 0.78, evidence: ['命中「判断/对错」'] }
  }
  if (/证明|求证|试证/.test(compact)) {
    return { questionType: '证明题', confidence: 0.78, evidence: ['命中「证明」'] }
  }
  // 填空题 / 判断题：靠「空的位置」区分
  //   - 空在句尾 + 陈述句（没有问号、没有求/算动词）-> 判断题
  //   - 其余（下划线、句中空括号）-> 填空题
  const blankMatch = compact.match(/_{2,}|＿{2,}|[（(]\s{0,2}[）)]/)
  if (blankMatch) {
    const tail = compact.slice(blankMatch.index + blankMatch[0].length).replace(/[。．.，,；;：:\s]/g, '')
    const isQuestion = /[？?]/.test(compact) || /什么|多少|哪|为什么|怎么|如何/.test(compact)
    const isFillVerb = /求|计算|解出|写出|填|等于/.test(compact)
    if (!tail && !isQuestion && !isFillVerb) {
      return { questionType: '判断题', confidence: 0.6, evidence: ['句末空括号（陈述句）'] }
    }
    return { questionType: '填空题', confidence: 0.72, evidence: ['命中下划线/空括号'] }
  }
  if (/应用题/.test(compact)) {
    return { questionType: '应用题', confidence: 0.8, evidence: ['命中「应用题」'] }
  }

  const feats = computeTextFeatures(raw)
  // 纯计算式（几乎只有符号和数字，没有成句文字）-> 计算题
  if (feats.mathSymbolRatio >= 0.02 && feats.chineseRatio < 0.15 && feats.textLength >= 4) {
    return { questionType: '计算题', confidence: 0.66, evidence: ['纯算式（运算符占比高）'] }
  }
  if (/求|解|列方程|化简|简算|解答|计算/.test(compact)) {
    const kw = ['求', '解', '列方程', '化简', '简算', '解答', '计算'].find((k) => compact.includes(k))
    return { questionType: '解答题', confidence: 0.7, evidence: [`命中「${kw}」`] }
  }

  return { questionType: '解答题', confidence: 0.3, evidence: ['没有明确的题型特征'] }
}

/**
 * 启发式知识点（纯规则）。
 *
 * @param {string} text OCR 全部文字
 * @param {string} subject 学科
 * @returns {string[]} 最多 5 个知识点名
 */
export function inferKnowledgePoints(text, subject) {
  const key = normalizeSubject(subject) || '数学'
  const map = KNOWLEDGE_KEYWORD_MAP[key] ?? KNOWLEDGE_KEYWORD_MAP[key === '道法' ? '道法' : '数学']
  const compact = String(text ?? '').replace(/\s+/g, '')
  if (!compact.length || !map) return []

  const out = []
  for (const [name, words] of Object.entries(map)) {
    if (words.some((w) => compact.includes(w))) {
      out.push(name)
      if (out.length >= 5) break
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* 草稿归一化                                                                  */
/* -------------------------------------------------------------------------- */

const OPTION_PREFIX = /^\s*[（(]?\s*([A-Ha-h])\s*[）).、．:：]\s*/
const OPTION_PREFIX_PAREN = /^\s*[（(]\s*([A-Ha-h])\s*[）)]\s*/

function stripOptionPrefix(text) {
  let s = String(text ?? '').trim()
  const m = s.match(OPTION_PREFIX) ?? s.match(OPTION_PREFIX_PAREN)
  if (m) {
    const letter = m[1].toUpperCase()
    const rest = s.slice(m[0].length).trim()
    // 只有当剩余内容非空时才认为是"字母前缀"，避免吃掉 "A" 这种纯答案
    if (rest) return { text: rest, letter }
  }
  return { text: s, letter: null }
}

function clamp01(v, dflt = 0) {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(1, Math.max(0, n))
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100
}

/** 从 OCR 行里猜测「答：X」这类手写作答 */
export function extractAnswerHints(ocrLines = []) {
  const hints = []
  for (const line of ocrLines) {
    const text = String(line?.text ?? '').trim()
    if (!text) continue
    const m = text.match(/^(?:正确答案|参考答案|标准答案|答案|我的答案|我选|选择|答|选)\s*[:：、]?\s*(.+)$/)
    if (m) {
      const label = m[0].split(/[:：、]/)[0].trim()
      const value = m[1].trim()
      if (value) {
        const isCorrect = /答案/.test(label)
        hints.push({ value, line: text, kind: isCorrect ? 'correctAnswer' : 'myAnswer' })
      }
      continue
    }
    // 整行只有一个选项字母
    if (/^[A-Ha-h]$/.test(text)) hints.push({ value: text.toUpperCase(), line: text, kind: 'myAnswer' })
  }
  return hints
}

/**
 * 拆分一行里的选项，例如 "A.12B.16C.20D.24" -> [A:12, B:16, C:20, D:24]。
 * 字母必须**严格递增**（允许有缺口，如 A,B,D —— 缺口要留给 layout 信号惩罚）。
 */
export function splitOptionLine(line) {
  const text = String(line ?? '')
  const re = /([A-Ha-h])\s*[.、．)）:：]\s*/g
  const marks = []
  let m
  while ((m = re.exec(text)) !== null) {
    marks.push({ letter: m[1].toUpperCase(), start: m.index, contentStart: m.index + m[0].length })
  }
  if (marks.length < 2) return null
  let prev = ''
  for (const mark of marks) {
    if (prev && mark.letter <= prev) return null
    prev = mark.letter
  }
  const options = []
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length
    const content = text.slice(marks[i].contentStart, end).trim()
    if (content) options.push({ letter: marks[i].letter, text: content })
  }
  return options.length >= 2 ? options : null
}

/**
 * 把 OCR 的每一行按用途归类：题干 / 选项 / 学生作答 / 其他。
 * 这是「字段级置信度」与「字段级分位数 ocrToken」的基础（纯规则，不依赖模型）。
 *
 * @returns {{groups: {stem: object[], options: object[], answer: object[], other: object[]}, texts: string[]}}
 */
export function classifyOcrLines(lines = []) {
  const groups = { stem: [], options: [], answer: [], other: [] }
  const texts = lines.map((l) => String(l?.text ?? '').trim()).filter(Boolean)
  const answerHints = extractAnswerHints(lines)

  const scoreOf = (t) => {
    const hit = lines.find((l) => String(l?.text ?? '').trim() === t)
    const s = Number(hit?.score)
    return Number.isFinite(s) ? s : 0.9
  }
  const singleOption = (t) => String(t ?? '').match(/^([A-Ha-h])\s*[.、．)）:：]\s*(.+)$/)

  let i = 0
  while (i < texts.length) {
    const t = texts[i]
    const hint = answerHints.find((h) => h.line === t)
    if (hint) {
      groups.answer.push({ text: t, score: scoreOf(t), kind: hint.kind, value: hint.value, letter: null })
      i++
      continue
    }
    // 情况一：一行里挤了多个选项，如 "A.12B.16C.20D.24"
    const split = splitOptionLine(t)
    if (split) {
      const score = scoreOf(t)
      for (const o of split) groups.options.push({ text: o.text, letter: o.letter, score })
      i++
      continue
    }
    // 情况二：每个选项单独一行，如 "A.12" / "B.16" / ...
    if (singleOption(t)) {
      const group = []
      let j = i
      while (j < texts.length) {
        const m = singleOption(texts[j])
        if (!m) break
        group.push({ letter: m[1].toUpperCase(), text: m[2].trim(), score: scoreOf(texts[j]) })
        j++
      }
      const asc = group.every((g, k) => k === 0 || g.letter > group[k - 1].letter)
      if (group.length >= 2 && asc) {
        for (const g of group) groups.options.push({ text: g.text, letter: g.letter, score: g.score })
        i = j
        continue
      }
    }
    groups.stem.push({ text: t, score: scoreOf(t), letter: null })
    i++
  }

  // ---- 位置信号（**辅助**，文本规则优先）----
  // 只有在「文本规则没认出选项」时才用坐标去救：
  //   - 同一行（y 接近）的若干行片段 -> 归为同一行
  //   - 这些行整体偏右（x 起点明显靠右）-> 判为选项（补 A/B/C… 字母）
  applyPositionHints(groups, lines)

  return { groups, texts }
}

/**
 * 位置信号辅助分类。
 *
 * 原则：**不重写文本规则**。只有在文本规则完全没认出选项、且坐标信息可用时，
 * 才用「同一行 y 接近 + x 起点偏右」把若干行判成选项（并补上 A/B/C… 字母）。
 *
 * @param {{stem:object[],options:object[],answer:object[],other:object[]}} groups
 * @param {Array<{text:string,score:number,box?:number[]}>} lines
 */
function applyPositionHints(groups, lines = []) {
  // 已经有选项了 -> 文本规则说了算，不动
  if (groups.options.length) return

  const withBox = lines
    .map((l) => ({ l, box: Array.isArray(l?.box) && l.box.length === 4 ? l.box : null }))
    .filter((x) => x.box)
  if (withBox.length < 3) return

  const width = Math.max(...withBox.map((x) => Number(x.box[2]) || 0)) || 1
  // 以**最左**的 x 作为页边距基准（不能用中位数：右列的行会把中位数拉过去）
  const leftMargin = Math.min(...withBox.map((x) => Number(x.box[0]) || 0))
  const shiftThreshold = leftMargin + width * 0.12

  // 候选：题干行里，x 起点明显偏右的（排除作答行：答/答案/解…）
  const rightShifted = groups.stem.filter((g) => {
    if (/^\s*(答|答案|解|我答|我的回答)/.test(g.text)) return false
    if (g.text.length > 16) return false
    const hit = withBox.find((x) => String(x.l?.text ?? '').trim() === g.text)
    if (!hit) return false
    return Number(hit.box[0]) > shiftThreshold
  })
  if (rightShifted.length < 2 || rightShifted.length > 6) return

  // 同一行判定：y 中心接近
  const centers = rightShifted
    .map((g) => {
      const hit = withBox.find((x) => String(x.l?.text ?? '').trim() === g.text)
      const b = hit.box
      return { g, cy: (Number(b[1]) + Number(b[3])) / 2, h: Math.max(1, Number(b[3]) - Number(b[1])) }
    })
    .sort((a, b) => a.cy - b.cy)

  const rows = []
  for (const it of centers) {
    const ref = rows[rows.length - 1]
    if (ref && Math.abs(ref[ref.length - 1].cy - it.cy) <= Math.max(ref[ref.length - 1].h, it.h) * 0.6) {
      ref.push(it)
    } else {
      rows.push([it])
    }
  }
  // 至少两行、且每行只有一个片段（多片段说明是题干被拆开了）
  if (rows.length < 2 || rows.some((r) => r.length !== 1)) return

  // 判定为选项：按 y 顺序补 A/B/C…
  const picked = rows.map((r) => r[0].g)
  groups.stem = groups.stem.filter((g) => !picked.includes(g))
  picked.forEach((g, idx) => {
    groups.options.push({
      text: g.text,
      letter: String.fromCharCode(65 + idx),
      score: g.score,
      viaPosition: true,
    })
  })
}

/**
 * 仅用本地 OCR 文本构造草稿（没有视觉模型时的降级路径）。
 *
 * 除了草稿本身，还会把 OCR 的每一行按用途分组（题干 / 选项 / 作答），
 * 以便派生**逐字段置信度**（视觉模型不在场时前端仍然有字段级信号）。
 *
 * @returns {{draft: object, optionLetters: string[], warnings: string[], groups: object}}
 */
export function draftFromOcrLines(lines = [], ctx = {}) {
  const warnings = []
  const { groups, texts } = classifyOcrLines(lines)

  const options = groups.options.map((o) => o.text)
  const optionLetters = groups.options.map((o) => o.letter).filter(Boolean)
  const stem = groups.stem.map((g) => g.text).join('\n').trim()
  const fullText = texts.join('\n')

  if (!options.length) warnings.push('本地 OCR 未识别到选项行')
  if (!stem) warnings.push('本地 OCR 未识别到题干文字')

  const myHint = groups.answer.find((g) => g.kind === 'myAnswer')
  const corHint = groups.answer.find((g) => g.kind === 'correctAnswer')

  /* ---- 学科 / 题型 / 知识点：纯规则启发式（零 AI） ---- */
  // 契约：ctx.fallbackSubject 有值 == 用户**手动选过**学科 -> 优先于启发式
  const userSubject = normalizeSubject(ctx.userSubject || ctx.fallbackSubject)
  const localSubject = normalizeSubject(ctx.localSubject)
  const userQuestionType = normalizeQuestionType(ctx.userQuestionType)
  const subjectInfer = inferSubjectFromText(fullText, lines)
  const typeInfer = inferQuestionTypeFromText(fullText, groups, { subject: userSubject || subjectInfer.subject })

  let subject = userSubject
  let subjectConfidence = userSubject ? 1 : 0
  let subjectEvidence = userSubject ? ['用户手动选择'] : []
  if (!subject) {
    subject = subjectInfer.subject || localSubject || '数学'
    subjectConfidence = subjectInfer.subject ? subjectInfer.confidence : 0
    subjectEvidence = subjectInfer.evidence
  }

  const questionType = userQuestionType || typeInfer.questionType
  const inferredKps = inferKnowledgePoints(fullText, subject)
  const knowledgePoints = inferredKps.length
    ? inferredKps
    : (Array.isArray(ctx.fallbackKnowledgePoints) ? ctx.fallbackKnowledgePoints : [])

  if (!userSubject) {
    if (!subjectInfer.subject) {
      warnings.push('没能从图片文字判断学科，请手动确认')
    } else if (subjectInfer.confidence < 0.45) {
      const guess = subjectInfer.candidates.slice(0, 2).map((c) => c.subject).join('/')
      warnings.push(`学科判断把握不大（可能是${guess}），请确认`)
    } else if (subjectInfer.subject !== localSubject) {
      warnings.push(
        `学科按文本特征判定为「${subjectInfer.subject}」（依据：${subjectInfer.evidence.slice(0, 3).join('、')}）`,
      )
    }
  }
  if (!userQuestionType && typeInfer.confidence < 0.5) {
    warnings.push(`题型判断把握不大（暂按「${questionType}」），请确认`)
  }

  return {
    draft: {
      subject,
      questionType,
      knowledgePoints,
      stem,
      options,
      myAnswer: myHint?.value ?? '',
      correctAnswer: corHint?.value ?? '',
      difficulty: 3,
      ocrText: fullText,
      /* 新增字段（前端用来显示「为什么判定成这个学科」） */
      subjectConfidence,
      subjectEvidence,
      questionTypeConfidence: userQuestionType ? 1 : typeInfer.confidence,
    },
    optionLetters,
    warnings,
    groups,
    inference: {
      subject: { ...subjectInfer, subject, confidence: subjectConfidence, source: userSubject ? 'user' : 'heuristic' },
      questionType: { ...typeInfer, questionType, source: userQuestionType ? 'user' : 'heuristic' },
      knowledgePoints: inferredKps,
    },
  }
}

/**
 * 由本地 OCR 的逐行 rec_scores 派生**逐字段置信度**。
 *
 * 映射规则（docs/07 §5.2 第 3 步：字段级置信度用该字段自己的分位数，而不是全文平均）：
 *   stem           -> 题干相关行 scores 的 P20
 *   options        -> 选项行 scores 均值
 *   myAnswer       -> 命中「答 / 答案 / 解」等作答行的 P20（该行缺失时给 0.3）
 *   correctAnswer  -> 识别到印刷体答案行则取其 score，否则给 0.1（基本不可信）
 *   knowledgePoints-> 由题干证据充分度推导（推理值，上限 0.6）
 *
 * 无法归属的行不参与任何字段。
 */
export function fieldConfidenceFromOcr(groups = {}, ctx = {}) {
  const g = groups ?? {}
  const avg = (arr) => {
    const list = (arr ?? []).filter((x) => x && Number.isFinite(Number(x.score)))
    if (!list.length) return 0
    return list.reduce((a, b) => a + Number(b.score), 0) / list.length
  }
  const scores = (arr) => (arr ?? []).map((x) => Number(x?.score)).filter(Number.isFinite)

  const stemConf = round2(percentile(scores(g.stem), 0.2))
  const optionsConf = round2(avg(g.options))
  const myScores = scores((g.answer ?? []).filter((x) => x.kind === 'myAnswer'))
  const corScores = scores((g.answer ?? []).filter((x) => x.kind === 'correctAnswer'))
  const myConf = myScores.length ? round2(percentile(myScores, 0.2)) : 0.3
  const corConf = corScores.length ? round2(percentile(corScores, 0.2)) : 0.1
  const stemLongEnough = String(ctx.stem ?? '').trim().length >= 8
  const kpConf = round2(Math.min(stemConf || 0.3, 0.6) * (stemLongEnough ? 1 : 0.6))

  return {
    stem: stemConf,
    options: optionsConf,
    myAnswer: myConf,
    correctAnswer: corConf,
    knowledgePoints: kpConf,
  }
}

/**
 * 把模型返回的草稿收敛为严格结构。
 *
 * @param {object} raw     模型返回
 * @param {object} ctx     { fallbackSubject, fallbackQuestionType, fallbackKnowledgePoints, hint, ocrText, ocrLines }
 * @returns {{draft: object, fieldConfidence: object, warnings: string[], repaired: boolean}}
 */
export function normalizeDraft(raw = {}, ctx = {}) {
  const warnings = []
  const r = raw && typeof raw === 'object' ? raw : {}

  /* ---- 学科 ---- */
  let subject = String(r.subject ?? '').trim()
  if (!SUBJECTS.includes(subject)) {
    if (subject) warnings.push(`模型返回的学科「${subject}」不在枚举内，已改为「${ctx.fallbackSubject || '数学'}」`)
    subject = ctx.fallbackSubject || '数学'
  }

  /* ---- 题型 ---- */
  let questionType = String(r.questionType ?? '').trim()
  if (!QUESTION_TYPES.includes(questionType)) {
    if (questionType) warnings.push(`模型返回的题型「${questionType}」不在枚举内，已改为「${ctx.fallbackQuestionType || '解答题'}」`)
    questionType = ctx.fallbackQuestionType || '解答题'
  }

  /* ---- 题干 ---- */
  let stem = String(r.stem ?? '').trim()
  if (!stem) {
    stem = String(ctx.hint ?? '').trim()
    if (stem) warnings.push('模型未返回题干，已回退为用户补充的线索文本')
  }

  /* ---- 选项（字母归一） ---- */
  const rawOptions = Array.isArray(r.options) ? r.options : []
  const options = []
  const letters = []
  for (const o of rawOptions) {
    const { text, letter } = stripOptionPrefix(o)
    if (!text && !letter) continue
    options.push(text)
    letters.push(letter)
  }
  if (rawOptions.length && !options.length) warnings.push('模型返回的选项无法解析，已忽略')
  if (options.length === 1) warnings.push('仅识别到 1 个选项，可能识别不完整')

  /* ---- 答案 ---- */
  const cleanAnswer = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v).trim()
    return s
  }
  let myAnswer = cleanAnswer(r.myAnswer)
  let correctAnswer = cleanAnswer(r.correctAnswer)

  // OCR 里的手写作答可以补齐模型漏掉的 myAnswer
  const hints = extractAnswerHints(ctx.ocrLines ?? [])
  if (!myAnswer && hints.length) {
    myAnswer = hints[0].value
    warnings.push('模型未识别出学生作答，已采用本地 OCR 识别的作答行')
  }

  const legalLetters = options.map((_, i) => String.fromCharCode(65 + i))
  const answerLegal = (value) => {
    if (!value) return true
    const v = value.trim()
    if (legalLetters.includes(v.toUpperCase())) return true
    const m = v.match(OPTION_PREFIX) ?? v.match(OPTION_PREFIX_PAREN)
    if (m && legalLetters.includes(m[1].toUpperCase())) return true
    if (/^[A-Ha-h]$/.test(v) && legalLetters.includes(v.toUpperCase())) return true
    return false
  }
  if (!answerLegal(myAnswer)) warnings.push('我的答案不在选项范围内')
  if (!answerLegal(correctAnswer)) warnings.push('正确答案不在选项范围内')

  /* ---- 知识点 ---- */
  let knowledgePoints = Array.isArray(r.knowledgePoints)
    ? r.knowledgePoints.map((k) => String(k ?? '').trim()).filter(Boolean)
    : []
  if (!knowledgePoints.length && Array.isArray(ctx.fallbackKnowledgePoints)) {
    knowledgePoints = ctx.fallbackKnowledgePoints
    warnings.push('模型未给出知识点，已回退为本地知识点推断')
  }

  /* ---- 难度 ---- */
  let difficulty = Math.round(Number(r.difficulty))
  if (!Number.isFinite(difficulty) || difficulty < 1 || difficulty > 5) {
    difficulty = 3
    warnings.push('模型返回的难度超出 1-5，已修正为 3')
  }

  /* ---- OCR 文本 ---- */
  let ocrText = String(r.ocrText ?? '').trim()
  if (!ocrText) {
    ocrText = String(ctx.ocrText ?? '').trim()
    if (ocrText) warnings.push('模型未回传 OCR 原文，已使用本地 OCR 文本')
  }

  /* ---- 逐字段置信度 ---- */
  const fcRaw = r.fieldConfidence && typeof r.fieldConfidence === 'object' ? r.fieldConfidence : {}
  const fieldConfidence = {}
  for (const key of ['stem', 'options', 'myAnswer', 'correctAnswer', 'knowledgePoints']) {
    const v = fcRaw[key]
    if (v !== undefined && v !== null && Number.isFinite(Number(v))) {
      fieldConfidence[key] = round2(clamp01(v))
    }
  }
  if (!Object.keys(fieldConfidence).length) {
    // 模型没给逐字段置信度时，用整体 confidence 兜底
    const overall = clamp01(r.confidence, 0.6)
    for (const key of ['stem', 'options', 'myAnswer', 'correctAnswer', 'knowledgePoints']) {
      fieldConfidence[key] = round2(overall)
    }
    warnings.push('模型未给出逐字段置信度，已用整体置信度近似')
  }

  const notes = r.notes ? String(r.notes) : null

  return {
    draft: {
      subject,
      questionType,
      knowledgePoints,
      stem,
      options,
      myAnswer,
      correctAnswer,
      difficulty,
      ocrText,
    },
    fieldConfidence,
    optionLetters: letters.filter(Boolean),
    warnings,
    notes,
  }
}

/* -------------------------------------------------------------------------- */
/* 置信度融合                                                                  */
/* -------------------------------------------------------------------------- */

/** 各信号的默认权重（缺失的信号不参与，权重按实际出现的信号归一） */
export const SIGNAL_WEIGHTS = {
  ocrToken: 0.35,
  modelSelf: 0.35,
  structure: 0.2,
  layout: 0.1,
  crossCheck: 0.1,
}

/** 模型自报逐字段置信度的加权（correctAnswer 常为空，权重压低） */
export const MODEL_SELF_WEIGHTS = {
  stem: 0.3,
  options: 0.3,
  myAnswer: 0.2,
  correctAnswer: 0.05,
  knowledgePoints: 0.15,
}

function normalizeText(s) {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、,.!?！？"'""''（）()【】\[\]]/g, '')
    .toLowerCase()
}

function bigrams(s) {
  const out = new Set()
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2))
  if (s.length === 1) out.add(s)
  return out
}

/**
 * 分位数（线性插值）。
 * OCR 置信度是重尾分布：一行 0.3 分就能把算术均值从 0.95 拉到 0.87，
 * 而用户肉眼根本看不出那一行有问题——所以要用低分位数而不是均值。
 */
export function percentile(values, p = 0.2) {
  const arr = (values ?? []).map(Number).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!arr.length) return 0
  if (arr.length === 1) return arr[0]
  const idx = (arr.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return arr[lo]
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)
}

/**
 * 字符级相似度：bigram Jaccard 与包含度（overlap）的折中。
 * 之所以不用「整串相等」：OCR 常把选项连成一行（A.12B.16C.20D.24），
 * 单纯的 Jaccard 会被这些噪声拉低；overlap 对局部噪声更宽容。
 */
export function textSimilarity(a, b) {
  const ta = normalizeText(a)
  const tb = normalizeText(b)
  if (!ta || !tb) return 0
  if (ta === tb) return 1
  const ga = bigrams(ta)
  const gb = bigrams(tb)
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  const union = ga.size + gb.size - inter
  const jaccard = union > 0 ? inter / union : 0
  const overlap = Math.min(ga.size, gb.size) > 0 ? inter / Math.min(ga.size, gb.size) : 0
  return Math.min(1, (jaccard + overlap) / 2)
}

/**
 * 包含度 coverage = |modelText ∩ ocrText| / |modelText|。
 *
 * `ocr.text` 往往是**整页多道题**，`modelText` 只是一道题，
 * 对称相似度天然被压到 0.3~0.5（系统性低估）。包含度衡量的是
 * 「模型结构化出来的题干+选项，有多少能在 OCR 原文里找到」，
 * 对整页 OCR 天然公平。
 */
export function textCoverage(modelText, ocrText) {
  const tm = normalizeText(modelText)
  const to = normalizeText(ocrText)
  if (!tm) return 0
  const gm = bigrams(tm)
  const go = bigrams(to)
  if (!gm.size) return 0
  let inter = 0
  for (const g of gm) if (go.has(g)) inter++
  return inter / gm.size
}

/**
 * 字段级 ocrToken：按字段归属取分位数后加权
 *   0.5×题干P20 + 0.3×选项行均值 + 0.2×学生作答行P20
 * 缺失的字段不计权重，按剩余权重归一。
 *
 * @returns {number|null} null 表示没有任何可用的 OCR 行
 */
export function ocrTokenFromGroups(groups = {}) {
  const g = groups ?? {}
  const stemScores = (g.stem ?? []).map((x) => Number(x.score)).filter(Number.isFinite)
  const optScores = (g.options ?? []).map((x) => Number(x.score)).filter(Number.isFinite)
  const ansScores = (g.answer ?? [])
    .filter((x) => x.kind === 'myAnswer')
    .map((x) => Number(x.score))
    .filter(Number.isFinite)

  const parts = []
  if (stemScores.length) parts.push({ value: percentile(stemScores, 0.2), weight: 0.5 })
  if (optScores.length) parts.push({ value: optScores.reduce((a, b) => a + b, 0) / optScores.length, weight: 0.3 })
  if (ansScores.length) parts.push({ value: percentile(ansScores, 0.2), weight: 0.2 })
  if (!parts.length) return null

  const w = parts.reduce((a, p) => a + p.weight, 0)
  return parts.reduce((a, p) => a + p.value * p.weight, 0) / w
}

/**
 * 版面完整度（layout 信号）与版面惩罚（layoutPenalty）。
 *
 * 四项各占 0.25：
 *   1. 题号存在
 *   2. 选项字母连续无缺口（A,B,C,D 不能缺 C）
 *   3. 题干含数学符号时检出公式块
 *   4. 检出学生作答块
 *
 * 惩罚：缺题号 ×0.95；选项字母有缺口 ×0.85；该有公式却没检出 ×0.80
 */
export function scoreLayout({ draft, groups, optionLetters = [] } = {}) {
  const stem = String(draft?.stem ?? '')
  const checks = []

  // 1. 题号
  const hasQuestionNumber = /^\s*(?:第\s*)?\d+\s*[.、．)）]/.test(stem) || /第\s*\d+\s*题/.test(stem)
  checks.push({ name: 'questionNumber', weight: 0.25, pass: hasQuestionNumber })

  // 2. 选项字母连续无缺口
  const letters = (optionLetters ?? []).filter(Boolean)
  let contiguous = true
  if (letters.length >= 2) {
    contiguous = letters.every((l, i) => l.toUpperCase() === String.fromCharCode(65 + i))
  }
  checks.push({ name: 'optionContinuity', weight: 0.25, pass: contiguous })

  // 3. 公式块（题干含数学符号时才检查）
  const hasMathSymbol = /[=＝+×÷√∠△∽°%π]|\d\s*\/\s*\d|\^|\$|\\frac/.test(stem)
  const hasFormulaBlock = /(\d\s*[=＝]\s*\d)|(\$[^$]+\$)|(\d\s*[+\-×÷*/]\s*\d)|(\d+\s*\/\s*\d+)|(√\s*\d)|(\d+\s*°)/.test(stem)
  checks.push({ name: 'formulaBlock', weight: 0.25, pass: hasMathSymbol ? hasFormulaBlock : true })

  // 4. 学生作答块
  const answerBlocks = (groups?.answer ?? []).length
  const hasAnswerBlock = answerBlocks > 0 || Boolean(draft?.myAnswer) || Boolean(draft?.correctAnswer)
  checks.push({ name: 'answerBlock', weight: 0.25, pass: hasAnswerBlock })

  const score = checks.reduce((acc, c) => acc + (c.pass ? c.weight : 0), 0)

  let penalty = 1
  if (!hasQuestionNumber) penalty *= 0.95
  if (!contiguous) penalty *= 0.85
  if (hasMathSymbol && !hasFormulaBlock) penalty *= 0.8

  return { score: Math.min(1, score), checks, penalty: Math.round(penalty * 1000) / 1000 }
}

/** 模型自报逐字段置信度的加权平均（无模型时返回 null） */
export function weightedModelSelf(fieldConfidence) {
  if (!fieldConfidence || typeof fieldConfidence !== 'object') return null
  let sum = 0
  let weight = 0
  for (const [key, w] of Object.entries(MODEL_SELF_WEIGHTS)) {
    const v = Number(fieldConfidence[key])
    if (Number.isFinite(v)) {
      sum += v * w
      weight += w
    }
  }
  if (!weight) return null
  return sum / weight
}

/** 结构校验得分（0~1）：逐项加权 */
export function scoreStructure(draft, { recognized = true, optionLetters = [] } = {}) {
  const checks = []

  // 1. 题干非空且长度 ≥ 8
  checks.push({
    name: 'stem',
    weight: 0.25,
    pass: recognized ? String(draft.stem ?? '').trim().length >= 8 : false,
  })

  // 2. 选项：若存在则 ≥2 项且字母唯一；选择题必须有选项
  const options = Array.isArray(draft.options) ? draft.options : []
  const letters = optionLetters.filter(Boolean)
  // 没有显式字母时（模型直接给了选项内容），字母是隐式 A/B/C…，天然唯一
  const lettersUnique = letters.length === 0 ? true : new Set(letters).size === letters.length
  let optionsPass
  if (!recognized) optionsPass = false
  else if (!options.length) optionsPass = draft.questionType !== '选择题'
  else optionsPass = options.length >= 2 && lettersUnique
  checks.push({ name: 'options', weight: 0.2, pass: optionsPass })

  // 3. 答案：若有选项则必须在合法字母集合内
  const legal = options.map((_, i) => String.fromCharCode(65 + i))
  const legalCheck = (v) => {
    if (!v) return true
    const s = String(v).trim()
    if (legal.includes(s.toUpperCase())) return true
    const m = s.match(OPTION_PREFIX) ?? s.match(OPTION_PREFIX_PAREN)
    return Boolean(m && legal.includes(m[1].toUpperCase()))
  }
  let answerPass
  if (!recognized) answerPass = false
  else if (!options.length) answerPass = true
  else answerPass = legalCheck(draft.myAnswer) && legalCheck(draft.correctAnswer)
  checks.push({ name: 'answers', weight: 0.2, pass: answerPass })

  // 4. 知识点非空
  checks.push({
    name: 'knowledgePoints',
    weight: 0.15,
    pass: Array.isArray(draft.knowledgePoints) && draft.knowledgePoints.length > 0,
  })

  // 5. 学科 / 题型在枚举内
  checks.push({
    name: 'enums',
    weight: 0.1,
    pass: SUBJECTS.includes(draft.subject) && QUESTION_TYPES.includes(draft.questionType),
  })

  // 6. 难度 1-5
  checks.push({
    name: 'difficulty',
    weight: 0.1,
    pass: Number.isFinite(Number(draft.difficulty)) && draft.difficulty >= 1 && draft.difficulty <= 5,
  })

  const score = checks.reduce((acc, c) => acc + (c.pass ? c.weight : 0), 0)
  return { score: Math.min(1, score), checks }
}

/**
 * 融合置信度。
 *
 * final = Σ(signal.value × signal.weight) / Σ(signal.weight)
 * final_adj = final × layoutPenalty
 *
 * 信号说明：
 *   ocrToken  字段级分位数加权（0.5×题干P20 + 0.3×选项均值 + 0.2×作答P20）
 *   modelSelf 模型自报逐字段置信度（加权平均；**没有模型时不参与**）
 *   structure 结构自洽度（6 项加权检查）
 *   layout    版面完整度（题号/选项连续性/公式块/作答块）
 *   crossCheck 包含度与对称相似度取较大值
 *
 * @param {object} p
 * @param {object} p.draft           归一化后的草稿
 * @param {object} [p.modelConfidence] 模型自报的逐字段置信度（没有模型时传 null）
 * @param {object} [p.ocr]            本地 OCR 结果 {avgScore, scores, text}
 * @param {object} [p.ocrGroups]      OCR 行分组（题干/选项/作答）
 * @param {boolean} [p.recognized]    是否有识别证据（OCR / 模型）
 * @param {string[]} [p.optionLetters]
 * @returns {{confidence: number, signals: {name:string,value:number,weight:number}[], layoutPenalty: number}}
 */
export function fuseConfidence({
  draft,
  modelConfidence,
  ocr,
  ocrGroups,
  recognized = true,
  optionLetters = [],
  crossCheck = true,
} = {}) {
  const signals = []

  // 1) 本地 OCR token：字段级分位数加权（不是全文算术平均）
  const token = ocrTokenFromGroups(ocrGroups)
  if (token !== null) {
    signals.push({ name: 'ocrToken', value: round2(clamp01(token)), weight: SIGNAL_WEIGHTS.ocrToken })
  } else if (ocr && Array.isArray(ocr.scores) && ocr.scores.length) {
    // 没有字段归属信息时退化为全部分数的 P20（仍然比算术平均稳健）
    const p20 = percentile(ocr.scores, 0.2)
    signals.push({ name: 'ocrToken', value: round2(clamp01(p20)), weight: SIGNAL_WEIGHTS.ocrToken })
  }

  // 2) 模型自报逐字段置信度（**只有真的调了模型才有**）
  const self = weightedModelSelf(modelConfidence)
  if (self !== null) {
    signals.push({ name: 'modelSelf', value: round2(clamp01(self)), weight: SIGNAL_WEIGHTS.modelSelf })
  }

  // 3) 结构校验得分
  const structure = scoreStructure(draft, { recognized, optionLetters })
  signals.push({ name: 'structure', value: round2(structure.score), weight: SIGNAL_WEIGHTS.structure })

  // 4) 版面完整度 + 版面惩罚
  const layout = scoreLayout({ draft, groups: ocrGroups, optionLetters })
  signals.push({ name: 'layout', value: round2(layout.score), weight: SIGNAL_WEIGHTS.layout })

  // 5) OCR 原文 vs 模型题干/选项：包含度与对称相似度取较大值
  //    （草稿本身来自 OCR 时不算，否则是自证循环）
  if (ocr?.text && recognized && crossCheck) {
    const modelText = [draft.stem, ...(draft.options ?? [])].filter(Boolean).join(' ')
    const sim = textSimilarity(ocr.text, modelText)
    const coverage = textCoverage(modelText, ocr.text)
    signals.push({
      name: 'crossCheck',
      value: round2(clamp01(Math.max(sim, coverage))),
      weight: SIGNAL_WEIGHTS.crossCheck,
    })
  }

  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0)
  const fused = totalWeight > 0
    ? signals.reduce((acc, s) => acc + s.value * s.weight, 0) / totalWeight
    : 0
  const final = fused * layout.penalty

  return {
    confidence: round2(clamp01(final)),
    signals,
    layoutPenalty: layout.penalty,
    layoutChecks: layout.checks,
  }
}

export default {
  SUBJECTS,
  QUESTION_TYPES,
  VISION_SYSTEM_PROMPT,
  parseModelJson,
  recognizeWithVision,
  recognizeFromOcrText,
  normalizeDraft,
  draftFromOcrLines,
  fieldConfidenceFromOcr,
  splitOptionLine,
  fuseConfidence,
  scoreStructure,
  textSimilarity,
  extractAnswerHints,
  SIGNAL_WEIGHTS,
  /* 启发式（零 AI） */
  inferSubjectFromText,
  inferQuestionTypeFromText,
  inferKnowledgePoints,
  normalizeSubject,
  normalizeQuestionType,
  classifyOcrLines,
}
