
import { GoogleGenAI } from "@google/genai";
import { Chapter, FormatRules, TechnicalTerm, Reference, ChatMessage, InterviewData, ApiSettings, ThesisStructure, SkeletonResponse } from "../types";

// --- OpenAI Compatible Interface ---

const cleanJsonText = (text: string) => {
  if (!text) return "";
  return text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
};

const cleanMarkdownArtifacts = (text: string) => {
  if (!text) return "";
  return text
    // Remove bold markers **text** -> text
    .replace(/\*\*(.*?)\*\*/g, '$1') 
    // Remove italic markers *text* -> text
    .replace(/(^|[^\*])\*([^\*]+)\*(?!\*)/g, '$1$2')     
    // Remove list bullets at start of line (* Item -> Item)
    .replace(/^\s*[\*\-]\s+/gm, '')
    // Remove markdown headers
    .replace(/^#+\s+/gm, '')         
    // Remove backticks
    .replace(/`/g, '')
    // Remove underscores
    .replace(/__+/g, '');              
};

// --- CONSTANTS: Human-like Writing Style Guide (Refined for Strict Academic Tone) ---
const HUMAN_WRITING_STYLE = `
你是一名严谨的顶尖大学博士生，正在撰写学位论文。你的目标是产出**极度专业、客观、逻辑致密**的学术文本，彻底消除AI生成的“翻译腔”和“口语化”痕迹。

【严禁使用的词汇（Negative Constraints）】
❌ **绝对禁止**使用以下口语化连接词或废话（出现即违规）：
   - "不难发现"、"由此可见"、"值得注意的是"、"众所周知"、"显而易见"、"毫无疑问"
   - "综上所述"、"总而言之"、"也就是说"、"换句话说"
❌ **绝对禁止**使用空洞的强调词：
   - "非常重要"、"极具意义"、"关键作用"（必须直接描述具体的技术作用或量化指标）。
❌ **绝对禁止**使用小学生式的列表连接词：
   - "首先...其次...最后..."（除非是描述严谨的算法步骤序列，否则请用逻辑递进或空间结构代替）。

【强制执行的写作规范】
1. **零连接词逻辑（Implicit Cohesion）**：
   - 高水平的学术写作依靠句与句之间的逻辑内在联系（因果、转折、递进）来衔接，而不是靠“因此”、“但是”这些显性词。
   - *Bad*: "首先使用了A方法，然后因为A方法效果不好，所以使用了B方法。"
   - *Good*: "鉴于A方法在处理稀疏数据时收敛困难，本文引入B策略以增强特征提取的鲁棒性。"
2. **客观被动语态**：
   - 多用“本文提出”、“实验结果表明”、“数据分析显示”。
   - 少用或不用“我们发现”、“我想”。
3. **句式密度与信息量**：
   - 避免短句碎读。学术长句应包含：条件状语（在xx条件下） + 核心主张（xx表现出xx特性） + 数据/理论支撑（误差降低了xx%）。
4. **具体化**：
   - 凡是涉及评价，必须带上限定条件。不要说“效果很好”，要说“在低信噪比环境下，Dice系数提升了3.5%”。

【输出要求】
请直接输出改写后的正文，**不要**包含“好的”、“根据您的要求”等任何对话性文字。
`;

const LOGIC_SKELETON_PROMPT = `
你是“学位论文逻辑架构师”。你的任务是根据用户的【研究课题】、【核心探讨记录】以及可选的【参考范文】，为当前小节设计一个详细的**逻辑骨架**和**循证搜索计划**。

【输入信息】
1. 论文题目与当前章节信息。
2. **核心探讨记录 (Critical)**: 用户之前与导师确认的方法论、数据和创新点。
3. **参考范文 (Optional)**: 用户提供的师兄论文或模板段落。
4. **用户指令**: 用户对本节的具体要求。

========================
0) 总原则与约束（必须遵守）
- 不编造：不得凭空编造文献、实验结果。
- 模板可学结构不可抄句：若提供 参考范文，只能学习其段落推进/语气/对比框架，禁止复用原句。
- **关键词策略 (重要)**：
  - **脉络延展性**：生成的关键词组必须覆盖该段落的逻辑演进。例如，如果段落是从“通用综述”讲到“具体缺陷”，关键词应包含宽泛的综述词和具体的缺陷词。
  - **中英双语 (Bilingual)**：必须同时提供中文和英文关键词（各占50%），以支持在不同数据库（ArXiv/OpenAlex vs 知网/万方）中检索。
  - **具体化**：严禁生成“深度学习”这种泛泛的词，必须是“基于Transformer的医学分割 (Transformer-based medical segmentation)”这种级别。

========================
A) 通用“逻辑词”词表（跨章节可复用）
Level-1：Move（段落功能/修辞动作）
Level-2：Slots（信息槽：段落里必须填的内容类型）

A1. Level-1 Moves（通用，任何领域可实例化）
【Intro/绪论类】
- BG-Field：领域大背景/技术概述（是什么、为什么重要）
- GAP-Problem：现有方法/系统的明确痛点（尽量量化或举例）
- RW-Compare：代表性方案对比（优缺点/适用条件/限制）
- OBJ-Goal：本文目标（解决什么、达到什么指标/性质）
- ORG-Roadmap：论文结构安排（每章做什么）

【Theory/Related/理论基础与相关工作】
- DEF-Concept：概念定义、符号、变量、范围、假设
- ALG-Canonical：经典方法/基线流程（可含步骤与伪代码级描述）
- ISSUE-Phenomenon：关键“现象/问题表现”（你领域里可为伪影/误差/偏差/失败模式）
- ISSUE-Mitigation：已有应对策略的范式分类（插值/重建/后处理/硬件/协议等）

【Method/Algorithm/核心方法章】
- PROB-Setup：问题定义（输入/输出/假设/符号/目标函数）
- METHOD-Pipeline：方法总流程（模块1-2-3）
- METHOD-Detail：关键步骤细化（公式/推导/复杂度/稳定性）
- EXP-Design：实验设计（数据、对比方法、指标、消融、统计检验口径）
- EXP-Result：结果呈现（定性图 + 定量表）
- ANALYSIS-WhyWorks：原因分析（回扣 Insight/GAP，对应哪些模块起作用）

A2. Level-2 Slots（所有 Move 统一使用）
每个 skeleton block 必须填这些槽（没有材料也要标 TODO）：
- Claim：这一段要表达的主张（1句）
- Evidence：需要的证据类型（reference/data/formula/figure/table/comparison）
- Mechanism：为什么成立（原理/推导/直觉）
- KeywordsZH：中文检索词（3-5个，覆盖从宽泛到具体的脉络）
- KeywordsEN：英文检索词（3-5个，对应英文术语，方便ArXiv/OpenAlex检索）

========================
C) 你的输出：严格 JSON
{
  "section_plans": [
    {
      "section_id": "...",
      "skeleton_blocks": [
        {
          "block_id": "blk_1",
          "move": "必须来自 A1 Move 词表",
          "slots": {
            "Claim": "本段核心主张 (e.g., 现有U-Net在处理边缘细节时存在模糊问题)",
            "Evidence": ["reference|data|formula|figure|table|comparison"],
            "KeywordsZH": ["U-Net 边缘模糊 原因", "医学图像分割 边界损失函数 综述"], 
            "KeywordsEN": ["U-Net boundary fuzziness analysis", "medical segmentation boundary loss survey"]
          },
          "style_notes": "模仿范文语气：先肯定现有贡献，再用转折词引出具体缺陷"
        }
      ],
      "writing_blueprint": {
        "section_flow": "一句话描述全文逻辑流"
      }
    }
  ]
}
`;

// Generic Generator Interface
interface GenerationRequest {
    systemPrompt: string;
    userPrompt?: string; // For single turn
    history?: ChatMessage[]; // For multi-turn
    jsonMode?: boolean;
}

// The Unified Caller
const generateContentUnified = async (
    settings: ApiSettings,
    req: GenerationRequest
): Promise<string> => {
    
    // CASE A: OpenAI Compatible (Custom Base URL)
    if (settings.baseUrl && settings.baseUrl.trim() !== "") {
        try {
            let url = settings.baseUrl.trim();
            if (url.endsWith('/')) url = url.slice(0, -1);
            if (!url.endsWith('/chat/completions')) {
                if (url.endsWith('/v1')) {
                    url = `${url}/chat/completions`;
                } else {
                    url = `${url}/chat/completions`;
                }
            }

            const messages: any[] = [
                { role: "system", content: req.systemPrompt }
            ];

            if (req.history) {
                req.history.forEach(h => {
                    messages.push({ role: h.role, content: h.content });
                });
            }

            if (req.userPrompt) {
                messages.push({ role: "user", content: req.userPrompt });
            }

            const payload: any = {
                model: settings.modelName,
                messages: messages,
                stream: false
            };

            if (req.jsonMode) {
                payload.response_format = { type: "json_object" };
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${settings.apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
            }

            const data = await response.json();
            
            // Usage Tracking for OpenAI
            if (data.usage && settings.onUsage) {
                settings.onUsage({
                    promptTokens: data.usage.prompt_tokens || 0,
                    completionTokens: data.usage.completion_tokens || 0,
                    totalTokens: data.usage.total_tokens || 0
                });
            }

            const content = data.choices?.[0]?.message?.content || "";
            return content;

        } catch (e) {
            console.error("OpenAI Compatible Call Failed", e);
            throw e;
        }
    } 
    // CASE B: Official Google GenAI SDK
    else {
        const ai = new GoogleGenAI({ apiKey: settings.apiKey });
        let contents: any = "";
        
        if (req.history && req.history.length > 0) {
            let fullPrompt = "";
            req.history.forEach(h => {
                fullPrompt += `${h.role === 'user' ? 'User' : 'Model'}: ${h.content}\n`;
            });
            if (req.userPrompt) {
                fullPrompt += `User: ${req.userPrompt}\n`;
            }
            contents = fullPrompt.trim();
            if (!contents && req.userPrompt) contents = req.userPrompt;
        } else {
             contents = req.userPrompt || "";
        }

        try {
            const res = await ai.models.generateContent({
                model: settings.modelName,
                contents: contents,
                config: {
                    systemInstruction: req.systemPrompt,
                    responseMimeType: req.jsonMode ? "application/json" : "text/plain"
                }
            });

            // Usage Tracking for Gemini
            if (res.usageMetadata && settings.onUsage) {
                settings.onUsage({
                    promptTokens: res.usageMetadata.promptTokenCount || 0,
                    completionTokens: res.usageMetadata.candidatesTokenCount || 0,
                    totalTokens: res.usageMetadata.totalTokenCount || 0
                });
            }

            return res.text || "";
        } catch (e) {
             console.error("Google GenAI Call Failed", e);
             throw e;
        }
    }
};

export const chatWithSupervisor = async (history: ChatMessage[], thesisTitle: string, currentStructure: any, settings: ApiSettings) => {
   const historyText = history.slice(0, -1).map(h => `${h.role}: ${h.content}`).join("\n");
  const lastMsg = history[history.length - 1];

  const fewShotExample = `
{
  "reply": "根据您的要求，我调整了第三章的结构...",
  "updatedStructure": {
    "chapters": [
      { "title": "第1章 绪论", "level": 1, "subsections": [] }
    ]
  }
}`;
  const systemPrompt = `
    你是一位严谨的硕士生导师。任务：协助学生设计论文大纲。题目：${thesisTitle}
    规则：1. 返回标准JSON。2. 细化到三级标题。3. 标题格式 "第X章 标题" 或 "1.1 标题"。
    JSON参考: ${fewShotExample}
    当前结构: ${JSON.stringify(currentStructure)}
  `;
  try {
    const text = await generateContentUnified(settings, { systemPrompt, userPrompt: lastMsg.content, history: history.slice(0, -1), jsonMode: true });
    return JSON.parse(cleanJsonText(text) || "{}");
  } catch (e) { return { reply: `API Error: ${e}` }; }
};

export const chatWithMethodologySupervisor = async (history: ChatMessage[], thesisTitle: string, chapter: Chapter, settings: ApiSettings) => {
  const lastMsg = history[history.length - 1];
  
  // Flatten structure for context
  const chapterStructure = JSON.stringify(chapter, (key, value) => {
      if (key === 'chatHistory') return undefined;
      return value;
  }, 2);

  const systemPrompt = `
    角色：专业的硕士导师/审稿人。
    任务：针对学生选定的章节（包含完整层级结构），探讨并确认写作思路。
    论文题目：${thesisTitle}
    章节：${chapter.title} (Level 1)
    
    【结构】
    ${chapterStructure}
    
    【任务目标】
    引导学生补充本章的核心内容。当信息足够时，**必须**在JSON中返回 \`finalizedMetadata\` 字段，将聊天中的非结构化信息整理为结构化摘要。
    
    【Metadata 整理规则】
    - methodology: 核心方法、算法流程、改进点。
    - dataSources: 数据集名称、来源、预处理。
    - experimentalDesign: 实验环境、对比算法、评价指标。
    - resultsAnalysis: 核心结论。
    - figurePlan/tablePlan: 必须生成具体的图表标题列表 (e.g. "图3-1: U-Net改进结构图")。

    【输出格式】
    {
      "reply": "回复内容...",
      "finalizedMetadata": {
         ... // 只有在对话结束/信息收集完毕时才返回此字段
      }
    }
  `;

  try {
    const text = await generateContentUnified(settings, {
        systemPrompt,
        userPrompt: lastMsg.content,
        history: history.slice(0, -1),
        jsonMode: true
    });
    return JSON.parse(cleanJsonText(text) || "{}");
  } catch (e) {
    console.error(e);
    return { reply: `（API 错误: ${e instanceof Error ? e.message : '未知错误'}）` };
  }
};

// --- Advanced Mode: Skeleton Planning (Upgraded) ---
export const generateSkeletonPlan = async (
    thesisTitle: string,
    chapterInfo: Chapter,
    discussionHistory: ChatMessage[] | undefined,
    referenceTemplate: string | undefined,
    userInstructions: string | undefined,
    settings: ApiSettings
): Promise<SkeletonResponse> => {
    const systemPrompt = LOGIC_SKELETON_PROMPT;
    
    // Format Discussion Context
    const contextStr = discussionHistory 
        ? discussionHistory.map(m => `${m.role === 'user' ? 'Student' : 'Advisor'}: ${m.content}`).join('\n').slice(-4000)
        : "无核心探讨记录";

    const userPromptPayload = {
        thesis_meta: { title: thesisTitle },
        current_section: { id: chapterInfo.id, title: chapterInfo.title },
        // CRITICAL: Injecting context
        core_discussion_context: contextStr,
        reference_template: referenceTemplate || "无参考范文，请根据标准学术逻辑推演。",
        user_instructions: userInstructions || "无特殊指令",
        available_search_apis: [{ name: "manual_search", capabilities: { can_search_abstracts: true }}]
    };

    const userPrompt = JSON.stringify(userPromptPayload);

    try {
        const text = await generateContentUnified(settings, {
            systemPrompt,
            userPrompt,
            jsonMode: true
        });
        const parsed = JSON.parse(cleanJsonText(text));
        return parsed;
    } catch (e) {
        console.error("Skeleton Generation Failed", e);
        throw e;
    }
};

// --- Single Section Writer ---

export interface WriteSectionContext {
  thesisTitle: string;
  chapterLevel1: Chapter; // Context: The main chapter this section belongs to
  targetSection: Chapter; // The specific section (can be L1, L2, or L3) to write
  userInstructions?: string; // Optional user feedback
  formatRules: FormatRules;
  globalRefs: Reference[];
  settings: ApiSettings;
  discussionHistory?: ChatMessage[]; // New: discussion context
  fullChapterTree?: Chapter[]; // New: Full outline context for Smart Write
}

export const writeSingleSection = async (ctx: WriteSectionContext) => {
  const { thesisTitle, chapterLevel1, targetSection, userInstructions, settings, discussionHistory, fullChapterTree, globalRefs } = ctx;

  const isLevel1 = targetSection.level === 1;

  // Compile discussion context (Limited to the relevant chapter usually)
  let discussionContextStr = "";
  if (discussionHistory && discussionHistory.length > 0) {
      discussionContextStr = discussionHistory
        .filter(m => m.role === 'assistant') 
        .map(m => `导师/审稿人意见: ${m.content}`)
        .join("\n").slice(-3000); 
  }
  
  // Format Structure Context (Simplified Tree)
  const structureContext = fullChapterTree 
      ? JSON.stringify(fullChapterTree.map(c => ({ 
          title: c.title, 
          subsections: c.subsections?.map(s => s.title) 
        })), null, 2)
      : "（无完整目录信息）";

  // Format Global References for Reuse
  const globalRefStr = globalRefs.map(r => `[RefID: ${r.id}] ${r.description}`).join("\n");

  const systemPrompt = `
    ${HUMAN_WRITING_STYLE}
    
    【写作任务背景】
    题目：${thesisTitle}
    当前一级章节：${chapterLevel1.title}
    **当前撰写目标**：${targetSection.title} (Level ${targetSection.level})
    
    【全文结构上下文】
    (请参考此结构以明确当前章节在全文中的定位，避免内容跑题或重复)
    ${structureContext}

    【核心探讨上下文 (Critical Logic Source)】
    以下是作者之前与导师确认过的本章核心思路（方法/数据/实验），请务必将其融入正文：
    ${discussionContextStr}
    
    【全局参考文献库 (Global References)】
    这是项目中已经存在的文献列表。
    **复用规则**：如果你需要引用的文献在下表中已经存在（**严格同源**），请务必直接使用其 ID 占位符 \`[[REF:ID]]\` (例如 [[REF:12]])。
    **新增规则**：只有当文献不在下表中时，才使用 \`[[REF:详细文献标题/描述]]\` 来请求添加新文献。
    
    已存在列表:
    ${globalRefStr || "(暂无全局文献，请创建新引用)"}
    
    【指令与逻辑骨架（非常重要）】
    ${userInstructions ? userInstructions : "无特殊指令，请按照标准学术规范撰写。"}

    【专业术语与翻译名词规范 (CRITICAL)】
    1. **严格区分“专业术语”与“普通翻译名词”**：
       - **专业术语** (具有行业公认英文缩写): 首次出现必须使用“中文全称 (英文全称, 英文缩写)”格式。
         * 例如：“生成对抗网络 (Generative Adversarial Networks, GAN)”。
         * 后续直接使用缩写 (如 "GAN")。
       - **普通翻译名词** (无特定缩写): 直接使用中文，**禁止**强行编造缩写或附带英文。
         * 例如：“生成器”直接写“生成器”，**不要**写“生成器 (Generator, G)”。
         * 例如：“损失函数”直接写“损失函数”，**不要**写“损失函数 (Loss Function)”。
    2. 确保缩写在当前章节内的上下文一致性。

    【格式占位符规范】
    1. **只输出正文**，不要输出章节标题。
    2. **特殊对象占位符**:
       - 插入图片：[[FIG:图片描述]]
       - 插入表格：[[TBL:表格描述]]
       - **独立公式（带编号）**：[[EQ:公式内容]] (例如: [[EQ:E=mc^2]])
       - **行内数学符号（无编号）**：[[SYM:数学符号]]
         * 必须嵌入在句子中间，**禁止**在 [[SYM:...]] 前后加换行符！
         * 使用标准 LaTeX 格式。
       - 插入引用：[[REF:描述或关键词]] 或 [[REF:数字ID]]
         * **禁止**在 [[REF:...]] 前后加换行符！
    3. **段落**：普通文本段落之间用换行符分隔。不要使用 XML/HTML 标签。

    请开始撰写：
  `;

  try {
    const text = await generateContentUnified(settings, { systemPrompt, userPrompt: "请开始撰写本小节内容", jsonMode: false });
    return cleanMarkdownArtifacts(text);
  } catch (e) {
    throw new Error(`撰写失败: ${e instanceof Error ? e.message : '未知错误'}`);
  }
};

// --- COMPLEX POST-PROCESSING WITH AI AGENTS ---

interface PostProcessContext {
    fullText: string; // Deprecated in favor of allChapters structure
    chapterId: string; // The chapter we are processing
    allChapters: Chapter[];
    globalReferences: Reference[];
    globalTerms: TechnicalTerm[];
    settings: ApiSettings;
    onLog?: (msg: string) => void;
}

interface PostProcessResult {
    updatedText: string;
    updatedReferences: Reference[];
    updatedTerms: TechnicalTerm[];
    updatedChapters: Chapter[]; 
}

// Helper: Flatten chapters to find order
const flattenChapters = (chapters: Chapter[]): Chapter[] => {
    let list: Chapter[] = [];
    chapters.forEach(c => { // Fixed Syntax Error Here
        list.push(c);
        if (c.subsections) list = list.concat(flattenChapters(c.subsections));
    });
    return list;
};

// 1. Extraction Agent
const extractTermsAI = async (text: string, settings: ApiSettings): Promise<TechnicalTerm[]> => {
    if (!text || text.length < 50) return [];
    
    const systemPrompt = `
      You are a Technical Term Extraction Agent.
      Analyze the provided text and identify "Professional Technical Terms" that are defined using the format "Full Name (Acronym)" or "Full Name (English)".
      
      CRITICAL FILTERING RULES:
      1. IGNORE figure/table citations like "Figure (1)", "Table (2)", "Eq. (3)".
      2. IGNORE common parentheses like "shown in (a)", "note (see below)".
      3. EXTRACT ONLY true domain-specific terms (e.g., "Convolutional Neural Networks (CNN)").
      4. IGNORE generic translated nouns like "Generator (Generator)", "Loss (Loss)". Only extract terms that have a DISTINCT valid acronym used in the field.
      
      Return JSON: { "terms": [ { "term": "中文全称", "acronym": "ACRONYM_OR_ENGLISH" } ] }
      Return empty list if none found.
    `;

    try {
        const res = await generateContentUnified(settings, {
            systemPrompt,
            userPrompt: text.slice(0, 4000), // Limit context
            jsonMode: true
        });
        const parsed = JSON.parse(cleanJsonText(res));
        return parsed.terms || [];
    } catch (e) {
        console.warn("Term extraction failed", e);
        return [];
    }
};

// 2. Rewrite Agent
const rewriteContentAI = async (text: string, instructions: string, settings: ApiSettings): Promise<string> => {
    const systemPrompt = `
      ${HUMAN_WRITING_STYLE}

      Task: REWRITE the provided text to strictly adhere to the terminology consistency rules provided.
      
      RULES:
      1. Keep the original meaning and core content.
      2. ONLY modify the technical terms as requested in the instructions, OR improve flow based on the human-writing style guide.
      3. Ensure the text flows naturally after modification.
      4. Preserve all special placeholders like [[FIG:...]], [[REF:...]], [[EQ:...]], [[SYM:...]].
      
      INSTRUCTIONS FROM TERM CHECKER:
      ${instructions}
    `;

    try {
        const res = await generateContentUnified(settings, {
            systemPrompt,
            userPrompt: `Original Text:\n${text}`,
            jsonMode: false
        });
        return cleanMarkdownArtifacts(res);
    } catch (e) {
        return text; // Fallback to original
    }
};

export const runPostProcessingAgents = async (ctx: PostProcessContext): Promise<PostProcessResult> => {
   const { chapterId, allChapters, globalReferences, settings, onLog } = ctx;
   
   // 1. Deep Clone & Flatten for Analysis
   let updatedChapters = JSON.parse(JSON.stringify(allChapters));
   const flatAll = flattenChapters(updatedChapters);
   
   // Identify the subset of nodes belonging to the CURRENT chapter
   // We need to process these for extraction and potentially rewriting
   const currentChapterNodes = flatAll.filter((c: Chapter) => c.id.startsWith(chapterId) || c.id === chapterId);
   
   // --- PHASE 1: AI TERM EXTRACTION (Current Chapter Only) ---
   if (onLog) onLog(`正在扫描本章 ${currentChapterNodes.length} 个节点的专业术语...`);
   
   // We gather terms found in THIS chapter
   const localTermsFound: { term: TechnicalTerm, nodeId: string }[] = [];
   
   for (const node of currentChapterNodes) {
       if (!node.content) continue;
       const terms = await extractTermsAI(node.content, settings);
       terms.forEach(t => {
           localTermsFound.push({ 
               term: { ...t, fullName: t.term }, 
               nodeId: node.id 
           });
       });
   }

   // --- PHASE 2: GLOBAL INDEXING (Determine First Occurrence) ---
   if (onLog) onLog("构建全书术语索引，计算首次出现位置...");

   // We need to know if these terms appear in EARLIER chapters (Pre-order).
   // Since we don't extract AI terms from previous chapters every time (too slow),
   // we do a hybrid approach: 
   // 1. We assume we have a 'registry' of known terms (ctx.globalTerms is the accumulation).
   // 2. But to be safe for "out of order writing", we perform a lightweight string check 
   //    on ALL preceding chapters for the terms we just found.
   
   const termDirectives: Record<string, 'use_full' | 'use_short'> = {}; // Key: NodeID + Acronym
   const uniqueAcronyms = Array.from(new Set(localTermsFound.map(x => x.term.acronym.toUpperCase())));

   // For each acronym found in this chapter, find its ABSOLUTE FIRST occurrence in the WHOLE book
   uniqueAcronyms.forEach(acronym => {
       const termObj = localTermsFound.find(x => x.term.acronym.toUpperCase() === acronym)?.term;
       if (!termObj) return;

       // Find the very first node in the ENTIRE book that mentions this acronym OR its full name
       // We use a simple includes check for speed on the global scope
       let firstGlobalNodeId = "";
       
       for (const node of flatAll) {
           if (!node.content) continue;
           const contentUpper = node.content.toUpperCase();
           // Strict check: Acronym should be bounded or in parens to avoid partial matches
           // But for simplicity in this logic, we check if the concept exists
           if (contentUpper.includes(acronym) || (termObj.fullName && node.content.includes(termObj.fullName))) {
               firstGlobalNodeId = node.id;
               break; // Found the first one
           }
       }

       // Now decide for the CURRENT chapter nodes
       currentChapterNodes.forEach((node: Chapter) => {
           if (!node.content) return;
           // Does this node contain the term?
           const hasTerm = node.content.toUpperCase().includes(acronym) || node.content.includes(termObj.fullName);
           if (hasTerm) {
               const key = `${node.id}||${acronym}`;
               if (node.id === firstGlobalNodeId) {
                   termDirectives[key] = 'use_full';
               } else {
                   termDirectives[key] = 'use_short';
               }
           }
       });
   });

   // --- PHASE 3: AI REWRITING (Apply Rules) ---
   if (onLog) onLog("AI 正在根据全局规则重写不规范的段落...");

   let rewrittenCount = 0;
   
   // We iterate current chapter nodes again to apply fixes
   for (const node of currentChapterNodes) {
       if (!node.content) continue;
       
       const nodeDirectives: string[] = [];
       
       uniqueAcronyms.forEach(acronym => {
           const rule = termDirectives[`${node.id}||${acronym}`];
           if (!rule) return;
           
           const termInfo = localTermsFound.find(t => t.term.acronym.toUpperCase() === acronym)?.term;
           if (!termInfo) return;

           if (rule === 'use_full') {
               nodeDirectives.push(`- Term "${acronym}" is defined for the FIRST time here. Ensure it appears ONCE as "${termInfo.fullName} (${termInfo.acronym})". Do not use just "${acronym}" before defining it.`);
           } else {
               nodeDirectives.push(`- Term "${acronym}" has been defined previously. Replace instances of "${termInfo.fullName} (${termInfo.acronym})" or "${termInfo.fullName}" with just "${termInfo.acronym}".`);
           }
       });

       if (nodeDirectives.length > 0) {
           // Call AI to rewrite this specific section
           if (onLog) onLog(`  - 修正节点: ${node.title} ...`);
           const newContent = await rewriteContentAI(node.content, nodeDirectives.join("\n"), settings);
           node.content = newContent; // Update in place
           rewrittenCount++;
       }
   }
   
   if (onLog) onLog(`术语一致性检查完成，AI 重写了 ${rewrittenCount} 个段落。`);


   // --- PHASE 4: Reference & Formatting (Legacy Logic) ---
   // Maintain the global reference list. Only add new ones if they don't match existing descriptions.
   const finalRefOrder: Reference[] = [...globalReferences];
   let nextId = finalRefOrder.length > 0 ? Math.max(...finalRefOrder.map(r => r.id)) + 1 : 1;

   const processBlock = (content: string): string => {
       if (!content) return "";
       // 1. First, aggressive cleanup of newlines around inline elements
       const cleanedContent = content
            .replace(/\n\s*(\[\[(?:SYM|REF):)/g, ' $1') // Remove newline before SYM/REF
            .replace(/(\]\])\s*\n/g, '$1 ');            // Remove newline after SYM/REF

       let txt = cleanMarkdownArtifacts(cleanedContent);

       // Space & Newline handling
       const parts = txt.split(/(\[\[(?:EQ|SYM):.*?\]\])/g);
       txt = parts.map(part => {
           if (part.startsWith('[[EQ:') || part.startsWith('[[SYM:')) return part; 
           let s = part.replace(/ {2,}/g, '\n'); 
           s = s.replace(/[ \t\r\f\v]+/g, ''); 
           return s;
       }).join('');
       
       // Ref Indexing Logic (Enhanced for Global Reuse)
       // Supports [[REF:12]] (Reuse ID) and [[REF:Title...]] (New)
       return txt.replace(/(\[\[REF:(.*?)\]\]|\[(\d+)\])/g, (match, pFull, pDesc, pId) => {
            
            // Case A: AI provided an explicit ID (e.g., [[REF:12]])
            // This happens when AI reused a global reference as instructed.
            if (pDesc && /^\d+$/.test(pDesc.trim())) {
                return `[[REF:${pDesc.trim()}]]`; // Trust the ID (assuming AI checked the list)
            }

            // Case B: AI provided a description/title (e.g., [[REF:Attention is all you need...]])
            let description = "";
            if (pDesc) description = pDesc.trim();
            else if (pId) {
                // If it looks like [1], it's ambiguous. Try to find if we have it.
                // But usually AI outputs [[REF:...]] as instructed.
                // Fallback: Just return match or treat as description "1".
                // Better: treat pId as description to be searched (unlikely to match but safe)
                description = pId; 
            }
            
            if (!description) return match;

            // Strict/Fuzzy Match against Global List
            let assignedId = 0;
            
            // Check matching. Logic: New description contains Old title OR Old description contains New title
            // This handles partial matches like "Attention is all you need" matching "Attention is all you need. NIPS 2017..."
            const existingIdx = finalRefOrder.findIndex(r => 
                r.description.includes(description) || description.includes(r.description)
            );
            
            if (existingIdx !== -1) {
                assignedId = finalRefOrder[existingIdx].id;
            } else {
                assignedId = nextId++;
                finalRefOrder.push({ id: assignedId, description, placeholder: match });
            }
            
            return `[[REF:${assignedId}]]`;
       });
   };

   // Critical: We must run this over ALL chapters to re-index correctly
   if (onLog) onLog("正在全书重排参考文献顺序 (优先复用全局同源文献)...");
   
   const finalUpdateRecursive = (list: Chapter[]): Chapter[] => {
       return list.map(ch => {
           let newContent = ch.content;
           if (newContent) {
               newContent = processBlock(newContent);
           }
           return {
               ...ch,
               content: newContent,
               subsections: ch.subsections ? finalUpdateRecursive(ch.subsections) : []
           };
       });
   };

   updatedChapters = finalUpdateRecursive(updatedChapters);

   // Extract new global terms list for UI display
   const finalGlobalTerms = [...ctx.globalTerms];
   localTermsFound.forEach(lt => {
       if (!finalGlobalTerms.find(gt => gt.acronym === lt.term.acronym)) {
           finalGlobalTerms.push(lt.term);
       }
   });

   return {
       updatedText: "", 
       updatedReferences: finalRefOrder,
       updatedTerms: finalGlobalTerms,
       updatedChapters: updatedChapters
   };
};

function escapeRegExp(string: string) {
  if (typeof string !== 'string') return "";
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}