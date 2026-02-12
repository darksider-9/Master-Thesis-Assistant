
import React, { useState, useRef, useEffect } from 'react';
import { ThesisStructure, Chapter, FormatRules, Reference, AgentLog, ApiSettings, SectionPlan, SearchProvider, SearchResult, SearchHistoryItem, CitationStyle, SkeletonBlock } from '../types';
import { writeSingleSection, writeSingleSectionQuickMode, runPostProcessingAgents, generateSkeletonPlan, polishDraftContent, finalizeAcademicStyle, filterSearchResultsAI } from '../services/geminiService';
import { searchAcademicPapers, fetchDetailedRefMetadata } from '../services/searchService';
import { generateContextEntry, formatCitation } from '../utils/citationFormatter';
import SearchHistoryModal from './SearchHistoryModal';

interface WritingDashboardProps {
  thesis: ThesisStructure;
  setThesis: React.Dispatch<React.SetStateAction<ThesisStructure>>;
  formatRules: FormatRules;
  references: Reference[];
  setReferences: React.Dispatch<React.SetStateAction<Reference[]>>;
  apiSettings: ApiSettings;
  setApiSettings?: React.Dispatch<React.SetStateAction<ApiSettings>>; // New: Allow updating settings
  agentLogs: AgentLog[];
  addLog: (agent: AgentLog['agentName'], message: string, status?: AgentLog['status']) => void;
  // New props for persistence
  searchHistory: SearchHistoryItem[];
  setSearchHistory: React.Dispatch<React.SetStateAction<SearchHistoryItem[]>>;
}

interface FlattenedNode {
  chapter: Chapter;
  parentId: string | null;
  depth: number;
  label: string; 
  chapterIndex: number; // Added to track which L1 chapter this belongs to
}

// Updated Flatten to track Chapter Index
const flattenChapters = (chapters: Chapter[], parentLabel: string = "", depth: number = 0, rootIndex: number = 0): FlattenedNode[] => {
  let nodes: FlattenedNode[] = [];
  chapters.forEach((ch, idx) => {
    // If depth is 0, this IS the root chapter, so its index is idx + 1
    // If depth > 0, we inherit the rootIndex passed down
    const currentRootIndex = depth === 0 ? idx + 1 : rootIndex;
    
    const currentLabel = parentLabel ? `${parentLabel}.${idx + 1}` : `${idx + 1}`;
    nodes.push({
      chapter: ch,
      parentId: null,
      depth,
      label: currentLabel,
      chapterIndex: currentRootIndex
    });
    if (ch.subsections) {
      nodes = [...nodes, ...flattenChapters(ch.subsections, currentLabel, depth + 1, currentRootIndex)];
    }
  });
  return nodes;
};

const WritingDashboard: React.FC<WritingDashboardProps> = ({ thesis, setThesis, formatRules, references, setReferences, apiSettings, setApiSettings, agentLogs, addLog, searchHistory, setSearchHistory }) => {
  const level1Chapters = thesis.chapters.filter(c => c.level === 1);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(level1Chapters[0]?.id || null);
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});
  const [isPostProcessing, setIsPostProcessing] = useState(false);
  const [isAddingRef, setIsAddingRef] = useState(false);
  
  // User Inputs
  const [instructions, setInstructions] = useState<Record<string, string>>({}); 
  const [refTemplates, setRefTemplates] = useState<Record<string, string>>({}); 
  const [targetWordCounts, setTargetWordCounts] = useState<Record<string, number>>({}); // node_id -> word count constraint
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Advanced Mode States
  const [advancedMode, setAdvancedMode] = useState(false);
  const [plans, setPlans] = useState<Record<string, SectionPlan>>({});
  const [referenceInputs, setReferenceInputs] = useState<Record<string, string>>({}); // block_id -> context
  
  // Search UI States - Modified to use global settings or default
  // Note: We access apiSettings directly. If setApiSettings is missing, it's read-only.
  const searchProvider = apiSettings.searchProvider || 'none';
  const searchApiKey = apiSettings.searchApiKey || '';

  const [activeSearchQueries, setActiveSearchQueries] = useState<Record<string, string>>({}); // block_id -> input box value
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('GB/T 7714');
  
  const [blockSearchResults, setBlockSearchResults] = useState<Record<string, SearchResult[]>>({});
  const [searchingBlockId, setSearchingBlockId] = useState<string | null>(null);
  
  // History Modal State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  
  // Auto Pilot State
  const [isAutoPiloting, setIsAutoPiloting] = useState(false);

  // Global Terms Registry (In-memory for session)
  const [globalTerms, setGlobalTerms] = useState<any[]>([]);

  const selectedChapter = thesis.chapters.find(c => c.id === selectedChapterId);
  // Calculate index of selected chapter in the whole thesis for numbering
  const selectedChapterIndex = thesis.chapters.findIndex(c => c.id === selectedChapterId) + 1;
  
  const nodes = selectedChapter ? flattenChapters([selectedChapter], `${selectedChapterIndex}`, 0, selectedChapterIndex) : [];
  
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  // Helper to update global search settings
  const handleUpdateSearchSettings = (provider?: string, key?: string) => {
      if (!setApiSettings) return;
      setApiSettings(prev => ({
          ...prev,
          searchProvider: provider !== undefined ? provider : prev.searchProvider,
          searchApiKey: key !== undefined ? key : prev.searchApiKey
      }));
  };

  const updateNodeContent = (chapters: Chapter[], targetId: string, content: string): Chapter[] => {
    return chapters.map(ch => {
      if (ch.id === targetId) {
        return { ...ch, content, status: 'completed' };
      }
      if (ch.subsections) {
        return { ...ch, subsections: updateNodeContent(ch.subsections, targetId, content) };
      }
      return ch;
    });
  };

  const handleSearchInput = (blockId: string, value: string) => {
      setActiveSearchQueries(prev => ({ ...prev, [blockId]: value }));
  };

  const handleBlockSearch = async (blockId: string) => {
      const query = activeSearchQueries[blockId];
      if (searchProvider === 'none' || !searchProvider) {
          alert("请先在上方选择一个搜索源 (如 Semantic Scholar 或 ArXiv)");
          return;
      }
      if (!query || query.trim() === '') {
          alert("请输入搜索关键词");
          return;
      }

      setSearchingBlockId(blockId);
      addLog('Searcher', `正在通过 ${searchProvider} 搜索: "${query}"...`, 'processing');

      try {
          // Cast provider string to Enum safely
          const providerEnum = searchProvider as SearchProvider;
          const results = await searchAcademicPapers(query, providerEnum, searchApiKey);
          setBlockSearchResults(prev => ({ ...prev, [blockId]: results }));
          
          // Persist to History
          const historyItem: SearchHistoryItem = {
              id: Date.now().toString(),
              timestamp: Date.now(),
              query: query,
              provider: providerEnum,
              results: results,
              blockId: blockId
          };
          setSearchHistory(prev => [...prev, historyItem]);

          addLog('Searcher', `找到 ${results.length} 篇相关文献 (已存入历史)`, 'success');
      } catch (e) {
          addLog('Searcher', `搜索失败: ${e}`, 'error');
      } finally {
          setSearchingBlockId(null);
      }
  };

  const addCitationToContext = async (blockId: string, result: SearchResult) => {
      if (isAddingRef) return;
      setIsAddingRef(true);
      const existingText = referenceInputs[blockId] || "";
      
      // 1. Check if strictly homologous (same source title) in global references
      let existingRef = references.find(r => 
        r.description.includes(result.title) || result.title.includes(r.description)
      );

      // 2. IMPORTANT: If not found, register it. 
      // NEW: Fetch Detailed Metadata first!
      if (!existingRef) {
          addLog('Reference', `正在通过 Crossref 补全 "${result.title}" 的详细元数据...`, 'processing');
          
          let meta = await fetchDetailedRefMetadata(result.title);
          
          // Fallback if Crossref fails, use basic info from SearchResult
          if (!meta) {
              addLog('Reference', `Crossref 未找到匹配，使用基础信息回退。`, 'warning');
              meta = {
                  title: result.title,
                  authors: result.authors,
                  year: result.year,
                  journal: result.venue
              };
          }

          const formattedDesc = formatCitation(result, citationStyle); // Initial format for display
          const newId = references.length > 0 ? Math.max(...references.map(r => r.id)) + 1 : 1;
          
          const newRef: Reference = {
              id: newId,
              description: formattedDesc,
              metadata: meta // Store structured data
          };
          
          setReferences(prev => [...prev, newRef]);
          existingRef = newRef;
          addLog('Reference', `已存入文献 [${newId}] (包含结构化元数据)`, 'success');
      }

      // 3. Update the Context Textbox with the entry (showing ID for reuse)
      const citationEntry = generateContextEntry(result, citationStyle, existingRef.id);

      setReferenceInputs(prev => ({
          ...prev,
          [blockId]: existingText + citationEntry
      }));
      setIsAddingRef(false);
  };

  // --- AUTO PILOT HANDLER ---
  const handleAutoPilotChapter = async () => {
      if (!selectedChapter || !apiSettings.apiKey) {
          alert("请先配置 API Key");
          return;
      }
      
      setIsAutoPiloting(true);
      addLog('Supervisor', `启动全章自动化探索与撰写流程...`, 'processing');

      // Filter nodes: Only process L2/L3 nodes (leaf nodes effectively) that haven't been written
      // OR prioritize nodes where user has added instructions/templates.
      // For simplicity in this robust "Batch" mode, we process all leaf nodes in order.
      const leafNodes = nodes.filter(n => (n.chapter.subsections === undefined || n.chapter.subsections.length === 0));
      
      try {
          // Iterate sequentially
          for (const node of leafNodes) {
              const nodeId = node.chapter.id;
              
              addLog('Planner', `[Auto-Pilot] 正在处理: ${node.label} ${node.chapter.title}`, 'processing');
              setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));

              // 1. Generate Skeleton
              // Use existing inputs if any, otherwise default
              const response = await generateSkeletonPlan(
                  thesis.title, 
                  node.chapter,
                  selectedChapter?.chatHistory, 
                  refTemplates[nodeId],         
                  instructions[nodeId],         
                  apiSettings
              );

              if (!response.section_plans || response.section_plans.length === 0) {
                   addLog('Planner', `[Auto-Pilot] 骨架生成失败，跳过此节`, 'error');
                   setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
                   continue;
              }

              const plan = response.section_plans[0];
              // Unique Block IDs
              const uniqueBlocks = plan.skeleton_blocks.map((b, idx) => ({
                 ...b,
                 block_id: `${nodeId}_blk_${idx + 1}`
              }));
              
              // Store plan in state (visual feedback)
              setPlans(prev => ({ ...prev, [nodeId]: { ...plan, skeleton_blocks: uniqueBlocks } }));

              // 2. Search & Filter & Context Assembly
              let combinedContext = "";

              for (const block of uniqueBlocks) {
                  // Decision: To search or not?
                  // Heuristic: If KeywordsZH exist, try search.
                  const shouldSearch = block.slots.KeywordsZH && block.slots.KeywordsZH.length > 0;

                  if (shouldSearch) {
                       const query = block.slots.KeywordsZH![0]; // Use first recommended query set
                       addLog('Searcher', `[Auto-Pilot] 正在多源检索逻辑块 "${block.slots.Claim.slice(0,15)}...": ${query}`, 'processing');
                       
                       // STRATEGY: Call ALL available APIs in parallel
                       // 1. Semantic Scholar (Free or Key)
                       // 2. OpenAlex (Free)
                       // 3. ArXiv (Free)
                       // 4. Crossref (Free)
                       // 5. Serper (Only if explicitly enabled via key in current settings?) -> Let's assume user wants broad coverage.
                       //    If ApiSettings has a valid 'serper' key (hard to know if the key is serper or S2 if they share one field, 
                       //    but user "selected" provider in UI. 
                       //    To be safe and robust: We always try the FREE/Public ones.
                       //    We try Semantic Scholar (works without key too).
                       //    We SKIP Serper unless it's the currently selected provider with a key, to avoid auth errors.
                       
                       const providersToTry: SearchProvider[] = ['open_alex', 'arxiv', 'crossref', 'semantic_scholar'];
                       
                       // If current setting is serper and key exists, try it too.
                       if (searchProvider === 'serper' && searchApiKey) {
                           providersToTry.push('serper');
                       }

                       try {
                           // Parallel Fetch
                           const resultsPromises = providersToTry.map(p => {
                               // Use key only if provider matches current settings
                               const keyToUse = (p === searchProvider || (p === 'semantic_scholar' && searchProvider === 'semantic_scholar')) ? searchApiKey : undefined;
                               return searchAcademicPapers(query, p, keyToUse).catch(e => {
                                   console.warn(`Provider ${p} failed`, e);
                                   return [] as SearchResult[];
                               });
                           });

                           const resultsArrays = await Promise.all(resultsPromises);
                           let aggregatedResults = resultsArrays.flat();
                           
                           // Deduplicate (Simple title match)
                           const seenTitles = new Set();
                           aggregatedResults = aggregatedResults.filter(r => {
                               const normTitle = r.title.toLowerCase().replace(/\s+/g, '');
                               if (seenTitles.has(normTitle)) return false;
                               seenTitles.add(normTitle);
                               return true;
                           });

                           if (aggregatedResults.length > 0) {
                               addLog('Searcher', `[Auto-Pilot] 汇总检索到 ${aggregatedResults.length} 篇文献，正在进行 AI 智能筛选...`, 'processing');
                               
                               // 3. AI Filter
                               const selectedIds = await filterSearchResultsAI(block.slots.Claim, aggregatedResults, apiSettings);
                               
                               if (selectedIds.length > 0) {
                                   addLog('Searcher', `[Auto-Pilot] AI 选中 ${selectedIds.length} 篇高相关文献`, 'success');
                                   
                                   const selectedPapers = aggregatedResults.filter(r => selectedIds.includes(r.id));
                                   
                                   // Add to Global Refs & Context
                                   for (const paper of selectedPapers) {
                                       // Check/Add to Global
                                       let existingRef = references.find(r => 
                                            r.description.includes(paper.title) || paper.title.includes(r.description)
                                       );
                                       if (!existingRef) {
                                            // Quick format (skip detailed crossref for speed in loop)
                                            const formattedDesc = formatCitation(paper, citationStyle);
                                            const newId = references.length > 0 ? Math.max(...references.map(r => r.id)) + 1 : 1;
                                            const newRef: Reference = {
                                                id: newId,
                                                description: formattedDesc,
                                                metadata: { // Basic metadata
                                                    title: paper.title,
                                                    authors: paper.authors,
                                                    year: paper.year,
                                                    journal: paper.venue
                                                }
                                            };
                                            // NOTE: references state inside a loop won't update immediately.
                                            // We append context manually.
                                            combinedContext += `[Ref Candidates] Title: ${paper.title}. Abstract: ${paper.abstract}\n`;
                                       } else {
                                            combinedContext += `[Ref Existing ID:${existingRef.id}] Title: ${paper.title}\n`;
                                       }
                                   }
                               } else {
                                   addLog('Searcher', `[Auto-Pilot] AI 判定无相关文献，跳过引用`, 'warning');
                               }
                           }
                       } catch (e) {
                           console.error(e);
                       }
                  }
              }

              // 4. Write Section
              addLog('Writer', `[Auto-Pilot] 正在撰写正文...`, 'processing');
              
              // Construct Instruction
              let constructedInstruction = `【严格遵循以下逻辑骨架进行撰写】\n\n写作蓝图: ${plan.writing_blueprint?.section_flow || "按顺序撰写"}\n\n`;
              plan.skeleton_blocks.forEach((block, idx) => {
                 constructedInstruction += `[BLOCK ${idx + 1}: ${block.move}]\n- Claim: ${block.slots.Claim}\n- Style: ${block.style_notes}\n`;
              });
              
              if (combinedContext) {
                  constructedInstruction += `\n【自动检索到的相关文献素材 (Global Search)】\n${combinedContext}\n请根据Claim合理选用，若素材不足则进行理论推演。`;
              }
              if (instructions[nodeId]) {
                  constructedInstruction += `\n【用户额外指令】\n${instructions[nodeId]}`;
              }

              // Draft (Using Advanced Mode Writer for Auto-Pilot as it uses Search Context)
              let content = await writeSingleSection({
                thesisTitle: thesis.title,
                chapterLevel1: selectedChapter,
                targetSection: node.chapter,
                userInstructions: constructedInstruction,
                formatRules,
                globalRefs: references, // Note: Stale references might be an issue if we added new ones. Auto-Pilot relies on post-process to fix IDs.
                settings: apiSettings,
                discussionHistory: selectedChapter.chatHistory, 
                fullChapterTree: thesis.chapters,
                targetWordCount: targetWordCounts[nodeId] || 800,
                chapterIndex: node.chapterIndex
              });

              // Polish & Finalize
              content = await polishDraftContent(content, node.chapterIndex, apiSettings);
              content = await finalizeAcademicStyle(content, node.chapterIndex, apiSettings);
              content = content.replace(/\n\s*(\[\[(?:SYM|REF):)/g, ' $1').replace(/(\]\])\s*\n/g, '$1 ');

              // Update Thesis State (One by one to show progress)
              setThesis(prev => ({
                ...prev,
                chapters: updateNodeContent(prev.chapters, nodeId, content)
              }));
              
              setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
              addLog('Writer', `[Auto-Pilot] ✅ ${node.label} 撰写完成`, 'success');
              
              // Small delay to prevent API rate limits if necessary
              await new Promise(r => setTimeout(r, 1000)); 
          }
          
          addLog('Supervisor', `🎉 全章自动化撰写流程结束！请进行人工审阅或点击“完成本章”进行最终校验。`, 'success');
          
      } catch (e) {
          addLog('Supervisor', `Auto-Pilot 异常中断: ${e}`, 'error');
      } finally {
          setIsAutoPiloting(false);
      }
  };
  
  // --- ADVANCED MODE HANDLERS ---
  const handleGeneratePlan = async (node: FlattenedNode) => {
     const nodeId = node.chapter.id;
     setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
     addLog('Planner', `正在分析 ${node.label} 逻辑骨架 (结合核心探讨与范文)...`, 'processing');
     
     try {
         const response = await generateSkeletonPlan(
             thesis.title, 
             node.chapter,
             selectedChapter?.chatHistory, 
             refTemplates[nodeId],         
             instructions[nodeId],         
             apiSettings
         );

         if (response.section_plans && response.section_plans.length > 0) {
             // Prefix Block IDs with Chapter ID to prevent scope pollution/collision
             const plan = response.section_plans[0];
             const uniqueBlocks = plan.skeleton_blocks.map((b, idx) => ({
                 ...b,
                 block_id: `${nodeId}_blk_${idx + 1}`
             }));
             
             setPlans(prev => ({ 
                 ...prev, 
                 [nodeId]: { ...plan, skeleton_blocks: uniqueBlocks } 
             }));
             addLog('Planner', `✅ 骨架提取成功，生成 ${uniqueBlocks.length} 个逻辑块`, 'success');
         } else {
             throw new Error("API 返回了空计划");
         }
     } catch (e) {
         addLog('Planner', `❌ 计划生成失败: ${e}`, 'error');
         console.error(e);
     } finally {
         setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
     }
  };

  const handleUpdateBlockSlot = (nodeId: string, blockIndex: number, field: string, value: string) => {
      setPlans(prev => {
          const plan = prev[nodeId];
          if (!plan) return prev;
          const newBlocks = [...plan.skeleton_blocks];
          newBlocks[blockIndex] = {
              ...newBlocks[blockIndex],
              slots: {
                  ...newBlocks[blockIndex].slots,
                  [field]: value
              }
          };
          return { ...prev, [nodeId]: { ...plan, skeleton_blocks: newBlocks } };
      });
  };

  const handleDeleteBlock = (nodeId: string, blockIndex: number) => {
      setPlans(prev => {
          const plan = prev[nodeId];
          if (!plan) return prev;
          const newBlocks = plan.skeleton_blocks.filter((_, i) => i !== blockIndex);
          return { ...prev, [nodeId]: { ...plan, skeleton_blocks: newBlocks } };
      });
  };

  const handleAddBlock = (nodeId: string) => {
      setPlans(prev => {
          const plan = prev[nodeId];
          if (!plan) return prev;
          const newBlock: SkeletonBlock = {
              block_id: `${nodeId}_manual_${Date.now()}`,
              move: "Manual-Addition",
              slots: { Claim: "新论点...", Evidence: [], KeywordsZH: [], KeywordsEN: [] },
              style_notes: "自定义"
          };
          return { ...prev, [nodeId]: { ...plan, skeleton_blocks: [...plan.skeleton_blocks, newBlock] } };
      });
  };

  const handleWriteWithPlan = async (node: FlattenedNode) => {
      if (!selectedChapter || !apiSettings.apiKey) {
        alert("请检查 API Key 配置");
        return;
      }
      
      const nodeId = node.chapter.id;
      const plan = plans[nodeId];
      if (!plan) return;

      setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
      addLog('Writer', `Step 1/3: 正在基于骨架撰写: ${node.label}...`, 'processing');

      let constructedInstruction = `【严格遵循以下逻辑骨架进行撰写】\n\n写作蓝图: ${plan.writing_blueprint?.section_flow || "按顺序撰写"}\n\n`;
      
      plan.skeleton_blocks.forEach((block, idx) => {
          const userRefContent = referenceInputs[block.block_id] || "";
          constructedInstruction += `[BLOCK ${idx + 1}: ${block.move}]\n`;
          constructedInstruction += `- 核心主张 (Claim): ${block.slots.Claim}\n`;
          constructedInstruction += `- 写作风格: ${block.style_notes || "学术中立"}\n`;
          if (userRefContent) {
              constructedInstruction += `- 【重要】已提供的真实文献素材(Context): \n${userRefContent}\n`;
              constructedInstruction += `- 指令: 请务必综合上述素材，并适当添加引用标记(如[1])。\n`;
          } else if (block.slots.Evidence && block.slots.Evidence.length > 0) {
              constructedInstruction += `- (本段暂无外部文献，请根据Claim进行理论推演或使用通用知识，若必须引用则标注TODO)\n`;
          }
          constructedInstruction += `\n`;
      });
      
      if (instructions[nodeId]) {
          constructedInstruction += `\n【额外用户指令】\n${instructions[nodeId]}`;
      }

      try {
          // STEP 1: Draft
          let content = await writeSingleSection({
            thesisTitle: thesis.title,
            chapterLevel1: selectedChapter,
            targetSection: node.chapter,
            userInstructions: constructedInstruction,
            formatRules,
            globalRefs: references,
            settings: apiSettings,
            discussionHistory: selectedChapter.chatHistory, 
            fullChapterTree: thesis.chapters,
            targetWordCount: targetWordCounts[nodeId] || 800,
            chapterIndex: node.chapterIndex // Pass index for numbering
          });

          // STEP 2: Logic Polish (With real-time numbering)
          addLog('Fixer', `Step 2/3: 逻辑润色与图表编号渲染...`, 'processing');
          content = await polishDraftContent(content, node.chapterIndex, apiSettings);

          // STEP 3: Style Finalize
          addLog('Writer', `Step 3/3: 最终去AI味与格式定稿...`, 'processing');
          content = await finalizeAcademicStyle(content, node.chapterIndex, apiSettings);

          content = content
            .replace(/\n\s*(\[\[(?:SYM|REF):)/g, ' $1')
            .replace(/(\]\])\s*\n/g, '$1 ');

          setThesis(prev => ({
            ...prev,
            chapters: updateNodeContent(prev.chapters, nodeId, content)
          }));

          addLog('Writer', `✅ ${node.label} 全流程撰写完成 (自动编号已渲染)`, 'success');

      } catch (e) {
          addLog('Writer', `❌ ${node.label} 撰写失败: ${e}`, 'warning');
      } finally {
          setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
      }
  };


  // --- SIMPLE MODE HANDLER (UPDATED TO USE QUICK MODE PROMPT) ---
  const handleWriteSection = async (node: FlattenedNode) => {
    if (!selectedChapter || !apiSettings.apiKey) {
        alert("请检查 API Key 配置");
        return;
    }
    
    const nodeId = node.chapter.id;
    setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
    addLog('Writer', `Step 1/3: 正在快速撰写: ${node.label} ${node.chapter.title} (Quick Mode)...`, 'processing');

    try {
      const userInstruction = instructions[nodeId] || "";
      
      // STEP 1: Draft using Quick Mode Prompt
      // This allows the model to generate "hallucinated" reference placeholders like [[REF:Author Year Keywords]]
      // It also checks globalRefs for strict ID reuse.
      let content = await writeSingleSectionQuickMode({
        thesisTitle: thesis.title,
        chapterLevel1: selectedChapter,
        targetSection: node.chapter,
        userInstructions: userInstruction,
        formatRules,
        globalRefs: references,
        settings: apiSettings,
        discussionHistory: selectedChapter.chatHistory, 
        fullChapterTree: thesis.chapters,
        targetWordCount: targetWordCounts[nodeId] || 800,
        chapterIndex: node.chapterIndex // Pass index for numbering
      });

      // STEP 2: Logic Polish
      addLog('Fixer', `Step 2/3: 逻辑润色与图表编号渲染...`, 'processing');
      content = await polishDraftContent(content, node.chapterIndex, apiSettings);

      // STEP 3: Style Finalize
      addLog('Writer', `Step 3/3: 最终去AI味与格式定稿...`, 'processing');
      content = await finalizeAcademicStyle(content, node.chapterIndex, apiSettings);

      content = content
        .replace(/\n\s*(\[\[(?:SYM|REF):)/g, ' $1')
        .replace(/(\]\])\s*\n/g, '$1 ');

      setThesis(prev => ({
        ...prev,
        chapters: updateNodeContent(prev.chapters, nodeId, content)
      }));

      addLog('Writer', `✅ ${node.label} 快速撰写完成 (已生成关键词引用占位)`, 'success');

    } catch (e) {
      addLog('Writer', `❌ ${node.label} 失败: ${e}`, 'warning');
      console.error(e);
    } finally {
      setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
    }
  };

  const handleCompleteChapter = async () => {
    if (!selectedChapter) return;
    setIsPostProcessing(true);
    addLog('Supervisor', '启动章节智能校验 (AI术语识别/全局一致性/参考文献)...', 'processing');

    const allContent = nodes.map(n => n.chapter.content || "").join("\n\n");
    if (!allContent.trim()) {
        addLog('Supervisor', '章节内容为空，无法处理', 'warning');
        setIsPostProcessing(false);
        return;
    }

    try {
        const result = await runPostProcessingAgents({
            fullText: allContent, 
            chapterId: selectedChapter.id,
            allChapters: thesis.chapters,
            globalReferences: references,
            globalTerms: globalTerms,
            settings: apiSettings,
            onLog: (msg) => addLog('TermChecker', msg, 'processing')
        });

        setThesis(prev => ({ ...prev, chapters: result.updatedChapters }));
        setReferences(result.updatedReferences);
        if (result.updatedReferences.length > references.length) {
            addLog('Reference', `库更新: ${result.updatedReferences.length} 条 (新增 ${result.updatedReferences.length - references.length})`, 'success');
        } else {
             addLog('Reference', `库同步完成: 当前共 ${result.updatedReferences.length} 条`, 'success');
        }

        setGlobalTerms(result.updatedTerms);
        if (result.updatedTerms.length > globalTerms.length) {
            addLog('TermChecker', `知识库更新: 发现新术语 ${result.updatedTerms.length - globalTerms.length} 个`, 'success');
        }

        addLog('Fixer', '章节校验与优化完成', 'success');

    } catch (e) {
        addLog('Supervisor', `处理失败: ${e}`, 'warning');
        console.error(e);
    } finally {
        setIsPostProcessing(false);
    }
  };

  const renderPreviewContent = (content: string) => {
     if (!content) return null;
     const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
     return paragraphs.map((paragraph, i) => {
         const trimmed = paragraph.trim();
         if (trimmed.startsWith("[[FIG:")) {
             // Clean up ID attribute if present for display
             const desc = trimmed.replace("[[FIG:", "").replace("]]", "").split('|')[0];
             return (
               <div key={i} className="my-2 p-3 bg-blue-50 border border-blue-100 rounded text-center shadow-sm">
                  <div className="w-20 h-20 bg-blue-100 mx-auto mb-2 flex items-center justify-center text-blue-400 rounded">IMG</div>
                  <div className="text-xs font-bold text-blue-600">图 [自动编号]: {desc}</div>
               </div>
             );
         }
         if (trimmed.startsWith("[[TBL:")) {
             const desc = trimmed.replace("[[TBL:", "").replace("]]", "").split('|')[0];
             return (
               <div key={i} className="my-2 p-3 bg-green-50 border border-green-100 rounded text-center shadow-sm">
                  <div className="text-xs font-bold text-green-600 mb-1">表 [自动编号]: {desc}</div>
                  <div className="grid grid-cols-3 gap-1 opacity-50 text-[10px] w-1/2 mx-auto">
                     <div className="bg-green-200 h-4"></div><div className="bg-green-200 h-4"></div><div className="bg-green-200 h-4"></div>
                     <div className="bg-white border h-4"></div><div className="bg-white border h-4"></div><div className="bg-white border h-4"></div>
                  </div>
               </div>
             );
         }
         if (trimmed.startsWith("[[EQ:")) {
            const eqText = trimmed.replace("[[EQ:", "").replace("]]", "");
            return (
              <div key={i} className="my-2 p-3 bg-slate-50 border border-slate-200 rounded text-center font-mono text-xs">
                 {eqText}
                 <div className="text-[10px] text-slate-400 mt-1">(公式 [自动编号])</div>
              </div>
            );
         }
         return (
            <p key={i} className="text-sm text-slate-700 leading-relaxed mb-2 indent-8 text-justify">
               {paragraph}
            </p>
         );
     });
  };

  if (!selectedChapter) return <div>请选择章节</div>;

  return (
    <div className="flex h-full gap-6">
      <SearchHistoryModal 
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
          history={searchHistory}
          onCite={(res) => {
              // Note: Searching history doesn't inherently know which block requested it unless we tracked it.
              // For simplicity, we just alert the user to copy/paste or we could track context.
              // The modal is mostly for viewing. To strictly support cite-back, we'd need to know the 'active' block.
              // Given the UI structure, let's copy the citation to clipboard as a fallback.
              const text = generateContextEntry(res, citationStyle);
              navigator.clipboard.writeText(text).then(() => alert("引用内容已复制到剪贴板，请粘贴到对应段落的 Context 框中。"));
          }}
      />

      <div className="w-60 bg-white rounded-xl border shadow-sm flex flex-col overflow-hidden shrink-0">
        <div className="p-4 bg-slate-50 border-b font-bold text-slate-700">章节目录</div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {level1Chapters.map(ch => (
             <div key={ch.id}>
                <button
                  onClick={() => setSelectedChapterId(ch.id)}
                  className={`w-full text-left p-3 rounded-lg text-sm transition-all border ${
                    selectedChapterId === ch.id 
                      ? 'bg-blue-600 text-white shadow-md border-blue-600' 
                      : 'bg-white hover:bg-slate-50 text-slate-600 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-medium">{ch.title}</span>
                  </div>
                </button>
             </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="min-h-14 bg-white rounded-xl border shadow-sm flex flex-col justify-center px-6 py-3 shrink-0 gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
                <h2 className="font-bold text-lg text-slate-800 truncate">
                    智能撰写工作台 - {selectedChapter.title}
                </h2>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                    onClick={() => setAdvancedMode(false)}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${!advancedMode ? 'bg-white shadow text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                    🚀 快速模式
                    </button>
                    <button 
                    onClick={() => setAdvancedMode(true)}
                    className={`px-3 py-1 rounded text-xs font-bold transition-all ${advancedMode ? 'bg-white shadow text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                    🧬 高级模式 (骨架+搜索)
                    </button>
                </div>
            </div>
            
            <div className="flex items-center gap-3">
                <button 
                    onClick={() => setIsHistoryOpen(true)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border border-slate-200"
                >
                    📜 搜索历史
                </button>
                {advancedMode && (
                  <button 
                      onClick={handleAutoPilotChapter}
                      disabled={isPostProcessing || isAutoPiloting}
                      className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-2 animate-pulse-slow"
                  >
                      {isAutoPiloting ? '⏳ Auto-Pilot 正在全自动运行...' : '⚡️ 启动 Auto-Pilot (全章自动撰写)'}
                  </button>
                )}
                <button 
                    onClick={handleCompleteChapter}
                    disabled={isPostProcessing || isAutoPiloting}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-2"
                >
                    {isPostProcessing ? '正在进行 AI 深度校验...' : '🎉 完成本章 & 校验'}
                </button>
            </div>
          </div>
          
          {/* Advanced Mode: Search Configuration Header */}
          {advancedMode && (
              <div className="flex items-center gap-3 bg-purple-50 p-2 rounded-lg border border-purple-100 animate-fade-in flex-wrap">
                  <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-purple-700 shrink-0">🔍 外部文献源:</span>
                      <select 
                         className="text-xs border border-purple-200 rounded px-2 py-1 outline-none focus:border-purple-400 bg-white"
                         value={searchProvider}
                         onChange={(e) => handleUpdateSearchSettings(e.target.value as string)}
                      >
                          <option value="none">无 (纯AI生成的知识/手动填入)</option>
                          <option value="semantic_scholar">Semantic Scholar (CS/医学推荐)</option>
                          <option value="arxiv">ArXiv (数学/物理/AI推荐)</option>
                          <option value="open_alex">OpenAlex (全学科)</option>
                          <option value="crossref">Crossref (出版物元数据)</option>
                          <option value="serper">Serper (Google Scholar, 需要Key)</option>
                      </select>
                  </div>

                  <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-purple-700 shrink-0">引用格式:</span>
                      <select 
                         className="text-xs border border-purple-200 rounded px-2 py-1 outline-none focus:border-purple-400 bg-white w-24"
                         value={citationStyle}
                         onChange={(e) => setCitationStyle(e.target.value as CitationStyle)}
                      >
                          <option value="GB/T 7714">GB/T 7714</option>
                          <option value="APA">APA</option>
                          <option value="IEEE">IEEE</option>
                          <option value="MLA">MLA</option>
                      </select>
                  </div>
                  
                  {/* Conditional API Key Input or Status Helper */}
                  {(searchProvider === 'semantic_scholar' || searchProvider === 'serper') ? (
                      <input 
                         type="password"
                         className="text-xs border border-purple-200 rounded px-2 py-1 outline-none focus:border-purple-400 bg-white w-32"
                         placeholder={searchProvider === 'serper' ? "输入 Serper Key *" : "S2 API Key (可选)"}
                         value={searchApiKey}
                         onChange={(e) => handleUpdateSearchSettings(undefined, e.target.value)}
                      />
                  ) : (searchProvider === 'open_alex' || searchProvider === 'crossref') ? (
                      <span className="text-xs text-green-600 font-bold bg-green-50 px-2 py-1 rounded border border-green-200 flex items-center gap-1" title="系统已自动配置 polite pool 邮箱，无需您操作">
                          <span>✅</span> 加速开启
                      </span>
                  ) : (searchProvider === 'arxiv') ? (
                      <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded border border-blue-200 flex items-center gap-1">
                          <span>ℹ️</span> 官方公开
                      </span>
                  ) : null}
              </div>
          )}
        </div>

        <div className="flex-1 bg-white rounded-xl border shadow-sm overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
               {selectedChapter.status === 'pending' ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                     <span className="text-5xl mb-4 opacity-50">🔒</span>
                     <p className="font-bold">该章节尚未解锁</p>
                     <p className="text-sm mt-2">请先完成「核心探讨」步骤</p>
                  </div>
               ) : (
                  <div className="space-y-6 max-w-5xl mx-auto">
                    {nodes.map((node) => {
                       const isGenerating = loadingNodes[node.chapter.id];
                       const hasContent = !!node.chapter.content;
                       const plan = plans[node.chapter.id];
                       
                       return (
                         <div key={node.chapter.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all hover:shadow-md">
                            {/* Card Header */}
                            <div className="flex items-center justify-between p-4 bg-white border-b border-slate-50">
                               <div className="flex items-center gap-3">
                                  <span className={`font-mono text-sm font-bold ${
                                     node.depth === 0 ? 'text-blue-600' : 'text-slate-500'
                                  }`}>
                                     {node.label}
                                  </span>
                                  <span className={`font-bold ${
                                     node.depth === 0 ? 'text-lg text-slate-800' : 'text-base text-slate-700'
                                  }`}>
                                     {node.chapter.title}
                                  </span>
                                  {hasContent && <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-bold">已生成</span>}
                               </div>
                               
                               <div className="flex gap-2 items-center">
                                  {/* Word Count Target Input */}
                                  <div className="flex items-center bg-slate-100 rounded px-2 py-1 mr-2 border border-slate-200">
                                      <span className="text-[10px] text-slate-500 mr-1 font-bold">目标字数:</span>
                                      <input 
                                          type="number"
                                          className="w-12 text-xs bg-transparent border-none outline-none text-center font-mono text-blue-600"
                                          placeholder="800"
                                          defaultValue={800}
                                          onChange={(e) => setTargetWordCounts(prev => ({...prev, [node.chapter.id]: parseInt(e.target.value) || 800}))}
                                      />
                                  </div>

                                  {advancedMode ? (
                                      !plan ? (
                                        <button 
                                            onClick={() => handleGeneratePlan(node)}
                                            disabled={isGenerating}
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 transition-colors shadow-sm flex items-center gap-1"
                                        >
                                            {isGenerating ? '分析中...' : '🧬 生成逻辑骨架'}
                                        </button>
                                      ) : (
                                        <div className="text-xs text-purple-600 font-bold bg-purple-50 px-2 py-1 rounded">骨架已就绪</div>
                                      )
                                  ) : (
                                      <button 
                                          onClick={() => handleWriteSection(node)}
                                          disabled={isGenerating}
                                          className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${
                                              hasContent 
                                              ? 'bg-white border border-blue-200 text-blue-600 hover:bg-blue-50'
                                              : 'bg-blue-600 text-white hover:bg-blue-700'
                                          }`}
                                      >
                                          {isGenerating ? (
                                              <span className="animate-spin">⏳</span>
                                          ) : (
                                              hasContent ? '🔄 重新撰写' : '✨ 智能撰写'
                                          )}
                                      </button>
                                  )}
                               </div>
                            </div>

                            {/* Advanced Mode: Skeleton View */}
                            {advancedMode && plan && (
                                <div className="p-4 bg-purple-50/30 border-b border-purple-100">
                                    <div className="mb-2 text-xs font-bold text-purple-800 flex justify-between items-center">
                                        <span>逻辑蓝图: {plan.writing_blueprint?.section_flow}</span>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleAddBlock(node.chapter.id)} className="text-[10px] bg-purple-100 px-2 py-0.5 rounded text-purple-700 hover:bg-purple-200">+ 添加块</button>
                                            <button onClick={() => setPlans(prev => { const n = {...prev}; delete n[node.chapter.id]; return n; })} className="text-purple-400 underline text-[10px]">重置骨架</button>
                                        </div>
                                    </div>
                                    <div className="space-y-3">
                                        {plan.skeleton_blocks.map((block, idx) => {
                                            const queries = plan.search_plan?.per_block_queries.find(q => q.block_id === block.block_id)?.query_sets?.broad_query || block.slots.KeywordsZH || [];
                                            const hasKeywords = queries.length > 0;
                                            const isSearching = searchingBlockId === block.block_id;
                                            const results = blockSearchResults[block.block_id] || [];
                                            const activeSearchText = activeSearchQueries[block.block_id] || "";
                                            
                                            return (
                                                <div key={block.block_id} className="bg-white border border-purple-100 p-3 rounded-lg shadow-sm">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs font-bold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">{block.move}</span>
                                                            <span className="text-[10px] text-slate-400 font-mono">Block {idx + 1}</span>
                                                        </div>
                                                        <button 
                                                            onClick={() => handleDeleteBlock(node.chapter.id, idx)}
                                                            className="text-slate-300 hover:text-red-500 text-xs"
                                                            title="删除此块"
                                                        >
                                                            🗑️
                                                        </button>
                                                    </div>
                                                    
                                                    {/* Editable Claim */}
                                                    <textarea 
                                                        className="w-full text-xs font-bold text-slate-700 mb-2 border-b border-transparent focus:border-purple-300 outline-none resize-none bg-transparent"
                                                        rows={2}
                                                        value={block.slots.Claim}
                                                        onChange={(e) => handleUpdateBlockSlot(node.chapter.id, idx, 'Claim', e.target.value)}
                                                        placeholder="在此输入核心主张..."
                                                    />
                                                    
                                                    {/* Evidence / Search Section */}
                                                    {hasKeywords && (
                                                        <div className="mt-2 bg-slate-50 p-2 rounded border border-slate-100">
                                                            {/* Recommended Keywords */}
                                                            <div className="flex flex-wrap gap-2 mb-2 items-center text-[10px]">
                                                                <span className="font-bold text-slate-500">💡 推荐:</span>
                                                                {queries.slice(0, 4).map((q, i) => (
                                                                    <button 
                                                                        key={i} 
                                                                        onClick={() => handleSearchInput(block.block_id, q)}
                                                                        className="bg-white border px-1.5 py-0.5 rounded text-slate-600 hover:border-purple-300 hover:text-purple-600 transition-colors"
                                                                    >
                                                                        {q}
                                                                    </button>
                                                                ))}
                                                                {block.slots.KeywordsEN && block.slots.KeywordsEN.slice(0,2).map((q, i) => (
                                                                     <button key={`en_${i}`} onClick={() => handleSearchInput(block.block_id, q)} className="bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded text-blue-600 hover:border-blue-300">
                                                                         {q}
                                                                     </button>
                                                                ))}
                                                            </div>

                                                            {/* Dedicated Search Box */}
                                                            {searchProvider !== 'none' && (
                                                                <div className="flex gap-2 mb-3">
                                                                    <input 
                                                                        type="text"
                                                                        className="flex-1 text-xs border border-purple-200 rounded px-2 py-1.5 focus:ring-1 focus:ring-purple-400 outline-none"
                                                                        placeholder="输入关键词进行搜索..."
                                                                        value={activeSearchText}
                                                                        onChange={(e) => handleSearchInput(block.block_id, e.target.value)}
                                                                        onKeyDown={(e) => e.key === 'Enter' && handleBlockSearch(block.block_id)}
                                                                    />
                                                                    <button 
                                                                        onClick={() => handleBlockSearch(block.block_id)}
                                                                        disabled={isSearching}
                                                                        className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded font-bold hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1"
                                                                    >
                                                                        {isSearching ? <span className="animate-spin">⏳</span> : '🔍 搜索'}
                                                                    </button>
                                                                </div>
                                                            )}
                                                            
                                                            {/* Search Results (Horizontal Scroll) */}
                                                            {results.length > 0 && (
                                                                <div className="flex gap-2 overflow-x-auto pb-2 mb-3 custom-scrollbar border-b border-slate-100">
                                                                    {results.map(res => (
                                                                        <div key={res.id} className="w-52 shrink-0 bg-white border border-purple-200 rounded p-2 shadow-sm hover:shadow-md transition-all flex flex-col">
                                                                            <div className="text-[10px] font-bold text-slate-800 line-clamp-2 leading-tight mb-1" title={res.title}>{res.title}</div>
                                                                            <div className="text-[9px] text-slate-500 mb-1">{res.authors[0]} et al., {res.year}</div>
                                                                            <div className="text-[9px] text-slate-400 line-clamp-3 mb-2 leading-tight flex-1" title={res.abstract}>{res.abstract}</div>
                                                                            <button 
                                                                                onClick={() => addCitationToContext(block.block_id, res)}
                                                                                disabled={isAddingRef}
                                                                                className="mt-auto bg-purple-100 hover:bg-purple-200 text-purple-700 text-[9px] py-1 rounded font-bold border border-purple-200 disabled:opacity-50"
                                                                            >
                                                                                {isAddingRef ? '...' : `+ 引用 (${citationStyle})`}
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {/* Context Input Area */}
                                                            <div className="relative">
                                                                <label className="text-[9px] font-bold text-slate-400 absolute top-1 right-2 bg-white px-1">引用素材上下文 (Context)</label>
                                                                <textarea 
                                                                    className="w-full text-xs border border-slate-300 rounded p-2 pt-4 focus:border-blue-400 outline-none h-24 resize-y bg-slate-50/50"
                                                                    placeholder={searchProvider === 'none' ? "在此粘贴参考文献摘要..." : "点击上方搜索结果的“引用”按钮，标准格式的参考文献将自动填入此处..."}
                                                                    value={referenceInputs[block.block_id] || ""}
                                                                    onChange={(e) => setReferenceInputs(prev => ({...prev, [block.block_id]: e.target.value}))}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-4 flex justify-end">
                                        <button 
                                            onClick={() => handleWriteWithPlan(node)}
                                            disabled={isGenerating}
                                            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-purple-200 transition-all flex items-center gap-2"
                                        >
                                            {isGenerating ? '撰写中...' : '📝 拼装撰写全文'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Manual Instructions (Common) & Reference Template Input (Advanced) */}
                            <div className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 space-y-2">
                               {advancedMode && (
                                   <div className="flex gap-2 animate-fade-in">
                                        <span className="text-xs font-bold text-purple-500 mt-2 shrink-0 w-16 text-right">参考范文:</span>
                                        <textarea 
                                            className="w-full text-xs border border-purple-100 hover:border-purple-200 focus:border-purple-400 focus:bg-white rounded p-1.5 outline-none transition-all resize-none h-16"
                                            placeholder={`[可选] 粘贴师兄论文中的相似段落作为结构模板 (AI 将模仿其起承转合)...`}
                                            value={refTemplates[node.chapter.id] || ""}
                                            onChange={(e) => setRefTemplates(prev => ({...prev, [node.chapter.id]: e.target.value}))}
                                        />
                                   </div>
                               )}

                               <div className="flex gap-2">
                                   <span className="text-xs font-bold text-slate-400 mt-2 shrink-0 w-16 text-right">指导意见:</span>
                                   <textarea 
                                      className="w-full text-xs bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-300 focus:bg-white rounded p-1.5 outline-none transition-all resize-none h-8 focus:h-20"
                                      placeholder={`给AI下达指令 (例如: 重点描述YOLO算法的改进点)...`}
                                      value={instructions[node.chapter.id] || ""}
                                      onChange={(e) => setInstructions(prev => ({...prev, [node.chapter.id]: e.target.value}))}
                                   />
                               </div>
                            </div>

                            {/* Result Preview */}
                            {hasContent && (
                               <div className="p-4 bg-white">
                                  <div className="max-h-60 overflow-y-auto custom-scrollbar pr-2 border-l-2 border-slate-100 pl-4">
                                     {renderPreviewContent(node.chapter.content || "")}
                                  </div>
                               </div>
                            )}
                         </div>
                       );
                    })}
                  </div>
               )}
            </div>
        </div>
      </div>

      <div className="w-72 flex flex-col gap-4 shrink-0">
        <div className="bg-slate-900 text-slate-300 rounded-xl flex-1 flex flex-col overflow-hidden shadow-xl">
          <div className="p-3 bg-black/40 border-b border-slate-700 font-mono text-xs flex justify-between">
             <span>AGENT_LOGS</span>
             <span className="text-green-400">ONLINE</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-[10px]">
            {agentLogs.map((log) => (
              <div key={log.id} className="border-l-2 border-slate-700 pl-2 animate-fade-in">
                <span className={`font-bold ${log.agentName === 'Fixer' ? 'text-orange-400' : log.agentName === 'TermChecker' ? 'text-teal-400' : log.agentName === 'Reference' ? 'text-purple-400' : log.agentName === 'Planner' ? 'text-pink-400' : log.agentName === 'Searcher' ? 'text-cyan-400' : 'text-blue-400'}`}>{log.agentName}</span>
                <p className="text-slate-300 mt-0.5">{log.message}</p>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default WritingDashboard;
