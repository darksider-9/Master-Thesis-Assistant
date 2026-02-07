
import React, { useState, useEffect, useRef } from 'react';
import { ThesisStructure, Chapter, ChatMessage } from '../types';
import { chatWithSupervisor } from '../services/geminiService';

interface StructurePlannerProps {
  thesis: ThesisStructure;
  onConfirm: () => void;
  setThesis: React.Dispatch<React.SetStateAction<ThesisStructure>>;
}

const StructurePlanner: React.FC<StructurePlannerProps> = ({ thesis, onConfirm, setThesis }) => {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
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

    const userMsg: ChatMessage = {
      role: 'user',
      content: inputMessage,
      timestamp: Date.now()
    };

    setChatHistory(prev => [...prev, userMsg]);
    setInputMessage("");
    setIsTyping(true);

    // Call Supervisor Agent
    const result = await chatWithSupervisor([...chatHistory, userMsg], thesis.title, { chapters: thesis.chapters });
    
    setIsTyping(false);
    
    const aiMsg: ChatMessage = {
      role: 'assistant',
      content: result.reply,
      timestamp: Date.now()
    };
    setChatHistory(prev => [...prev, aiMsg]);

    // Update structure recursively if agent returned a modification
    if (result.updatedStructure && result.updatedStructure.chapters) {
      
      const cleanTitle = (title: string) => {
        // Regex to remove "1.1", "1. ", "第一章", "Chapter 1" etc.
        // Matches start of string, optionally "第" + Chinese number + "章", OR digits + dots/spaces
        return title.replace(/^((第[一二三四五六七八九十\d]+[章节])|([\d\.]+)|(Chapter\s*\d+))\s*/i, '').trim();
      };

      const mapChaptersRecursive = (chapters: any[], parentId: string, levelOffset: number): Chapter[] => {
        return chapters.map((ch, idx) => {
          const currentId = `${parentId}-${idx + 1}`;
          // Ensure level is correct (1, 2, 3)
          const currentLevel = ch.level || (levelOffset + 1);
          
          return {
            id: currentId,
            title: cleanTitle(ch.title), // <--- CLEANING HAPPENS HERE
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

  // Recursive component for rendering the outline tree
  const ChapterNode = ({ chapter, indexPrefix }: { chapter: Chapter, indexPrefix: string }) => {
    return (
      <div className="mb-2">
        {/* Chapter Title Row */}
        <div className={`
          flex items-center p-3 rounded-lg border 
          ${chapter.level === 1 ? 'bg-white border-slate-200 shadow-sm' : 
            chapter.level === 2 ? 'bg-slate-50 border-slate-100 ml-4' : 
            'bg-transparent border-transparent ml-8 py-1'}
        `}>
          <span className={`
            font-mono text-slate-400 mr-3 shrink-0
            ${chapter.level === 1 ? 'font-bold text-slate-600' : 'text-xs'}
          `}>
            {indexPrefix}
          </span>
          <span className={`
            text-slate-800 
            ${chapter.level === 1 ? 'font-bold text-lg' : 
              chapter.level === 2 ? 'font-medium' : 
              'text-sm text-slate-600'}
          `}>
            {chapter.title}
          </span>
        </div>

        {/* Render Children Recursively */}
        {chapter.subsections && chapter.subsections.length > 0 && (
          <div className="mt-1">
            {chapter.subsections.map((sub, idx) => (
              <ChapterNode 
                key={sub.id} 
                chapter={sub} 
                indexPrefix={`${indexPrefix}.${idx + 1}`} 
              />
            ))}
          </div>
        )}
      </div>
    );
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
            <span className="text-xs font-normal text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">
              包含 {thesis.chapters.reduce((acc, ch) => acc + 1 + (ch.subsections?.length||0), 0)} 个章节节点
            </span>
          </h2>
          {thesis.chapters.length > 0 && (
            <button 
              onClick={onConfirm}
              className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg shadow-lg shadow-green-200 transition-all font-medium animate-pulse flex items-center gap-2"
            >
              <span>确认大纲</span>
              <span className="text-xs opacity-80">进入细节确认与撰写 →</span>
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pr-2">
          {thesis.chapters.length === 0 ? (
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
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StructurePlanner;
