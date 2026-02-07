
import React, { useState } from 'react';

interface FormatAnalyzerProps {
  onUpload: (content: string) => void;
}

const FormatAnalyzer: React.FC<FormatAnalyzerProps> = ({ onUpload }) => {
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

  return (
    <div className="max-w-4xl mx-auto mt-12">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-slate-900 mb-4">上传你的论文模版</h2>
        <p className="text-slate-600 max-w-2xl mx-auto">
          请上传由 Word 另存为的 <span className="font-mono text-blue-600 font-bold">XML (WordML)</span> 文件。
          我们将自动解析其中的页边距、字体、段落间距及标题层级样式。
        </p>
      </div>

      <div
        className={`relative border-2 border-dashed rounded-2xl p-20 flex flex-col items-center justify-center transition-all ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:border-slate-400'
        }`}
        onDragEnter={onDrag}
        onDragLeave={onDrag}
        onDragOver={onDrag}
        onDrop={onDrop}
      >
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-slate-900 font-medium mb-2">拖拽文件到此处，或点击上传</p>
        <p className="text-slate-500 text-sm mb-6">仅支持 .xml 格式 (Word 2003 XML)</p>
        
        <input
          type="file"
          id="file-upload"
          className="hidden"
          accept=".xml"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <label
          htmlFor="file-upload"
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg cursor-pointer transition-colors shadow-lg shadow-blue-200"
        >
          浏览文件
        </label>
      </div>

      <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { title: "自动解析格式", desc: "自动识别宋体/黑体、字号及行间距，确保生成内容与学校要求一致。" },
          { title: "智能章节建议", desc: "基于导师视角，根据你的论文题目自动生成科学合理的章节结构。" },
          { title: "三线表与自动编号", desc: "符合国内学术规范，图表、公式自动编号并保持引用同步。" }
        ].map((item, i) => (
          <div key={i} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-slate-800 mb-2">{item.title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FormatAnalyzer;
