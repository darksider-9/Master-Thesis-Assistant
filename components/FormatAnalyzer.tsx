
import React, { useState } from 'react';
import { FormatRules, Chapter } from '../types';
import StructureVisualizer from './StructureVisualizer';
import { extractThesisFromXML } from '../services/xmlParser';

interface FormatAnalyzerProps {
  onUpload: (content: string) => void;
  formatRules: FormatRules | null;
  onNext: () => void;
  // NEW: Callback for importing existing thesis flow
  onImportExisting?: (extractedChapters: Chapter[], rawTextPreview: string) => Promise<void>;
}

const FormatAnalyzer: React.FC<FormatAnalyzerProps> = ({ onUpload, formatRules, onNext, onImportExisting }) => {
  const [dragActive, setDragActive] = useState(false);
  const [hasExistingContent, setHasExistingContent] = useState(false);
  const [previewContent, setPreviewContent] = useState("");
  const [extractedData, setExtractedData] = useState<{chapters: Chapter[], rawTextPreview: string} | null>(null);
  
  // New state for loading animation
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      onUpload(content);
      
      // Attempt to extract existing content
      try {
          const data = extractThesisFromXML(content);
          // Threshold: At least one L1 chapter and some text content
          if (data.chapters.length > 0 && data.rawTextPreview.length > 300) {
              setHasExistingContent(true);
              setPreviewContent(data.rawTextPreview);
              setExtractedData(data);
          } else {
              setHasExistingContent(false);
          }
      } catch (err) {
          console.warn("Extraction check failed", err);
          setHasExistingContent(false);
      }
    };
    reader.readAsText(file);
  };

  const handleSmartImport = async () => {
      if (!onImportExisting || !extractedData) return;
      setIsAnalyzing(true);
      try {
          await onImportExisting(extractedData.chapters, extractedData.rawTextPreview);
      } catch (e) {
          console.error("Import failed", e);
          setIsAnalyzing(false); // Only reset on error (success will unmount/navigate)
      }
  };

  const onDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  if (formatRules) {
    return (
      <div className="max-w-6xl mx-auto mt-6 bg-white p-6 rounded-2xl shadow-xl border border-blue-100 h-[600px] flex flex-col relative overflow-hidden">
        {/* Loading Overlay */}
        {isAnalyzing && (
            <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-sm flex flex-col items-center justify-center animate-fade-in cursor-wait">
                <div className="relative mb-6">
                    <div className="w-20 h-20 border-4 border-slate-100 rounded-full"></div>
                    <div className="w-20 h-20 border-4 border-t-purple-600 border-r-purple-600 border-b-transparent border-l-transparent rounded-full animate-spin absolute top-0 left-0"></div>
                    <div className="absolute inset-0 flex items-center justify-center text-2xl">🧠</div>
                </div>
                <h3 className="text-2xl font-bold text-slate-800 animate-pulse">AI 正在深度解析文档结构...</h3>
                <div className="mt-4 space-y-2 text-center text-slate-500 text-sm">
                    <p>正在识别核心章节逻辑</p>
                    <p>正在逆向推导研究方法与元数据</p>
                    <p className="text-xs text-slate-400 mt-2 pt-2 border-t border-slate-100 w-64 mx-auto">预计耗时 10-30 秒，请保持页面开启</p>
                </div>
            </div>
        )}

        <div className="flex items-center justify-between mb-6 border-b pb-4 shrink-0">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center animate-bounce-in">
                <span className="text-xl">✓</span>
             </div>
             <div>
               <h2 className="text-2xl font-bold text-slate-800">模版解析成功</h2>
               <p className="text-slate-500 text-sm">已自动识别 XML 结构层次</p>
             </div>
          </div>
          
          {/* Default Next Button (Only shown if no existing content found, or as fallback) */}
          {!hasExistingContent && (
              <button 
                onClick={onNext}
                disabled={isAnalyzing}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl text-sm font-bold shadow-lg shadow-blue-200 transition-all flex items-center gap-2 hover:scale-105 disabled:opacity-50 disabled:scale-100"
              >
                确认并下一步 <span className="text-lg">→</span>
              </button>
          )}
        </div>

        {/* If existing content is found, show the Two Options UI overlaying the visualizer area or above it */}
        {hasExistingContent && onImportExisting && extractedData ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-200 p-8 space-y-6">
                <div className="text-center">
                    <h3 className="text-xl font-bold text-slate-800">💡 检测到文档中包含已撰写的内容</h3>
                    <p className="text-slate-500 mt-2">系统识别出约 <span className="font-mono font-bold text-blue-600">{extractedData.chapters.length}</span> 个章节结构和 <span className="font-mono font-bold text-blue-600">{previewContent.length}</span> 字的正文。请选择操作模式：</p>
                </div>
                
                <div className="flex gap-6 w-full max-w-3xl">
                    {/* Option 1: Template Only */}
                    <button 
                        onClick={onNext}
                        disabled={isAnalyzing}
                        className="flex-1 bg-white p-6 rounded-xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl transition-all group text-left relative overflow-hidden disabled:opacity-50 disabled:pointer-events-none"
                    >
                        <div className="absolute top-0 right-0 bg-slate-200 text-slate-600 text-[10px] font-bold px-2 py-1 rounded-bl">常规模式</div>
                        <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition-all">📄</div>
                        <h4 className="font-bold text-lg text-slate-800 group-hover:text-blue-600">作为空白模版使用</h4>
                        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                            忽略文档中的现有正文，仅提取样式规则。我们将从“题目确认”开始，引导您从零开始进行大纲设计与撰写。
                        </p>
                    </button>

                    {/* Option 2: Smart Import */}
                    <button 
                        onClick={handleSmartImport}
                        disabled={isAnalyzing}
                        className="flex-1 bg-purple-50 p-6 rounded-xl border-2 border-purple-200 hover:border-purple-500 hover:shadow-xl transition-all group text-left relative overflow-hidden disabled:opacity-50 disabled:pointer-events-none"
                    >
                        <div className="absolute top-0 right-0 bg-purple-200 text-purple-700 text-[10px] font-bold px-2 py-1 rounded-bl">推荐</div>
                        <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🚀</div>
                        <h4 className="font-bold text-lg text-purple-800">智能导入 (断点续写)</h4>
                        <p className="text-sm text-purple-600/80 mt-2 leading-relaxed">
                            AI 将分析现有章节结构，保留已写内容，并自动推导核心探讨记录。您可以直接跳过前期步骤，在现有进度上继续完善。
                        </p>
                    </button>
                </div>
                
                <div className="text-xs text-slate-400 mt-4 border-t pt-4 w-full text-center">
                    当前预览: <span className="font-mono">{previewContent.slice(0, 50)}...</span>
                </div>
            </div>
        ) : (
            <>
                <div className="flex-1 overflow-hidden border rounded-xl bg-slate-50">
                   <StructureVisualizer formatRules={formatRules} thesis={{ title: '', chapters: [] }} />
                </div>
                
                <div className="mt-4 shrink-0 bg-blue-50/50 p-3 rounded-lg border border-blue-100 text-xs text-slate-500 flex gap-4">
                   <span>📚 样式映射: Heading1={formatRules.styleIds.heading1}</span>
                   <span>🔤 正文字体: {formatRules.fontMain}</span>
                   <span>📐 纸张: {formatRules.metadata.paperSize}</span>
                </div>
            </>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto mt-12">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-slate-900 mb-4">上传 Word XML 模版</h2>
        <p className="text-slate-600 max-w-2xl mx-auto">
          请上传 Word 另存为的 <span className="font-mono text-blue-600 font-bold">Word 2003 XML</span> 或 <span className="font-mono text-blue-600 font-bold">Flat OPC</span> 文件。
        </p>
      </div>

      <div
        className={`relative border-2 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center transition-all cursor-pointer ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'
        }`}
        onDragEnter={onDrag}
        onDragLeave={onDrag}
        onDragOver={onDrag}
        onDrop={onDrop}
        onClick={() => document.getElementById('file-upload')?.click()}
      >
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6 pointer-events-none">
          <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-slate-900 font-medium mb-2 pointer-events-none">拖拽文件到此处，或点击上传</p>
        
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept=".xml"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg pointer-events-none transition-colors shadow-lg shadow-blue-200"
        >
          浏览文件
        </button>
      </div>
    </div>
  );
};

export default FormatAnalyzer;
