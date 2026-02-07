
import React, { useState, useRef, useEffect } from 'react';
import { ThesisStructure, Chapter, ChatMessage, InterviewData } from '../types';
import { chatWithMethodologySupervisor } from '../services/geminiService';

interface MethodologyDiscussionProps {
  thesis: ThesisStructure;
  setThesis: React.Dispatch<React.SetStateAction<ThesisStructure>>;
  onNext: () => void;
}

const MethodologyDiscussion: React.FC<MethodologyDiscussionProps> = ({ thesis, setThesis, onNext }) => {
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Find the selected Level 1 chapter
  const selectedChapter = thesis.chapters.find(c => c.id === selectedChapterId);
  
  // Use the chat history stored in the chapter, or empty array if none
  const chatHistory = selectedChapter?.chatHistory || [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, selectedChapterId]);

  const updateChapterState = (chapterId: string, updates: Partial<Chapter>) => {
    setThesis(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch => ch.id === chapterId ? { ...ch, ...updates } : ch)
    }));
  };

  const startDiscussion = (chapter: Chapter) => {
    if (chapter.level !== 1) return;
    setSelectedChapterId(chapter.id);
    
    // If no history, init with greeting
    if (!chapter.chatHistory || chapter.chatHistory.length === 0) {
      const title = chapter.title;
      let topicIntro = "";
      
      if (title.includes("绪论") || title.includes("引言")) {
        topicIntro = "本章是全篇的开端。我们需要确认：\n1. 研究背景与临床/实际需求\n2. 国内外研究现状简述\n3. 本文的主要研究内容与章节安排";
      } else if (title.includes("相关") || title.includes("理论") || title.includes("综述")) {
        topicIntro = "本章主要介绍理论基础。请告诉我：\n1. 涉及哪些核心算法或理论（如GAN, Transformer等）\n2. 这些理论在现有研究中存在什么问题，为后续章节铺垫什么？";
      } else if (title.includes("总结") || title.includes("展望") || title.includes("结论")) {
        topicIntro = "这是最后一章。请总结：\n1. 全文完成了哪些工作（3-4点）\n2. 还有哪些局限性或未来的改进方向？";
      } else {
        topicIntro = "这是论文的核心章节。请重点描述：\n1. **方法/创新点**（提出了什么新模型？改进了什么？）\n2. **数据**（使用了什么数据集？）\n3. **实验**（设计了哪些对比实验？结果如何？）";
      }

      const initialMsg: ChatMessage = {
        role: 'assistant',
        content: `你好，我们开始探讨 **${chapter.title}**。\n\n${topicIntro}`,
        timestamp: Date.now()
      };
      updateChapterState(chapter.id, { chatHistory: [initialMsg] });
    }
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedChapter) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: inputMessage,
      timestamp: Date.now()
    };

    // Optimistic update
    const newHistory = [...chatHistory, userMsg];
    updateChapterState(selectedChapter.id, { chatHistory: newHistory });
    
    setInputMessage("");
    setIsTyping(true);

    const result = await chatWithMethodologySupervisor(
      newHistory,
      thesis.title,
      selectedChapter
    );

    setIsTyping(false);
    
    const aiMsg: ChatMessage = {
      role: 'assistant',
      content: result.reply,
      timestamp: Date.now()
    };
    
    // Update history with AI response and optionally metadata
    const finalHistory = [...newHistory, aiMsg];
    
    setThesis(prev => ({
      ...prev,
      chapters: prev.chapters.map(ch => {
        if (ch.id === selectedChapter.id) {
          return { 
            ...ch, 
            chatHistory: finalHistory,
            // If metadata returned, merge it
            metadata: result.finalizedMetadata ? { ...ch.metadata, ...result.finalizedMetadata } : ch.metadata,
            status: result.finalizedMetadata ? 'discussed' : ch.status
          };
        }
        return ch;
      })
    }));
  };

  return (
    <div className="flex h-full gap-6 p-4">
      {/* Chapter List (Level 1 Only) */}
      <div className="w-1/4 bg-white rounded-xl border shadow-sm flex flex-col overflow-hidden">
        <div className="p-4 bg-slate-50 border-b">
          <h3 className="font-bold text-slate-700">章节核心探讨</h3>
          <p className="text-xs text-slate-500 mt-1">仅需与导师确认一级章节的宏观思路</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {thesis.chapters.map(ch => (
            <div key={ch.id} className="mb-2">
              <button
                onClick={() => startDiscussion(ch)}
                className={`w-full text-left p-3 rounded-lg transition-all flex justify-between items-center group border ${
                  selectedChapterId === ch.id 
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md' 
                    : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className={`w-3 h-3 rounded-full shrink-0 ${
                    ch.status === 'discussed' ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-slate-200'
                  }`} />
                  <span className="truncate font-bold text-sm">{ch.title}</span>
                </div>
                {ch.status === 'discussed' && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    selectedChapterId === ch.id ? 'bg-white/20 text-white' : 'bg-green-100 text-green-700'
                  }`}>
                    完成
                  </span>
                )}
              </button>
              
              {/* Subsections Preview */}
              {ch.subsections && ch.subsections.length > 0 && (
                 <div className="pl-8 mt-1 border-l-2 border-slate-100 ml-4 space-y-1">
                   {ch.subsections.map(sub => (
                     <div key={sub.id} className="text-[10px] text-slate-400 truncate py-0.5">
                       {sub.title}
                     </div>
                   ))}
                 </div>
              )}
            </div>
          ))}
        </div>
        <div className="p-4 border-t">
          <button onClick={onNext} className="w-full bg-slate-800 hover:bg-slate-900 text-white py-2 rounded-lg text-sm font-bold shadow-lg">
            确认所有探讨，进入撰写 →
          </button>
        </div>
      </div>

      {/* Chat Interface */}
      <div className="flex-1 flex flex-col bg-white rounded-xl border shadow-sm overflow-hidden relative">
        {!selectedChapter ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50">
            <span className="text-4xl mb-4">💬</span>
            <p>请点击左侧 <span className="font-bold text-slate-600">一级章节</span> 开始探讨</p>
          </div>
        ) : (
          <>
            <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
              <div>
                <h2 className="font-bold text-slate-800 flex items-center gap-2">
                  {selectedChapter.title}
                  {selectedChapter.status === 'discussed' && <span className="text-green-500 text-lg">✓</span>}
                </h2>
                <div className="flex gap-2 text-xs text-slate-500 mt-1">
                  <span className="bg-slate-200 px-1.5 rounded">Level 1 章节</span>
                  <span>|</span>
                  <span>AI 导师模式: 审稿人视角</span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30" ref={scrollRef}>
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs mr-3 shrink-0 shadow-sm">
                      AI
                    </div>
                  )}
                  <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-tr-none' 
                      : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                   <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs mr-3">AI</div>
                   <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none flex gap-1 items-center shadow-sm">
                     <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                     <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></div>
                     <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></div>
                   </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
              <div className="flex gap-3">
                <textarea
                  className="flex-1 border rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none resize-none text-sm bg-slate-50 focus:bg-white transition-colors"
                  rows={2}
                  placeholder="请输入您的想法... (例如：本章我打算先介绍...)"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                />
                <button 
                  onClick={handleSendMessage}
                  disabled={isTyping}
                  className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-6 rounded-xl font-bold transition-all shadow-md hover:shadow-lg"
                >
                  发送
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default MethodologyDiscussion;
