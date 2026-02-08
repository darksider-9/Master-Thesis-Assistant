
import React, { useState, useRef, useEffect } from 'react';
import { ThesisStructure, Chapter, FormatRules, Reference, AgentLog, ApiSettings } from '../types';
import { writeSingleSection, runPostProcessingAgents } from '../services/geminiService';

interface WritingDashboardProps {
  thesis: ThesisStructure;
  setThesis: React.Dispatch<React.SetStateAction<ThesisStructure>>;
  formatRules: FormatRules;
  references: Reference[];
  setReferences: React.Dispatch<React.SetStateAction<Reference[]>>;
  apiSettings: ApiSettings;
}

// Helper to flatten the tree for the list view
interface FlattenedNode {
  chapter: Chapter;
  parentId: string | null;
  depth: number;
  label: string; // "1", "1.1", "1.1.1"
}

const flattenChapters = (chapters: Chapter[], parentLabel: string = "", depth: number = 0): FlattenedNode[] => {
  let nodes: FlattenedNode[] = [];
  chapters.forEach((ch, idx) => {
    // For L1 chapters, don't use the index in label if title already has it (handled by Supervisor)
    // But for list consistency, we keep internal numbering.
    const currentLabel = parentLabel ? `${parentLabel}.${idx + 1}` : `${idx + 1}`;
    nodes.push({
      chapter: ch,
      parentId: null,
      depth,
      label: currentLabel
    });
    if (ch.subsections) {
      nodes = [...nodes, ...flattenChapters(ch.subsections, currentLabel, depth + 1)];
    }
  });
  return nodes;
};

const WritingDashboard: React.FC<WritingDashboardProps> = ({ thesis, setThesis, formatRules, references, setReferences, apiSettings }) => {
  const level1Chapters = thesis.chapters.filter(c => c.level === 1);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(level1Chapters[0]?.id || null);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [loadingNodes, setLoadingNodes] = useState<Record<string, boolean>>({});
  const [isPostProcessing, setIsPostProcessing] = useState(false);
  const [instructions, setInstructions] = useState<Record<string, string>>({}); 
  const logsEndRef = useRef<HTMLDivElement>(null);

  const selectedChapter = thesis.chapters.find(c => c.id === selectedChapterId);

  // Flatten the selected chapter for the list view
  const nodes = selectedChapter ? flattenChapters([selectedChapter], `${thesis.chapters.indexOf(selectedChapter) + 1}`) : [];
  
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  const addLog = (agent: AgentLog['agentName'], message: string, status: AgentLog['status'] = 'processing') => {
    setAgentLogs(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      agentName: agent,
      message,
      timestamp: Date.now(),
      status
    }]);
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

  const handleWriteSection = async (node: FlattenedNode) => {
    if (!selectedChapter || !apiSettings.apiKey) {
        alert("请检查 API Key 配置");
        return;
    }
    
    const nodeId = node.chapter.id;
    setLoadingNodes(prev => ({ ...prev, [nodeId]: true }));
    addLog('Writer', `正在撰写: ${node.label} ${node.chapter.title}...`, 'processing');

    try {
      const userInstruction = instructions[nodeId] || "";
      
      const content = await writeSingleSection({
        thesisTitle: thesis.title,
        chapterLevel1: selectedChapter,
        targetSection: node.chapter,
        userInstructions: userInstruction,
        formatRules,
        globalRefs: references,
        settings: apiSettings,
        discussionHistory: selectedChapter.chatHistory // Inject context
      });

      setThesis(prev => ({
        ...prev,
        chapters: updateNodeContent(prev.chapters, nodeId, content)
      }));

      addLog('Writer', `✅ ${node.label} 撰写完成`, 'success');

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
    addLog('Supervisor', '启动章节完成流程...', 'processing');

    // 1. Gather all content
    // Simplified: we concatenate content for processing context, but we will update node by node?
    // Actually, post processing usually needs the whole text to check consistency.
    // For now, we will perform a 'check' pass and update references globaly.
    
    const allContent = nodes.map(n => n.chapter.content || "").join("\n\n");
    if (!allContent.trim()) {
        addLog('Supervisor', '章节内容为空，无法处理', 'warning');
        setIsPostProcessing(false);
        return;
    }

    try {
        addLog('Figure', '检查图表与公式格式...', 'processing');
        addLog('TermChecker', '提取专业术语...', 'processing');
        addLog('Reference', '整理参考文献...', 'processing');

        const result = await runPostProcessingAgents(allContent, apiSettings);

        // Update References
        if (result.newReferences.length > 0) {
            setReferences(prev => {
                // simple dedup based on desc
                const combined = [...prev, ...result.newReferences];
                const unique = Array.from(new Map(combined.map(item => [item.description, item])).values());
                // re-assign IDs based on order
                return unique.map((r, i) => ({...r, id: i+1}));
            });
            addLog('Reference', `更新参考文献库: +${result.newReferences.length} 条`, 'success');
        }

        // Update Terms (Just logging for now, or store in Chapter metadata)
        if (result.newTerms.length > 0) {
            addLog('TermChecker', `发现新术语: ${result.newTerms.map(t=>t.term).join(', ')}`, 'success');
        }

        addLog('Fixer', '格式校验完成', 'success');

    } catch (e) {
        addLog('Supervisor', `处理失败: ${e}`, 'warning');
    } finally {
        setIsPostProcessing(false);
    }
  };

  const renderPreviewContent = (content: string) => {
     if (!content) return null;
     // Split by new placeholders [[FIG:...]] or [[TBL:...]]
     return content.split(/(\[\[.*?\]\]|\n)/g)
      .filter(p => p.trim())
      .map((part, i) => {
          if (part.startsWith("[[FIG:")) {
             const desc = part.replace("[[FIG:", "").replace("]]", "");
             return (
               <div key={i} className="my-2 p-3 bg-blue-50 border border-blue-100 rounded text-center">
                  <div className="w-20 h-20 bg-blue-200 mx-auto mb-2 flex items-center justify-center text-blue-400">IMG</div>
                  <div className="text-xs font-bold text-blue-600">图 X-X: {desc}</div>
               </div>
             );
          }
          if (part.startsWith("[[TBL:")) {
             const desc = part.replace("[[TBL:", "").replace("]]", "");
             return (
               <div key={i} className="my-2 p-3 bg-green-50 border border-green-100 rounded text-center">
                  <div className="text-xs font-bold text-green-600 mb-1">表 X-X: {desc}</div>
                  <div className="grid grid-cols-3 gap-1 opacity-50 text-[10px]">
                     <div className="bg-green-200 h-4"></div><div className="bg-green-200 h-4"></div><div className="bg-green-200 h-4"></div>
                     <div className="bg-white border h-4"></div><div className="bg-white border h-4"></div><div className="bg-white border h-4"></div>
                  </div>
               </div>
             );
          }
          return <p key={i} className="text-sm text-slate-700 leading-relaxed mb-2 indent-8 text-justify">{part}</p>;
      });
  };

  if (!selectedChapter) return <div>请选择章节</div>;

  return (
    <div className="flex h-full gap-4">
      {/* Chapter Selector */}
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="h-14 bg-white rounded-xl border shadow-sm flex items-center px-6 justify-between shrink-0">
          <h2 className="font-bold text-lg text-slate-800 truncate">
             智能撰写工作台 - {selectedChapter.title}
          </h2>
          <div className="flex items-center gap-3">
             <div className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                共 {nodes.length} 个写作单元
             </div>
             <button 
                onClick={handleCompleteChapter}
                disabled={isPostProcessing}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm flex items-center gap-2"
             >
                {isPostProcessing ? '处理中...' : '🎉 完成本章'}
             </button>
          </div>
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
                  <div className="space-y-6 max-w-4xl mx-auto">
                    {nodes.map((node) => {
                       const isGenerating = loadingNodes[node.chapter.id];
                       const hasContent = !!node.chapter.content;
                       
                       return (
                         <div key={node.chapter.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all hover:shadow-md">
                            {/* Node Header */}
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
                               
                               <div className="flex gap-2">
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
                               </div>
                            </div>

                            {/* Instruction Input */}
                            <div className="px-4 py-3 bg-slate-50/50 border-b border-slate-100 flex gap-2">
                               <span className="text-xs font-bold text-slate-400 mt-2 shrink-0">指导意见:</span>
                               <textarea 
                                  className="w-full text-xs bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-300 focus:bg-white rounded p-1.5 outline-none transition-all resize-none h-8 focus:h-20"
                                  placeholder={`给AI下达指令...`}
                                  value={instructions[node.chapter.id] || ""}
                                  onChange={(e) => setInstructions(prev => ({...prev, [node.chapter.id]: e.target.value}))}
                               />
                            </div>

                            {/* Preview Content */}
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

      {/* Agent Logs */}
      <div className="w-72 flex flex-col gap-4 shrink-0">
        <div className="bg-slate-900 text-slate-300 rounded-xl flex-1 flex flex-col overflow-hidden shadow-xl">
          <div className="p-3 bg-black/40 border-b border-slate-700 font-mono text-xs flex justify-between">
             <span>AGENT_LOGS</span>
             <span className="text-green-400">ONLINE</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-[10px]">
            {agentLogs.map((log) => (
              <div key={log.id} className="border-l-2 border-slate-700 pl-2 animate-fade-in">
                <span className={`font-bold ${log.agentName === 'Fixer' ? 'text-orange-400' : 'text-blue-400'}`}>{log.agentName}</span>
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
