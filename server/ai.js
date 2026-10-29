/**
 * server/ai.js
 * ---------------------------------------------------------------------------
 * 「错题智能分析机」双引擎实现。
 *
 *   引擎 A —— 大模型引擎（OpenAI 兼容协议）
 *     环境变量：AI_BASE_URL / AI_API_KEY / AI_MODEL
 *     调用：POST {AI_BASE_URL}/chat/completions  （要求严格 JSON 输出）
 *     超时 25s，任何异常自动降级到引擎 B，绝不抛出 5xx。
 *
 *   引擎 B —— 本地启发式引擎（无 API Key 也能产出结构完整、可用的结果）
 *     基于：题干关键词 + 学科 + 题型 + 学生作答情况
 *     推断：知识点 / 错因 / 解题步骤 / 根因 / 建议 / 同类题 / 7 天练习计划
 *
 * 直接运行 `node server/ai.js` 会执行一遍自检并打印示例 JSON。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readStoredAiConfig } from './settings.js'
import { getPreset, guessProviderByBaseUrl, resolveVisionSupport } from './providers.js'
import { callChat, sanitizeMessage, RED_PIXEL_DATA_URL } from './modelClient.js'
import { runLocalOcr, probeOcrService } from './ocr.js'
import {
  recognizeWithVision,
  recognizeFromOcrText,
  normalizeDraft,
  draftFromOcrLines,
  classifyOcrLines,
  inferSubjectFromText,
  inferQuestionTypeFromText,
  fieldConfidenceFromOcr,
  fuseConfidence,
} from './vision.js'
import {
  detectProblemModel,
  buildWorkedSteps,
  buildModelPitfalls,
  mergeModelIntoKnowledgePoints,
} from './problemModels.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, 'uploads')

/* ========================================================================== */
/* 常量                                                                       */
/* ========================================================================== */

export const ERROR_TYPE_LABEL = {
  knowledge_gap: '知识盲点',
  misread: '审题不清',
  calculation: '计算失误',
  method: '方法不当',
  time: '时间不足',
  careless: '粗心大意',
  expression: '书写不规范',
}

/**
 * 服务端错误码 → 用户看得懂的一句话。
 *
 * MiniMax 这类服务**认证失败、余额不足、限流都返回 HTTP 200**，
 * 真正的错误码在 body 的 `base_resp.status_code` 里（见 server/modelClient.js）。
 * 没有这张表，用户只会看到「连接失败」，完全不知道是密钥错了还是没钱了。
 */
const PROVIDER_ERROR_HINT = {
  1000: '服务端内部错误',
  1001: '服务端超时',
  1002: '触发限流，请稍后重试',
  1003: '请求参数不合法',
  1004: 'API Key 无效或已过期',
  1008: '账户余额不足',
  1013: '服务端内部错误',
  1027: '输出内容被安全策略拦截',
  1039: 'Token 数超过模型上限',
  2013: '请求参数错误',
}

const ERROR_TYPE_DESC = {
  knowledge_gap: '概念、公式或定理本身没有掌握，导致无法启动解题。',
  misread: '题意理解出现偏差，把题目要求理解错了。',
  calculation: '思路正确，但运算过程出错导致结果错误。',
  method: '解题方向本身不对，需要更换解法模型。',
  time: '时间分配不合理，题目未在规定时间内完成。',
  careless: '看错符号、抄错数字等低级失误。',
  expression: '步骤缺失、单位不规范导致扣分。',
}

/* ========================================================================== */
/* 知识点识别词典                                                            */
/* ========================================================================== */

/**
 * 每条规则：学科、知识点名、难度层级、触发关键词（按优先级从上到下）
 */
const KNOWLEDGE_RULES = [
  /* ------------------------------ 数学 ------------------------------ */
  { subject: '数学', name: '分数应用题', level: '难点', kw: ['分数应用', '几分之几', '分数占', '用分数表示'] },
  { subject: '数学', name: '分数四则运算', level: '基础', kw: ['通分', '约分', '异分母', '分数加减', '分数乘', '分数除'] },
  { subject: '数学', name: '小数四则运算', level: '基础', kw: ['小数点', '小数乘', '小数除', '保留两位', '进率'] },
  { subject: '数学', name: '百分数应用题', level: '进阶', kw: ['百分之', '百分数', '折扣', '打折', '利率', '增长率', '提高百分之'] },
  { subject: '数学', name: '行程问题', level: '难点', kw: ['相遇', '追及', '速度和', '同时出发', '行驶', '路程', '速度是', '追上'] },
  { subject: '数学', name: '归一归总问题', level: '进阶', kw: ['照这样计算', '每份', '总数除以', '单一量'] },
  { subject: '数学', name: '面积与周长', level: '进阶', kw: ['面积', '周长', '平方厘米', '平方米', '长方形', '正方形', '平行四边形', '梯形'] },
  { subject: '数学', name: '三角形内角和', level: '基础', kw: ['三角形', '内角和', '外角'] },
  { subject: '数学', name: '解方程', level: '进阶', kw: ['解方程', '方程', '未知数', '设x'] },
  { subject: '数学', name: '比例问题', level: '进阶', kw: ['比例', '正比例', '反比例', '成比例', '按比例'] },
  { subject: '数学', name: '运算定律与简便计算', level: '基础', kw: ['简便计算', '简便运算', '运算律', '凑整', '乘法分配律', '结合律'] },
  { subject: '数学', name: '统计与可能性', level: '基础', kw: ['平均数', '中位数', '众数', '可能性', '统计图', '扇形统计'] },
  { subject: '数学', name: '几何图形的认识', level: '基础', kw: ['线段', '射线', '平移', '旋转', '垂直', '平行', '角的度量'] },
  { subject: '数学', name: '圆柱与圆锥', level: '进阶', kw: ['圆柱', '圆锥', '侧面积', '底面积'] },
  { subject: '数学', name: '负数与数轴', level: '基础', kw: ['负数', '正数', '数轴', '相反数', '绝对值'] },

  /* ------------------------------ 语文 ------------------------------ */
  { subject: '语文', name: '修辞手法', level: '进阶', kw: ['修辞', '比喻', '拟人', '排比', '夸张', '设问', '反问', '反复'] },
  { subject: '语文', name: '病句修改', level: '进阶', kw: ['病句', '语序不当', '搭配不当', '成分残缺', '修改病句'] },
  { subject: '语文', name: '阅读理解', level: '难点', kw: ['阅读下面', '阅读短文', '根据短文', '概括', '体会情感', '中心思想'] },
  { subject: '语文', name: '作文审题与立意', level: '进阶', kw: ['作文', '写一篇', '不少于', '字左右', '题目要求'] },
  { subject: '语文', name: '古诗词默写', level: '基础', kw: ['默写', '补写', '上句', '下句', '古诗', '诗句'] },
  { subject: '语文', name: '词语积累与运用', level: '基础', kw: ['成语', '近义词', '反义词', '词语', '加点字'] },
  { subject: '语文', name: '文言文阅读', level: '难点', kw: ['文言', '之乎者也', '加点词', '解释句子'] },
  { subject: '语文', name: '标点符号运用', level: '基础', kw: ['标点', '引号', '破折号', '省略号', '分号'] },
  { subject: '语文', name: '句子排序与衔接', level: '进阶', kw: ['排序', '连贯', '衔接'] },

  /* ------------------------------ 英语 ------------------------------ */
  { subject: '英语', name: '一般现在时', level: '基础', kw: ['usually', 'every day', 'always', 'often', '一般现在时'] },
  { subject: '英语', name: '一般过去时', level: '基础', kw: ['yesterday', 'last week', 'ago', '一般过去时', 'was', 'were'] },
  { subject: '英语', name: '现在完成时', level: '进阶', kw: ['already', 'yet', 'since', 'have been', '已经', '现在完成时'] },
  { subject: '英语', name: '状语从句', level: '难点', kw: ['because', 'although', 'though', 'so that', '状语从句', 'as soon as'] },
  { subject: '英语', name: '宾语从句', level: '难点', kw: ['asked', 'wondered', '宾语从句', 'whether', 'if he', 'what time'] },
  { subject: '英语', name: '被动语态', level: '进阶', kw: ['被动语态', 'is made', 'was cleaned', 'be done'] },
  { subject: '英语', name: '时态综合辨析', level: '进阶', kw: ['时态', '时态填空', 'tense'] },
  { subject: '英语', name: '词汇与拼写', level: '基础', kw: ['拼写', 'spelling', 'vocabulary', '单词'] },
  { subject: '英语', name: '完形填空', level: '进阶', kw: ['完形填空', 'cloze', '选词填空'] },
  { subject: '英语', name: '介词与固定搭配', level: '基础', kw: ['介词', 'in front of', 'on time', 'be good at'] },
  { subject: '英语', name: '英语阅读理解', level: '进阶', kw: ['read the passage', 'according to the passage', '英语短文'] },

  /* ------------------------------ 物理 ------------------------------ */
  { subject: '物理', name: '力与运动', level: '进阶', kw: ['摩擦力', '重力', '牛顿', '二力平衡', '惯性'] },
  { subject: '物理', name: '浮力', level: '难点', kw: ['浮力', '漂浮', '下沉', '排开', '液体密度'] },
  { subject: '物理', name: '电学', level: '进阶', kw: ['电流', '电压', '电阻', '电路', '欧姆定律', '串联', '并联'] },
  { subject: '物理', name: '压强', level: '进阶', kw: ['压强', '压力', '受力面积', '液体压强'] },
  { subject: '物理', name: '功与机械能', level: '进阶', kw: ['功率', '机械能', '动能', '势能', '做功'] },
  { subject: '物理', name: '光学', level: '基础', kw: ['光的反射', '折射', '凸透镜', '焦距', '成像'] },

  /* ------------------------------ 化学 ------------------------------ */
  { subject: '化学', name: '化学方程式', level: '进阶', kw: ['化学方程式', '配平', '书写反应'] },
  { subject: '化学', name: '溶液与浓度', level: '进阶', kw: ['溶液', '溶质', '溶剂', '浓度', '饱和溶液', '溶解度'] },
  { subject: '化学', name: '原子与元素', level: '进阶', kw: ['原子', '元素', '质子', '中子', '离子', '相对原子质量'] },
  { subject: '化学', name: '酸碱盐', level: '进阶', kw: ['酸', '碱', '盐', 'pH', '中和'] },
  { subject: '化学', name: '质量守恒定律', level: '基础', kw: ['质量守恒', '守恒定律'] },

  /* ------------------------------ 生物 ------------------------------ */
  { subject: '生物', name: '细胞与组织结构', level: '基础', kw: ['细胞', '组织', '器官', '系统', '细胞壁'] },
  { subject: '生物', name: '光合作用与呼吸作用', level: '进阶', kw: ['光合作用', '呼吸作用', '叶绿体', '光能'] },
  { subject: '生物', name: '遗传与变异', level: '进阶', kw: ['遗传', '基因', '染色体', '变异', '显性'] },

  /* --------------------------- 道法 / 其它 --------------------------- */
  { subject: '道法', name: '法律法规常识', level: '进阶', kw: ['宪法', '法律', '权利', '义务', '未成年', '依法'] },
  { subject: '道法', name: '品德修养与责任', level: '基础', kw: ['诚信', '责任', '友谊', '挫折', '感恩'] },
  { subject: '地理', name: '地球与地图', level: '基础', kw: ['经度', '纬度', '地球', '地图', '半球'] },
  { subject: '地理', name: '气候与降水', level: '进阶', kw: ['气候', '降水', '气温', '季风'] },
  { subject: '历史', name: '中国古代史', level: '进阶', kw: ['朝代', '秦朝', '唐朝', '宋朝', '孔子', '丝绸之路'] },
  { subject: '历史', name: '中国近代史', level: '进阶', kw: ['近代', '革命', '五四运动', '抗日', '鸦片战争'] },
]

/* ========================================================================== */
/* 题型推断                                                                  */
/* ========================================================================== */

const QUESTION_TYPE_RULES = [
  { type: '选择题', kw: ['下列', '正确的一项是', '错误的一项是', '（　）', 'A．', 'A.', '选项'] },
  { type: '判断题', kw: ['判断对错', '正确的打', '√', '×'] },
  { type: '填空题', kw: ['填空', '横线上', '______', '（　）'] },
  { type: '计算题', kw: ['计算', '解方程', '化简', '直接写出'] },
  { type: '应用题', kw: ['每', '一共', '平均', '还剩', '多少元', '多少千米', '买', '原有'] },
  { type: '证明题', kw: ['证明', '求证'] },
  { type: '作文题', kw: ['作文', '写一篇', '不少于'] },
  { type: '阅读理解', kw: ['阅读下面', '阅读短文', '根据短文', '短文'] },
  { type: '完形填空', kw: ['完形填空', 'cloze'] },
  { type: '语法填空', kw: ['用所给词的适当形式', '语法填空', '填入空白处'] },
  { type: '翻译题', kw: ['翻译', '汉译英', '英译汉'] },
  { type: '实验题', kw: ['实验', '探究', '如图所示装置'] },
  { type: '解答题', kw: ['解答', '求解', '并说明理由'] },
]

/* ========================================================================== */
/* 解题手册（correctSteps 模板）                                              */
/* ========================================================================== */

const SUBJECT_PLAYBOOK = {
  数学: [
    { title: '审题与标注条件', detail: '把题目中的已知量、未知量和所求问题分别圈出来，特别注意单位、倍数关系和"比……多/少"这类描述。' },
    { title: '分析数量关系', detail: '判断这道题属于哪一种基本模型（总数=各部分之和、相遇=速度和×时间、单价×数量=总价），确定使用的公式。' },
    { title: '列式分步计算', detail: '按数量关系写出算式，先算什么后算什么分步列清楚；小数点、括号、单位都不能漏写。' },
    { title: '检验与作答', detail: '把结果代回题目条件检验是否合理（估算数量级），最后写上"答：……"。' },
  ],
  语文: [
    { title: '审清题目要求', detail: '明确要回答几问、答题格式（是否要点式/字数限制），避免答非所问或漏答。' },
    { title: '回读原文定位依据', detail: '根据题干中的关键词回到原文对应段落找依据，答案要"从文中来"。' },
    { title: '组织答案语言', detail: '按"原文依据 + 自己的概括归纳"组织语言，尽量使用题目要求的语文术语，分点作答。' },
    { title: '规范书写', detail: '字迹工整、标点正确、要点用序号标清，保证卷面分。' },
  ],
  英语: [
    { title: '判断句子时态', detail: '先找时间状语（yesterday / every day / since…），由它确定谓语动词的时态形式。' },
    { title: '分析句子结构', detail: '划分主语、谓语、宾语/表语，确认谓语动词的位置与形式变化。' },
    { title: '处理词形变化', detail: '注意第三人称单数、名词复数、动词时态词尾变化以及主谓一致。' },
    { title: '通读检查', detail: '把整句朗读一遍，检查语法搭配、拼写与标点，确认与题目要求一致。' },
  ],
  物理: [
    { title: '明确研究对象与物理量', detail: '先确定研究对象和已知物理量，判断题目涉及哪几个过程，写出对应公式。' },
    { title: '建立物理模型', detail: '画简图，把实际情境抽象成理想模型（如受力分析图、光路图、电路图）。' },
    { title: '列式求解', detail: '代入公式并统一单位，注意正负号方向与有效数字。' },
    { title: '回代检验与答题', detail: '检查结果的物理意义是否符合实际（如浮力不能大于重力），最后规范写出结论。' },
  ],
  化学: [
    { title: '写出反应物与生成物', detail: '确认反应物、生成物和反应条件，注意化学式不能写错。' },
    { title: '配平并检查', detail: '按照最小公倍数法配平，使等号两边各元素原子个数相等。' },
    { title: '标注反应条件与状态', detail: '补充"点燃/加热/催化剂"等条件与"↑""↓"符号。' },
    { title: '复核', detail: '逐项核对化学式、配平结果和单位，确认没有遗漏物质。' },
  ],
  生物: [
    { title: '定位知识点', detail: '明确题目考查的结构、功能或过程（如细胞结构、光合作用条件）。' },
    { title: '调用教材结论', detail: '回忆并准确写出教材中的关键结论，避免答题不完整。' },
    { title: '结合材料分析', detail: '把教材结论与题目中的具体情境、数据对应起来作答。' },
    { title: '规范表达', detail: '用完整的生物学语言作答，术语准确、条理清楚。' },
  ],
}

const GENERIC_PLAYBOOK = [
  { title: '回顾相关知识', detail: '先回到课本或笔记，找到本题考查的核心概念、公式或方法。' },
  { title: '读懂题目要求', detail: '用铅笔在题目上圈出关键条件与所求问题，确认问法。' },
  { title: '建立解题思路', detail: '把题目条件转化成自己熟悉的模型，写出解题的关键一步。' },
  { title: '规范作答与检查', detail: '分步书写、写出依据与结论，最后回读一遍检查。' },
]

/* ========================================================================== */
/* 同类题库                                                                  */
/* ========================================================================== */

/** key = 知识点名；每条含 stem / answer / analysis / difficulty */
const SIMILAR_BANK = {
  分数应用题: [
    { stem: '果园里有苹果树 120 棵，其中 1/3 是红富士，红富士有多少棵？', answer: '40 棵', analysis: '求 120 的 1/3，用乘法：120 × 1/3 = 40（棵）。', difficulty: 2 },
    { stem: '一根绳子长 3/4 米，用去了 2/5 米，还剩多少米？', answer: '7/20 米', analysis: '同分母先通分：3/4 = 15/20，2/5 = 8/20，15/20 − 8/20 = 7/20（米）。', difficulty: 3 },
    { stem: '六年级有学生 240 人，其中 5/8 参加了课后服务，参加课后服务的有多少人？', answer: '150 人', analysis: '240 × 5/8 = 30 × 5 = 150（人）。', difficulty: 3 },
  ],
  分数四则运算: [
    { stem: '计算：3/4 + 2/7 = ?', answer: '29/28', analysis: '通分到 28：3/4 = 21/28，2/7 = 8/28，相加得 29/28。', difficulty: 2 },
    { stem: '计算：5/6 ÷ 5/9 = ?', answer: '3/2', analysis: '除以一个数等于乘它的倒数：5/6 × 9/5 = 9/6 = 3/2。', difficulty: 2 },
    { stem: '计算：7/8 × 4/21 = ?', answer: '1/6', analysis: '先约分再相乘：(7×4)/(8×21) = 28/168 = 1/6。', difficulty: 3 },
  ],
  行程问题: [
    { stem: '甲、乙两地相距 240 千米，两车同时从两地相对开出，甲车每小时 45 千米，乙车每小时 35 千米，几小时相遇？', answer: '3 小时', analysis: '速度和 = 45 + 35 = 80（千米/时），相遇时间 = 240 ÷ 80 = 3（小时）。', difficulty: 3 },
    { stem: '弟弟以每分钟 60 米的速度追赶哥哥，哥哥先行 300 米且不快跑，弟弟几分钟追上？', answer: '5 分钟', analysis: '追及路程差 = 300 米，速度差 = 60 米/分，时间 = 300 ÷ 60 = 5（分钟）。', difficulty: 3 },
    { stem: '汽车以 60 千米/时的速度行驶 2.5 小时，路程是多少千米？', answer: '150 千米', analysis: '路程 = 速度 × 时间 = 60 × 2.5 = 150（千米）。', difficulty: 1 },
  ],
  面积与周长: [
    { stem: '一个长方形长 8 厘米、宽 5 厘米，它的面积和周长各是多少？', answer: '面积 40 平方厘米，周长 26 厘米', analysis: '面积 = 8×5 = 40（cm²），周长 = (8+5)×2 = 26（cm）。', difficulty: 2 },
    { stem: '一个平行四边形的底是 12 分米，高是 7 分米，面积是多少？', answer: '84 平方分米', analysis: '平行四边形面积 = 底 × 高 = 12 × 7 = 84（dm²）。', difficulty: 2 },
    { stem: '一个三角形面积是 36 平方米，底是 9 米，高是多少米？', answer: '8 米', analysis: '高 = 面积 × 2 ÷ 底 = 36 × 2 ÷ 9 = 8（米）。', difficulty: 3 },
  ],
  三角形内角和: [
    { stem: '三角形中两个角分别是 50° 和 60°，第三个角是多少度？', answer: '70°', analysis: '三角形内角和 180°，180° − 50° − 60° = 70°。', difficulty: 2 },
    { stem: '一个等腰三角形的顶角是 40°，每个底角是多少度？', answer: '70°', analysis: '底角 = (180° − 40°) ÷ 2 = 70°。', difficulty: 3 },
    { stem: '三角形的外角等于两个不相邻内角的什么？', answer: '和', analysis: '三角形的一个外角等于与它不相邻的两个内角的和。', difficulty: 2 },
  ],
  解方程: [
    { stem: '解方程：3x + 12 = 27', answer: 'x = 5', analysis: '两边同减 12 得 3x = 15，两边同除 3 得 x = 5。', difficulty: 2 },
    { stem: '解方程：2(x − 5) = 14', answer: 'x = 12', analysis: '两边同除 2 得 x − 5 = 7，x = 12。', difficulty: 3 },
    { stem: '一件衣服打折后 96 元，原价是多少元（打八折）？', answer: '120 元', analysis: '设原价 x，0.8x = 96，x = 120（元）。', difficulty: 3 },
  ],
  百分数应用题: [
    { stem: '某班有 50 人，今天缺席 2 人，出勤率是多少？', answer: '96%', analysis: '出勤 48 人，48 ÷ 50 = 96%。', difficulty: 2 },
    { stem: '一件商品原价 200 元，涨价 10% 后是多少元？', answer: '220 元', analysis: '200 × (1 + 10%) = 220（元）。', difficulty: 2 },
    { stem: '存入 1000 元，年利率 2.75%，存期 2 年利息是多少元？', answer: '55 元', analysis: '利息 = 本金 × 利率 × 时间 = 1000 × 2.75% × 2 = 55（元）。', difficulty: 3 },
  ],
  运算定律与简便计算: [
    { stem: '简便计算：25 × 32 × 125', answer: '100000', analysis: '25×4=100，125×8=1000，32=4×8，原式 = 100 × 1000 = 100000。', difficulty: 3 },
    { stem: '简便计算：99 × 36 + 36', answer: '3600', analysis: '提取公因数 36：36 × (99 + 1) = 36 × 100 = 3600。', difficulty: 2 },
    { stem: '简便计算：125 × 88', answer: '11000', analysis: '88 = 8 × 11，125 × 8 = 1000，1000 × 11 = 11000。', difficulty: 2 },
  ],
  统计与可能性: [
    { stem: '一组数据 3、5、5、7、10 的平均数是多少？', answer: '6', analysis: '总和 30 ÷ 5 = 6。', difficulty: 2 },
    { stem: '数据 2、3、3、4、8 的中位数是多少？', answer: '3', analysis: '已按大小排列，共 5 个数，中间的数是 3。', difficulty: 2 },
    { stem: '盒子里有 2 个红球和 3 个白球，随机摸一个，摸到红球的可能性是多少？', answer: '2/5', analysis: '总共 5 个球，红球 2 个，2 ÷ 5 = 2/5。', difficulty: 2 },
  ],
  修辞手法: [
    { stem: '"春天像一位害羞的小姑娘，悄悄地把花瓣洒向大地。"用了什么修辞手法？有什么表达效果？', answer: '比喻', analysis: '把"春天"比作"害羞的小姑娘"，生动形象地写出了春天来临的柔和与喜悦。', difficulty: 2 },
    { stem: '"红的像火，粉的像霞，白的像雪。"这句话用了什么修辞？', answer: '比喻、排比', analysis: '连用三个比喻构成排比，句式整齐，描绘出花的色彩之美。', difficulty: 3 },
    { stem: '"小明_atom 急得直跺脚。"句中加点词运用了什么修辞手法？', answer: '拟人', analysis: '把"急"这一人的情态赋予"跺脚"的动作，生动写出小明的着急。', difficulty: 2 },
  ],
  病句修改: [
    { stem: '修改病句："通过这次活动，使我明白了团结的重要性。"', answer: '删去"通过"或"使"', analysis: '"通过"和"使"同时使用导致句子缺主语，删去其中一个即可。', difficulty: 3 },
    { stem: '修改病句："我们要养成边读边思考的好方法。"', answer: '"方法"改为"习惯"', analysis: '"养成"搭配的应是"习惯"而非"方法"，属于搭配不当。', difficulty: 3 },
    { stem: '修改病句："他的语文成绩明显的提高了。"', answer: '"明显的"改为"明显地"', analysis: '成分残缺，句子缺少谓语中心，应补上"地"字。', difficulty: 3 },
  ],
  阅读理解: [
    { stem: '阅读短文后，用一句话概括全文的主要内容。', answer: '按"谁+做了什么+结果"概括', analysis: '先找首尾段的关键句，再把主体事件合并成一句 20 字左右的话。', difficulty: 3 },
    { stem: '文中划线句"父亲的手掌很粗糙"表达了作者怎样的情感？', answer: '对父亲的感激与心疼', analysis: '抓住"粗糙"这一细节，结合父亲劳动的语境体会作者的情感。', difficulty: 4 },
    { stem: '短文第 3 自然段运用了什么描写方法？作用是什么？', answer: '外貌（细节）描写', analysis: '外貌描写使人物形象更具体可感，为下文情节发展作铺垫。', difficulty: 3 },
  ],
  作文审题与立意: [
    { stem: '作文题："那一次，我长大了"，请列出你的写作提纲。', answer: '事件 + 感受', analysis: '选一件具体的经历，按"事情发生—遇到困难—我的选择与成长—感悟"排列。', difficulty: 3 },
    { stem: '作文要求"不少于 400 字"，写作时应该怎样安排详略？', answer: '重点部分详写', analysis: '最能体现中心的事件详写，其余略写，注意字数与结构完整。', difficulty: 3 },
    { stem: '写《我的好朋友》时，如何避免流水账？', answer: '抓住细节与心理描写', analysis: '选取 1—2 个典型场景，用动作、语言、神态和心理描写替代平铺直叙。', difficulty: 4 },
  ],
  一般过去时: [
    { stem: 'We ____ (visit) the museum last Sunday.', answer: 'visited', analysis: 'last Sunday 是过去时间状语，谓语用一般过去时，visit 的过去式为 visited。', difficulty: 2 },
    { stem: 'She ____ (be) very tired yesterday.', answer: 'was', analysis: 'be 动词的一般过去式是 was / were，主语 She 用 was。', difficulty: 2 },
    { stem: 'They ____ (go) to Beijing two years ago.', answer: 'went', analysis: 'ago 提示过去时间；go 的过去式为 went（不规则变化）。', difficulty: 3 },
  ],
  现在完成时: [
    { stem: 'I ____ (finish) my homework already.', answer: 'have finished', analysis: 'already 是现在完成时的标志词，主句主语 I 用 have + 过去分词。', difficulty: 3 },
    { stem: 'He ____ (live) in Shanghai since 2015.', answer: 'has lived', analysis: 'since + 时间点，表示从过去持续到现在，用现在完成时。', difficulty: 3 },
    { stem: 'Have you ever ____ (been) to Xi\'an?', answer: 'been', analysis: '现在完成时中 be 动词的过去分词为 been。', difficulty: 3 },
  ],
  状语从句: [
    { stem: '连词成句：he was late, because / he / the bus / missed / .', answer: 'He was late because he missed the bus.', analysis: 'because 引导原因状语从句，主句在前，从句在后且用陈述语序。', difficulty: 3 },
    { stem: '选择合适的连词："____ it was raining, we still went out."', answer: 'Although', analysis: '前后意思转折（虽然下雨但仍出门），用 although / though 引导让步状语从句。', difficulty: 3 },
    { stem: '"You can pass the exam ____ you work hard."中应填？', answer: 'if', analysis: 'if 引导条件状语从句，表示"只要……就……"。', difficulty: 3 },
  ],
  宾语从句: [
    { stem: 'He asked me ____ I had finished my homework.', answer: 'whether / if', analysis: '宾语从句表示"是否"，用 whether 或 if；注意语序要用陈述语序。', difficulty: 3 },
    { stem: '把 He said, "I am busy." 改为宾语从句：He said that ____.', answer: 'he was busy', analysis: '主句过去时，从句时态相应后移，am → was。', difficulty: 3 },
    { stem: '"Where did you go?" 改为宾语从句，连接词用 ____。', answer: 'where', analysis: '宾语从句连接词用原来的疑问词，且从句用陈述语序。', difficulty: 3 },
  ],
  时态综合辨析: [
    { stem: 'He ____ (go) to the park every Sunday, but yesterday he ____ (not go).', answer: 'goes; did not go', analysis: 'every Sunday 表习惯用一般现在时；yesterday 表过去用一般过去时否定式。', difficulty: 4 },
    { stem: '选择：She ____ here since she moved to Nanjing.', answer: 'has lived', analysis: 'since 引导的时间状语与现在完成时连用。', difficulty: 4 },
    { stem: 'Listen! Someone ____ the piano in the next room.', answer: 'is playing', analysis: 'Listen! 提示动作正在发生，用现在进行时。', difficulty: 3 },
  ],
  词汇与拼写: [
    { stem: '根据首字母填空：I am very t______ after running.', answer: 'tired', analysis: '根据句意"跑完后很累"及首字母 t，填 tired。', difficulty: 2 },
    { stem: '写出下列单词的反义词：expensive', answer: 'cheap', analysis: 'expensive（昂贵的）的反义词为 cheap（便宜的）。', difficulty: 2 },
    { stem: '选择正确的词：The weather is very ____ (rain) today.', answer: 'rainy', analysis: 'be 动词后需用形容词，rain 的形容词形式为 rainy。', difficulty: 2 },
  ],
  完形填空: [
    { stem: '完形填空（第 5 空）：It was raining hard, so I ____ my umbrella with me.', answer: 'took', analysis: '过去某时发生的动作，用一般过去时 took。', difficulty: 3 },
    { stem: '完形填空（第 8 空）：If you want to stay healthy, you should ____ more exercise.', answer: 'take', analysis: 'should 后接动词原形 take。', difficulty: 3 },
    { stem: '完形填空（第 12 空）：The film was so ____ that I fell asleep.', answer: 'boring', analysis: 'so…that 引导结果从句，"我睡着了"说明电影无聊，用 boring。', difficulty: 4 },
  ],
  浮力: [
    { stem: '体积为 0.001 m³ 的物体完全浸没在水中，受到的浮力是多少？（ρ水=1.0×10³ kg/m³，g 取 10 N/kg）', answer: '10 N', analysis: 'F浮 = ρ液 g V排 = 1.0×10³ × 10 × 0.001 = 10 N。', difficulty: 3 },
    { stem: '物体在水中漂浮时，浮力与重力有什么关系？', answer: '浮力等于重力', analysis: '漂浮物体处于平衡状态，二力平衡，F浮 = G物。', difficulty: 2 },
    { stem: '同一物体分别放入水和盐水中，浮力变大还是变小？', answer: '在盐水中浮力变大', analysis: '物体排开体积不变，液体密度变大则浮力变大（阿基米德原理）。', difficulty: 4 },
  ],
  电学: [
    { stem: '电路中电流为 0.5 A，电压为 6 V，电阻是多少欧姆？', answer: '12 Ω', analysis: 'R = U / I = 6 ÷ 0.5 = 12（Ω）。', difficulty: 2 },
    { stem: '两个电阻串联，总电阻与分电阻的关系是什么？', answer: '总电阻等于各分电阻之和', analysis: '串联电路各处电流相同，总电阻 R = R₁ + R₂。', difficulty: 3 },
    { stem: '并联电路中各支路电压有什么特点？', answer: '各支路两端电压相等', analysis: '并联电路电压相等，电流按定值电阻分配。', difficulty: 3 },
  ],
  化学方程式: [
    { stem: '配平并书写：铁在氧气中燃烧的化学方程式。', answer: '3Fe + 2O₂ =点燃= Fe₃O₄', analysis: '铁与氧气生成四氧化三铁，用最小公倍数法配平为 3 : 2 : 1，并标注"点燃"条件。', difficulty: 3 },
    { stem: '写出实验室用高锰酸钾制取氧气的化学方程式。', answer: '2KMnO₄ =加热= K₂MnO₄ + MnO₂ + O₂↑', analysis: '注意"加热"条件与氧气的"↑"符号。', difficulty: 4 },
    { stem: '检验二氧化碳使用什么试剂？', answer: '澄清石灰水', analysis: '通入澄清石灰水，变浑浊则证明是二氧化碳。', difficulty: 2 },
  ],
  溶液与浓度: [
    { stem: '把 50 g 食盐完全溶解在 200 g 水中，所得溶液的溶质质量分数是多少？', answer: '20%', analysis: '溶质质量分数 = 50 ÷ (50 + 200) × 100% = 20%。', difficulty: 3 },
    { stem: '一定温度下不能再溶解某溶质的溶液叫什么？', answer: '饱和溶液', analysis: '该温度下达到最大溶解量即为饱和溶液。', difficulty: 2 },
    { stem: '把 100 g 20% 的盐水稀释成 10%，需要加水多少克？', answer: '100 g', analysis: '溶质不变：20 g ÷ 10% = 200 g 溶液，需加水 100 g。', difficulty: 4 },
  ],
  法律与品德: [
    { stem: '未成年人保护法中"四大保护"指的是什么？', answer: '家庭保护、学校保护、社会保护、网络保护、政府保护、司法保护', analysis: '答题需完整列举，注意题目要求的条数，漏写会扣分。', difficulty: 3 },
    { stem: '公民的基本义务有哪些？请写出两条。', answer: '维护国家统一和全国各民族团结；依法纳税；服兵役等', analysis: '义务与权利相对，写出准确、完整的具体条目。', difficulty: 3 },
  ],
}

/** 通用同类题生成器（知识点库中没有对应模板时使用） */
function genericSimilar(subject, kp, difficulty) {
  const d = Math.min(5, Math.max(1, difficulty || 3))
  if (subject === '数学') {
    return [
      { stem: `【${kp}】练习：把一道与「${kp}」相关的题目重做一遍，并写出自查过程。`, answer: '见具体作答', analysis: '整理「' + kp + '」的基本模型：先找已知量与所求量，再选公式，最后检验。', difficulty: d },
      { stem: `【${kp}】变式：把题中的数据改变后重新计算，结果应随之变化。`, answer: '随数据变化', analysis: '训练对「' + kp + '」的数量关系理解，而不是机械套用固定数字。', difficulty: d },
      { stem: `【${kp}】拓展：自己编一道包含「${kp}」的应用题并给出完整解答。`, answer: '自编题答案', analysis: '编题过程能检验是否真正掌握「' + kp + '」的核心关系。', difficulty: d },
    ]
  }
  if (subject === '语文') {
    return [
      { stem: `阅读一段含有「${kp}」的文本，说说它的表达效果。`, answer: '要点式作答', analysis: '按"手法 + 内容 + 情感"三个层次组织答案。', difficulty: d },
      { stem: `找出文中与「${kp}」相关的句子，并做批注。`, answer: '批注内容', analysis: '批注要落到具体的词句，不能只写"很好"这类空泛评价。', difficulty: d },
      { stem: `用「${kp}」的手法写一句话或一小段话。`, answer: '自拟', analysis: '迁移运用能加深对「' + kp + '」的理解。', difficulty: d },
    ]
  }
  if (subject === '英语') {
    return [
      { stem: `用「${kp}」的语法结构造 3 个句子。`, answer: '自造句', analysis: '造句时要检查时态、语序与主谓一致。', difficulty: d },
      { stem: `完成一段含有「${kp}」的短文填空，注意时态与词形变化。`, answer: '填空答案', analysis: '先判断时间状语提示的时态，再处理词形。', difficulty: d },
      { stem: `把课文中含有「${kp}」的句子改写为否定句或一般疑问句。`, answer: '改写结果', analysis: '句型改写要保持时态不变，注意助动词与实义动词的分工。', difficulty: d },
    ]
  }
  return [
    { stem: `【${kp}】基础题：写出相关概念与要点。`, answer: '见要点', analysis: '先准确记忆「' + kp + '」的教材结论，再做变式。', difficulty: d },
    { stem: `【${kp}】实验/材料题：结合情境分析并作答。`, answer: '见解答', analysis: '注意把教材结论与情境中的具体条件对应起来。', difficulty: d },
    { stem: `【${kp}】总结题：用自己的话复述「${kp}」的要点。`, answer: '复述内容', analysis: '复述能检验是否真正理解，而不只是记住结论。', difficulty: d },
  ]
}

/* ========================================================================== */
/* 错因推断与文案库                                                          */
/* ========================================================================== */

const ROOT_CAUSE_BANK = {
  knowledge_gap: (kp, ctx) => [
    `「${kp}」的核心概念/公式尚未真正理解，遇到题目无法把条件转成对应的解题模型。`,
    `缺少「${kp}」的基础题型训练，思路启动不起来，只能凭印象作答。`,
    `教材中的定义、公式或定理停留在"背过"层面，没有形成可以调用的解题工具。`,
  ],
  misread: (kp, ctx) => [
    `审题时漏看或误读了题目中的关键限定词（"一共""比……多""至少""恰好"等）。`,
    `没有抓住题目真正所求的对象，把"中间量"当成了"最终结果"。`,
    `缺少"读两遍题、圈条件"的习惯，凭第一遍印象就动笔。`,
  ],
  calculation: (kp, ctx) => [
    `「${kp}」的计算流程还不够熟练，中间步骤跳步导致错误。`,
    `没有先估算结果的数量级就动笔，小数点、百分号、约分等细节失守。`,
    `限时压力下没有留下验算时间，错误没有被及时发现。`,
  ],
  method: (kp, ctx) => [
    `「${kp}」的通用解题模型没有建立，遇到新情境时没有匹配的思路。`,
    `缺少"转化"意识，没有把题目条件转成学过的基础模型。`,
    `缺少一题多解的对比训练，遇到变式就容易卡壳。`,
  ],
  time: (kp, ctx) => [
    `「${kp}」的通解题型用时偏长，在整卷时间分配上被拖住。`,
    `缺少限时训练，没有形成"先易后难、遇难则跳"的答题策略。`,
    `前面的小题耗时过多，导致难题没有时间完成。`,
  ],
  careless: (kp, ctx) => [
    `抄写/誊写环节出现低级失误，符号、负号、小数点被抄错。`,
    `没有回读题目要求（单位、取值范围、"共"与"各"）就直接作答。`,
    `草稿与答题卡之间缺少一次核对，错答到下一题。`,
  ],
  expression: (kp, ctx) => [
    `解题过程缺少必要的中间步骤，阅卷时无法给过程分。`,
    `单位、名称、"答："等书写不规范，造成不必要的扣分。`,
    `结论没有和题目所求一一对应，表述含糊。`,
  ],
}

const TIP_BANK = {
  knowledge_gap: [
    '回到课本找到这一知识点的定义和例题，把例题重新做一遍并写出思路。',
    '用"概念 → 例题 → 反例"三步整理笔记，确保能用自己的话讲清楚。',
    '整理一个"我不会做"的清单，逐条补齐，比盲目刷题效率更高。',
  ],
  misread: [
    '拿到题目先圈出"所求问题"和所有限定词，再决定动笔顺序。',
    '读完后用一句话复述题目要求，复述不出来说明还没读懂。',
    '做完立刻把答案与题目所求对照一次，检查问法是否答偏。',
  ],
  calculation: [
    '关键步骤必须写出中间过程，不跳步、不心算。',
    '计算前先估一估结果的取值范围，异常就要回头检查。',
    '每天 5 分钟口算/竖式训练，重点是"稳"而不是"快"。',
  ],
  method: [
    '把同类题按"模型"归类，形成自己的题型索引。',
    '每道错题都补写"这类题我以后怎么想"的一行提示。',
    '一道题至少尝试两种解法，拓宽思路来源。',
  ],
  time: [
    '做题前先给整卷分配时间，单题超时 3 分钟就做标记先跳过。',
    '把做过 3 次以上的题型整理成"秒杀清单"考场直接调用。',
    '每天做一次 20 分钟限时小练习，训练取舍能力。',
  ],
  careless: [
    '答题前先在草稿纸上重写一遍关键数据，避免抄错。',
    '写完数字后习惯性用笔点一下小数点和负号，防止看错。',
    '最后 5 分钟专门用来核对"题目问什么—我答什么"。',
  ],
  expression: [
    '分步书写，步骤之间留出间距，阅卷老师一眼看清你的逻辑。',
    '每一问的答案单独成行，最后统一写"答：……"。',
    '把"单位""名称""答语"当成必写项，训练成肌肉记忆。',
  ],
}

/* ========================================================================== */
/* 文本工具                                                                  */
/* ========================================================================== */

function stripSpaces(s) {
  return String(s ?? '').replace(/\s+/g, '').trim()
}

function stripNonDigits(s) {
  return String(s ?? '').replace(/[^\d.]/g, '')
}

function onlyDigits(s) {
  return String(s ?? '').replace(/[^\d]/g, '')
}

function normAnswer(s) {
  return stripSpaces(s)
    .replace(/[，。、；：,.;:]/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .toLowerCase()
}

/** 从题干中提取一个"关键片段"，用于生成根因描述 */
function keywordOf(stem, kp) {
  if (kp) return kp
  const s = String(stem ?? '')
  const m = s.match(/[一-龥]{2,6}/)
  return m ? m[0] : '本题'
}

/* ========================================================================== */
/* 引擎 B：本地启发式                                                        */
/* ========================================================================== */

function inferSubject(input) {
  if (input.subject) return input.subject
  const stem = String(input.stem ?? '')
  for (const rule of KNOWLEDGE_RULES) {
    if (rule.kw.some((k) => stem.includes(k))) return rule.subject
  }
  const en = /[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(stem)
  if (en) return '英语'
  return '数学'
}

function inferQuestionType(input) {
  if (input.questionType) return input.questionType
  const stem = String(input.stem ?? '')
  const options = Array.isArray(input.options) ? input.options : []
  for (const rule of QUESTION_TYPE_RULES) {
    if (rule.kw.some((k) => stem.includes(k))) return rule.type
  }
  if (options.length >= 2) return '选择题'
  return '解答题'
}

function inferKnowledgePoints(input) {
  const subject = inferSubject(input)
  const stem = String(input.stem ?? '')
  const provided = Array.isArray(input.knowledgePoints)
    ? input.knowledgePoints.filter((k) => k && typeof k === 'string')
    : []

  const out = []
  const push = (name, confidence, level) => {
    if (!name) return
    if (out.some((k) => k.name === name)) return
    out.push({ name, confidence: Math.round(confidence * 100) / 100, level })
  }

  for (const p of provided) push(p, 0.92, '基础')

  // ---- 分数题专项识别（分数记号 / 分数关键词）----
  // 纯计算式 -> 分数四则运算；带具体数量单位的应用题 -> 分数应用题
  const hasFrac = /\d+\s*\/\s*\d+/.test(stem) || /几分之|分数/.test(stem)
  if (hasFrac) {
    const isCalc = /^(计算|直接写出|脱式计算|化简)/.test(stem.trim())
    const hasUnit = /(棵|本|元|千米|米|人|件|个|只|箱|袋|吨|千克|页|支|天|小时|分钟|米|克)/.test(stem)
    if (isCalc || !hasUnit) push('分数四则运算', 0.86, '基础')
    else push('分数应用题', 0.88, '难点')
  }

  // ---- 行程类专项识别（速度/时间/路程同时出现）----
  if (/速度|每小时|行驶|路程|千米/.test(stem) && /相遇|相向|追上|同向|同时出发/.test(stem)) {
    push('行程问题', 0.9, '难点')
  }

  // 关键词命中（同学科优先）
  const hits = []
  for (const rule of KNOWLEDGE_RULES) {
    const score = rule.kw.filter((k) => stem.includes(k)).length
    if (score > 0) hits.push({ rule, score })
  }
  hits.sort((a, b) => {
    const sa = a.rule.subject === subject ? a.score + 2 : a.score
    const sb = b.rule.subject === subject ? b.score + 2 : b.score
    return sb - sa
  })
  for (const h of hits.slice(0, 3)) {
    const conf = Math.min(0.95, 0.55 + h.score * 0.12 + (h.rule.subject === subject ? 0.12 : 0))
    push(h.rule.name, conf, h.rule.level)
  }

  if (!out.length) {
    // 兜底：按学科给一个泛化知识点
    const fallback = {
      数学: ['综合运算与应用', '基础计算'],
      语文: ['综合阅读理解', '基础字词'],
      英语: ['综合语言运用', '基础词汇'],
      物理: ['物理量与公式', '基础概念'],
      化学: ['化学反应与方程式', '基础概念'],
      生物: ['生物学基础知识', '基础概念'],
      道法: ['思想品德基础', '教材知识点'],
      政治: ['时政与法律常识', '教材知识点'],
      地理: ['地理基础', '教材知识点'],
      历史: ['历史基础知识', '教材知识点'],
    }[subject] || ['综合知识点', '基础概念']
    for (const f of fallback) push(f, 0.45, '基础')
  }
  return out
}

/**
 * 错因推断：优先利用显式传入的 errorType，再结合作答细节做细化。
 */
function inferDiagnosis(input) {
  const my = normAnswer(input.myAnswer)
  const cor = normAnswer(input.correctAnswer)
  const difficulty = Number(input.difficulty ?? 3)
  const qtype = inferQuestionType(input)
  const kps = inferKnowledgePoints(input)
  const kpName = kps[0]?.name ?? '本题知识点'
  const evidence = []

  const type = input.errorType || inferTypeFromAnswers({ my, cor, difficulty, qtype })
  const label = ERROR_TYPE_LABEL[type] ?? '知识盲点'

  // ---- 证据收集 ----
  if (!my) {
    evidence.push('你的作答为空：本题未留下任何答案痕迹')
    evidence.push(`涉及知识点「${kpName}」，需要调用对应的基本模型`)
  } else {
    evidence.push(`你的作答：${stripSpaces(input.myAnswer).slice(0, 40)}`)
    if (cor) evidence.push(`参考答案：${stripSpaces(input.correctAnswer).slice(0, 40)}`)
    const digitsMy = onlyDigits(my)
    const digitsCor = onlyDigits(cor)
    if (digitsMy && digitsCor && digitsMy !== digitsCor && digitsMy.length === digitsCor.length) {
      evidence.push('两个答案的数值位数相同但取值不同，问题出在运算/抄写环节而非解题方向')
    }
    if (my.replace(/[+\-−]/g, '') === cor.replace(/[+\-−]/g, '') && my !== cor) {
      evidence.push('答案仅在正负号上不同，属于典型的符号性失误')
    }
  }
  if (difficulty >= 4) {
    evidence.push(`本题难度为 ${difficulty}（偏难），在限时练习中容易出现"会做但没做完"`)
  }
  if (my && cor && my === cor) {
    evidence.push('最终答案与参考答案一致 —— 若这题确实被扣分，扣分点多半在过程书写（步骤、单位、"答："），也可能是录入时漏记了过程')
  }

  // ---- 理由 ----
  const reasons = {
    knowledge_gap: `本题需要调用「${kpName}」的核心方法，但你的作答${my ? '与题目要求的解题模型不匹配' : '为空'}，说明这一知识点还没有真正掌握，属于典型的知识盲点。`,
    misread: `你的答案${my ? `是「${stripSpaces(input.myAnswer).slice(0, 24)}」` : '未作答'}，与题目真正所求的量不一致，说明审题时对题干要求（所求对象、限定条件）理解出现偏差。`,
    calculation: `解题方向是对的，但最终数值与参考答案不符，说明在${kpName}的运算过程中出现了偏差（跳步、小数点或约分等细节失守）。`,
    method: `你的作答反映的解题路径与「${kpName}」的标准模型不同，说明面对这道题时思路方向就跑偏了，需要更换解法模型。`,
    time: `本题难度为 ${difficulty}，属于${kpName}中耗时较长的题型。你的作答不完整（${my ? '内容不完整' : '未作答'}），更可能是时间分配不合理，而不是不会做。`,
    careless: `答案与参考答案高度接近，问题出在细节：符号、负号、小数点或抄写环节出现了低级失误，属于可以靠检查习惯避免的失分。`,
    expression: `你的答案与参考答案一致，但看不到完整的解题过程。如果是过程分被扣，多半是中间步骤、单位或"答："没写全；也请确认一下过程是否真的漏记了。`,
  }
  const reason = reasons[type] ?? reasons.knowledge_gap

  // 置信度：
  //   用户自己指定了错因（input.errorType）→ 信任度高
  //   答案一致 → 我们**看不到过程**，只能推测是书写问题，不该给高把握
  //   答案不一致 → 证据相对充分
  let confidence = 0.58 + (my && cor ? 0.24 : 0.1) + (input.errorType ? 0.12 : 0)
  if (my && cor && my === cor) {
    // 答案对上了，却说有错 —— 证据不足，把把握压下来
    confidence = Math.min(confidence, 0.5)
    evidence.push('说明：仅凭最终答案一致无法确定真实错因，已降低把握度，建议对照原卷确认')
  }
  if (!my) confidence = Math.min(confidence, 0.86)

  return {
    type,
    confidence: Math.min(0.96, confidence),
    reason,
    evidence,
    kpName,
    label,
  }
}

function inferTypeFromAnswers({ my, cor, difficulty, qtype }) {
  // 完全空白 / 答非所问 -> 知识盲点
  if (!my) return 'knowledge_gap'
  if (cor && my === cor) return 'expression'
  if (cor) {
    const myNoSign = my.replace(/[+\-−]/g, '')
    const corNoSign = cor.replace(/[+\-−]/g, '')
    // 仅差符号 -> 粗心大意
    if (myNoSign === corNoSign && my !== cor) return 'careless'
    const dMy = onlyDigits(my)
    const dCor = onlyDigits(cor)
    if (dMy && dCor && dMy.length === dCor.length && dMy !== dCor) {
      // 仅差末位数字 / 数值接近 -> 计算失误；差异大 -> 方法不当
      const diff = Math.abs(Number(dMy) - Number(dCor))
      const base = Math.max(Number(dMy), Number(dCor), 1)
      return diff / base < 0.35 ? 'calculation' : 'method'
    }
    // 数值一致但单位/书写缺失 -> 书写不规范
    if (dMy && dCor && stripNonDigits(my) === stripNonDigits(cor)) return 'expression'
    // 英语单词/词形错误：短的是长的前缀 -> 词形变化规则没掌握
    if (/^[a-zA-Z]+$/.test(my) && /^[a-zA-Z]+$/.test(cor)) {
      const [short, long] = my.length <= cor.length ? [my, cor] : [cor, my]
      if (short.length >= 3 && long.startsWith(short.slice(0, Math.max(3, short.length - 1)))) {
        return 'knowledge_gap'
      }
      return 'misread'
    }
  }
  // 有作答痕迹但明显未完成 + 题目偏难 -> 时间不足
  if (difficulty >= 4 && (my.length < 6 || /未完成|不会|忘了|没写完/.test(my))) return 'time'
  if (difficulty >= 4) return 'time'
  if (['应用题', '解答题', '证明题', '阅读理解', '作文题', '实验题'].includes(qtype)) return 'method'
  return 'misread'
}

function buildCorrectSteps(subject, kpName, type, input) {
  const playbook = SUBJECT_PLAYBOOK[subject] || GENERIC_PLAYBOOK
  const steps = playbook.map((s) => ({ title: s.title, detail: s.detail }))
  // 首步加入具体知识点
  steps[0] = {
    title: steps[0].title,
    detail: `${steps[0].detail}（本题核心知识点：${kpName}；按「${ERROR_TYPE_LABEL[type] ?? ''}」的方向重点突破）`,
  }
  return steps
}

function buildKnowledgeGaps(kps, diagnosis) {
  const gaps = kps
    .filter((k) => k.level === '难点' || k.confidence < 0.75)
    .map((k) => k.name)
  if (!gaps.length && diagnosis.type === 'knowledge_gap') gaps.push(diagnosis.kpName)
  if (!gaps.length) gaps.push(diagnosis.kpName)
  return [...new Set(gaps)].slice(0, 4)
}

function buildPracticePlan(subject, kpName, type, diagnosis) {
  const label = ERROR_TYPE_LABEL[type] ?? '知识盲点'
  const plan = [
    { day: 1, focus: `回顾「${kpName}」`, task: `翻课本找到${kpName}的定义与例题，把例题抄写一遍并口述思路`, minutes: 20 },
    { day: 2, focus: '基础夯实', task: `完成 5 道${kpName}的基础题，每题写出关键的一步依据`, minutes: 25 },
    { day: 3, focus: '原题重做', task: `把今天这道错题重新独立做一遍，完整写出解题步骤并对照参考答案`, minutes: 15 },
    { day: 4, focus: '同类训练', task: `再做 3 道${kpName}的同类题（注意：${label}是本题主要失分点）`, minutes: 25 },
    { day: 5, focus: '错因专项', task: `整理一份"${label}"易错清单，写清 3 条以后如何避免`, minutes: 15 },
    { day: 6, focus: '变式挑战', task: `完成 2 道${kpName}的数据变式题，检验是否真的掌握模型`, minutes: 30 },
    { day: 7, focus: '复盘检测', task: `回看本周全部错题，闭卷复述${kpName}的解题模型并自测 5 题`, minutes: 25 },
  ]
  if (subject === '语文' || subject === '英语') {
    plan[1].task = `完成 5 道${kpName}的基础题，用批注的方式标出答案依据所在`
    plan[3].task = `再做 3 道${kpName}的同类题，重点检查答案组织是否分点、术语是否准确`
  }
  return plan
}

function buildSummary(diagnosis, subject, kpName, input, model) {
  const label = ERROR_TYPE_LABEL[diagnosis.type] ?? '知识盲点'
  const qtype = inferQuestionType(input)
  const modelPart = model && !model.ambiguous ? `模型是「${model.name}」，` : ''
  return `这是一道${subject}${qtype}，${modelPart}核心考点是「${kpName}」。${label}——${diagnosis.reason}`
}

/**
 * 本地启发式分析（引擎 B）。
 * @param {object} input 题目信息
 * @returns {object} 完整符合 AIAnalysis 结构
 */
export function localAnalyze(input = {}) {
  const subject = inferSubject(input)
  const questionType = inferQuestionType(input)
  const knowledgePoints = inferKnowledgePoints(input)
  const diagnosis = inferDiagnosis(input)
  const kpName = diagnosis.kpName
  const label = diagnosis.label

  /* ---- 认出这道题的「模型」，让建议能落到具体解法上 ---- */
  const stemText = String(input.stem ?? '')
  const model = detectProblemModel(stemText, subject)
  const worked = model ? buildWorkedSteps(model, stemText) : { steps: [], computed: null, formulas: [] }

  /* 知识点里把模型放前面（模型比泛化的大类更具体）。
     mergeModelIntoKnowledgePoints 内部会做别名去重：
     如果已有知识点已经覆盖了这个模型（如「面积与周长」覆盖了「几何面积与周长」），
     就不重复插入，避免出现两条说的是同一件事。 */
  const kpNames = mergeModelIntoKnowledgePoints(model, knowledgePoints)
  const modelAdded = Boolean(model && !model.ambiguous && kpNames.includes(model.name))
  const knowledgePointsOut = knowledgePoints.slice()
  if (modelAdded) {
    knowledgePointsOut.unshift({
      name: model.name,
      confidence: model.confidence,
      level: '难点',
      model: true,
      evidence: model.evidence,
    })
  }

  const rootCauses = (ROOT_CAUSE_BANK[diagnosis.type] || ROOT_CAUSE_BANK.knowledge_gap)(kpName, input)
  /* 模型专属的根因：比通用模板具体得多 */
  if (model && !model.ambiguous) {
    rootCauses.unshift(
      `这道题属于「${model.name}」（题干依据：${model.evidence.slice(0, 2).join('、') || '关键词匹配'}）。` +
        `如果没做对，多半是**没认出这是一道${model.name}的题**，而不是计算粗心 —— 这类题要靠"看到特征就直接套公式"来破。`,
    )
  }

  const tips = [...(TIP_BANK[diagnosis.type] || TIP_BANK.knowledge_gap)]
  /* 模型专属的易错提醒 */
  const modelTips = buildModelPitfalls(model)
  if (modelTips.length) tips.unshift(...modelTips)
  if (model && !model.ambiguous) {
    tips.unshift(
      `解这类题的固定套路：${model.think}`,
      worked.computed
        ? `按公式算一遍应该是：${worked.computed} —— 和你的答案对一下，差在哪一步就清楚了。`
        : `用公式「${model.formula}」套一遍，再和自己的答案对照。`,
    )
  }

  const similar = SIMILAR_BANK[kpName] || genericSimilar(subject, kpName, input.difficulty)

  return {
    byModel: false,
    model: undefined,
    subject,
    questionType,
    knowledgePoints: knowledgePointsOut,
    diagnosis: {
      type: diagnosis.type,
      confidence: Math.round(diagnosis.confidence * 100) / 100,
      reason: diagnosis.reason,
      evidence: diagnosis.evidence,
    },
    rootCauses,
    correctSteps: worked.steps.length
      ? worked.steps
      : buildCorrectSteps(subject, kpName, diagnosis.type, input),
    knowledgeGaps: buildKnowledgeGaps(knowledgePoints, diagnosis),
    tips,
    similarQuestions: similar.map((s) => ({
      stem: s.stem,
      answer: s.answer,
      analysis: s.analysis,
      difficulty: s.difficulty,
    })),
    practicePlan: buildPracticePlan(subject, kpName, diagnosis.type, diagnosis),
    summary: buildSummary(diagnosis, subject, kpName, input, model),
    createdAt: new Date().toISOString(),
  }
}

/* ========================================================================== */
/* 引擎 A：大模型（配置解析 + 调用）                                            */
/* ========================================================================== */

/**
 * 解析**当前实际生效**的模型配置。
 *
 * 优先级：
 *   1) 数据库 settings.ai.config（enableModel === true 且已保存 apiKey）
 *   2) 环境变量 AI_BASE_URL / AI_API_KEY / AI_MODEL
 *   3) 都没有 —— 走本地启发式引擎
 *
 * @returns {object} cfg
 */
export function resolveProviderConfig() {
  const stored = readStoredAiConfig()

  // 本地 OCR 是**独立**的信号源：即使关闭大模型也照常生效
  const ocrBaseUrl = String(stored?.ocrBaseUrl ?? '').trim()
  const ocrEnabled = Boolean(stored?.ocrEnabled) && Boolean(ocrBaseUrl)

  if (stored) {
    const provider = String(stored.provider || 'custom')
    const preset = getPreset(provider)
    const apiKey = String(stored.apiKey ?? '').trim()
    const baseUrl = String(stored.baseUrl ?? preset?.baseUrl ?? '').replace(/\/+$/, '')
    const model = String(stored.model ?? preset?.defaultModel ?? '')
    const visionModel = String(stored.visionModel ?? '')
    if (stored.enableModel !== false && apiKey && baseUrl && model) {
      const visionTarget = visionModel || model
      const supportsVision = resolveVisionSupport({
        provider,
        model: visionTarget,
        declared: typeof stored.supportsVision === 'boolean' ? stored.supportsVision : undefined,
      })
      return {
        enabled: true,
        source: 'db',
        provider,
        providerName: preset?.name || provider,
        apiKey,
        baseUrl,
        model,
        visionModel,
        visionModelEffective: visionTarget,
        supportsVision,
        temperature: Number(stored.temperature ?? 0.3),
        timeoutMs: Number(stored.timeoutMs ?? 25000),
        maxOutputTokens: Number(stored.maxOutputTokens ?? 4096),
        ocrBaseUrl,
        ocrEnabled,
      }
    }
  }

  const envKey = String(process.env.AI_API_KEY ?? '').trim()
  if (envKey) {
    const baseUrl = String(process.env.AI_BASE_URL || 'https://api.minimax.chat/v1').replace(/\/+$/, '')
    const model = String(process.env.AI_MODEL || 'MiniMax-M3.1-Flash')
    const provider = guessProviderByBaseUrl(baseUrl)
    const preset = getPreset(provider)
    return {
      enabled: true,
      source: 'env',
      provider,
      providerName: preset?.name || provider,
      apiKey: envKey,
      baseUrl,
      model,
      visionModel: '',
      visionModelEffective: model,
      supportsVision: resolveVisionSupport({ provider, model }),
      temperature: 0.3,
      timeoutMs: Number(process.env.AI_TIMEOUT_MS || 25000),
      maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 4096),
      ocrBaseUrl,
      ocrEnabled,
    }
  }

  return {
    enabled: false,
    source: 'none',
    provider: 'local',
    providerName: '本地启发式引擎',
    apiKey: '',
    baseUrl: '',
    model: '',
    visionModel: '',
    visionModelEffective: '',
    supportsVision: false,
    temperature: 0.3,
    timeoutMs: 25000,
    maxOutputTokens: 4096,
    ocrBaseUrl,
    ocrEnabled,
  }
}

/** 兼容旧调用点：返回当前生效的模型配置（不含密钥明文给外部，仅内部使用） */
export function modelConfig() {
  const cfg = resolveProviderConfig()
  return {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    enabled: cfg.enabled,
  }
}

export function hasModelConfig() {
  return resolveProviderConfig().enabled
}

/** 一句话描述当前生效的引擎（前端设置页展示用） */
export function describeActiveEngine(cfg = resolveProviderConfig()) {
  const ocr = cfg?.ocrEnabled ? ' + 本地 OCR 服务' : ''
  if (!cfg?.enabled) return `本地启发式引擎${ocr}（未配置可用大模型）`
  const vision = cfg.supportsVision ? '，视觉已启用' : '，不支持图片输入'
  return `${cfg.model}@${cfg.providerName}${vision}${ocr}`
}

/** 简短引擎标识（/api/health 用） */
export function describeEngineCode(cfg = resolveProviderConfig()) {
  const base = cfg?.enabled
    ? `${cfg.provider}:${cfg.model}${cfg.supportsVision ? '(vision)' : ''}`
    : 'local-heuristic'
  // 本地 OCR 是独立信号源，启用时一并体现在健康检查里
  return cfg?.ocrEnabled ? `${base}+ocr` : base
}

/** 剥离 ```json 代码块等包裹，返回可解析的 JSON 文本 */
export function stripCodeFence(text) {
  if (typeof text !== 'string') return ''
  let t = text.trim()
  const fence = t.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/)
  if (fence) t = fence[1].trim()
  // 去掉前后出现的 "json" 单词
  t = t.replace(/^json\s*/i, '').trim()
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first >= 0 && last > first) t = t.slice(first, last + 1)
  return t
}

/**
 * 调用大模型（OpenAI 兼容协议）。
 * @param {Array} messages
 * @param {object} [opts] { json, timeoutMs, temperature, model }
 */
async function callModel(messages, { json = true, timeoutMs = 25000, temperature, model } = {}) {
  const cfg = resolveProviderConfig()
  if (!cfg.enabled) throw new Error('AI_API_KEY 未配置')
  return callChat({
    cfg,
    messages,
    json,
    timeoutMs,
    temperature: temperature ?? cfg.temperature,
    model,
  })
}

const ANALYSIS_SYSTEM_PROMPT = `你是一位资深中小学教师兼错题分析专家。你的任务是分析学生的错题。
【铁律】
1. 只输出一个 JSON 对象，不要输出任何解释文字、不要使用 Markdown 代码块。
2. JSON 必须严格符合下面的结构：
{
  "subject": "语文|数学|英语|物理|化学|生物|地理|历史|政治|道法",
  "questionType": "选择题|填空题|判断题|计算题|应用题|解答题|作文题|阅读理解|完形填空|语法填空|翻译题|实验题|证明题",
  "knowledgePoints": [{"name":"知识点名称","confidence":0.0-1.0,"level":"基础|进阶|难点"}],
  "diagnosis": {"type":"knowledge_gap|misread|calculation|method|time|careless|expression","confidence":0.0-1.0,"reason":"中文错因说明","evidence":["证据1","证据2"]},
  "rootCauses": ["根因1","根因2","根因3"],
  "correctSteps": [{"title":"步骤标题","detail":"步骤详述"}],
  "knowledgeGaps": ["需要补学的知识点"],
  "tips": ["针对性建议1","建议2","建议3"],
  "similarQuestions": [{"stem":"同类题题干","answer":"答案","analysis":"解析","difficulty":1}],
  "practicePlan": [{"day":1,"focus":"当天重点","task":"具体任务","minutes":20}],
  "summary": "一句话总评"
}
3. practicePlan 必须是 7 天，每天 minutes 在 15-40 之间。
4. similarQuestions 必须是 3 道与原题同类但数据不同的新题。
5. 所有文字使用简体中文，不要输出英文段落。`

/** 把模型返回的原始 JSON 规整为严格的 AIAnalysis 结构 */
export function normalizeAnalysis(raw, base = {}) {
  const fallback = localAnalyze(base)
  if (!raw || typeof raw !== 'object') return fallback

  const arr = (v, dflt = []) => (Array.isArray(v) ? v : dflt)
  const num = (v, dflt = 0.5) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : dflt
  }
  const str = (v, dflt = '') => (typeof v === 'string' && v.trim() ? v.trim() : dflt)

  const kps = arr(raw.knowledgePoints, fallback.knowledgePoints).map((k) =>
    typeof k === 'string'
      ? { name: k, confidence: 0.7, level: '基础' }
      : {
          name: str(k?.name, '未知知识点'),
          confidence: Math.min(1, Math.max(0, num(k?.confidence, 0.7))),
          level: ['基础', '进阶', '难点'].includes(k?.level) ? k.level : '基础',
        },
  )

  const diagRaw = raw.diagnosis && typeof raw.diagnosis === 'object' ? raw.diagnosis : {}
  const diagType = ERROR_TYPE_LABEL[diagRaw.type] ? diagRaw.type : fallback.diagnosis.type

  const steps = arr(raw.correctSteps, fallback.correctSteps).map((s) => ({
    title: str(s?.title, '步骤'),
    detail: str(s?.detail, ''),
  }))

  /* 把本地算出的**具体算式**补给大模型的结果。
   *
   * 大模型给的解题步骤通常方向对，但常常是**通用话**（「列式计算」「代入公式」）；
   * 而本地规则能从题干里抽出真实数字，算出「速度和 = 60 + 40 = 100 千米/时」
   * 这种可对照的式子 —— 学生能拿它和自己的答案对一下，差在哪一步就清楚了。
   *
   * 只在「本地确实算出了具体结果」且「大模型的步骤里还没有这个数」时补一条，
   * 避免重复。没配大模型时 fallback 本身就是这套步骤，天然一致。
   */
  const concrete = fallback.correctSteps.find(
    (st) => /=\s*\d/.test(st.detail) && /÷|×/.test(st.detail),
  )
  if (concrete) {
    const marker = String(concrete.detail).match(/=\s*[\d.]+/)?.[0]?.trim() ?? ''
    const already = marker && steps.some((st) => String(st.detail ?? '').includes(marker))
    if (!already) {
      steps.push({ title: '对照验算', detail: concrete.detail })
    }
  }

  const similar = arr(raw.similarQuestions, fallback.similarQuestions).map((q) => ({
    stem: str(q?.stem, ''),
    answer: str(q?.answer, ''),
    analysis: str(q?.analysis, ''),
    difficulty: Math.min(5, Math.max(1, Math.round(num(q?.difficulty, 3)))),
  }))

  const plan = arr(raw.practicePlan, fallback.practicePlan).map((p) => ({
    day: Math.round(num(p?.day, 1)),
    focus: str(p?.focus, '复习'),
    task: str(p?.task, ''),
    minutes: Math.min(60, Math.max(10, Math.round(num(p?.minutes, 20)))),
  }))

  return {
    byModel: true,
    model: str(raw.model, resolveProviderConfig().model),
    subject: str(raw.subject, fallback.subject),
    questionType: str(raw.questionType, fallback.questionType),
    knowledgePoints: kps.length ? kps : fallback.knowledgePoints,
    diagnosis: {
      type: diagType,
      confidence: Math.min(1, Math.max(0, num(diagRaw.confidence, 0.8))),
      reason: str(diagRaw.reason, fallback.diagnosis.reason),
      evidence: arr(diagRaw.evidence, fallback.diagnosis.evidence).map((e) => str(e, '')).filter(Boolean),
    },
    rootCauses: arr(raw.rootCauses, fallback.rootCauses).map((r) => str(r, '')).filter(Boolean),
    correctSteps: steps.length ? steps : fallback.correctSteps,
    knowledgeGaps: arr(raw.knowledgeGaps, fallback.knowledgeGaps).map((g) => str(g, '')).filter(Boolean),
    tips: arr(raw.tips, fallback.tips).map((t) => str(t, '')).filter(Boolean),
    similarQuestions: similar.length ? similar : fallback.similarQuestions,
    practicePlan: plan.length ? plan : fallback.practicePlan,
    summary: str(raw.summary, fallback.summary),
    createdAt: new Date().toISOString(),
  }
}

/**
 * 分析一道错题：优先走大模型，失败自动降级到本地启发式。
 * 任何情况下都不抛出异常。
 */
export async function analyzeQuestion(input = {}) {
  const local = localAnalyze(input)
  const cfg = resolveProviderConfig()
  if (!cfg.enabled) return local

  const payload = {
    subject: local.subject,
    grade: input.grade ?? '',
    questionType: local.questionType,
    knowledgePoints: (input.knowledgePoints ?? []).join('、'),
    stem: String(input.stem ?? '').slice(0, 3000),
    options: Array.isArray(input.options) ? input.options.join(' | ').slice(0, 500) : '',
    myAnswer: String(input.myAnswer ?? '').slice(0, 300),
    correctAnswer: String(input.correctAnswer ?? '').slice(0, 300),
    errorType: input.errorType ?? '',
    errorDetail: String(input.errorDetail ?? '').slice(0, 300),
    difficulty: input.difficulty ?? 3,
  }

  const userPrompt = `请分析下面这道错题，并严格按系统提示中的 JSON 结构输出：\n${JSON.stringify(payload, null, 2)}`

  try {
    const content = await callModel(
      [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      { json: true, timeoutMs: cfg.timeoutMs },
    )
    const parsed = JSON.parse(stripCodeFence(content))
    return normalizeAnalysis(parsed, input)
  } catch (err) {
    console.warn('[ai] 大模型分析失败，已降级到本地启发式引擎:', err?.message || err)
    return local
  }
}

/* ========================================================================== */
/* 拍照分析                                                                  */
/* ========================================================================== */

/* 结构化识别提示词已迁移到 server/vision.js 的 VISION_SYSTEM_PROMPT：
   它面向「多模态视觉模型直读图片」，并要求逐字段置信度。 */

function resolveImageSource(image) {
  const src = String(image ?? '').trim()
  if (!src) return ''
  if (src.startsWith('data:')) return src
  if (src.startsWith('/api/upload/')) {
    const name = path.basename(src)
    const file = path.join(UPLOAD_DIR, name)
    try {
      if (fs.existsSync(file)) {
        const ext = path.extname(file).toLowerCase()
        const mime =
          ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
        const buf = fs.readFileSync(file)
        return `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch {
      /* ignore */
    }
    return src
  }
  // 本机地址（127.0.0.1 / localhost）模型无法直接访问，见 resolveImageForModel
  return src
}

/**
 * 把图片变成模型可用的形式：
 *  - data url / 站内上传路径 —— 直接内联成 base64
 *  - 本机 http 地址 —— 先下载再内联（远端模型访问不到 127.0.0.1）
 */
async function resolveImageForModel(image) {
  const src = resolveImageSource(image)
  if (!src || src.startsWith('data:')) return src
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(src)) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        const ct = res.headers.get('content-type') || 'image/jpeg'
        return `data:${ct};base64,${buf.toString('base64')}`
      }
    } catch {
      /* ignore：交给调用方按「无图片」处理 */
    }
  }
  return src
}

/** 从 data url 中取出裸 base64（不带 data:...;base64, 前缀） */
function extractBase64Payload(src) {
  const s = String(src ?? '')
  if (!s.startsWith('data:')) return ''
  const idx = s.indexOf(',')
  return idx > 0 ? s.slice(idx + 1).trim() : ''
}

/** 错误信息截断（避免日志/响应过长） */
function shortError(err) {
  const msg = String(err?.message ?? err ?? '未知错误').replace(/\s+/g, ' ').trim()
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg
}

/**
 * 拍照分析（视觉识别链路）。
 *
 * 处理流程：
 *   1) 解码图片（data url / /api/upload/xxx / http 地址）
 *   2) 本地 OCR 服务（可选）—— 作为**并行信号源**取原文与 token 置信度
 *   3) 视觉模型直读图片（OpenAI 兼容多模态 image_url）—— 取结构化草稿
 *   4) 字段校验与修正（枚举收敛、选项字母归一、答案合法性）
 *   5) 置信度融合（ocrToken / modelSelf / structure / crossCheck）
 *   6) 本地启发式兜底 —— 任何一步失败都不 500
 *
 * 返回 PhotoAnalysisResponse，永不抛异常。
 */
export async function analyzePhoto(input = {}) {
  const hint = String(input.hint ?? '')
  const cfg = resolveProviderConfig()
  const warnings = []

  const localBase = {
    subject: input.subject,
    grade: input.grade ?? '',
    stem: hint,
    difficulty: 3,
    errorType: undefined,
  }
  const localAnalysis = localAnalyze(localBase)

  // 提示词兜底时也用启发式判学科（用户没选才生效）
  const hintSubjectInfer = input.subject
    ? { subject: '', confidence: 0 }
    : inferSubjectFromText(hint)
  const hintSubject = hintSubjectInfer.confidence >= 0.5 ? hintSubjectInfer.subject : ''

  const localDraft = {
    subject: hintSubject || localAnalysis.subject,
    questionType: localAnalysis.questionType,
    knowledgePoints: localAnalysis.knowledgePoints.map((k) => k.name),
    stem: hint || '（本地引擎未能识别图片文字，请补充题干文本）',
    options: [],
    myAnswer: '',
    correctAnswer: '',
    difficulty: 3,
    confidence: 0.32,
    ocrText: hint || '',
    ...(hintSubject
      ? {
          subjectConfidence: hintSubjectInfer.confidence,
          subjectEvidence: hintSubjectInfer.evidence,
        }
      : {}),
  }

  /* ---------------- 1. 解码图片 ---------------- */
  const imageSrc = await resolveImageForModel(input.image)
  const imageBase64 = extractBase64Payload(imageSrc)

  /* ---------------- 2. 本地 OCR（并行信号源） ---------------- */
  let ocr = null
  if (cfg.ocrEnabled && cfg.ocrBaseUrl) {
    if (imageBase64) {
      try {
        ocr = await runLocalOcr({
          baseUrl: cfg.ocrBaseUrl,
          imageBase64,
          timeoutMs: Math.min(cfg.timeoutMs ?? 25000, 15000),
        })
      } catch (err) {
        warnings.push(`本地 OCR 服务调用失败：${shortError(err)}`)
      }
    } else {
      warnings.push('没有可用于本地 OCR 的图片数据，已跳过 OCR')
    }
  }

  /* ---------------- 3. 视觉模型识别 ---------------- */
  let recognized = null
  let usedVisionModel = false
  let usedTextModel = false

  if (cfg.enabled && cfg.supportsVision) {
    if (!imageSrc) {
      warnings.push('没有可用的图片，已跳过视觉模型识别')
    } else {
      try {
        recognized = await recognizeWithVision({
          cfg,
          imageSrc,
          hint,
          grade: input.grade,
          subject: input.subject,
          ocrText: ocr?.text,
        })
        usedVisionModel = true
      } catch (err) {
        warnings.push(`视觉模型识别失败：${shortError(err)}`)
      }
    }
  } else if (cfg.enabled && !cfg.supportsVision) {
    warnings.push(`当前模型 ${cfg.model} 不支持图片输入，无法直接读图`)
    // 退化路径：本地 OCR 文本 + 纯文本大模型做结构化
    if (ocr?.text) {
      try {
        recognized = await recognizeFromOcrText({
          cfg,
          ocrText: ocr.text,
          hint,
          grade: input.grade,
          subject: input.subject,
        })
        usedTextModel = true
        warnings.push('已改走「本地 OCR 文本 + 大模型结构化」路径')
      } catch (err) {
        warnings.push(`大模型结构化失败：${shortError(err)}`)
      }
    }
  } else if (!cfg.enabled) {
    // 降级文案在「链路说明」阶段按实际层级统一给出，这里不重复提示
  }

  /* ---------------- 4. 字段校验与修正 ---------------- */
  let draft = null
  let fieldConfidence = null
  let optionLetters = []
  let recognizedEvidence = false
  let crossCheckEnabled = false
  let modelConfidence = null   // **只有真的调了模型**才有模型自报置信度

  if (recognized) {
    const norm = normalizeDraft(recognized.raw, {
      fallbackSubject: localAnalysis.subject,
      fallbackQuestionType: localAnalysis.questionType,
      fallbackKnowledgePoints: localAnalysis.knowledgePoints.map((k) => k.name),
      hint,
      ocrText: ocr?.text ?? '',
      ocrLines: ocr?.lines ?? [],
    })
    draft = norm.draft
    fieldConfidence = norm.fieldConfidence
    modelConfidence = norm.fieldConfidence
    optionLetters = norm.optionLetters ?? []
    warnings.push(...norm.warnings)
    recognizedEvidence = true
    crossCheckEnabled = true
    if (recognized.repaired) warnings.push('模型返回的 JSON 被截断，已尽力修复')
    if (norm.notes) warnings.push(`模型备注：${String(norm.notes).slice(0, 120)}`)
  } else if (ocr?.text) {
    // 只有本地 OCR 可用：直接用 OCR 文本构造草稿
    // 契约：fallbackSubject 有值 == 用户**手动选过**学科 -> 优先于启发式判定
    const ocrDraft = draftFromOcrLines(ocr.lines ?? [], {
      fallbackSubject: input.subject,
      localSubject: localAnalysis.subject,
      fallbackQuestionType: localAnalysis.questionType,
      fallbackKnowledgePoints: localAnalysis.knowledgePoints.map((k) => k.name),
    })
    draft = ocrDraft.draft
    optionLetters = ocrDraft.optionLetters ?? []
    warnings.push(...ocrDraft.warnings)
    recognizedEvidence = true
    crossCheckEnabled = false
    // 没有视觉模型时，用 OCR 的逐行 rec_scores 派生**逐字段置信度**（前端高亮用）
    fieldConfidence = fieldConfidenceFromOcr(ocrDraft.groups, { stem: draft.stem })
    // 注意：此时**没有模型**，modelSelf 信号不参与融合
  }

  const finalDraft = draft ?? localDraft

  /* ---------------- 5. 置信度融合 ---------------- */
  // OCR 行分组（题干/选项/作答）—— 字段级分位数 ocrToken 与 layout 都依赖它
  const ocrGroups = ocr?.lines?.length ? classifyOcrLines(ocr.lines).groups : null
  const { confidence, signals, layoutPenalty } = fuseConfidence({
    draft: finalDraft,
    modelConfidence,
    ocr,
    ocrGroups,
    recognized: recognizedEvidence,
    optionLetters,
    crossCheck: crossCheckEnabled,
  })

  /* ---------------- 6. 分析结论 ---------------- */
  let analysis
  if (recognized?.raw?.analysis) {
    analysis = normalizeAnalysis(recognized.raw.analysis, {
      ...localBase,
      stem: finalDraft.stem,
      options: finalDraft.options,
      myAnswer: finalDraft.myAnswer,
      correctAnswer: finalDraft.correctAnswer,
      knowledgePoints: finalDraft.knowledgePoints,
      subject: finalDraft.subject,
      questionType: finalDraft.questionType,
      difficulty: finalDraft.difficulty,
    })
  } else {
    analysis = localAnalyze({
      ...localBase,
      stem: finalDraft.stem,
      options: finalDraft.options,
      myAnswer: finalDraft.myAnswer,
      correctAnswer: finalDraft.correctAnswer,
      knowledgePoints: finalDraft.knowledgePoints,
      subject: finalDraft.subject,
      questionType: finalDraft.questionType,
      difficulty: finalDraft.difficulty,
    })
  }

  /* ---------------- 7. 链路说明 + 分层 warning ---------------- */
  let ocrEngine = 'hint-fallback'
  let ocrEngineLabel = '提示词推导（本地启发式引擎）'
  if (usedVisionModel) {
    ocrEngine = 'vision-model'
    ocrEngineLabel = '视觉模型直读图片'
  } else if (usedTextModel || (ocr && !usedVisionModel)) {
    ocrEngine = 'local-ocr'
    ocrEngineLabel = usedTextModel ? '本地 OCR 文本 + 大模型结构化' : '本地 OCR 服务识别'
  }

  /* --- 字段级提示 --- */
  if (finalDraft.options.length === 0 && finalDraft.questionType === '选择题') {
    warnings.push('未识别到选项')
  }
  if (ocrEngine === 'vision-model' && fieldConfidence) {
    // 视觉模型在位：只在**字段置信度偏低**时提示，不做"降级"措辞
    const FIELD_LABEL = {
      stem: '题干',
      options: '选项',
      myAnswer: '我的答案',
      correctAnswer: '正确答案',
      knowledgePoints: '知识点',
    }
    for (const [key, value] of Object.entries(fieldConfidence)) {
      if (Number(value) < 0.5) {
        warnings.push(`模型自报「${FIELD_LABEL[key] ?? key}」置信度偏低（${value}），建议人工校对`)
      }
    }
  }

  /* --- 降级说明：严格按实际链路层级给文案 --- */
  if (ocrEngine === 'hint-fallback') {
    warnings.push('未配置视觉模型且未启用本地 OCR，已按提示词推导，请人工校对')
    warnings.push('本次没有任何图像识别证据，置信度仅反映结构自洽度')
  } else if (ocrEngine === 'local-ocr') {
    if (usedTextModel) {
      warnings.push('未使用视觉模型：已用本地 OCR 文本 + 大模型完成结构化')
    } else {
      warnings.push('未使用视觉模型：文字与选项由本地 OCR 识别，学科/题型/知识点由本地启发式推导')
    }
  }

  /* --- 启发式判定（零 AI）：OCR-only 路径直接给结论；模型路径作为交叉校验 --- */
  const heuristicText = String(finalDraft.ocrText || finalDraft.stem || '')
  let subjectConfidence = finalDraft.subjectConfidence
  let subjectEvidence = finalDraft.subjectEvidence
  let questionTypeConfidence = finalDraft.questionTypeConfidence
  if (subjectConfidence === undefined && heuristicText) {
    const hSubject = inferSubjectFromText(heuristicText)
    const hType = inferQuestionTypeFromText(
      heuristicText,
      ocrGroups ? { options: ocrGroups.options } : {},
    )
    const agree = Boolean(hSubject.subject) && hSubject.subject === finalDraft.subject
    subjectConfidence = agree ? hSubject.confidence : Math.min(0.5, hSubject.confidence || 0)
    subjectEvidence = hSubject.evidence
    questionTypeConfidence = hType.questionType === finalDraft.questionType
      ? hType.confidence
      : Math.min(0.5, hType.confidence)
    if (!agree && hSubject.subject) {
      warnings.push(
        `模型判定学科「${finalDraft.subject}」与文字特征（可能是${hSubject.subject}）不完全一致，请确认`,
      )
    }
  }

  const response = {
    draft: {
      subject: finalDraft.subject,
      questionType: finalDraft.questionType,
      knowledgePoints: finalDraft.knowledgePoints,
      stem: finalDraft.stem,
      options: finalDraft.options,
      myAnswer: finalDraft.myAnswer,
      correctAnswer: finalDraft.correctAnswer,
      difficulty: finalDraft.difficulty,
      confidence,
      ocrText: finalDraft.ocrText,
      fieldConfidence: fieldConfidence ?? undefined,
      /* 新增：启发式判定的把握与依据（前端可显示「为什么是这个学科」） */
      ...(subjectConfidence !== undefined ? { subjectConfidence } : {}),
      ...(subjectEvidence !== undefined ? { subjectEvidence } : {}),
      ...(questionTypeConfidence !== undefined ? { questionTypeConfidence } : {}),
    },
    analysis,
    pipeline: {
      ocrEngine,
      ocrEngineLabel,
      ...(cfg.enabled ? { model: `${cfg.provider}:${usedVisionModel ? cfg.visionModelEffective : cfg.model}` } : {}),
      signals,
      warnings,
      ...(layoutPenalty !== 1 ? { layoutPenalty } : {}),
    },
  }
  return response
}

/* ========================================================================== */
/* 学情报告                                                                  */
/* ========================================================================== */

const REPORT_SYSTEM_PROMPT = `你是一位资深班主任兼学习诊断专家。请根据给定的错题统计数据生成一份学情报告。
【铁律】
1. 只输出一个 JSON 对象，不要输出任何解释文字、不要 Markdown 代码块。
2. JSON 结构：
{
  "summary": "300 字以内的中文总评",
  "strengths": [{"title":"优势标题","detail":"展开说明","evidence":"数据证据"}],
  "weaknesses": [{"title":"薄弱项标题","detail":"展开说明","evidence":"数据证据","subject":"学科"}],
  "riskSubjects": [{"subject":"学科","reason":"风险原因","score":0-100}],
  "suggestions": [{"title":"建议标题","detail":"具体做法","priority":"高|中|低"}],
  "weeklyPlan": [{"day":1,"focus":"重点","task":"任务","minutes":20}],
  "parentNotes": ["给家长的沟通要点"]
}
3. weeklyPlan 必须是 7 天；riskSubjects 的 score 为风险分（0-100，越高越危险）。`

/** 本地启发式报告 */
export function localReport({ student, stats, questions = [] }) {
  const name = student?.name ?? '该学生'
  const grade = student?.grade ?? ''
  const bySubject = stats?.bySubject ?? []
  const weakPoints = stats?.weakPoints ?? []
  const byErrorType = stats?.byErrorType ?? []
  const totals = stats?.totals ?? {}

  const sortedByMastery = [...bySubject].sort((a, b) => b.mastery - a.mastery)
  const strengths = sortedByMastery.slice(0, 3).map((s) => ({
    title: `${s.label}掌握较好`,
    detail: `${s.label}共记录 ${s.total} 道错题，平均掌握度 ${s.mastery} 分，已订正 ${s.corrected} 道，属于当前相对稳定的学科。`,
    evidence: `${s.label} 掌握度 ${s.mastery}/100，订正率 ${s.total ? Math.round((s.corrected / s.total) * 100) : 0}%`,
  }))
  if (!strengths.length) {
    strengths.push({
      title: '错题记录习惯初步建立',
      detail: '错题数量还不多，说明刚开始使用。建议保持每日记录，形成稳定的数据积累。',
      evidence: `累计记录 ${totals.questions ?? 0} 道错题`,
    })
  }

  const weaknesses = weakPoints.slice(0, 4).map((w) => ({
    title: `「${w.name}」需要重点突破`,
    detail: `该知识点共出错 ${w.total} 次，平均掌握度仅 ${w.mastery} 分，属于${w.severity}风险知识点，建议安排专项训练。`,
    evidence: `${w.subject} · ${w.name} · 错误 ${w.total} 次 · 掌握度 ${w.mastery}`,
    subject: w.subject,
  }))
  if (!weaknesses.length) {
    weaknesses.push({
      title: '暂无显著薄弱点',
      detail: '当前数据量较少，继续积累错题记录后再做更精细的诊断。',
      evidence: `累计 ${totals.questions ?? 0} 道错题`,
    })
  }

  const riskSubjects = [...bySubject]
    .sort((a, b) => a.mastery - b.mastery || b.total - a.total)
    .slice(0, 3)
    .map((s) => {
      const risk = Math.max(5, Math.min(100, Math.round(100 - s.mastery + Math.min(20, s.total))))
      const topError = byErrorType.find((e) => e.count > 0)
      return {
        subject: s.label,
        reason: `共 ${s.total} 道错题，平均掌握度 ${s.mastery} 分，未订正 ${Math.max(0, s.total - s.corrected)} 道${topError ? `；整体错因以「${topError.label}」为主` : ''}。`,
        score: risk,
      }
    })

  const suggestions = []
  if (weakPoints[0]) {
    suggestions.push({
      title: `优先突破「${weakPoints[0].name}」`,
      detail: `该知识点掌握度仅 ${weakPoints[0].mastery} 分，建议本周安排 3 次、每次 20 分钟的专项练习，先补概念再做题。`,
      priority: '高',
    })
  }
  const topError = [...byErrorType].sort((a, b) => b.count - a.count)[0]
  if (topError) {
    suggestions.push({
      title: `针对「${topError.label}」做习惯改造`,
      detail: `「${topError.label}」占全部错因的 ${topError.ratio}%，是最集中的失分原因。建议针对这一类错误做一次专项复盘，并写出检查清单。`,
      priority: '高',
    })
  }
  suggestions.push({
    title: '坚持错题三步订正',
    detail: '每道题按"重做 → 标注错因 → 写出同类题"三步处理，避免只抄答案不思考。',
    priority: '中',
  })
  suggestions.push({
    title: '建立每日 15 分钟复盘',
    detail: '固定时间回看当天错题，配合艾宾浩斯间隔（1 天 / 3 天 / 7 天）安排复习。',
    priority: '中',
  })
  if (suggestions.length < 4) {
    suggestions.push({ title: '保持记录习惯', detail: '继续每天拍照或手动录入错题，数据越完整诊断越准确。', priority: '低' })
  }

  const weeklyPlan = [
    { day: 1, focus: '错题清零', task: '重做本周积压的 3 道待复盘错题并标注错因', minutes: 25 },
    { day: 2, focus: '概念补齐', task: `复习${weakPoints[0]?.name ?? '核心知识点'}的定义与例题`, minutes: 20 },
    { day: 3, focus: '基础训练', task: '完成 5 道基础题，全对才算过关', minutes: 25 },
    { day: 4, focus: '变式训练', task: '完成 2 道同类变式题并写出与原题的差异', minutes: 25 },
    { day: 5, focus: '过程规范', task: '挑选 2 道题重写完整过程，练习规范书写', minutes: 15 },
    { day: 6, focus: '限时训练', task: '20 分钟完成一组限时题，模拟考场节奏', minutes: 20 },
    { day: 7, focus: '周测复盘', task: '回顾本周所有错题，闭卷讲出解题模型', minutes: 20 },
  ]

  const parentNotes = [
    `本周共记录 ${totals.questions ?? 0} 道错题，已完成订正 ${totals.corrected ?? 0} 道，整体掌握度 ${totals.mastery ?? 0} 分。`,
    `最需要关注的是${weakPoints[0] ? `「${weakPoints[0].name}」（${weakPoints[0].subject}）` : '各学科的基础计算与审题习惯'}，目前掌握度偏低。`,
    '陪伴时请多问"当时你是怎么想的"，少直接给答案，帮助孩子复述解题思路。',
    '每完成一次订正请及时在系统里标记订正状态，数据准确才能反映真实进步。',
  ]

  const summary = `${name}${grade ? `（${grade}）` : ''}近期共记录 ${totals.questions ?? 0} 道错题，覆盖 ${bySubject.length} 个学科，整体掌握度 ${totals.mastery ?? 0} 分，已订正 ${totals.corrected ?? 0} 道（订正率 ${totals.questions ? Math.round((totals.corrected / totals.questions) * 100) : 0}%），活跃学习 ${totals.activeDays ?? 0} 天。${
    topError ? `从错因结构看，「${topError.label}」占比最高（${topError.ratio}%），是当前最主要的失分原因。` : ''
  }${
    weakPoints[0] ? `其中「${weakPoints[0].name}」是突破口，建议优先安排专项训练，并坚持每次订正后写清错因，同类错误重复出现的概率会明显下降。` : ''
  }总体来看，${totals.mastery >= 70 ? '掌握情况良好，保持当前节奏即可。' : '仍有较大提升空间，关键在于把错题从"记下来"变成"讲出来"。'}`

  return {
    studentId: student?.id,
    studentName: name,
    byModel: false,
    model: undefined,
    summary,
    strengths,
    weaknesses,
    riskSubjects,
    suggestions,
    weeklyPlan,
    parentNotes,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 生成学情报告：优先大模型，失败降级到本地启发式。
 */
export async function buildInsightReport({ student, stats, questions = [] }) {
  const local = localReport({ student, stats, questions })
  const cfg = resolveProviderConfig()
  if (!cfg.enabled) return local

  const brief = {
    student: { name: student?.name, grade: student?.grade, school: student?.school },
    totals: stats?.totals,
    bySubject: stats?.bySubject,
    byErrorType: stats?.byErrorType,
    weakPoints: stats?.weakPoints,
    samples: (questions || []).slice(0, 20).map((q) => ({
      subject: q.subject,
      knowledgePoints: q.knowledgePoints,
      questionType: q.questionType,
      errorType: q.errorType,
      difficulty: q.difficulty,
      mastery: q.mastery,
      stem: String(q.stem ?? '').slice(0, 120),
    })),
  }

  try {
    const content = await callModel(
      [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: `请根据以下学情数据生成报告：\n${JSON.stringify(brief, null, 2)}` },
      ],
      { json: true, timeoutMs: cfg.timeoutMs },
    )
    const parsed = JSON.parse(stripCodeFence(content))
    if (!parsed || typeof parsed !== 'object') return local

    const arr = (v, d = []) => (Array.isArray(v) ? v : d)
    const str = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d)

    return {
      studentId: student?.id,
      studentName: student?.name ?? name,
      byModel: true,
      model: cfg.model,
      summary: str(parsed.summary, local.summary),
      strengths: arr(parsed.strengths, local.strengths).map((s) => ({
        title: str(s?.title, '优势'),
        detail: str(s?.detail, ''),
        evidence: str(s?.evidence, ''),
      })),
      weaknesses: arr(parsed.weaknesses, local.weaknesses).map((s) => ({
        title: str(s?.title, '薄弱项'),
        detail: str(s?.detail, ''),
        evidence: str(s?.evidence, ''),
        ...(s?.subject ? { subject: str(s.subject) } : {}),
      })),
      riskSubjects: arr(parsed.riskSubjects, local.riskSubjects).map((s) => ({
        subject: str(s?.subject, ''),
        reason: str(s?.reason, ''),
        score: Math.min(100, Math.max(0, Math.round(Number(s?.score) || 0))),
      })),
      suggestions: arr(parsed.suggestions, local.suggestions).map((s) => ({
        title: str(s?.title, '建议'),
        detail: str(s?.detail, ''),
        priority: ['高', '中', '低'].includes(s?.priority) ? s.priority : '中',
      })),
      weeklyPlan: arr(parsed.weeklyPlan, local.weeklyPlan).map((p, i) => ({
        day: Math.round(Number(p?.day) || i + 1),
        focus: str(p?.focus, '复习'),
        task: str(p?.task, ''),
        minutes: Math.min(60, Math.max(10, Math.round(Number(p?.minutes) || 20))),
      })),
      parentNotes: arr(parsed.parentNotes, local.parentNotes).map((n) => str(n, '')).filter(Boolean),
      createdAt: new Date().toISOString(),
    }
  } catch (err) {
    console.warn('[ai] 报告生成失败，已降级到本地启发式引擎:', err?.message || err)
    return local
  }
}

/* ========================================================================== */
/* 对话式追问（POST /api/ai/chat）                                            */
/* ========================================================================== */

const CHAT_INTENTS = [
  { intent: '错因分析', kw: ['粗心', '马虎', '细心', '为什么错', '错因', '失误', '总是错', '老错', '计算错', '看错'] },
  { intent: '复习计划', kw: ['复习', '计划', '这周', '下周', '安排', '每天', '什么时候', '接下来', '先做什么', '时间'] },
  { intent: '学习方法', kw: ['方法', '技巧', '怎么学', '效率', '习惯', '怎么背', '记不住', '速记', '效率低'] },
  { intent: '知识诊断', kw: ['突破', '薄弱', '哪里弱', '掌握', '哪科', '诊断', '弱点', '提分', '差在哪', '难点', '学得差'] },
]

const CHAT_SYSTEM_PROMPT = `你是一名学习顾问，正在根据学生的真实错题数据回答家长或学生的问题。
【铁律】
1. 只输出一个 JSON 对象，不要输出任何解释文字、不要 Markdown 代码块。
2. JSON 结构：
{
  "answer": "中文回答，300-500字，分段说明，可使用换行",
  "intent": "知识诊断|复习计划|错因分析|学习方法|其他",
  "references": [{"label":"数据引用标题","detail":"具体数字说明"}],
  "followUps": ["推荐追问1","推荐追问2","推荐追问3"],
  "dataUsed": {"questions": 0, "mastered": 0, "weakSubjects": ["学科名"]}
}
3. 只能使用上下文中真实出现的数据，严禁编造数字；上下文里没有的结论要说明"数据不足"。
4. references 至少 2 条，每条都要带真实数字。
5. followUps 恰好 3 条。`

/** 识别意图 */
export function detectIntent(message) {
  const s = String(message ?? '')
  let best = { intent: '其他', score: 0 }
  for (const r of CHAT_INTENTS) {
    const score = r.kw.filter((k) => s.includes(k)).length
    if (score > best.score) best = { intent: r.intent, score }
  }
  return best.intent
}

/** 各错因的典型特征描述（用于回答时给出针对性解释） */
const ERROR_CHARACTER = {
  knowledge_gap:
    '知识盲点的特征是：看到题目根本没有思路，缺少把条件转成解题模型的能力。这类问题光靠刷题解决不了，必须回到课本补概念、补例题。',
  careless:
    '粗心大意的特征是：思路完全正确，只是在符号、数字、单位或抄写等细节上丢分。这类失误最可惜——用一张两分钟的检查清单就能避免大半。',
  calculation:
    '计算失误的特征是：方法选对了，但运算过程出错，常见于跳步、小数点、约分与通分环节。解决办法是把中间步骤写出来，并养成估算结果范围的习惯。',
  misread:
    '审题不清的特征是：把题目真正所求的对象理解错了，答非所问，题目做了但没得分。解决办法是读完后用一句话复述"题目要我求什么"。',
  method:
    '方法不当的特征是：解题路径从一开始就跑偏了，不是算错而是"没想到这一步"。需要建立题型模型，做到看到条件就想到对应解法。',
  time:
    '时间不足的特征是：会做但没做完，题目在规定时间内没写完。解决办法是限时训练加上"先易后难、遇难则跳"的答题策略。',
  expression:
    '书写不规范的特征是：结论正确，但步骤、单位或"答："缺失，过程分被扣。解决办法是把书写规范当成必做项，训练成肌肉记忆。',
}

/** 用户提问中明确提到的错因类型 */
const ERROR_TYPE_KEYWORDS = {
  careless: ['粗心', '马虎', '细心', '抄错', '看错', '粗心大意', '不认真'],
  calculation: ['计算', '算错', '运算', '算数'],
  misread: ['审题', '题意', '读错', '理解偏差', '审不清'],
  knowledge_gap: ['知识', '不会', '没学会', '概念', '公式', '知识点'],
  method: ['思路', '方法', '没思路', '方向', '解法'],
  time: ['时间', '来不及', '太慢', '做不完'],
  expression: ['步骤', '书写', '过程', '格式', '不完整'],
}

/** 从用户问题里识别具体错因类型 */
export function detectErrorTypeInMessage(message) {
  const s = String(message ?? '')
  let best = null
  let bestScore = 0
  for (const [type, kws] of Object.entries(ERROR_TYPE_KEYWORDS)) {
    const score = kws.filter((k) => s.includes(k)).length
    if (score > bestScore) {
      best = type
      bestScore = score
    }
  }
  return best
}

/** 按学科统计错因分布（真实数据） */
function errorDistribution(questions, subject) {
  const map = new Map()
  for (const q of questions ?? []) {
    if (subject && q.subject !== subject) continue
    map.set(q.errorType, (map.get(q.errorType) ?? 0) + 1)
  }
  const total = [...map.values()].reduce((a, b) => a + b, 0)
  return [...map.entries()]
    .map(([type, count]) => ({
      type,
      label: ERROR_TYPE_LABEL[type] ?? type,
      count,
      ratio: total ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
}

/** 统计摘要 -> 供回答使用的真实数据 */
function chatContext(stats, questions) {
  const totals = stats?.totals ?? {}
  const bySubject = stats?.bySubject ?? []
  const byErrorType = stats?.byErrorType ?? []
  const weakPoints = stats?.weakPoints ?? []
  const sortedSubjects = [...bySubject].sort((a, b) => a.mastery - b.mastery)
  const weakSubjects = sortedSubjects.filter((s) => s.mastery < 70).slice(0, 3).map((s) => s.label)
  const topError = [...byErrorType].sort((a, b) => b.count - a.count)[0]

  // 每个学科各自的错因分布
  const errorDistBySubject = {}
  for (const s of bySubject) {
    errorDistBySubject[s.label] = errorDistribution(questions, s.label)
  }

  // 全部知识点的真实统计（按出错次数倒序）
  const kpMap = new Map()
  for (const q of questions ?? []) {
    for (const name of q.knowledgePoints ?? []) {
      if (!name) continue
      if (!kpMap.has(name)) kpMap.set(name, [])
      kpMap.get(name).push(q)
    }
  }
  const knowledgeStats = [...kpMap.entries()]
    .map(([name, list]) => ({
      name,
      subject: list[0]?.subject ?? '',
      total: list.length,
      corrected: list.filter((q) => q.corrected).length,
      mastery: Math.round(list.reduce((a, q) => a + q.mastery, 0) / list.length),
    }))
    .sort((a, b) => b.total - a.total)

  return {
    totals,
    bySubject,
    byErrorType,
    weakPoints,
    topError,
    errorDistBySubject,
    knowledgeStats,
    weakSubjects: weakSubjects.length ? weakSubjects : sortedSubjects.slice(0, 1).map((s) => s.label),
    recent: (questions ?? []).slice(-15).map((q) => ({
      subject: q.subject,
      knowledgePoints: q.knowledgePoints,
      errorType: q.errorType,
      errorTypeLabel: ERROR_TYPE_LABEL[q.errorType] ?? q.errorType,
      questionType: q.questionType,
      difficulty: q.difficulty,
      mastery: q.mastery,
      status: q.status,
    })),
  }
}

/** 本地启发式对话：完全基于真实统计数据 */
export function localChat({ message, history = [], student, stats, questions = [] }) {
  const intent = detectIntent(message)
  const ctx = chatContext(stats, questions)
  const totals = ctx.totals
  const name = student?.name ?? '该学生'
  const grade = student?.grade ?? ''
  const total = totals.questions ?? 0
  const mastery = totals.mastery ?? 0
  const corrected = totals.corrected ?? 0
  const mastered = totals.mastered ?? 0
  const topError = ctx.topError
  const weakest = ctx.weakPoints[0]
  const weakestSubject = [...ctx.bySubject].sort((a, b) => a.mastery - b.mastery)[0]

  const references = []
  let answer = ''

  // ---------- 无数据兜底：没有错题记录也要正常回答，不能报错 ----------
  if (total === 0) {
    const emptyReferences = [
      {
        label: '数据提示',
        detail: `${name}${grade ? `（${grade}）` : ''}目前还没有错题记录，统计口径为 0 题。`,
      },
    ]
    const emptyFollowUps = [
      '怎样快速录入第一道错题？',
      '错题应该怎么分类和标注错因？',
      '拍照录入时怎样保证题干识别准确？',
    ]
    return {
      answer: [
        `${name}${grade ? `（${grade}）` : ''}目前还没有错题记录，因此我暂时无法基于真实数据做诊断。`,
        '建议先录入 5～10 道近期错题：拍照上传或手动录入都可以，每题尽量标好学科、知识点、题型和错因。',
        '数据积累之后，我可以基于真实统计回答"哪科最弱""错因分布""本周该复习什么"这类问题，并给出带数据引用的建议。',
      ].join('\n\n'),
      intent,
      references: emptyReferences,
      followUps: emptyFollowUps,
      dataUsed: { questions: 0, mastered: 0, weakSubjects: [] },
      byModel: false,
      model: undefined,
      createdAt: new Date().toISOString(),
    }
  }

  if (intent === '错因分析') {
    const focusSubject = ctx.bySubject.find((s) => message.includes(s.label))
    // 只统计关注学科内的错因分布（真实数据）
    const errList = focusSubject ? ctx.errorDistBySubject[focusSubject.label] ?? ctx.byErrorType : ctx.byErrorType
    // 用户明确提到的错因类型优先
    const askedType = detectErrorTypeInMessage(message)
    const err = (askedType && errList.find((e) => e.type === askedType)) || errList[0]
    const focusWeak = focusSubject
      ? ctx.weakPoints.find((w) => w.subject === focusSubject.label) ?? weakest
      : weakest

    if (err) {
      references.push({
        label: focusSubject ? `${focusSubject.label}·错因分布` : '错因分布',
        detail: `「${err.label}」${err.count} 次，占${focusSubject ? '该学科' : '全部'}错因的 ${err.ratio}%`,
      })
    }
    for (const e of errList.slice(0, 3)) {
      references.push({
        label: `错因·${e.label}`,
        detail: `${e.count} 次，占比 ${e.ratio}%`,
      })
    }
    if (focusSubject) {
      references.push({
        label: `${focusSubject.label}学科`,
        detail: `共 ${focusSubject.total} 道错题，已订正 ${focusSubject.corrected} 道，平均掌握度 ${focusSubject.mastery} 分`,
      })
    }
    if (focusWeak) {
      references.push({
        label: `${focusWeak.subject}·${focusWeak.name}`,
        detail: `错误 ${focusWeak.total} 次，掌握度 ${focusWeak.mastery} 分（${focusWeak.severity}风险）`,
      })
    }

    answer = [
      focusSubject
        ? `从 ${name}（${grade || '当前年级'}）的 ${focusSubject.total} 道${focusSubject.label}错题看，` +
          (err
            ? `「${err.label}」出现了 ${err.count} 次，占该学科错因的 ${err.ratio}%`
            : '错因分布比较分散，没有单一主导的错误类型') +
          '。'
        : `从 ${name}${grade ? `（${grade}）` : ''}近期记录的 ${total} 道错题看，` +
          (err ? `最主要的失分原因是「${err.label}」，共出现 ${err.count} 次，占全部错因的 ${err.ratio}%。` : '错因分布比较分散。'),
      err ? ERROR_CHARACTER[err.type] ?? '' : '',
      focusWeak
        ? `从知识点维度看，「${focusWeak.subject}·${focusWeak.name}」重复出错 ${focusWeak.total} 次、掌握度只有 ${focusWeak.mastery} 分${
            focusSubject && focusWeak.subject !== focusSubject.label
              ? `（注意：这是${focusSubject.label}之外的知识点，若想集中突破${focusSubject.label}，建议先挑该学科掌握度最低的知识点）`
              : '，是这类错误的高发区'
          }。`
        : '',
      focusSubject
        ? `针对${focusSubject.label}，建议：①每次做完题用 30 秒回读"题目问什么—我答什么"；②凡是带单位的答案，写完圈出单位；③把 ${focusSubject.total - focusSubject.corrected} 道未订正的错题重做一遍并标注错因。`
        : '建议：①每道错题标注具体错因（不要只写"粗心"）；②每周固定一次错题回看；③做完题保留 2 分钟做检查，重点看符号、单位和步骤。',
    ]
      .filter(Boolean)
      .join('\n\n')
  } else if (intent === '复习计划') {
    references.push({
      label: '待复习量',
      detail: `共 ${total} 道错题，已订正 ${corrected} 道，待复盘 ${totals.pending ?? total - mastered} 道`,
    })
    if (weakest) {
      references.push({
        label: `优先知识点`,
        detail: `${weakest.subject}·${weakest.name}，错误 ${weakest.total} 次，掌握度 ${weakest.mastery} 分`,
      })
    }
    if (topError) {
      references.push({
        label: '主要错因',
        detail: `${topError.label} ${topError.count} 次，占 ${topError.ratio}%`,
      })
    }
    references.push({
      label: '学习活跃度',
      detail: `近 ${totals.activeDays ?? 0} 天有错题记录，整体掌握度 ${mastery} 分`,
    })

    answer = [
      `按 ${name} 当前的数据（${total} 道错题、待复盘 ${totals.pending ?? 0} 道、整体掌握度 ${mastery} 分），建议这样安排接下来 7 天：`,
      `Day 1-2｜清库存：把 ${totals.pending ?? 0} 道未订正错题重做一遍，按"重做 → 标注错因 → 写一句同类题"三步处理，每天 3 道，约 25 分钟。`,
      weakest
        ? `Day 3-4｜补弱点：集中攻克「${weakest.subject}·${weakest.name}」（错误 ${weakest.total} 次，掌握度 ${weakest.mastery} 分）。先回课本补概念，再做 5 道基础题。`
        : `Day 3-4｜补弱点：选择掌握度最低的学科做一次专题复习，先概念后练习。`,
      `Day 5｜专项纠错：针对占比最高的「${topError?.label ?? '主要错因'}」做一次专项训练，配一张检查清单。`,
      `Day 6｜限时训练：20 分钟做一组限时题，模拟考场节奏。`,
      `Day 7｜复盘检测：闭卷讲出本次最弱知识点的解题模型，并自测 5 题。`,
      `如果每天只有 20 分钟，就只做 Day 1 的"清库存"，坚持一周比一次做两小时更有效。`,
    ].join('\n\n')
  } else if (intent === '学习方法') {
    references.push({
      label: '错题结构',
      detail: `共 ${total} 道错题，分布于 ${ctx.bySubject.length} 个学科，整体掌握度 ${mastery} 分`,
    })
    if (topError) {
      references.push({
        label: '主要错因',
        detail: `${topError.label} ${topError.count} 次，占 ${topError.ratio}%`,
      })
    }
    references.push({
      label: '订正情况',
      detail: `已订正 ${corrected} 道，已掌握 ${mastered} 道`,
    })

    answer = [
      `结合 ${name} 的错题数据（${total} 道、掌握度 ${mastery} 分、已订正 ${corrected} 道），给你几条更贴合实际情况的方法：`,
      `1｜按错因分类整理，而不是按时间整理。${topError ? `目前「${topError.label}」占 ${topError.ratio}%，这一类单独建一个清单，每天只练 2 道，2 周就能明显下降。` : '先给每道错题标上错因，分类之后再练习。'}`,
      `2｜错题本只写"错在哪"和"下次怎么做"，不抄整题。一道题写 3 行以内，抄题既费时间又没效果。`,
      `3｜用间隔复习代替集中复习。掌握度低的题当天、3 天后、7 天后各看一次，比一次性刷 20 道有效。`,
      `4｜做"出题"而不是只"做题"。把一道错题改编数据再做一遍，能检验是否真的掌握模型。`,
      `5｜错题之外要有正向输入：${weakest ? `「${weakest.subject}·${weakest.name}」相关` : '薄弱学科'}每天 10 分钟的课本阅读或例题复述，保证知识是活的。`,
    ].join('\n\n')
  } else if (intent === '知识诊断') {
    const focus = ctx.bySubject.find((s) => message.includes(s.label))
    // 问题中直接提到的知识点（用真实统计回答）
    const askedKp = ctx.knowledgeStats.find((k) => message.includes(k.name))
    const kpDist = askedKp ? ctx.errorDistBySubject[askedKp.subject] ?? ctx.byErrorType : []
    const kpTopError = kpDist[0]

    references.push({
      label: '整体学情',
      detail: `共 ${total} 道错题，覆盖 ${ctx.bySubject.length} 个学科，掌握度 ${mastery} 分，订正 ${corrected} 道`,
    })
    if (askedKp) {
      references.push({
        label: `${askedKp.subject}·${askedKp.name}`,
        detail: `错误 ${askedKp.total} 次，已订正 ${askedKp.corrected} 道，掌握度 ${askedKp.mastery} 分`,
      })
    }
    for (const s of [...ctx.bySubject].sort((a, b) => a.mastery - b.mastery).slice(0, 3)) {
      references.push({
        label: `${s.label}学科`,
        detail: `${s.total} 道错题，已订正 ${s.corrected} 道，掌握度 ${s.mastery} 分`,
      })
    }
    if (weakest) {
      references.push({
        label: `${weakest.subject}·${weakest.name}`,
        detail: `错误 ${weakest.total} 次，掌握度 ${weakest.mastery} 分（${weakest.severity}风险）`,
      })
    }

    answer = [
      askedKp
        ? `你问到的「${askedKp.subject}·${askedKp.name}」：共出错 ${askedKp.total} 次，已订正 ${askedKp.corrected} 道（订正率 ${askedKp.total ? Math.round((askedKp.corrected / askedKp.total) * 100) : 0}%），平均掌握度 ${askedKp.mastery} 分。` +
          (askedKp.mastery < 60
            ? '掌握度偏低，说明这个知识点还没形成稳定的解题模型，属于需要优先补的类型。'
            : askedKp.mastery >= 80
              ? '掌握度不错，方向已经对了，重点是保持订正节奏，避免同类错误反复出现。'
              : '掌握度中等，方向已经对了，重点是把正确率稳定下来，减少同类失误。')
        : `${name}${grade ? `（${grade}）` : ''}的错题诊断如下（数据口径：${total} 道错题，整体掌握度 ${mastery} 分）：`,
      focus
        ? `你问到的${focus.label}：共 ${focus.total} 道错题，已订正 ${focus.corrected} 道（订正率 ${focus.total ? Math.round((focus.corrected / focus.total) * 100) : 0}%），平均掌握度 ${focus.mastery} 分。${focus.mastery < 60 ? '这个水平说明基础还不牢，先补概念再提速。' : '这个水平说明大方向没问题，重点在稳定性和细节。'}`
        : askedKp
          ? ''
          : `按学科看：${[...ctx.bySubject]
              .sort((a, b) => a.mastery - b.mastery)
              .map((s) => `${s.label}（${s.mastery} 分 / ${s.total} 题）`)
              .join('、')}。`,
      askedKp && kpTopError
        ? `从错因看，「${askedKp.subject}」里占比最高的是「${kpTopError.label}」（${kpTopError.count} 次，占 ${kpTopError.ratio}%），这说明突破这个知识点时要先解决${kpTopError.label}带来的失分。`
        : '',
      askedKp
        ? `突破办法：①回到课本把「${askedKp.name}」的定义、公式和 2 道例题抄写一遍并口述思路；②做 5 道基础题，每题写出关键的一步依据；③做 2 道变式题，改数据后再做一遍，检验是否真的掌握模型而不是记住了答案。`
        : weakest
          ? `最该先突破的知识点是「${weakest.subject}·${weakest.name}」：错了 ${weakest.total} 次，掌握度 ${weakest.mastery} 分，属于${weakest.severity}风险。这一个点解决好，比同时补五门课有效。`
          : `当前数据量还不足以定位到具体知识点，建议再积累一些错题记录。`,
      `另外，${ctx.weakPoints
        .slice(1, 4)
        .map((w) => `${w.subject}·${w.name}（${w.mastery} 分）`)
        .join('、') || '暂无其它集中薄弱点'}也需要安排复盘。`,
      `具体突破口建议：每天 20 分钟只攻一个知识点，配 5 道基础题 + 2 道变式题，一周之后重新统计掌握度对比。`,
    ]
      .filter(Boolean)
      .join('\n\n')
  } else {
    references.push({
      label: '整体学情',
      detail: `共 ${total} 道错题，掌握度 ${mastery} 分，已订正 ${corrected} 道，已掌握 ${mastered} 道`,
    })
    if (weakestSubject) {
      references.push({
        label: `掌握最弱的学科`,
        detail: `${weakestSubject.label}，${weakestSubject.total} 道错题，掌握度 ${weakestSubject.mastery} 分`,
      })
    }
    if (topError) {
      references.push({
        label: '主要错因',
        detail: `${topError.label} ${topError.count} 次，占 ${topError.ratio}%`,
      })
    }

    answer = [
      `我基于 ${name}${grade ? `（${grade}）` : ''}的错题数据回答：目前共 ${total} 道错题，整体掌握度 ${mastery} 分，已订正 ${corrected} 道，已掌握 ${mastered} 道。`,
      weakestSubject
        ? `其中${weakestSubject.label}是当前最需要关注的学科（掌握度 ${weakestSubject.mastery} 分，共 ${weakestSubject.total} 题）。`
        : '',
      weakest
        ? `优先级最高的知识点是「${weakest.subject}·${weakest.name}」（${weakest.total} 次出错，掌握度 ${weakest.mastery} 分）。`
        : '',
      '你可以继续问我具体某一个知识点、某一门学科，或者让我给出本周的复习安排。',
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const followUps = buildFollowUps(intent, ctx, name)

  // 兜底：保证 references 至少有一条真实数据引用
  if (!references.length) {
    references.push({
      label: '整体学情',
      detail: `共 ${total} 道错题，掌握度 ${mastery} 分，已订正 ${corrected} 道，已掌握 ${mastered} 道`,
    })
  }

  return {
    answer,
    intent,
    references: references.slice(0, 6),
    followUps,
    dataUsed: {
      questions: total,
      mastered,
      weakSubjects: ctx.weakSubjects,
    },
    byModel: false,
    model: undefined,
    createdAt: new Date().toISOString(),
  }
}

function buildFollowUps(intent, ctx, name) {
  const weakest = ctx.weakPoints[0]
  const subject = ctx.bySubject.length ? [...ctx.bySubject].sort((a, b) => a.mastery - b.mastery)[0].label : ''
  const bank = {
    错因分析: [
      weakest ? `「${weakest.subject}·${weakest.name}」我一共错了 ${weakest.total} 次，具体该怎么做？` : '我的错因主要是哪一类？',
      '除了粗心，还有哪些容易忽略的失分细节？',
      '怎么帮孩子建立做题后的检查习惯？',
    ],
    复习计划: [
      '如果每天只有 20 分钟，七天该怎么安排？',
      weakest ? `「${weakest.subject}·${weakest.name}」应该先补课本还是先刷题？` : '薄弱知识点应该怎么补？',
      '艾宾浩斯间隔复习具体怎么用？',
    ],
    学习方法: [
      '错题本应该记什么、不记什么？',
      '怎么用最少时间记住一个公式或模型？',
      '订正完的题还需要反复看吗？',
    ],
    知识诊断: [
      subject ? `${subject}这一科我该从哪里开始补？` : '我应该先补哪一科？',
      weakest ? `「${weakest.name}」怎么突破？` : '哪个知识点最该优先突破？',
      '按目前的数据，我大概处于什么水平？',
    ],
    其他: [
      '我的错题主要反映哪些问题？',
      '这周该复习什么？',
      '有什么适合我的学习方法？',
    ],
  }
  return (bank[intent] ?? bank['其他']).slice(0, 3)
}

/**
 * 对话式追问：优先大模型，失败降级到本地启发式。
 */
export async function buildChatAnswer({ message, history = [], student, stats, questions = [] }) {
  const local = localChat({ message, history, student, stats, questions })
  const cfg = resolveProviderConfig()
  if (!cfg.enabled) return local

  const ctx = chatContext(stats, questions)
  const context = {
    student: { name: student?.name, grade: student?.grade, school: student?.school },
    totals: stats?.totals,
    bySubject: stats?.bySubject,
    byErrorType: stats?.byErrorType,
    weakPoints: stats?.weakPoints,
    recentQuestions: ctx.recent,
  }

  const historySlice = (history ?? []).slice(-8).map((h) => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: String(h.content ?? '').slice(0, 500),
  }))

  try {
    const content = await callModel(
      [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...historySlice,
        {
          role: 'user',
          content: `【学生数据】\n${JSON.stringify(context, null, 2)}\n\n【学生的问题】\n${String(message).slice(0, 500)}\n\n请严格按 JSON 结构输出。`,
        },
      ],
      { json: true, timeoutMs: cfg.timeoutMs },
    )
    const parsed = JSON.parse(stripCodeFence(content))
    if (!parsed || typeof parsed !== 'object') return local

    const str = (v, d = '') => (typeof v === 'string' && v.trim() ? v.trim() : d)
    const arr = (v, d = []) => (Array.isArray(v) ? v : d)
    const intents = ['知识诊断', '复习计划', '错因分析', '学习方法', '其他']

    return {
      answer: str(parsed.answer, local.answer),
      intent: intents.includes(parsed.intent) ? parsed.intent : local.intent,
      references: arr(parsed.references, local.references)
        .map((r) => ({ label: str(r?.label, '数据'), detail: str(r?.detail, '') }))
        .filter((r) => r.detail),
      followUps: arr(parsed.followUps, local.followUps)
        .map((f) => str(f, ''))
        .filter(Boolean)
        .slice(0, 3),
      dataUsed: {
        questions: Number(parsed?.dataUsed?.questions ?? local.dataUsed.questions),
        mastered: Number(parsed?.dataUsed?.mastered ?? local.dataUsed.mastered),
        weakSubjects: arr(parsed?.dataUsed?.weakSubjects, local.dataUsed.weakSubjects).map((s) => str(s, '')).filter(Boolean),
      },
      byModel: true,
      model: cfg.model,
      createdAt: new Date().toISOString(),
    }
  } catch (err) {
    console.warn('[ai] 对话分析失败，已降级到本地启发式引擎:', err?.message || err)
    return local
  }
}

/* ========================================================================== */
/* 模型连接测试（POST /api/settings/ai/test）                                   */
/* ========================================================================== */

/**
 * 试连：向目标模型发一次极小请求（system: 只回复 OK），超时 15s。
 * 若该模型支持视觉，额外再发一次带 1×1 纯红 PNG 的请求，验证图片输入确实可用。
 *
 * @param {object} input  可带**未保存的部分配置**（用于保存前试连）
 * @returns {Promise<object>} AIConnectionTestResult
 */
export async function testAiConnection(input = {}) {
  const saved = readStoredAiConfig()
  const pick = (key, fallback) => {
    const v = input?.[key]
    return v === undefined ? fallback : v
  }

  const provider = String(pick('provider', saved?.provider ?? 'custom') || 'custom')
  const preset = getPreset(provider)
  const baseUrl = String(pick('baseUrl', saved?.baseUrl ?? preset?.baseUrl ?? '') || '')
    .replace(/\/+$/, '')
  const model = String(pick('model', saved?.model ?? preset?.defaultModel ?? '') || '')
  const visionModel = String(pick('visionModel', saved?.visionModel ?? '') || '')

  // 密钥：传入掩码/空串时回落到已保存的密钥
  let apiKey = ''
  if (input?.apiKey !== undefined) {
    const incoming = String(input.apiKey ?? '').trim()
    apiKey = incoming && !incoming.includes('****') ? incoming : String(saved?.apiKey ?? '')
  } else {
    apiKey = String(saved?.apiKey ?? '')
  }

  const declared = pick('supportsVision', saved?.supportsVision)
  const vision = resolveVisionSupport({
    provider,
    model: visionModel || model,
    declared: typeof declared === 'boolean' ? declared : undefined,
  })

  // 大模型是否处于"启用"状态（与运行时 resolveProviderConfig 一致）
  const enableModel = pick('enableModel', saved?.enableModel ?? true) !== false

  const timeoutMs = Math.min(Number(pick('timeoutMs', saved?.timeoutMs ?? 15000)) || 15000, 15000)
  // 连通性测试的输出预算：优先用「最大输出长度」设置，至少 1024。
  // 推理模型会先思考，预算太小 content 会是空串 —— 这正是用户报的「模型返回内容为空」。
  const maxOutputTokens = Math.max(
    1024,
    Number(pick('maxOutputTokens', saved?.maxOutputTokens ?? 4096)) || 4096,
  )
  const cfg = {
    enabled: Boolean(apiKey),
    apiKey,
    baseUrl,
    model,
    visionModel,
    visionModelEffective: visionModel || model,
    supportsVision: vision,
    temperature: Number(pick('temperature', saved?.temperature ?? 0)) || 0,
    timeoutMs,
    maxOutputTokens,
  }

  // 本地 OCR 是独立信号源：即使没配大模型，也要单独做一次可达性测试
  const ocrBaseUrl = String(pick('ocrBaseUrl', saved?.ocrBaseUrl ?? '') || '').trim()
  const ocrEnabled = Boolean(pick('ocrEnabled', saved?.ocrEnabled)) && Boolean(ocrBaseUrl)

  const result = {
    ok: false,
    provider,
    model,
    message: '连接失败',
    latencyMs: 0,
    vision,
  }

  /* ---- 分支 1：没有可用的大模型（未启用 / 没配密钥） ---- */
  if (!enableModel || !apiKey) {
    if (!enableModel) result.vision = false
    if (ocrEnabled) {
      const started = Date.now()
      const probe = await probeOcrService({ baseUrl: ocrBaseUrl, timeoutMs: 8000 })
      result.latencyMs = Date.now() - started
      result.ok = probe.reachable
      result.message = probe.reachable ? '本地 OCR 服务可达（未配置大模型）' : '连接失败'
      result.detail = probe.reachable
        ? `${enableModel ? '未配置 API Key' : '大模型已禁用（enableModel=false）'}，已跳过模型连通性测试；本地 OCR 服务探测通过（${probe.detail}）`
        : `${enableModel ? '未配置 API Key' : '大模型已禁用（enableModel=false）'}；本地 OCR 服务不可达：${probe.detail}`
      return result
    }
    if (!enableModel) {
      result.detail = '大模型已禁用（enableModel=false），且未配置本地 OCR 服务，无可测试的连接'
      return result
    }
    result.detail = '未配置 API Key，请先在设置页填写密钥'
    return result
  }

  if (!baseUrl) {
    result.detail = '未配置接口地址（baseUrl）'
    return result
  }
  if (!model) {
    result.detail = '未配置模型名（model）'
    return result
  }

  const started = Date.now()
  // 连通性测试的输出预算。
  //
  // ⚠️ 这里原来写的是 16 token —— **推理模型会把这 16 个 token 全花在思考上**，
  // 最终答案一个字都没输出，content 是空串，于是报「模型返回内容为空」。
  // MiniMax-M3.1-Flash 默认思考深度就是 max（官方文档：thinking 默认 max，
  // 且 M3 系列不支持关闭），所以这个 16 必然踩雷。
  //
  // 之前用户报「配置大模型提示连接失败 / 模型返回内容为空」就是这个原因 ——
  // 他们的 Base URL、API Key、模型名都是对的，是我们的测试把预算给小了。
  const TEST_BUDGET = maxOutputTokens
  try {
    const content = await callChat({
      cfg,
      messages: [
        { role: 'system', content: '只回复 OK' },
        { role: 'user', content: 'OK' },
      ],
      json: false,
      timeoutMs,
      temperature: 0,
      maxTokens: TEST_BUDGET,
    })
    result.ok = true
    result.message = '连接成功，模型已响应'
    result.latencyMs = Date.now() - started

    if (vision) {
      try {
        const answer = await callChat({
          cfg,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '这张图片是什么颜色？只回答颜色' },
                { type: 'image_url', image_url: { url: RED_PIXEL_DATA_URL } },
              ],
            },
          ],
          json: false,
          timeoutMs,
          temperature: 0,
          maxTokens: TEST_BUDGET,
        })
        result.detail = `视觉校验：模型回答「${String(answer).trim().slice(0, 60)}」`
      } catch (err) {
        result.detail = `视觉校验失败：${shortError(sanitizeMessage(err?.message, apiKey))}`
      }
    }

    // 顺带报告本地 OCR 服务的可达性
    if (ocrEnabled) {
      const probe = await probeOcrService({ baseUrl: ocrBaseUrl, timeoutMs: 8000 })
      result.detail = `${result.detail ? `${result.detail}；` : ''}本地 OCR 服务${probe.reachable ? '可达' : `不可达（${probe.detail}）`}`
      if (!probe.reachable) result.ok = false
    }
    return result
  } catch (err) {
    result.ok = false
    result.latencyMs = Date.now() - started
    result.detail = sanitizeMessage(shortError(err), apiKey)
    // message 不要一律写「连接失败」—— 用户拿到这句话根本不知道该改什么。
    // 按错误类型给一句人话，用户能直接照着排查。
    const raw = String(err?.message ?? '')
    const status = Number(err?.status ?? 0)
    if (err?.providerCode) {
      result.message = `连接失败：${PROVIDER_ERROR_HINT[err.providerCode] ?? '服务端返回错误'}`
    } else if (/认证|401|unauthorized|invalid.*key/i.test(raw) || status === 401 || status === 403) {
      result.message = '连接失败：API Key 无效或没有权限'
      result.detail = `${result.detail}。请检查密钥是否完整（首尾空格会导致 401）、是否已过期、是否开通了对应模型权限`
    } else if (/余额|insufficient.*balance|quota/i.test(raw)) {
      result.message = '连接失败：账户余额不足'
    } else if (/限流|rate.?limit|429/i.test(raw) || status === 429) {
      result.message = '连接失败：触发了服务商限流'
      result.detail = `${result.detail}。请稍后重试，或降低并发`
    } else if (/超时|timeout|abort/i.test(raw)) {
      result.message = '连接失败：请求超时'
      result.detail = `${result.detail}。请检查网络（校园网/公司网可能拦截境外域名），或在设置里调大超时时间`
    } else if (/模型返回内容为空|输出预算/.test(raw)) {
      result.message = '连接失败：模型有响应，但内容为空'
      result.detail = `${String(result.detail).replace(/[。.\s]+$/, '')}。如果这个模型是「推理模型」（会先思考），请把「最大输出长度」调大；也可以换一个不思考的模型试试`
    } else if (/地址|baseurl|ENOTFOUND|fetch failed|ECONNREFUSED/i.test(raw)) {
      result.message = '连接失败：连不上模型服务'
      result.detail = `${result.detail}。请检查 Base URL 是否写全（多数兼容服务要带 /v1）、网络能不能访问这个域名`
    } else if (/模型不存在|not found|404/i.test(raw) || status === 404) {
      result.message = '连接失败：接口地址或模型名不对'
      result.detail = `${result.detail}。请核对 Base URL（要带 /v1）和模型名（大小写敏感，用控制台里的原始名称）`
    } else {
      result.message = '连接失败'
    }
    return result
  }
}

/* ========================================================================== */
/* 自检                                                                      */
/* ========================================================================== */

function validateAnalysis(a, label) {
  const problems = []
  const req = (cond, msg) => {
    if (!cond) problems.push(msg)
  }
  req(typeof a === 'object' && a !== null, `${label}: 不是对象`)
  req(typeof a.byModel === 'boolean', `${label}: byModel 必须是 boolean`)
  req(Array.isArray(a.knowledgePoints) && a.knowledgePoints.length > 0, `${label}: knowledgePoints 必须是非空数组`)
  req(a.diagnosis && typeof a.diagnosis === 'object', `${label}: 缺少 diagnosis`)
  req(a.diagnosis && ERROR_TYPE_LABEL[a.diagnosis.type] !== undefined, `${label}: diagnosis.type 非法`)
  req(typeof a.diagnosis?.confidence === 'number', `${label}: diagnosis.confidence 必须是数字`)
  req(typeof a.diagnosis?.reason === 'string' && a.diagnosis.reason.length > 0, `${label}: diagnosis.reason 不能为空`)
  req(Array.isArray(a.rootCauses) && a.rootCauses.length > 0, `${label}: rootCauses 必须非空`)
  req(Array.isArray(a.correctSteps) && a.correctSteps.length > 0, `${label}: correctSteps 必须非空`)
  req(Array.isArray(a.knowledgeGaps) && a.knowledgeGaps.length > 0, `${label}: knowledgeGaps 必须非空`)
  req(Array.isArray(a.tips) && a.tips.length > 0, `${label}: tips 必须非空`)
  req(Array.isArray(a.similarQuestions) && a.similarQuestions.length >= 3, `${label}: similarQuestions 至少 3 道`)
  req(Array.isArray(a.practicePlan) && a.practicePlan.length === 7, `${label}: practicePlan 必须是 7 天`)
  req(typeof a.summary === 'string' && a.summary.length > 0, `${label}: summary 不能为空`)
  req(typeof a.createdAt === 'string', `${label}: createdAt 必须是字符串`)
  for (const kp of a.knowledgePoints || []) {
    req(typeof kp.name === 'string' && kp.name.length > 0, `${label}: knowledgePoint.name 不能为空`)
    req(typeof kp.confidence === 'number', `${label}: knowledgePoint.confidence 必须是数字`)
  }
  for (const q of a.similarQuestions || []) {
    req(typeof q.stem === 'string' && q.stem.length > 0, `${label}: similarQuestion.stem 不能为空`)
    req(typeof q.answer === 'string', `${label}: similarQuestion.answer 必须是字符串`)
    req(typeof q.analysis === 'string', `${label}: similarQuestion.analysis 必须是字符串`)
    req(Number.isInteger(q.difficulty) && q.difficulty >= 1 && q.difficulty <= 5, `${label}: similarQuestion.difficulty 必须在 1-5`)
  }
  for (const p of a.practicePlan || []) {
    req(Number.isInteger(p.day), `${label}: practicePlan.day 必须是整数`)
    req(typeof p.focus === 'string' && p.focus.length > 0, `${label}: practicePlan.focus 不能为空`)
    req(typeof p.task === 'string' && p.task.length > 0, `${label}: practicePlan.task 不能为空`)
    req(typeof p.minutes === 'number' && p.minutes > 0, `${label}: practicePlan.minutes 必须是正数`)
  }
  return problems
}

async function selfTest() {
  const samples = [
    {
      label: '数学·分数应用题',
      input: {
        subject: '数学',
        grade: '四年级',
        questionType: '应用题',
        stem: '果园里有苹果树 120 棵，其中红富士占总数的 1/3，红富士有多少棵？',
        myAnswer: '40',
        correctAnswer: '40棵',
        difficulty: 3,
      },
    },
    {
      label: '英语·状语从句',
      input: {
        subject: '英语',
        grade: '初二',
        questionType: '语法填空',
        stem: 'He was late for school because he ____ the bus.',
        myAnswer: 'miss',
        correctAnswer: 'missed',
        difficulty: 3,
      },
    },
    {
      label: '语文·阅读理解（未作答）',
      input: {
        subject: '语文',
        grade: '四年级',
        questionType: '阅读理解',
        stem: '阅读下面的短文，回答问题：这篇短文表达了作者怎样的思想感情？',
        myAnswer: '',
        correctAnswer: '对故乡的怀念与赞美',
        difficulty: 4,
      },
    },
  ]

  let failures = 0
  for (const s of samples) {
    const a = localAnalyze(s.input)
    const problems = validateAnalysis(a, s.label)
    if (problems.length) {
      failures++
      console.error(`✗ ${s.label}`)
      problems.forEach((p) => console.error(`   - ${p}`))
    } else {
      console.log(`✓ ${s.label}  → 知识点: ${a.knowledgePoints.map((k) => k.name).join('/')}  错因: ${a.diagnosis.type}`)
    }
  }

  // 归一化函数自检（模拟模型返回）
  const norm = normalizeAnalysis({ knowledgePoints: ['分数'], diagnosis: { type: 'calculation' } }, samples[0].input)
  const normProblems = validateAnalysis(norm, 'normalizeAnalysis')
  if (normProblems.length) {
    failures++
    normProblems.forEach((p) => console.error(`   - ${p}`))
  } else {
    console.log('✓ normalizeAnalysis 容错规整通过')
  }

  // 异步主入口（无 API Key 时走本地引擎）
  const async1 = await analyzeQuestion(samples[0].input)
  if (validateAnalysis(async1, 'analyzeQuestion').length) failures++
  else console.log(`✓ analyzeQuestion 正常返回（byModel=${async1.byModel}）`)

  const photo = await analyzePhoto({ image: '', hint: '数学 分数应用题 求几分之几是多少' })
  if (!photo?.draft || !photo?.analysis) {
    failures++
    console.error('   - analyzePhoto 返回结构不完整')
  } else {
    console.log(`✓ analyzePhoto 正常返回（学科=${photo.draft.subject}，置信度=${photo.draft.confidence}）`)
  }

  const report = localReport({
    student: { id: 's1', name: '张小明', grade: '四年级' },
    stats: {
      totals: { questions: 12, corrected: 5, mastery: 46, activeDays: 6 },
      bySubject: [{ key: '数学', label: '数学', total: 8, corrected: 3, mastery: 42, errorRate: 62 }],
      byErrorType: [{ type: 'knowledge_gap', label: '知识盲点', count: 6, ratio: 50 }],
      weakPoints: [{ name: '分数应用题', subject: '数学', total: 4, mastery: 30, severity: '高' }],
    },
    questions: [],
  })
  if (!report.summary || !Array.isArray(report.weeklyPlan) || report.weeklyPlan.length !== 7) {
    failures++
    console.error('   - localReport 结构不完整')
  } else {
    console.log('✓ localReport 结构完整')
  }

  // 对话式追问自检
  const chatStats = {
    totals: { questions: 12, corrected: 5, mastery: 46, activeDays: 6, pending: 9, mastered: 3 },
    bySubject: [
      { key: '数学', label: '数学', total: 8, corrected: 3, mastery: 42, errorRate: 62 },
      { key: '语文', label: '语文', total: 4, corrected: 2, mastery: 55, errorRate: 50 },
    ],
    byErrorType: [{ type: 'knowledge_gap', label: '知识盲点', count: 6, ratio: 50 }],
    weakPoints: [{ name: '分数应用题', subject: '数学', total: 4, mastery: 30, severity: '高' }],
  }
  const chat = await buildChatAnswer({
    message: '为什么我数学总是粗心？',
    history: [{ role: 'user', content: '你好' }],
    student: { id: 's1', name: '张小明', grade: '四年级' },
    stats: chatStats,
    questions: [],
  })
  const chatProblems = []
  if (typeof chat.answer !== 'string' || !chat.answer) chatProblems.push('answer 不能为空')
  if (!['知识诊断', '复习计划', '错因分析', '学习方法', '其他'].includes(chat.intent))
    chatProblems.push('intent 非法')
  if (!Array.isArray(chat.references) || chat.references.length < 1) chatProblems.push('references 至少 1 条')
  if (!Array.isArray(chat.followUps) || chat.followUps.length !== 3) chatProblems.push('followUps 必须是 3 条')
  if (chat.dataUsed?.questions !== chatStats.totals.questions) chatProblems.push('dataUsed.questions 与统计不一致')
  if (chat.dataUsed?.mastered !== chatStats.totals.mastered) chatProblems.push('dataUsed.mastered 与统计不一致')
  if (chatProblems.length) {
    failures++
    chatProblems.forEach((p) => console.error(`   - chat: ${p}`))
  } else {
    console.log(`✓ buildChatAnswer 正常返回（intent=${chat.intent}，引用 ${chat.references.length} 条）`)
  }

  console.log('\n===== 本地启发式引擎示例输出（分数应用题） =====')
  console.log(JSON.stringify(localAnalyze(samples[0].input), null, 2))

  if (failures) {
    console.error(`\n❌ AI 引擎自检失败：${failures} 项`)
    process.exitCode = 1
  } else {
    console.log('\n✅ AI 引擎自检全部通过')
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isDirectRun) {
  selfTest().catch((e) => {
    console.error('自检异常:', e)
    process.exitCode = 1
  })
}
