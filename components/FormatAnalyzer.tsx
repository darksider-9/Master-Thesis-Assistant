
import React, { useState } from 'react';
import { FormatRules } from '../types';
import StructureVisualizer from './StructureVisualizer';

interface FormatAnalyzerProps {
  onUpload: (content: string) => void;
  formatRules: FormatRules | null;
  onNext: () => void;
}

const FormatAnalyzer: React.FC<FormatAnalyzerProps> = ({ onUpload, formatRules, onNext }) => {
  const [dragActive, setDragActive] = useState(false);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      onUpload(content);
    };
    reader.readAsText(file);
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
      <div className="max-w-6xl mx-auto mt-6 bg-white p-6 rounded-2xl shadow-xl border border-blue-100 h-[600px] flex flex-col">
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
          <div className="flex gap-3">
             <button 
               onClick={onNext}
               className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl text-sm font-bold shadow-lg shadow-blue-200 transition-all flex items-center gap-2 hover:scale-105"
             >
               确认并下一步 <span className="text-lg">→</span>
             </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden border rounded-xl bg-slate-50">
           {/* Use the Unified Visualizer here passing empty thesis structure initially */}
           <StructureVisualizer formatRules={formatRules} thesis={{ title: '', chapters: [] }} />
        </div>
        
        <div className="mt-4 shrink-0 bg-blue-50/50 p-3 rounded-lg border border-blue-100 text-xs text-slate-500 flex gap-4">
           <span>📚 样式映射: Heading1={formatRules.styleIds.heading1}</span>
           <span>🔤 正文字体: {formatRules.fontMain}</span>
           <span>📐 纸张: {formatRules.metadata.paperSize}</span>
        </div>
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
