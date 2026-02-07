
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ThesisStructure, Chapter, FormatRules, Reference, TechnicalTerm, AgentLog } from '../types';
import { orchestrateChapterGeneration, repairChapterFormatting } from '../services/geminiService';

interface WritingDashboardProps {
  thesis: ThesisStructure;
  setThesis: React.Dispatch<React.SetStateAction<ThesisStructure>>;
  formatRules: FormatRules;
  references: Reference[];
  setReferences: React.Dispatch<React.SetStateAction<Reference[]>>;
}

const WritingDashboard: React.FC<WritingDashboardProps> = ({ thesis, setThesis, formatRules, references, setReferences }) => {
  // Filter only Level 1 chapters for selection
  const level1Chapters = thesis.chapters.filter(c => c.level === 1);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(level1Chapters[0]?.id || null);
  const [globalTerms, setGlobalTerms] = useState<TechnicalTerm[]>([]);
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [isFixing, setIsFixing] = useState(false);
  const [targetWordCount, setTargetWordCount] = useState<number>(2000);
  
  const selectedChapter = thesis.chapters.find(c => c.id === selectedChapterId);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLogs]);

  useEffect(() => {
    if (selectedChapter && !selectedChapter.content) {
      setAgentLogs([]);
    }
  }, [selectedChapterId]);

  const addLog = (agent: AgentLog['agentName'], message: string, status: AgentLog['status'] = 'processing') => {
    setAgentLogs(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      agentName: agent,
      message,
      timestamp: Date.now(),
      status
    }]);
  };

  const handleStartWriting = async () => {
    if (!selectedChapter) return;
    
    // Strict check: Must be discussed in Stage 4
    if (selectedChapter.status !== 'discussed' && selectedChapter.status !== 'completed') {
      alert("⚠️ 无法生成：请先回到「核心探讨」阶段，完成该章节的思路确认。");
      return;
    }

    addLog('Supervisor', `加载章节《${selectedChapter.title}》...`, 'success');
    addLog('Supervisor', `设定目标字数: ${targetWordCount}字`, 'processing');
    addLog('Writer', '启动多 Agent 协同撰写 (按结构递归生成)...', 'processing');

    try {
      const result = await orchestrateChapterGeneration({
        thesisTitle: thesis.title,
        chapter: selectedChapter,
        interviewData: selectedChapter.metadata,
        formatRules,
        globalTerms,
        globalRefs: references,
        targetWordCount,
        onLog: (agent, msg) => addLog(agent, msg)
      });

      // Update content for the whole chapter node
      const updateChapters = (chapters: Chapter[]): Chapter[] => {
        return chapters.map(ch => {
          if (ch.id === selectedChapterId) {
            return {
              ...ch,
              content: result.content,
              rawModelOutput: result.rawOutput, // SAVE THE RAW CACHE
              status: 'completed',
              targetWordCount: targetWordCount
            };
          }
          return ch;
        });
      };

      setThesis(prev => ({ ...prev, chapters: updateChapters(prev.chapters) }));

      if (result.newTerms.length > 0) setGlobalTerms(prev => [...prev, ...result.newTerms]);
      
      if (result.newRefs.length > 0) {
        setReferences(prev => {
          const nextId = prev.length + 1;
          const mappedRefs = result.newRefs.map((r, i) => ({
             ...r,
             id: nextId + i
          }));
          return [...prev, ...mappedRefs];
        });
      }
      
      addLog('Writer', '✅ 章节撰写完成', 'success');

    } catch (e) {
      addLog('Writer', '❌ 错误: ' + e, 'warning');
      console.error(e);
    }
  };

  const handleFixFormatting = async () => {
    if (!selectedChapter?.rawModelOutput || isFixing) return;
    
    setIsFixing(true);
    addLog('Fixer', '检测到格式异常，启动修复 Agent...', 'warning');
    addLog('Fixer', '正在读取原始缓存数据...', 'processing');

    try {
      const fixedContent = await repairChapterFormatting(selectedChapter.rawModelOutput, formatRules);
      
      const updateChapters = (chapters: Chapter[]): Chapter[] => {
        return chapters.map(ch => {
          if (ch.id === selectedChapterId) {
            return {
              ...ch,
              content: fixedContent // Update with repaired content
            };
          }
          return ch;
        });
      };
      
      setThesis(prev => ({ ...prev, chapters: updateChapters(prev.chapters) }));
      addLog('Fixer', '✅ 格式修复完成，内容已恢复', 'success');

    } catch (e) {
      addLog('Fixer', '❌ 修复失败: ' + e, 'warning');
    } finally {
      setIsFixing(false);
    }
  };

  // --- Loss Detection Logic ---
  const lossMetrics = useMemo(() => {
    if (!selectedChapter?.content || !selectedChapter?.rawModelOutput) return null;

    const rawClean = selectedChapter.rawModelOutput.replace(/<metadata>[\s\S]*?<\/metadata>/, '');
    const rawTextLength = rawClean.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;

    const parts = selectedChapter.content.split(/(<[^>]+>.*?<\/[^>]+>|<[^>]+\/>)/g).filter(p => p.trim());
    let renderedTextLength = 0;
    
    parts.forEach(part => {
      const pMatch = part.match(/<p style="(.*?)">(.*?)<\/p>/);
      if (pMatch) {
        renderedTextLength += pMatch[2].replace(/\s/g, '').length;
      }
    });

    const diff = rawTextLength - renderedTextLength;
    
    return {
      diff,
      rawLength: rawTextLength,
      renderedLength: renderedTextLength,
      hasSignificantLoss: diff > 100 // Threshold: > 100 characters missing
    };
  }, [selectedChapter?.content, selectedChapter?.rawModelOutput]);


  if (!selectedChapter) return <div>请选择章节</div>;

  const renderContent = (content: string) => {
    const parts = content.split(/(<[^>]+>.*?<\/[^>]+>|<[^>]+\/>)/g).filter(p => p.trim());
    return parts.map((part, i) => {
      const pMatch = part.match(/<p style="(.*?)">(.*?)<\/p>/);
      if (pMatch) {
        const styleId = pMatch[1];
        const text = pMatch[2];
        let className = "mb-4 text-justify leading-relaxed ";
        
        // Map XML styles to visual classes
        if (styleId === formatRules.styleMap.heading1) className += "text-2xl font-bold mt-8 mb-4 text-slate-900 border-b pb-2";
        else if (styleId === formatRules.styleMap.heading2) className += "text-xl font-bold mt-6 mb-3 text-slate-800";
        else if (styleId === formatRules.styleMap.heading3) className += "text-lg font-bold mt-4 mb-2 text-slate-700";
        else if (styleId === formatRules.styleMap.captionFigure) className += "text-sm text-center text-slate-500 italic mt-2";
        else if (styleId === formatRules.styleMap.captionTable) className += "text-sm text-center text-slate-500 italic mb-2 font-bold";
        else className += "text-base text-slate-800 indent-8";
        
        return <div key={i} className={className}>{text}</div>;
      }
      if (part.includes("figure_placeholder")) {
        const desc = part.match(/desc="(.*?)"/)?.[1] || "Image";
        return (
          <div key={i} className="my-6 border-2 border-dashed border-blue-200 bg-blue-50 p-6 rounded-xl flex flex-col items-center justify-center text-blue-400">
            <span className="text-2xl mb-2">🖼️</span>
            <span className="font-mono text-sm">{desc} (待生成)</span>
          </div>
        );
      }
      return null;
    });
  };

  return (
    <div className="flex h-full gap-4">
      {/* Chapter Selector (Level 1 Only) */}
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
                    <div className="flex gap-1">
                      {ch.status === 'completed' && <span className="text-white text-xs bg-white/20 px-1.5 rounded">撰写完</span>}
                      {ch.status === 'discussed' && selectedChapterId !== ch.id && <span className="text-xs bg-green-100 text-green-600 px-1.5 rounded">已探讨</span>}
                    </div>
                  </div>
                </button>
             </div>
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        <div className="h-14 bg-white rounded-xl border shadow-sm flex items-center px-6 justify-between shrink-0">
          <h2 className="font-bold text-lg text-slate-800 truncate">{selectedChapter.title}</h2>
          
          <div className="flex items-center gap-4">
             {/* Word Count Control */}
             {!selectedChapter.content && (
                <div className="flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-lg">
                   <span className="text-xs text-slate-500 font-bold">目标字数:</span>
                   <input 
                     type="number" 
                     min={1000} 
                     max={10000} 
                     step={500}
                     value={targetWordCount}
                     onChange={(e) => setTargetWordCount(Number(e.target.value))}
                     className="w-16 bg-transparent text-sm font-bold text-slate-700 outline-none text-right"
                   />
                </div>
             )}

            <div className="flex gap-2">
              {!selectedChapter.content ? (
                <button 
                  onClick={handleStartWriting} 
                  disabled={selectedChapter.status !== 'discussed'}
                  className={`px-6 py-1.5 rounded-lg text-sm font-bold shadow-md transition-all flex items-center gap-2 ${
                    selectedChapter.status === 'discussed' 
                      ? 'bg-blue-600 text-white hover:bg-blue-700' 
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  {selectedChapter.status !== 'discussed' ? '🔒 请先完成探讨' : '✨ 启动智能撰写'}
                </button>
              ) : (
                <button onClick={handleStartWriting} className="text-blue-600 px-4 py-1.5 rounded-lg text-sm hover:bg-blue-50 border border-blue-200">
                  🔄 重新生成本章
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-xl border shadow-sm overflow-hidden relative flex flex-col">
            {/* Loss Warning Banner */}
            {lossMetrics?.hasSignificantLoss && (
               <div className="bg-orange-50 border-b border-orange-200 p-3 flex items-center justify-between animate-fade-in">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <div className="text-sm font-bold text-orange-800">检测到格式渲染异常</div>
                      <div className="text-xs text-orange-600">
                        原始回复长度: {lossMetrics.rawLength} | 当前渲染长度: {lossMetrics.renderedLength} (丢失 {lossMetrics.diff} 字符)
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={handleFixFormatting}
                    disabled={isFixing}
                    className="bg-orange-600 hover:bg-orange-700 text-white text-xs px-4 py-2 rounded-lg font-bold shadow-sm transition-all"
                  >
                    {isFixing ? '正在修复...' : '🔧 调用修复 Agent'}
                  </button>
               </div>
            )}

            <div className="flex-1 overflow-y-auto p-12 bg-white">
               {selectedChapter.content ? renderContent(selectedChapter.content) : (
                 <div className="h-full flex flex-col items-center justify-center text-slate-400">
                   {selectedChapter.status === 'discussed' ? (
                     <>
                        <span className="text-5xl mb-4 text-green-500">✅</span>
                        <p className="font-bold text-slate-700 text-lg">探讨已完成</p>
                        <p className="text-sm mt-2 max-w-md text-center text-slate-500">
                           AI 已掌握本章的{selectedChapter.metadata.isCoreChapter ? '核心方法与实验数据' : '写作思路'}。<br/>
                           点击上方按钮即可开始自动撰写。
                        </p>
                     </>
                   ) : (
                     <>
                        <span className="text-5xl mb-4 opacity-50">🔒</span>
                        <p className="font-bold">该章节尚未解锁</p>
                        <p className="text-sm mt-2 text-slate-400">请返回「核心探讨」步骤，与导师确认本章思路。</p>
                     </>
                   )}
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
              <div key={log.id} className="border-l-2 border-slate-700 pl-2">
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
