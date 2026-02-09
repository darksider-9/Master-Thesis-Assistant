
import { GoogleGenAI } from "@google/genai";
import { Chapter, FormatRules, TechnicalTerm, Reference, ChatMessage, InterviewData, ApiSettings, ThesisStructure } from "../types";

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
       - 插入引用：**关键**：请明确包含引用文献的关键词或描述，以便后续索引。格式：[[REF:描述或关键词]]。
         例如: "根据文献 [[REF:U-Net original paper, keywords: CT unet]] 的方法..." 或 "相关研究表明 [[REF:ResNet]] ..."。
       - **绝对禁止**使用 Markdown 图片或表格语法。
    3. **段落**：普通文本段落之间用换行符分隔即可。不要使用 XML/HTML 标签。
    4. **禁止使用 Markdown 列表符号**：请直接使用文本描述，或用"首先，... 其次，..."来表达列表逻辑，不要使用 "* Item" 或 "- Item" 格式。

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
    chapters.forEach(c => {
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
      3. EXTRACT ONLY true domain-specific terms (e.g., "Convolutional Neural Networks (CNN)", "Cone Beam CT (CBCT)").
      
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
      You are a Technical Thesis Editor.
      Your task is to REWRITE the provided text to strictly adhere to the terminology consistency rules provided.
      
      RULES:
      1. Keep the original meaning, style, and length EXACTLY the same.
      2. ONLY modify the technical terms as requested in the instructions.
      3. Ensure the text flows naturally after modification.
      4. Preserve all special placeholders like [[FIG:...]], [[REF:...]], [[EQ:...]].
      
      INSTRUCTIONS:
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
   const finalRefOrder: Reference[] = [];
   let nextId = 1;

   const processBlock = (content: string): string => {
       if (!content) return "";
       let txt = cleanMarkdownArtifacts(content);

       // Space & Newline handling
       const parts = txt.split(/(\[\[EQ:.*?\]\])/g);
       txt = parts.map(part => {
           if (part.startsWith('[[EQ:')) return part; 
           let s = part.replace(/ {2,}/g, '\n'); 
           s = s.replace(/[ \t\r\f\v]+/g, ''); 
           return s;
       }).join('');
       
       // Ref Indexing
       // Replaces placeholder [[REF:desc]] with [[REF:1]] (new structure) instead of plain [1]
       return txt.replace(/(\[\[REF:(.*?)\]\]|\[(\d+)\])/g, (match, pFull, pDesc, pId) => {
            let description = "";
            if (pDesc) description = pDesc.trim();
            else if (pId) {
                const oldRef = globalReferences.find(r => r.id === parseInt(pId));
                if (oldRef) description = oldRef.description;
                else return match;
            }
            if (!description) return match;

            let assignedId = 0;
            const existingIdx = finalRefOrder.findIndex(r => r.description === description || r.description.includes(description) || description.includes(r.description));
            
            if (existingIdx !== -1) {
                assignedId = finalRefOrder[existingIdx].id;
            } else {
                assignedId = nextId++;
                finalRefOrder.push({ id: assignedId, description, placeholder: match });
            }
            // IMPORTANT CHANGE: Return [[REF:ID]] so XML parser detects it as a reference, not plain text.
            return `[[REF:${assignedId}]]`;
       });
   };

   // Critical: We must run this over ALL chapters to re-index correctly
   // because inserting a reference in Chapter 1 shifts IDs in Chapter 2
   if (onLog) onLog("正在全书重排参考文献顺序...");
   
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
