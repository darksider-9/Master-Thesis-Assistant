
import { GoogleGenAI } from "@google/genai";
import { Chapter, FormatRules, TechnicalTerm, Reference, ChatMessage, InterviewData, ApiSettings } from "../types";

// --- OpenAI Compatible Interface ---

// Helper to clean Markdown JSON code blocks
const cleanJsonText = (text: string) => {
  return text.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
};

const cleanMarkdownArtifacts = (text: string) => {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') 
    .replace(/\*(.*?)\*/g, '$1')     
    .replace(/^#+\s+/gm, '')         
    .replace(/`/g, '');              
};

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
            // Normalize URL: Ensure it doesn't end with slash
            if (url.endsWith('/')) url = url.slice(0, -1);
            // Append standard chat completions endpoint if not present
            if (!url.endsWith('/chat/completions')) {
                // If user entered ".../v1", append "/chat/completions"
                // If user entered root, append "/v1/chat/completions" (heuristic)
                if (url.endsWith('/v1')) {
                    url = `${url}/chat/completions`;
                } else {
                    // Try to be smart: usually proxies give the root.
                    // We will append /chat/completions and hope the user provided the full path to the API root (e.g. .../v1)
                    // Or we just append /chat/completions assuming the user pasted the full base.
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
        
        // Convert history to Google format if present
        if (req.history && req.history.length > 0) {
            // Google SDK expects a specific chat structure or simple contents.
            // For generateContent, we can pass text. For chat, we need history.
            // Here we flatten to a simple prompt strategy for simplicity in "generateContent", 
            // OR we assume the caller wants a stateless call (like Supervisor).
            // For multi-turn with history, strict mapping is needed.
            
            // However, the Google SDK `generateContent` takes `contents` which can be multi-part.
            // But it doesn't automatically handle "history" objects unless we use `ai.chats.create`.
            // To keep it unified with the OpenAI logic above (which is stateless HTTP), 
            // we will construct the prompt by appending history to the prompt text 
            // OR use the Chat session if strictly required. 
            // Given the complexity, we'll serialize history into the text for the simple `generateContent` call
            // unless we really need `startChat`. 
            // Let's use `startChat` logic for history cases?
            // Actually, simply concatenating history into the "contents" string is often robust enough for simple agents,
            // but let's try to map it to `Content` objects if possible.
            
            // Simplified approach for Google SDK (Stateless):
            // System instruction is separate.
            // History is manually managed in the prompt context? 
            // No, Google SDK supports `systemInstruction`.
            
            // Let's stick to the prompt engineering approach for history to keep it simple across both:
            // "Here is the history:\nUser:...\nAssistant:..."
            
            // Wait, the prompt requirements say "Use ai.models.generateContent".
            // Let's construct a Chat session if history exists? No, the requirement is generateContent.
            // We will format the history into the prompt string.
            
            let fullPrompt = "";
            req.history.forEach(h => {
                fullPrompt += `${h.role === 'user' ? 'User' : 'Model'}: ${h.content}\n`;
            });
            if (req.userPrompt) {
                fullPrompt += `User: ${req.userPrompt}\n`;
            }
            contents = fullPrompt.trim();
            
            // If history is empty but userPrompt exists
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
            return res.text || "";
        } catch (e) {
             console.error("Google GenAI Call Failed", e);
             throw e;
        }
    }
};

// --- Supervisor Agent (Structure Design) ---
export const chatWithSupervisor = async (
  history: ChatMessage[], 
  thesisTitle: string,
  currentStructure: any,
  settings: ApiSettings
): Promise<{ reply: string, updatedStructure?: any }> => {
  const historyText = history.slice(0, -1).map(h => `${h.role}: ${h.content}`).join("\n");
  const lastMsg = history[history.length - 1];

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
  `;

  try {
    const text = await generateContentUnified(settings, {
        systemPrompt,
        userPrompt: lastMsg.content, // Pass only the new message as prompt, history is context? 
        // Logic fix: generateContentUnified for Google combines history. 
        // For OpenAI, we need explicit history array.
        history: history.slice(0, -1),
        jsonMode: true
    });
    return JSON.parse(cleanJsonText(text) || "{}");
  } catch (e) {
    console.error(e);
    return { reply: `（系统提示：API调用失败 - ${e instanceof Error ? e.message : '未知错误'}）` };
  }
};

// --- Methodology Supervisor Agent ---
export const chatWithMethodologySupervisor = async (
  history: ChatMessage[],
  thesisTitle: string,
  chapter: Chapter,
  settings: ApiSettings
): Promise<{ reply: string, finalizedMetadata?: InterviewData }> => {
  
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
  const lastMsg = history[history.length - 1];

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

// --- Single Section Writer ---

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
  const { thesisTitle, chapterLevel1, targetSection, userInstructions, settings, discussionHistory } = ctx;

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
       - 插入公式：[[EQ:公式内容]]
       - 插入引用：[[REF:引用ID]] (例如: [[REF:1]])
       - **绝对禁止**使用 Markdown 图片或表格语法。
    3. **段落**：普通文本段落之间用换行符分隔即可。不要使用 XML/HTML 标签。
    4. **字数**：300-800 字。

    请开始撰写：
  `;

  try {
    const text = await generateContentUnified(settings, {
        systemPrompt,
        userPrompt: "请开始撰写本小节内容",
        jsonMode: false
    });
    return cleanMarkdownArtifacts(text);
  } catch (e) {
    console.error(e);
    throw new Error(`撰写失败: ${e instanceof Error ? e.message : '未知错误'}`);
  }
};

// --- Post-Processing Agents ---

export const runPostProcessingAgents = async (
  fullChapterText: string,
  settings: ApiSettings
): Promise<{
    polishedText: string;
    newReferences: Reference[];
    newTerms: TechnicalTerm[];
}> => {
   
   const systemPrompt = `
     You are a Quality Assurance Agent Cluster.
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

   const userPrompt = `Input Text (Raw Content):\n${fullChapterText.slice(0, 15000)}`;

   try {
     const text = await generateContentUnified(settings, {
         systemPrompt,
         userPrompt,
         jsonMode: true
     });
     
     const result = JSON.parse(cleanJsonText(text) || "{}");
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
   return rawContent;
};
