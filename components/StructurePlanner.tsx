
import React, { useState, useEffect, useRef } from 'react';
import { ThesisStructure, Chapter, ChatMessage, ApiSettings, FormatRules } from '../types';
import { chatWithSupervisor } from '../services/geminiService';
import StructureVisualizer from './StructureVisualizer';

interface StructurePlannerProps {
  thesis: ThesisStructure;
  onStructureConfirmed: (newThesis: ThesisStructure) => Promise<void>;
  setThesis: React.Dispatch<React.SetStateAction<ThesisStructure>>;
  apiSettings: ApiSettings;
  formatRules?: FormatRules | null;
}

const ChapterNode: React.FC<{ chapter: Chapter, indexPrefix: string, onDelete: (id: string) => void, onRegenerate: (title: string) => void }> = ({ chapter, indexPrefix, onDelete, onRegenerate }) => {
  return (
    <div className="mb-2 group relative">
      <div className={`
        flex items-center p-3 rounded-lg border pr-10 transition-colors
        ${chapter.level === 1 ? 'bg-white border-slate-200 shadow-sm' : 
          chapter.level === 2 ? 'bg-slate-50 border-slate-100 ml-4' : 
          'bg-transparent border-transparent ml-8 py-1'}
      `}>
        <span className={`
          font-mono text-slate-400 mr-3 shrink-0
          ${chapter.level === 1 ? 'font-bold text-slate-600' : 'text-xs'}
        `}>
          {chapter.level === 1 && chapter.title.startsWith("第") ? "" : indexPrefix}
        </span>
        <span className={`
          text-slate-800 
          ${chapter.level === 1 ? 'font-bold text-lg' : 
            chapter.level === 2 ? 'font-medium' : 
            'text-sm text-slate-600'}
        `}>
          {chapter.title}
        </span>

        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all flex items-center">
            {/* Regenerate Button */}
            <button 
                onClick={(e) => { e.stopPropagation(); onRegenerate(chapter.title); }}
                className="text-slate-300 hover:text-blue-500 p-1 mr-1"
                title="AI 重写此章节结构"
            >
                <span className="text-sm">🔄</span>
            </button>
            
            {/* Delete Button */}
            <button 
                onClick={(e) => { e.stopPropagation(); onDelete(chapter.id); }}
                className="text-slate-300 hover:text-red-500 p-1"
                title="删除章节"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
            </button>
        </div>
      </div>

      {chapter.subsections && chapter.subsections.length > 0 && (
        <div className="mt-1">
          {chapter.subsections.map((sub, idx) => (
            <ChapterNode 
              key={sub.id} 
              chapter={sub} 
              indexPrefix={`${indexPrefix}.${idx + 1}`} 
              onDelete={onDelete}
              onRegenerate={onRegenerate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const StructurePlanner: React.FC<StructurePlannerProps> = ({ thesis, onStructureConfirmed, setThesis, apiSettings, formatRules }) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isGeneratingXML, setIsGeneratingXML] = useState(false);
  const [viewMode, setViewMode] = useState<'outline' | 'visual'>('outline');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Initial Greeting
  useEffect(() => {
    if (chatHistory.length === 0) {
      const initialMsg: ChatMessage = {
        role: 'assistant',
        content: `你好！我是你的论文导师 Agent。\n\n我们将分为两步来完成工作：\n1. **确立大纲**：首先确定所有的章节标题（细化到三级标题，如 3.1.1）。\n2. **撰写细节**：大纲确定后，我们将逐章确认方法、数据和实验细节，最后开始撰写。\n\n首先，请告诉我你的核心工作主要包含哪些部分？（例如：提出了一种新方法并应用，还是对比了多种算法？）`,
        timestamp: Date.now()
      };
      setChatHistory([initialMsg]);
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    if (!apiSettings.apiKey) {
        alert("请先在设置中配置 API Key");
        return;
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: inputMessage,
      timestamp: Date.now()
    };

    setChatHistory(prev => [...prev, userMsg]);
    setInputMessage("");
    setIsTyping(true);

    // Call Supervisor Agent with Settings
    const result = await chatWithSupervisor(
        [...chatHistory, userMsg], 
        thesis.title, 
        { chapters: thesis.chapters },
        apiSettings
    );
    
    setIsTyping(false);
    
    const aiMsg: ChatMessage = {
      role: 'assistant',
      content: result.reply,
      timestamp: Date.now()
    };
    setChatHistory(prev => [...prev, aiMsg]);

    if (result.updatedStructure && result.updatedStructure.chapters) {
      const cleanTitle = (title: string) => {
        return title; 
      };

      const mapChaptersRecursive = (chapters: any[], parentId: string, levelOffset: number): Chapter[] => {
        return chapters.map((ch, idx) => {
          const currentId = `${parentId}-${idx + 1}`;
          const currentLevel = ch.level || (levelOffset + 1);
          
          return {
            id: currentId,
            title: cleanTitle(ch.title),
            level: currentLevel,
            status: 'pending',
            designConfirmed: true,
            metadata: {
              figureCount: 0,
              tableCount: 0,
              isCoreChapter: false
            },
            subsections: ch.subsections ? mapChaptersRecursive(ch.subsections, currentId, currentLevel) : []
          };
        });
      };

      const newChapters = mapChaptersRecursive(result.updatedStructure.chapters, 'ch', 0);
      setThesis(prev => ({ ...prev, chapters: newChapters }));
    }
  };

  const handleDeleteChapter = (idToDelete: string) => {
      const deleteRecursive = (chapters: Chapter[]): Chapter[] => {
          return chapters.filter(c => c.id !== idToDelete).map(c => ({
              ...c,
              subsections: deleteRecursive(c.subsections || [])
          }));
      };
      
      const newChapters = deleteRecursive(thesis.chapters);
      setThesis(prev => ({ ...prev, chapters: newChapters }));
  };
  
  const handleRegenerateChapter = (title: string) => {
      setInputMessage(`请针对章节 "${title}" 重新设计这一部分的结构，替换当前的方案。`);
  };

  const handleConfirm = async () => {
      setIsGeneratingXML(true);
      try {
          await onStructureConfirmed(thesis);
      } catch (e) {
          alert("结构同步到模版失败: " + e);
          setIsGeneratingXML(false);
      }
  };

  return (
    <div className="flex h-full gap-6 p-4">
      {/* Chat Area */}
      <div className="w-5/12 flex flex-col bg-white rounded-2xl border shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-xs">AI</div>
          <div>
            <div className="font-bold text-slate-800">论文导师 Agent</div>
            <div className="text-xs text-slate-500">第一阶段：大纲设计</div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
          {chatHistory.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : 'bg-slate-100 text-slate-800 rounded-tl-none'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-slate-100 p-3 rounded-2xl rounded-tl-none flex gap-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-75"></div>
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-150"></div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-white">
          <div className="flex gap-2">
            <input
              className="flex-1 border rounded-xl px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="例如：我希望第三章专门讲数据预处理..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button 
              onClick={handleSendMessage}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>

      {/* Structure Preview Area */}
      <div className="w-7/12 flex flex-col bg-slate-50 rounded-2xl border border-dashed border-slate-300 p-6 overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            大纲预览
          </h2>
          <div className="flex gap-2">
             <div className="flex bg-slate-200 rounded-lg p-1 text-xs font-bold text-slate-600">
                <button 
                   onClick={() => setViewMode('outline')}
                   className={`px-3 py-1 rounded ${viewMode === 'outline' ? 'bg-white shadow text-blue-600' : 'hover:bg-slate-300/50'}`}
                >
                   大纲树
                </button>
                <button 
                   onClick={() => setViewMode('visual')}
                   className={`px-3 py-1 rounded ${viewMode === 'visual' ? 'bg-white shadow text-blue-600' : 'hover:bg-slate-300/50'}`}
                >
                   模版解析
                </button>
             </div>

             {thesis.chapters.length > 0 && (
                <button 
                onClick={handleConfirm}
                disabled={isGeneratingXML}
                className="bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white px-4 py-1.5 rounded-lg shadow-lg shadow-green-200 transition-all font-medium flex items-center gap-2 text-xs"
                >
                {isGeneratingXML ? (
                    <>
                        <span className="animate-spin">🔄</span>
                        生成并同步模版...
                    </>
                ) : (
                    <>
                         确认并下一步 →
                    </>
                )}
                </button>
             )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2">
           {viewMode === 'outline' ? (
              thesis.chapters.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <span className="text-4xl mb-4">🌳</span>
                  <p>请在左侧描述你的研究思路</p>
                  <p className="text-sm mt-2">AI 导师将为您生成三级标题结构</p>
                </div>
              ) : (
                <div>
                  {thesis.chapters.map((chapter, idx) => (
                    <ChapterNode 
                      key={chapter.id} 
                      chapter={chapter} 
                      indexPrefix={`${idx + 1}`} 
                      onDelete={handleDeleteChapter}
                      onRegenerate={handleRegenerateChapter}
                    />
                  ))}
                </div>
              )
           ) : (
              <StructureVisualizer formatRules={formatRules || null} thesis={thesis} />
           )}
        </div>
      </div>
    </div>
  );
};

export default StructurePlanner;
