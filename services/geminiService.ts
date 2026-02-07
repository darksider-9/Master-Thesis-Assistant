
import { GoogleGenAI, Type } from "@google/genai";
import { Chapter, FormatRules, TechnicalTerm, Reference, ChatMessage, InterviewData } from "../types";

const API_KEY = process.env.API_KEY || "";
const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Helpers ---
const cleanJsonString = (str: string) => {
  let cleaned = str.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned;
};

const cleanMarkdownArtifacts = (text: string) => {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') 
    .replace(/\*(.*?)\*/g, '$1')     
    .replace(/^#+\s+/gm, '')         
    .replace(/`/g, '');              
};

// --- Supervisor Agent (Structure Design) ---
export const chatWithSupervisor = async (
  history: ChatMessage[], 
  thesisTitle: string,
  currentStructure: any
): Promise<{ reply: string, updatedStructure?: any }> => {
  const historyText = history.map(h => `${h.role}: ${h.content}`).join("\n");
  const fewShotExample = `
{
  "reply": "根据您的要求，我调整了第三章的结构...",
  "updatedStructure": {
    "chapters": [
      {
        "title": "绪论", 
        "level": 1,
        "subsections": [
          { "title": "研究背景", "level": 2, "subsections": [] }
        ]
      }
    ]
  }
}`;

  const systemPrompt = `
    你是一位严谨的硕士生导师。当前任务：协助学生设计论文大纲。
    论文题目：${thesisTitle}
    
    【核心规则】
    1. **必须**返回标准的 JSON 格式。
    2. 目标是确定完整大纲（5-7章），必须细化到 **三级标题**。
    3. 只有在用户明确同意或要求修改结构时，才在 \`updatedStructure\` 中返回完整的大纲树。
    4. **【严禁编号】**: JSON中的 \`title\` 字段**绝对不要**包含 "第一章"、"1.1"、"3.2.1" 等序号。只返回纯标题文字。
    
    【JSON 结构参考】
    ${fewShotExample}
    
    当前结构: ${JSON.stringify(currentStructure)}
    对话历史: ${historyText}
    请回复 JSON:
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: systemPrompt,
    config: { responseMimeType: "application/json" }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    return { reply: "（系统提示：JSON解析失败，请重试）" };
  }
};

// --- Methodology Supervisor Agent (Autonomous Context Aware) ---
export const chatWithMethodologySupervisor = async (
  history: ChatMessage[],
  thesisTitle: string,
  chapter: Chapter
): Promise<{ reply: string, finalizedMetadata?: InterviewData }> => {
  const historyText = history.map(h => `${h.role}: ${h.content}`).join("\n");
  
  const getStructureText = (ch: Chapter, prefix = ""): string => {
    let text = `${prefix}${ch.title}\n`;
    if (ch.subsections && ch.subsections.length > 0) {
      ch.subsections.forEach((sub, i) => {
        text += getStructureText(sub, `${prefix}  `);
      });
    }
    return text;
  };

  const chapterStructure = getStructureText(chapter);

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
    
    对话历史:
    ${historyText}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: systemPrompt,
    config: { responseMimeType: "application/json" }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (e) {
    return { reply: "（请继续补充您的想法...）" };
  }
};

// --- Agent Orchestrator (Chapter Writing) ---

interface OrchestrationContext {
  thesisTitle: string;
  chapter: Chapter;
  interviewData: InterviewData;
  formatRules: FormatRules;
  globalTerms: TechnicalTerm[];
  globalRefs: Reference[];
  targetWordCount?: number;
  onLog: (agent: any, msg: string) => void;
}

export const orchestrateChapterGeneration = async (ctx: OrchestrationContext) => {
  const { chapter, interviewData, formatRules, onLog, targetWordCount = 2000 } = ctx;
  const { styleMap } = formatRules;

  onLog('Figure', `加载图表规划... (Figs: ${interviewData.figureCount})`);
  onLog('Writer', `启动撰写... 目标字数: ${targetWordCount}`);
  
  const termList = ctx.globalTerms.map(t => `${t.term} (${t.fullName})`).join(", ");
  const chapterIndex = chapter.id.split('-')[1] || "1";

  // Build a recursive JSON structure of the chapter specifically for the prompt
  // to enforce structural adherence.
  const buildStructureMap = (ch: Chapter): any => {
    return {
      title: ch.title,
      level: ch.level,
      subsections: ch.subsections?.map(buildStructureMap)
    };
  };
  const structureMap = buildStructureMap(chapter);

  const contentPrompt = `
    角色：专业的学术论文撰写 Agent (严格模式)
    任务：撰写章节《${chapter.title}》。
    目标字数：**${targetWordCount}字以上** (必须严格达标)。
    
    【核心输入】
    1. 论文题目：${ctx.thesisTitle}
    2. 核心思路摘要（来自导师探讨）：${JSON.stringify(interviewData)}
    3. **严格结构树**：${JSON.stringify(structureMap)}
    
    【撰写逻辑 - CRITICAL】
    1. **按结构树遍历**：必须依次为结构树中的每个标题生成内容。
    2. **处理层级间隙**：
       - 如果二级标题 (Level 2) 下面紧接着有三级标题 (Level 3)，则二级标题只需写 100 字左右的简短引言，引导出三级标题。**核心内容写在三级标题下**。
       - 绝对不要跳过任何一个定义的子章节。
    3. **字数分配**：请自行估算，确保总字数达到 ${targetWordCount}。如果是核心章节，请详细展开算法公式推导和实验分析。
    
    【格式规范】
    - 使用 <p style="${styleMap.heading1}">...</p> 等标签包裹标题。
    - 使用 <p style="${styleMap.normal}">...</p> 包裹正文。
    - **图表占位**：依据 metadata 中的 figurePlan/tablePlan，在合适位置插入 <figure_placeholder ... />。
    - **参考文献**：使用 [i] 占位。
    - **公式**：用文字描述公式逻辑。
    - **严禁**：不要输出 Markdown，不要手动加序号 (如 1.1)。
    
    【输出示例】
    <p style="${styleMap.heading1}">绪论</p>
    <p style="${styleMap.normal}">...（约 200 字）...</p>
    <p style="${styleMap.heading2}">研究背景</p>
    <p style="${styleMap.normal}">...（约 800 字，详细阐述背景）...</p>
    ...
    
    [JSON Metadata at the end]
    <metadata>
      { "new_terms": [], "new_refs": [] }
    </metadata>
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: contentPrompt,
  });

  let rawText = response.text || "";
  rawText = cleanMarkdownArtifacts(rawText);
  
  onLog('AutoNumber', '解析 XML 并校验格式...');
  
  const metadataMatch = rawText.match(/<metadata>([\s\S]*?)<\/metadata>/);
  let newTerms: TechnicalTerm[] = [];
  let newRefs: Reference[] = [];
  let cleanContent = rawText;

  if (metadataMatch) {
    try {
      const jsonStr = metadataMatch[1].trim();
      const meta = JSON.parse(jsonStr);
      if (meta.new_terms) newTerms = meta.new_terms;
      if (meta.new_refs) newRefs = meta.new_refs;
      cleanContent = rawText.replace(/<metadata>[\s\S]*?<\/metadata>/, '').trim();
    } catch (e) {
      console.warn("Metadata parsing failed", e);
    }
  }

  onLog('TermChecker', `术语检查完毕，新增: ${newTerms.length} 个`);
  
  return {
    rawOutput: rawText,
    content: cleanContent,
    newTerms,
    newRefs
  };
};

export const repairChapterFormatting = async (
  rawContent: string, 
  formatRules: FormatRules
) => {
  const { styleMap } = formatRules;
  
  const systemPrompt = `
    角色：XML 格式修复专家 (Format Fixer)
    任务：修复用户提供的文本内容，使其符合严格的 XML 标签规范。
    
    【问题描述】
    之前的 AI 输出虽然包含文字内容，但可能遗漏了 XML 标签，导致前端解析器无法显示。
    
    【修复规则】
    1. **保留所有文字**：绝对不要删除或修改原始文本的内容。
    2. **补充标签**：确保每一段文字都被正确的 <p style="...">...</p> 包裹。
    3. **标签映射表**:
       - 章节标题 (Heading 1/2/3): <p style="${styleMap.heading1}">...</p> (自行根据上下文判断层级)
       - 普通正文: <p style="${styleMap.normal}">...</p>
       - 图表占位符: <figure_placeholder ... /> (保持原样)
       - 题注: <p style="${styleMap.captionFigure}">...</p>
    
    【输入内容】
    ${rawContent}
    
    【输出要求】
    只输出修复后的带有完整 XML 标签的字符串。
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview', 
    contents: systemPrompt,
  });

  let fixedText = response.text || "";
  fixedText = cleanMarkdownArtifacts(fixedText); 
  fixedText = fixedText.replace(/<metadata>[\s\S]*?<\/metadata>/, '').trim();
  return fixedText;
};
