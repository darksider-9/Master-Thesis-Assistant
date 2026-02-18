











import React, { useState, useRef, useEffect } from 'react';
import { ThesisStructure, Chapter, FormatRules, Reference, AgentLog, ApiSettings, SectionPlan, SearchProvider, SearchResult, SearchHistoryItem, CitationStyle, SkeletonBlock, CitationStrategy, TechnicalTerm } from '../types';
import { writeSingleSection, writeSingleSectionQuickMode, runPostProcessingAgents, generateSkeletonPlan, polishDraftContent, finalizeAcademicStyle, filterSearchResultsAI, standardizeReferencesGlobal } from '../services/geminiService';
import { searchAcademicPapers, fetchDetailedRefMetadata, enrichReferenceMetadata } from '../services/searchService';
import { generateContextEntry, formatCitation } from '../utils/citationFormatter';
import SearchHistoryModal from './SearchHistoryModal';
import SearchDebugger from './SearchDebugger';
import TermManagerModal from './TermManagerModal';

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
  globalTerms: TechnicalTerm[]; // NEW Props
  setGlobalTerms: React.Dispatch<React.SetStateAction<TechnicalTerm[]>>; // NEW Props
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

const WritingDashboard: React.FC<WritingDashboardProps> = ({ thesis, setThesis, formatRules, references, setReferences, apiSettings, setApiSettings, agentLogs, addLog, searchHistory, setSearchHistory, globalTerms, setGlobalTerms }) => {
  const level1Chapters = thesis.chapters.filter(c => c.level === 1);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(level1Chapters[0]?.id || null);
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});
  const [isPostProcessing, setIsPostProcessing] = useState(false);
  const [isAddingRef, setIsAddingRef] = useState(false);
  
  const logsEndRef = useRef<HTMLDivElement>(null);
  
  // Advanced Mode States
  const [advancedMode, setAdvancedMode] = useState(false);
  
  // Search UI States - Modified to use global settings or default
  // Note: We access apiSettings directly. If setApiSettings is missing, it's read-only.
  const searchProvider = apiSettings.searchProvider || 'none';
  const searchApiKey = apiSettings.searchApiKey || '';

  const [activeSearchQueries, setActiveSearchQueries] = useState<Record<string, string>>({}); // block_id -> input box value
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('GB/T 7714');
  
  const [blockSearchResults, setBlockSearchResults] = useState<Record<string, SearchResult[]>>({});
  const [searchingBlockId, setSearchingBlockId] = useState<string | null>(null);
  
  // Modals
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isDebuggerOpen, setIsDebuggerOpen] = useState(false);
  const [isTermManagerOpen, setIsTermManagerOpen] = useState(false);
  
  // Auto Pilot State
  const [isAutoPiloting, setIsAutoPiloting] = useState(false);
  const [autoPilotScope, setAutoPilotScope] = useState<'section' | 'chapter'>('section'); // New granularity

  const selectedChapter = thesis.chapters.find(c => c.id === selectedChapterId);
  // Calculate index of selected chapter in the whole thesis for numbering
  const selectedChapterIndex = thesis.chapters.findIndex(c => c.id === selectedChapterId) + 1;
  
  const nodes = selectedChapter ? flattenChapters([selectedChapter], `${selectedChapterIndex}`, 0, selectedChapterIndex) : [];
  
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  // Helper to get AI context from Chapter Metadata
  const getAIContext = (ch: Chapter) => ch.metadata?.aiContext || {};

  // Helper to update AI context in thesis structure (Persistence)
  const updateChapterAIContext = (chapterId: string, contextUpdate: Partial<NonNullable<Chapter['metadata']>['aiContext']>) => {
      setThesis(prev => {
          const updateRecursive = (list: Chapter[]): Chapter[] => {
              return list.map(ch => {
                  if (ch.id === chapterId) {
                      const existingMeta = ch.metadata || {};
                      const existingContext = existingMeta.aiContext || {};
                      return {
                          ...ch,
                          metadata: {
                              ...existingMeta,
                              aiContext: { ...existingContext, ...contextUpdate }
                          }
                      };
                  }
                  if (ch.subsections) {
                      return { ...ch, subsections: updateRecursive(ch.subsections) };
                  }
                  return ch;
              });
          };
          return { ...prev, chapters: updateRecursive(prev.chapters) };
      });
  };

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

  const addCitationToContext = async (blockId: string, nodeId: string, result: SearchResult) => {
      if (isAddingRef) return;
      setIsAddingRef(true);
      
      const currentCh = nodes.find(n => n.chapter.id === nodeId)?.chapter;
      const existingText = getAIContext(currentCh!).referenceInput || "";
      
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

      // Use Persistent Store
      updateChapterAIContext(nodeId, { referenceInput: existingText + citationEntry });
      setIsAddingRef(false);
  };

  // --- STANDARD REFERENCE FIXER (UPDATED to use new dedicated function) ---
  const handleFixReferences = async () => {
      if (isPostProcessing) return;
      setIsPostProcessing(true);
      addLog('Reference', '开始执行“智能参考文献规范化”流程...', 'processing');
      // Updated to pass thesis.chapters for context
      addLog('Reference', '1. 全局检查：扫描正文引用上下文 & 缺失元数据...', 'processing');
      
      try {
          const updatedRefs = await standardizeReferencesGlobal(
              references,
              thesis.chapters, // Pass all chapters to find context
              apiSettings,
              citationStyle,
              (msg) => addLog('Reference', msg, 'processing')
          );
        
        setReferences(updatedRefs);
        addLog('Reference', '参考文献规范化完成，已更新描述与格式。', 'success');
      } catch (e) {
          addLog('Reference', `规范化失败: ${e}`, 'error');
      } finally {
          setIsPostProcessing(false);
      }
  };

  // --- AUTO PILOT HANDLER (Granular & Persistent) ---
  const handleAutoPilot = async (targetNodeId?: string) => {
      if (!selectedChapter || !apiSettings.apiKey) {
          alert("请先配置 API Key");
          return;
      }
      
      setIsAutoPiloting(true);
      
      // LOGIC FIX: Resolve ambiguity for "Single Section" logic
      // If targetNodeId is present (clicked on card), use it.
      // If undefined (clicked on header):
      //    - If scope is 'chapter', use all leaf nodes.
      //    - If scope is 'section', find the FIRST pending/unwritten node in the chapter and run on that.
      
      let targetNodes: FlattenedNode[] = [];
      const leafNodes = nodes.filter(n => (n.chapter.subsections === undefined || n.chapter.subsections.length === 0));

      if (targetNodeId) {
          const n = nodes.find(x => x.chapter.id === targetNodeId);
          if (n) targetNodes = [n];
      } else {
          if (autoPilotScope === 'chapter') {
              targetNodes = leafNodes;
              addLog('Supervisor', `启动全章 Auto-Pilot，共 ${targetNodes.length} 个任务...`, 'processing');
          } else {
              // Find first pending
              const firstPending = leafNodes.find(n => !n.chapter.content || n.chapter.content.length < 50);
              if (firstPending) {
                  targetNodes = [firstPending];
                  addLog('Supervisor', `启动单节 Auto-Pilot (自动定位到: ${firstPending.label} ${firstPending.chapter.title})...`, 'processing');
              } else {
                  // Fallback to first one if all done
                  if (leafNodes.length > 0) {
                      targetNodes = [leafNodes[0]];
                      addLog('Supervisor', `所有章节似已完成。自动定位到第一节: ${leafNodes[0].label}`, 'processing');
                  }
              }
          }
      }
      
      if (targetNodes.length === 0) {
          addLog('Supervisor', `未找到可执行的章节目标`, 'warning');
          setIsAutoPiloting(false);
          return;
      }

      try {
          // Iterate sequentially
          for (const node of targetNodes) {
              const nodeId = node.chapter.id;
              
              addLog('Planner', `[Auto-Pilot] 正在处理: ${node.label} ${node.chapter.title}`, 'processing');
              setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));

              // 1. Generate Skeleton (If not exists)
              let plan = getAIContext(node.chapter).skeletonPlan;
              
              if (!plan) {
                  const response = await generateSkeletonPlan(
                      thesis.title, 
                      node.chapter,
                      selectedChapter?.chatHistory, 
                      getAIContext(node.chapter).refTemplate,         
                      getAIContext(node.chapter).userInstruction,         
                      apiSettings
                  );

                  if (!response.section_plans || response.section_plans.length === 0) {
                       addLog('Planner', `[Auto-Pilot] 骨架生成失败，跳过此节`, 'error');
                       setLoadingNodes(prev => ({ ...prev, [nodeId]: false }));
                       continue;
                  }

                  const rawPlan = response.section_plans[0];
                  // Unique Block IDs
                  const uniqueBlocks = rawPlan.skeleton_blocks.map((b, idx) => ({
                     ...b,
                     block_id: `${nodeId}_blk_${idx + 1}`
                  }));
                  
                  plan = { ...rawPlan, skeleton_blocks: uniqueBlocks };
                  
                  // PERSISTENCE FIX: Save skeleton immediately
                  updateChapterAIContext(nodeId, { skeletonPlan: plan });
                  
                  // Wait for state update (simulate)
                  await new Promise(r => setTimeout(r, 100));
              }

              // 2. Search & Filter & Context Assembly
              let combinedContext = getAIContext(node.chapter).referenceInput || "";

              for (const block of plan.skeleton_blocks) {
                  // Strategy Check: Auto-Pilot defaults to 'search_new' if not set
                  const strategy = block.citation_strategy || 'search_new';
                  
                  if (strategy === 'search_new') {
                       // NEW LOGIC: Use BOTH English and Chinese Keywords
                       const queriesToRun: string[] = [];
                       if (block.slots.KeywordsEN && block.slots.KeywordsEN.length > 0) {
                           queriesToRun.push(...block.slots.KeywordsEN.slice(0, 2)); // Top 2 English
                       }
                       if (block.slots.KeywordsZH && block.slots.KeywordsZH.length > 0) {
                           queriesToRun.push(block.slots.KeywordsZH[0]); // Top 1 Chinese
                       }
                       
                       const uniqueQueries = Array.from(new Set(queriesToRun)); // Dedupe

                       if (uniqueQueries.length > 0) {
                           addLog('Searcher', `[Auto-Pilot] 正在多源检索逻辑块 "${block.slots.Claim.slice(0,15)}...": ${uniqueQueries.join(", ")}`, 'processing');
                           
                           let allFoundPapers: SearchResult[] = [];

                           // Iterate queries (sequential to be polite, or parallel if brave)
                           for (const query of uniqueQueries) {
                               const providersToTry: SearchProvider[] = ['open_alex', 'arxiv', 'crossref', 'semantic_scholar'];
                               if (searchProvider === 'serper' && searchApiKey) {
                                   providersToTry.push('serper');
                               }

                               try {
                                   const resultsPromises = providersToTry.map(p => {
                                       const keyToUse = (p === searchProvider || (p === 'semantic_scholar' && searchProvider === 'semantic_scholar')) ? searchApiKey : undefined;
                                       return searchAcademicPapers(query, p, keyToUse).catch(e => {
                                           console.warn(`Provider ${p} failed for query ${query}`, e);
                                           return [] as SearchResult[];
                                       });
                                   });
                                   const resultsArrays = await Promise.all(resultsPromises);
                                   allFoundPapers = [...allFoundPapers, ...resultsArrays.flat()];
                               } catch (e) {
                                   console.error(e);
                               }
                           }
                           
                           // Deduplicate
                           const seenTitles = new Set();
                           let aggregatedResults = allFoundPapers.filter(r => {
                               const normTitle = r.title.toLowerCase().replace(/\s+/g, '');
                               if (seenTitles.has(normTitle)) return false;
                               seenTitles.add(normTitle);
                               return true;
                           });
    
                           if (aggregatedResults.length > 0) {
                               addLog('Searcher', `[Auto-Pilot] 汇总检索到 ${aggregatedResults.length} 篇文献，正在进行 AI 智能筛选...`, 'processing');
                               
                               // PERSISTENCE FIX: Save to Search History (Use the first query as label)
                               setSearchHistory(prev => [...prev, {
                                    id: Date.now().toString() + Math.random(),
                                    timestamp: Date.now(),
                                    query: uniqueQueries[0] + " (+others)",
                                    provider: 'open_alex', // Approximation since we mixed providers
                                    results: aggregatedResults,
                                    blockId: block.block_id
                               }]);

                               const selectedIds = await filterSearchResultsAI(block.slots.Claim, aggregatedResults, apiSettings);
                               
                               if (selectedIds.length > 0) {
                                   addLog('Searcher', `[Auto-Pilot] AI 选中 ${selectedIds.length} 篇高相关文献`, 'success');
                                   
                                   const selectedPapers = aggregatedResults.filter(r => selectedIds.includes(r.id));
                                   
                                   for (const paper of selectedPapers) {
                                       // Check/Add to Global
                                       let existingRef = references.find(r => 
                                            r.description.includes(paper.title) || paper.title.includes(r.description)
                                       );
                                       
                                       // --- NEW: Strict Metadata Enrichment for Auto-Pilot ---
                                       if (!existingRef) {
                                            // We found a new paper. We must enrich it to ensure perfect metadata.
                                            addLog('Reference', `[Auto-Pilot] 正在全网验证并补全元数据: "${paper.title.slice(0,20)}..."`, 'processing');
                                            
                                            // Use Strict Mode (True) because we know the title from the selected paper
                                            const perfectMeta = await enrichReferenceMetadata(paper.title, apiSettings, true);
                                            
                                            // Quick format
                                            const formattedDesc = formatCitation(paper, citationStyle);
                                            const newId = references.length > 0 ? Math.max(...references.map(r => r.id)) + 1 : 1;
                                            
                                            const newRef: Reference = {
                                                id: newId,
                                                description: formattedDesc,
                                                // Prefer perfect metadata if found, otherwise fallback to search result
                                                metadata: perfectMeta || { 
                                                    title: paper.title,
                                                    authors: paper.authors,
                                                    year: paper.year,
                                                    journal: paper.venue
                                                }
                                            };
                                            setReferences(prev => [...prev, newRef]);
                                            // Append to context
                                            combinedContext += generateContextEntry(paper, citationStyle, newId);
                                       } else {
                                            combinedContext += `[Ref Existing ID:${existingRef.id}] Title: ${paper.title}\n`;
                                       }
                                   }
                                   // PERSISTENCE FIX: Save accumulated context
                                   updateChapterAIContext(nodeId, { referenceInput: combinedContext });

                               } else {
                                   addLog('Searcher', `[Auto-Pilot] AI 判定无相关文献，跳过引用`, 'warning');
                               }
                           }
                       }
                  } else if (strategy === 'use_existing') {
                       // Logic handled in prompt instructions to use global refs
                       addLog('Searcher', `[Auto-Pilot] 策略设为“引用已有”，跳过搜索`, 'processing');
                  }
              }

              // 4. Write Section
              addLog('Writer', `[Auto-Pilot] 正在撰写正文...`, 'processing');
              
              const targetWordCount = getAIContext(node.chapter).targetWordCount || 800;

              // Construct Instruction
              let constructedInstruction = `【严格遵循以下逻辑骨架进行撰写】\n\n写作蓝图: ${plan.writing_blueprint?.section_flow || "按顺序撰写"}\n\n`;
              plan.skeleton_blocks.forEach((block, idx) => {
                 constructedInstruction += `[BLOCK ${idx + 1}: ${block.move}]\n- Claim: ${block.slots.Claim}\n- Style: ${block.style_notes}\n`;
              });
              
              if (combinedContext) {
                  constructedInstruction += `\n【自动检索到的相关文献素材 (Global Search)】\n${combinedContext}\n请根据Claim合理选用，若素材不足则进行理论推演。`;
              }
              const userInst = getAIContext(node.chapter).userInstruction;
              if (userInst) {
                  constructedInstruction += `\n【用户额外指令】\n${userInst}`;
              }

              // Draft
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
                targetWordCount: targetWordCount,
                chapterIndex: node.chapterIndex,
                globalTerms: globalTerms // Pass Global Terms to Auto-Pilot Writer
              });

              // Polish & Finalize
              content = await polishDraftContent(content, node.chapterIndex, apiSettings, targetWordCount);
              content = await finalizeAcademicStyle(content, node.chapterIndex, apiSettings, targetWordCount);
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
          
          addLog('Supervisor', `🎉 Auto-Pilot 流程结束！`, 'success');
          
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
             getAIContext(node.chapter).refTemplate,         
             getAIContext(node.chapter).userInstruction,         
             apiSettings
         );

         if (response.section_plans && response.section_plans.length > 0) {
             // Prefix Block IDs with Chapter ID to prevent scope pollution/collision
             const plan = response.section_plans[0];
             const uniqueBlocks = plan.skeleton_blocks.map((b, idx) => ({
                 ...b,
                 block_id: `${nodeId}_blk_${idx + 1}`
             }));
             
             // Update Persistence
             updateChapterAIContext(nodeId, { skeletonPlan: { ...plan, skeleton_blocks: uniqueBlocks } });
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
      const currentPlan = nodes.find(n => n.chapter.id === nodeId)?.chapter.metadata?.aiContext?.skeletonPlan;
      if (!currentPlan) return;

      const newBlocks = [...currentPlan.skeleton_blocks];
      newBlocks[blockIndex] = {
          ...newBlocks[blockIndex],
          slots: {
              ...newBlocks[blockIndex].slots,
              [field]: value
          }
      };
      
      updateChapterAIContext(nodeId, { skeletonPlan: { ...currentPlan, skeleton_blocks: newBlocks } });
  };
  
  // NEW: Update Citation Strategy
  const handleUpdateBlockStrategy = (nodeId: string, blockIndex: number, strategy: CitationStrategy) => {
      const currentPlan = nodes.find(n => n.chapter.id === nodeId)?.chapter.metadata?.aiContext?.skeletonPlan;
      if (!currentPlan) return;

      const newBlocks = [...currentPlan.skeleton_blocks];
      newBlocks[blockIndex] = {
          ...newBlocks[blockIndex],
          citation_strategy: strategy
      };
      
      updateChapterAIContext(nodeId, { skeletonPlan: { ...currentPlan, skeleton_blocks: newBlocks } });
  };

  const handleDeleteBlock = (nodeId: string, blockIndex: number) => {
      const currentPlan = nodes.find(n => n.chapter.id === nodeId)?.chapter.metadata?.aiContext?.skeletonPlan;
      if (!currentPlan) return;

      const newBlocks = currentPlan.skeleton_blocks.filter((_, i) => i !== blockIndex);
      updateChapterAIContext(nodeId, { skeletonPlan: { ...currentPlan, skeleton_blocks: newBlocks } });
  };

  const handleAddBlock = (nodeId: string) => {
      const currentPlan = nodes.find(n => n.chapter.id === nodeId)?.chapter.metadata?.aiContext?.skeletonPlan;
      if (!currentPlan) return;

      const newBlock: SkeletonBlock = {
          block_id: `${nodeId}_manual_${Date.now()}`,
          move: "Manual-Addition",
          slots: { Claim: "新论点...", Evidence: [], KeywordsZH: [], KeywordsEN: [] },
          style_notes: "自定义",
          citation_strategy: 'search_new'
      };
      updateChapterAIContext(nodeId, { skeletonPlan: { ...currentPlan, skeleton_blocks: [...currentPlan.skeleton_blocks, newBlock] } });
  };

  const handleWriteWithPlan = async (node: FlattenedNode) => {
      if (!selectedChapter || !apiSettings.apiKey) {
        alert("请检查 API Key 配置");
        return;
      }
      
      const nodeId = node.chapter.id;
      const plan = getAIContext(node.chapter).skeletonPlan;
      if (!plan) return;

      setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
      addLog('Writer', `Step 1/3: 正在基于骨架撰写: ${node.label}...`, 'processing');
      const targetWordCount = getAIContext(node.chapter).targetWordCount || 800;

      let constructedInstruction = `【严格遵循以下逻辑骨架进行撰写】\n\n写作蓝图: ${plan.writing_blueprint?.section_flow || "按顺序撰写"}\n\n`;
      
      plan.skeleton_blocks.forEach((block, idx) => {
          const userRefContent = getAIContext(node.chapter).referenceInput || "";
          constructedInstruction += `[BLOCK ${idx + 1}: ${block.move}]\n`;
          constructedInstruction += `- 核心主张 (Claim): ${block.slots.Claim}\n`;
          constructedInstruction += `- 写作风格: ${block.style_notes || "学术中立"}\n`;
          
          // Strategy Handling in Prompt
          const strategy = block.citation_strategy || 'search_new';
          if (strategy === 'search_new') {
              if (userRefContent) {
                  constructedInstruction += `- 【重要】已提供的真实文献素材(Context): \n${userRefContent}\n`;
                  constructedInstruction += `- 指令: 请务必综合上述素材，并适当添加引用标记(如[1])。\n`;
              }
          } else if (strategy === 'use_existing') {
              constructedInstruction += `- 指令: 请仅引用【全局参考文献库】中已有的文献 ID，严禁编造。\n`;
          } else {
              constructedInstruction += `- 指令: 本段不需要引用参考文献，请进行纯理论推演。\n`;
          }
          
          constructedInstruction += `\n`;
      });
      
      const userInst = getAIContext(node.chapter).userInstruction;
      if (userInst) {
          constructedInstruction += `\n【额外用户指令】\n${userInst}`;
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
            targetWordCount: targetWordCount,
            chapterIndex: node.chapterIndex, // Pass index for numbering
            globalTerms: globalTerms // Pass Global Terms
          });

          // STEP 2: Logic Polish (With real-time numbering)
          addLog('Fixer', `Step 2/3: 逻辑润色与图表编号渲染...`, 'processing');
          content = await polishDraftContent(content, node.chapterIndex, apiSettings, targetWordCount);

          // STEP 3: Style Finalize
          addLog('Writer', `Step 3/3: 最终去AI味与格式定稿...`, 'processing');
          content = await finalizeAcademicStyle(content, node.chapterIndex, apiSettings, targetWordCount);

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
    const targetWordCount = getAIContext(node.chapter).targetWordCount || 800;

    try {
      const userInstruction = getAIContext(node.chapter).userInstruction || "";
      
      // STEP 1: Draft using Quick Mode Prompt
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
        targetWordCount: targetWordCount,
        chapterIndex: node.chapterIndex, // Pass index for numbering
        globalTerms: globalTerms // Pass Global Terms to Quick Mode
      });

      // STEP 2: Logic Polish
      addLog('Fixer', `Step 2/3: 逻辑润色与图表编号渲染...`, 'processing');
      content = await polishDraftContent(content, node.chapterIndex, apiSettings, targetWordCount);

      // STEP 3: Style Finalize
      addLog('Writer', `Step 3/3: 最终去AI味与格式定稿...`, 'processing');
      content = await finalizeAcademicStyle(content, node.chapterIndex, apiSettings, targetWordCount);

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
    addLog('Supervisor', '启动章节智能校验 (AI术语识别/全局一致性/标点修复)...', 'processing');

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
            globalTerms: globalTerms, // Pass Global Terms to Service
            settings: apiSettings,
            onLog: (msg) => addLog('TermChecker', msg, 'processing')
        });

        setThesis(prev => ({ ...prev, chapters: result.updatedChapters }));
        setReferences(result.updatedReferences);
        
        // Update Global Terms State with results from AI
        setGlobalTerms(result.updatedTerms);
        
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
              // Copy to clipboard fallback
              const text = generateContextEntry(res, citationStyle);
              navigator.clipboard.writeText(text).then(() => alert("引用内容已复制到剪贴板，请粘贴到对应段落的 Context 框中。"));
          }}
      />

      <SearchDebugger 
          isOpen={isDebuggerOpen}
          onClose={() => setIsDebuggerOpen(false)}
          apiSettings={apiSettings}
          references={references}
          setReferences={setReferences}
          citationStyle={citationStyle}
      />

      <TermManagerModal 
          isOpen={isTermManagerOpen}
          onClose={() => setIsTermManagerOpen(false)}
          globalTerms={globalTerms}
          setGlobalTerms={setGlobalTerms}
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
                    onClick={() => setIsTermManagerOpen(true)}
                    className="bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-1"
                    title="管理全局术语表"
                >
                    📚 术语表 ({globalTerms.length})
                </button>
                <button 
                    onClick={() => setIsDebuggerOpen(true)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border border-slate-200 flex items-center gap-1"
                >
                    🐞 搜索调试
                </button>
                <button 
                    onClick={() => setIsHistoryOpen(true)}
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border border-slate-200"
                >
                    📜 搜索历史
                </button>
                <button 
                    onClick={handleFixReferences}
                    disabled={isPostProcessing}
                    className="bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm"
                    title="强制搜索元数据并规范化所有引用格式"
                >
                    {isPostProcessing ? '...' : `🏷️ 规范参考文献 (${citationStyle})`}
                </button>
                {advancedMode && (
                  <div className="flex items-center gap-1 bg-purple-50 p-1 rounded-lg border border-purple-100">
                      <select 
                          className="text-[10px] bg-transparent font-bold text-purple-700 outline-none"
                          value={autoPilotScope}
                          onChange={(e) => setAutoPilotScope(e.target.value as 'section' | 'chapter')}
                      >
                          <option value="section">单节</option>
                          <option value="chapter">全章</option>
                      </select>
                      <button 
                          onClick={() => handleAutoPilot(autoPilotScope === 'section' ? undefined : undefined)}
                          disabled={isPostProcessing || isAutoPiloting}
                          className="bg-purple-600 hover:bg-purple-700 disabled:bg-slate-300 text-white px-3 py-1 rounded text-xs font-bold transition-colors shadow-sm flex items-center gap-2 animate-pulse-slow"
                          title={autoPilotScope === 'section' ? "自动运行当前第一个未完成的小节" : "自动运行本章所有小节"}
                      >
                          {isAutoPiloting ? '⏳ 运行中...' : `⚡️ Auto-Pilot`}
                      </button>
                  </div>
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
                       const plan = getAIContext(node.chapter).skeletonPlan;
                       const aiContext = getAIContext(node.chapter);
                       
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
                                  {hasContent && (
                                     <div className="flex items-center gap-2">
                                        <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-bold">已生成</span>
                                        <span className="text-[10px] text-slate-400 font-mono">
                                            {node.chapter.content!.length} 字
                                        </span>
                                     </div>
                                  )}
                               </div>
                               
                               <div className="flex gap-2 items-center">
                                  {/* Word Count Target Input */}
                                  <div className="flex items-center bg-slate-100 rounded px-2 py-1 mr-2 border border-slate-200">
                                      <span className="text-[10px] text-slate-500 mr-1 font-bold">目标字数:</span>
                                      <input 
                                          type="number"
                                          className="w-12 text-xs bg-transparent border-none outline-none text-center font-mono text-blue-600"
                                          placeholder="800"
                                          value={aiContext.targetWordCount || 800}
                                          onChange={(e) => updateChapterAIContext(node.chapter.id, { targetWordCount: parseInt(e.target.value) || 800 })}
                                      />
                                  </div>

                                  {/* Auto-Pilot This Section Button */}
                                  {advancedMode && (
                                     <button 
                                        onClick={() => handleAutoPilot(node.chapter.id)}
                                        disabled={isGenerating || isAutoPiloting}
                                        className="px-2 py-1.5 rounded-lg text-xs font-bold text-purple-600 hover:bg-purple-50 transition-colors"
                                        title="仅为此小节运行 Auto-Pilot"
                                     >
                                        ⚡️
                                     </button>
                                  )}

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
                                            <button onClick={() => updateChapterAIContext(node.chapter.id, { skeletonPlan: undefined })} className="text-purple-400 underline text-[10px]">重置骨架</button>
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
                                                            
                                                            {/* Citation Strategy Selector */}
                                                            <div className="flex ml-2 bg-slate-100 rounded p-0.5">
                                                                {(['search_new', 'use_existing', 'none'] as const).map(strat => (
                                                                    <button
                                                                        key={strat}
                                                                        onClick={() => handleUpdateBlockStrategy(node.chapter.id, idx, strat)}
                                                                        className={`text-[9px] px-2 py-0.5 rounded transition-colors ${
                                                                            (block.citation_strategy || 'search_new') === strat 
                                                                            ? 'bg-white shadow text-purple-600 font-bold' 
                                                                            : 'text-slate-400 hover:text-slate-600'
                                                                        }`}
                                                                        title={strat === 'search_new' ? '搜索新文献' : strat === 'use_existing' ? '📚 存' : '🚫 无'}
                                                                    >
                                                                        {strat === 'search_new' ? '🔍 搜' : strat === 'use_existing' ? '📚 存' : '🚫 无'}
                                                                    </button>
                                                                ))}
                                                            </div>
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
                                                    
                                                    {/* Evidence / Search Section (Conditional on Strategy) */}
                                                    {(block.citation_strategy || 'search_new') === 'search_new' && hasKeywords && (
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
                                                                                onClick={() => addCitationToContext(block.block_id, node.chapter.id, res)}
                                                                                disabled={isAddingRef}
                                                                                className="mt-auto bg-purple-100 hover:bg-purple-200 text-purple-700 text-[9px] py-1 rounded font-bold border border-purple-200 disabled:opacity-50"
                                                                            >
                                                                                {isAddingRef ? '...' : `+ 引用 (${citationStyle})`}
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                            
                                                            {/* Context Display (Shared for node) */}
                                                            {idx === 0 && (
                                                                <div className="relative">
                                                                    <label className="text-[9px] font-bold text-slate-400 absolute top-1 right-2 bg-white px-1">引用素材上下文 (Context)</label>
                                                                    <textarea 
                                                                        className="w-full text-xs border border-slate-300 rounded p-2 pt-4 focus:border-blue-400 outline-none h-24 resize-y bg-slate-50/50"
                                                                        placeholder={searchProvider === 'none' ? "在此粘贴参考文献摘要..." : "点击上方搜索结果的“引用”按钮，标准格式的参考文献将自动填入此处..."}
                                                                        value={aiContext.referenceInput || ""}
                                                                        onChange={(e) => updateChapterAIContext(node.chapter.id, { referenceInput: e.target.value })}
                                                                    />
                                                                </div>
                                                            )}
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
                                            value={aiContext.refTemplate || ""}
                                            onChange={(e) => updateChapterAIContext(node.chapter.id, { refTemplate: e.target.value })}
                                        />
                                   </div>
                               )}

                               <div className="flex gap-2">
                                   <span className="text-xs font-bold text-slate-400 mt-2 shrink-0 w-16 text-right">指导意见:</span>
                                   <textarea 
                                      className="w-full text-xs bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-300 focus:bg-white rounded p-1.5 outline-none transition-all resize-none h-8 focus:h-20"
                                      placeholder={`给AI下达指令 (例如: 重点描述YOLO算法的改进点)...`}
                                      value={aiContext.userInstruction || ""}
                                      onChange={(e) => updateChapterAIContext(node.chapter.id, { userInstruction: e.target.value })}
                                   />
                               </div>
                            </div>

                            {/* Result Preview with Editing Enabled */}
                            {hasContent && (
                               <div className="p-4 bg-white relative group/edit">
                                  <textarea
                                      className="w-full h-64 text-sm text-slate-700 leading-relaxed outline-none border border-transparent focus:border-blue-200 rounded p-2 resize-y"
                                      value={node.chapter.content}
                                      onChange={(e) => setThesis(prev => ({
                                          ...prev,
                                          chapters: updateNodeContent(prev.chapters, node.chapter.id, e.target.value)
                                      }))}
                                  />
                                  <div className="absolute top-2 right-2 opacity-0 group-hover/edit:opacity-100 transition-opacity bg-white/80 p-1 rounded text-[10px] text-slate-400 pointer-events-none">
                                      点击编辑
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