
import { GoogleGenAI } from "@google/genai";
import { Chapter, FormatRules, TechnicalTerm, Reference, ChatMessage, InterviewData, ApiSettings } from "../types";

// Helper to create a dynamic client based on settings
const getClient = (settings: ApiSettings) => {
  if (!settings.apiKey) {
    throw new Error("请先在设置中配置 API Key");
  }
  
  const config: any = { apiKey: settings.apiKey };
  if (settings.baseUrl) {
    config.baseUrl = settings.baseUrl;
  }

  return new GoogleGenAI(config);
};

// --- Helpers ---
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
  currentStructure: any,
  settings: ApiSettings
): Promise<{ reply: string, updatedStructure?: any }> => {
  const ai = getClient(settings);
  const historyText = history.map(h => `${h.role}: ${h.content}`).join("\n");
  const fewShotExample = `
{
  "reply": "根据您的要求，我调整了第三章的结构...",
  "updatedStructure": {
    "chapters": [
      {
        "title": "第1章 绪论", 
        "level": 1,
        "subsections": [
          { "title": "1.1 研究背景", "level": 2, "subsections": [] }
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
    4. **【标题格式要求】**: 
       - 一级标题必须加前缀，格式为 "第X章 标题名" (例如: "第1章 绪论")
       - 二级/三级标题请保留 "1.1", "1.1.1" 这样的序号前缀。
    
    【JSON 结构参考】
    ${fewShotExample}
    
    当前结构: ${JSON.stringify(currentStructure)}
    对话历史: ${historyText}
    请回复 JSON:
  `;

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: systemPrompt,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error(e);
    return { reply: `（系统提示：API调用失败 - ${e instanceof Error ? e.message : '未知错误'}）` };
  }
};

// --- Methodology Supervisor Agent (Autonomous Context Aware) ---
export const chatWithMethodologySupervisor = async (
  history: ChatMessage[],
  thesisTitle: string,
  chapter: Chapter,
  settings: ApiSettings
): Promise<{ reply: string, finalizedMetadata?: InterviewData }> => {
  const ai = getClient(settings);
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

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: systemPrompt,
      config: { responseMimeType: "application/json" }
    });
    return JSON.parse(response.text || "{}");
  } catch (e) {
    console.error(e);
    return { reply: `（API 错误: ${e instanceof Error ? e.message : '未知错误'}）` };
  }
};

// --- Single Section Writer (Granular Control) ---

interface WriteSectionContext {
  thesisTitle: string;
  chapterLevel1: Chapter; // Context: The main chapter this section belongs to
  targetSection: Chapter; // The specific section (can be L1, L2, or L3) to write
  userInstructions?: string; // Optional user feedback
  formatRules: FormatRules;
  globalRefs: Reference[];
  settings: ApiSettings;
  discussionHistory?: ChatMessage[]; // New: discussion context
}

export const writeSingleSection = async (ctx: WriteSectionContext) => {
  const { thesisTitle, chapterLevel1, targetSection, userInstructions, formatRules, settings, discussionHistory } = ctx;
  const ai = getClient(settings);

  const isLevel1 = targetSection.level === 1;

  // Compile discussion context
  let discussionContextStr = "";
  if (discussionHistory && discussionHistory.length > 0) {
      discussionContextStr = discussionHistory
        .filter(m => m.role === 'assistant') 
        .map(m => `导师/审稿人意见: ${m.content}`)
        .join("\n").slice(-2000); 
  }

  const systemPrompt = `
    角色：专业的学术论文撰写 Agent。
    任务：撰写章节具体的**正文内容**。
    
    【论文背景】
    题目：${thesisTitle}
    所属一级章节：${chapterLevel1.title}
    
    【核心探讨上下文】
    ${discussionContextStr}

    【撰写目标】
    标题：${targetSection.title} (Level ${targetSection.level})
    ${isLevel1 ? "注意：这是章首语，请概括本章主要内容。" : "注意：请专注于本小节的具体技术/理论细节。"}
    
    【用户指令】
    ${userInstructions ? userInstructions : "无"}

    【格式规范 (CRITICAL)】
    1. **只输出正文**，不要输出章节标题。
    2. **特殊对象占位符** (解析器将自动将其转换为复杂的Word格式):
       - 插入图片：[[FIG:图片描述]]  (例如: [[FIG:U-Net网络结构图]])
       - 插入表格：[[TBL:表格描述]]
       - 插入引用：[[REF:引用ID]] (例如: [[REF:1]])
       - 不要使用Markdown图片或表格语法。
    3. **段落**：普通文本段落之间用换行符分隔即可。不要使用 XML/HTML 标签。
    4. **字数**：300-800 字。

    请开始撰写：
  `;

  try {
    const response = await ai.models.generateContent({
      model: settings.modelName,
      contents: systemPrompt,
    });

    let rawText = response.text || "";
    rawText = cleanMarkdownArtifacts(rawText);
    return rawText;
  } catch (e) {
    console.error(e);
    throw new Error(`撰写失败: ${e instanceof Error ? e.message : '未知错误'}`);
  }
};

// --- Post-Processing Agents (Chapter Completion) ---

export const runPostProcessingAgents = async (
  fullChapterText: string,
  settings: ApiSettings
): Promise<{
    polishedText: string;
    newReferences: Reference[];
    newTerms: TechnicalTerm[];
}> => {
   const ai = getClient(settings);
   
   const prompt = `
     You are a Quality Assurance Agent Cluster.
     Input Text (Raw Content):
     ${fullChapterText.slice(0, 15000)}

     Tasks:
     1. **Syntax Check**: Ensure specific placeholders are correctly formatted: [[FIG:Desc]], [[TBL:Desc]], [[REF:ID]]. 
     2. **Term Check**: Extract technical terms.
     3. **Reference Check**: Extract [[REF:ID]] usage and generate a reference list.
     
     Return JSON:
     {
       "polishedText": "Corrected text...",
       "references": [
          { "id": 1, "description": "Author, Title, Year..." }
       ],
       "terms": [
          { "term": "GAN", "fullName": "Generative Adversarial Network", "acronym": "GAN" }
       ]
     }
   `;

   try {
     const response = await ai.models.generateContent({
        model: settings.modelName,
        contents: prompt,
        config: { responseMimeType: "application/json" }
     });
     
     const result = JSON.parse(response.text || "{}");
     return {
        polishedText: result.polishedText || fullChapterText,
        newReferences: result.references || [],
        newTerms: result.terms || []
     };

   } catch (e) {
      console.error("Post processing failed", e);
      return { polishedText: fullChapterText, newReferences: [], newTerms: [] };
   }
};

export const repairChapterFormatting = async (
  rawContent: string, 
  formatRules: FormatRules,
  settings: ApiSettings
) => {
   // Deprecated in favor of strict placeholder syntax
   return rawContent;
};
