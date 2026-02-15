

import React, { useState } from 'react';
import { ThesisStructure, FormatRules, Reference, StyleSettings, StyleConfig, FontFamily, FontSizeName } from '../types';
import StructureVisualizer from './StructureVisualizer';
import { generateThesisXML, inspectHeaderDebugInfo, HeaderDebugInfo } from '../services/xmlParser';

interface PreviewerProps {
  thesis: ThesisStructure;
  formatRules: FormatRules;
  references: Reference[];
}

// Word size is half-points (e.g., 24 = 12pt)
const FONT_SIZE_MAP: Record<FontSizeName, string> = {
    '小初': '72',
    '一号': '52',
    '小一': '48',
    '二号': '44',
    '小二': '36',
    '三号': '32',
    '小三': '30',
    '四号': '28',
    '小四': '24',
    '五号': '21',
    '小五': '18'
};

const DEFAULT_SETTINGS: StyleSettings = {
    heading1: { fontFamilyCI: 'SimHei', fontFamilyAscii: 'Times New Roman', fontSize: '32', fontSizeName: '三号' },
    heading2: { fontFamilyCI: 'SimHei', fontFamilyAscii: 'Times New Roman', fontSize: '28', fontSizeName: '四号' },
    heading3: { fontFamilyCI: 'SimHei', fontFamilyAscii: 'Times New Roman', fontSize: '24', fontSizeName: '小四' },
    body: { fontFamilyCI: 'SimSun', fontFamilyAscii: 'Times New Roman', fontSize: '24', fontSizeName: '小四' },
    caption: { fontFamilyCI: 'FangSong', fontFamilyAscii: 'Times New Roman', fontSize: '21', fontSizeName: '五号' },
    table: { fontFamilyCI: 'SimSun', fontFamilyAscii: 'Times New Roman', fontSize: '21', fontSizeName: '五号' },
    reference: { fontFamilyCI: 'SimSun', fontFamilyAscii: 'Times New Roman', fontSize: '21', fontSizeName: '五号' },
    equationSeparator: '-',
    header: {
        oddPage: 'chapterTitle',
        evenPageText: '东南大学硕士学位论文'
    },
    keepHeadingNumbers: false // Default to false (strip standard 1.1) to allow Word auto-numbering
};

// Define a type that only includes keys mapping to StyleConfig (excluding equationSeparator/header/keepHeadingNumbers)
type StyleConfigKey = Exclude<keyof StyleSettings, 'equationSeparator' | 'header' | 'keepHeadingNumbers'>;

const Previewer: React.FC<PreviewerProps> = ({ thesis, formatRules, references }) => {
  const [viewMode, setViewMode] = useState<'doc' | 'visual'>('doc');
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [styles, setStyles] = useState<StyleSettings>(DEFAULT_SETTINGS);
  
  // Debug State
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [debugInfo, setDebugInfo] = useState<HeaderDebugInfo[]>([]);

  // Restored helper function (kept for legacy compatibility or enhanced debug labeling)
  const getSectionTypeLabel = (index: number, total: number, headers: any[]) => {
      // Heuristic guess
      if (index === 1) return "第1节 (封面/目录)";
      if (index === total) return `第${index}节 (封底/附录)`;
      
      // Check content
      const combinedText = headers.map((h: any) => h.data.text).join(" ");
      if (combinedText.includes("章") || combinedText.includes("Chapter")) return `第${index}节 (正文)`;
      
      return `第${index}节 (正文)`;
  };

  const handleExport = () => {
    try {
      // Generate with styles!
      const xml = generateThesisXML(thesis, formatRules, references, styles);
      const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${thesis.title || 'thesis'}_formatted.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export Error:", e);
      alert(`导出失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  };

  const handleDebug = () => {
      try {
          const xml = generateThesisXML(thesis, formatRules, references, styles);
          const info = inspectHeaderDebugInfo(xml);
          setDebugInfo(info);
          setShowDebugModal(true);
      } catch(e) {
          alert("Debug Failed: " + e);
      }
  };

  const updateStyle = (key: StyleConfigKey, field: keyof StyleConfig, value: string) => {
      setStyles(prev => {
          const oldConfig = prev[key] as StyleConfig;
          const newConfig = { ...oldConfig, [field]: value };
          if (field === 'fontSizeName') {
              newConfig.fontSize = FONT_SIZE_MAP[value as FontSizeName];
          }
          return { ...prev, [key]: newConfig };
      });
  };

  const StyleRow = ({ label, confKey }: { label: string; confKey: StyleConfigKey }) => (
      <div className="grid grid-cols-12 gap-2 items-center text-sm py-1 border-b border-slate-100 last:border-0">
          <div className="col-span-3 font-bold text-slate-600">{label}</div>
          <div className="col-span-4">
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs"
                value={(styles[confKey] as StyleConfig).fontFamilyCI}
                onChange={e => updateStyle(confKey, 'fontFamilyCI', e.target.value)}
              >
                  <option value="SimSun">宋体</option>
                  <option value="SimHei">黑体</option>
                  <option value="FangSong">仿宋</option>
                  <option value="KaiTi">楷体</option>
              </select>
          </div>
          <div className="col-span-2 text-xs text-slate-400 text-center font-mono">
              Times
          </div>
          <div className="col-span-3">
              <select 
                 className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs"
                 value={(styles[confKey] as StyleConfig).fontSizeName}
                 onChange={e => updateStyle(confKey, 'fontSizeName', e.target.value)}
              >
                  {Object.keys(FONT_SIZE_MAP).map(k => (
                      <option key={k} value={k}>{k}</option>
                  ))}
              </select>
          </div>
      </div>
  );

  const renderContent = (content?: string) => {
      if (!content) return <div className="text-slate-300 italic">...</div>;
      
      // Clean up XML-like placeholders for preview
      const cleanText = content.replace(/<[^>]+>/g, '');
      
      // Split by newline and render paragraphs
      return cleanText.split('\n').map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) return null;
          
          // Handle placeholders visually
          if (trimmed.startsWith('[[FIG:')) {
              return <div key={idx} className="text-center text-blue-500 text-xs my-2 font-bold">{trimmed.replace('[[FIG:', '图: ').replace(']]', '')}</div>;
          }
          if (trimmed.startsWith('[[TBL:')) {
              return <div key={idx} className="text-center text-green-600 text-xs my-2 font-bold">{trimmed.replace('[[TBL:', '表: ').replace(']]', '')}</div>;
          }
          if (trimmed.startsWith('[[EQ:')) {
             const eqText = trimmed.replace('[[EQ:', '').replace(']]', '');
             return <div key={idx} className="text-center text-slate-700 text-sm font-mono my-2">{eqText} <span className="float-right text-xs opacity-50">(3-1)</span></div>;
          }

          return (
              <p key={idx} className="leading-relaxed text-justify indent-8 text-sm mb-1.5" style={{ fontFamily: styles.body.fontFamilyCI }}>
                  {trimmed}
              </p>
          );
      });
  };

  return (
    <div className="h-full flex flex-col relative">
       <div className="flex justify-between px-8 py-2 mb-2 items-center">
            <div className="flex bg-slate-200 rounded-lg p-1 text-xs font-bold text-slate-600">
                <button 
                   onClick={() => setViewMode('doc')}
                   className={`px-3 py-1 rounded ${viewMode === 'doc' ? 'bg-white shadow text-blue-600' : 'hover:bg-slate-300/50'}`}
                >
                   文档预览
                </button>
                <button 
                   onClick={() => setViewMode('visual')}
                   className={`px-3 py-1 rounded ${viewMode === 'visual' ? 'bg-white shadow text-blue-600' : 'hover:bg-slate-300/50'}`}
                >
                   结构透视
                </button>
             </div>
             
             <div className="flex gap-3">
                 <button
                    onClick={handleDebug}
                    className="bg-orange-50 border border-orange-200 hover:bg-orange-100 text-orange-700 px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2"
                 >
                    <span>🔍</span> 调试页眉
                 </button>
                 <button
                    onClick={() => setShowStylePanel(!showStylePanel)}
                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2"
                 >
                    <span>🛠️</span> 排版设置
                 </button>
                 <button 
                    onClick={handleExport}
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2"
                 >
                    <span>📤</span> 导出 XML
                 </button>
             </div>
       </div>

        {/* Debug Modal */}
        {showDebugModal && (
            <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-8">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
                    <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                        <div>
                            <h3 className="font-bold text-slate-800">页眉生成结果透视</h3>
                            <p className="text-xs text-slate-500 mt-1">
                                检测到的H1样式名: <span className="font-mono bg-slate-200 px-1 rounded text-slate-700">{debugInfo[0]?.detectedH1Style}</span> 
                                {styles.header.headerReferenceStyle && <span className="ml-2 text-blue-600">(当前强制覆盖为: {styles.header.headerReferenceStyle})</span>}
                            </p>
                        </div>
                        <button onClick={() => setShowDebugModal(false)} className="text-slate-400 hover:text-red-500 text-xl font-bold px-2">✕</button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-100 space-y-6">
                        {debugInfo.length === 0 ? (
                            <div className="text-center text-slate-400 py-10">未检测到 Section 信息，请检查 XML 结构。</div>
                        ) : (
                            debugInfo.map((sect, i) => (
                                <div key={i} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-2 bg-slate-50 border-b font-mono text-sm font-bold text-slate-700 flex flex-col gap-1">
                                        <div className="flex justify-between items-center">
                                            <span>
                                                {/* Use restored function for labeling */}
                                                {getSectionTypeLabel(sect.sectionIndex, debugInfo.length, sect.headers)}
                                            </span>
                                            {/* Show Start Text prominently to help user identify chapter */}
                                            <span className="text-blue-600 font-serif max-w-md truncate text-right">
                                                &quot;{sect.sectionStartText}&quot;
                                            </span>
                                        </div>
                                    </div>
                                    <div className="divide-y">
                                        {sect.headers.map((h, hi) => {
                                            // Combine field codes for easier reading
                                            const combinedFields = h.data.fields.join(" ").replace(/\s+/g, ' ');
                                            const hasError = combinedFields.toLowerCase().includes("heading 1") && !styles.header.headerReferenceStyle?.toLowerCase().includes("heading");
                                            
                                            return (
                                                <div key={hi} className={`p-4 grid grid-cols-12 gap-4 ${hasError ? 'bg-red-50/50' : ''}`}>
                                                    <div className="col-span-2">
                                                        <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded block w-fit mb-1 ${
                                                            h.type === 'default' ? 'bg-blue-100 text-blue-700' : 
                                                            h.type === 'even' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                                                        }`}>
                                                            {h.type || 'ODD (默认)'}
                                                        </span>
                                                        <div className="text-[10px] text-slate-400 font-mono break-all">{h.file}</div>
                                                    </div>
                                                    <div className="col-span-10 space-y-3">
                                                        <div className="text-xs">
                                                            <span className="font-bold text-slate-700 block mb-1">预览文本 (Text):</span>
                                                            <div className="bg-white p-2 rounded border border-slate-200 text-slate-600 font-serif min-h-[2rem]">
                                                                {h.data.text || <span className="italic text-slate-300">Empty</span>}
                                                            </div>
                                                        </div>
                                                        <div className="text-xs">
                                                            <span className="font-bold text-slate-700 block mb-1">域代码指令 (Field Codes):</span>
                                                            {h.data.fields.length > 0 ? (
                                                                <div className={`font-mono p-2 rounded border text-[11px] break-all ${
                                                                    hasError ? 'bg-red-100 text-red-700 border-red-300' : 'bg-yellow-50 text-yellow-800 border-yellow-200'
                                                                }`}>
                                                                    {combinedFields}
                                                                </div>
                                                            ) : <span className="italic text-slate-300">None</span>}
                                                            
                                                            {hasError && (
                                                                <div className="mt-1 text-[10px] text-red-500 font-bold">
                                                                    ⚠️ 警告: 似乎引用了错误的样式名。请尝试在“排版设置”中手动指定样式名为 "标题 1"。
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* Style Configuration Panel */}
        {showStylePanel && (
            <div className="absolute top-12 right-8 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 animate-fade-in p-5 max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-slate-800">自定义排版样式</h3>
                    <button onClick={() => setShowStylePanel(false)} className="text-slate-400 hover:text-red-500">✕</button>
                </div>
                <div className="grid grid-cols-12 gap-2 text-xs font-bold text-slate-400 mb-2 px-1">
                    <div className="col-span-3">对象</div>
                    <div className="col-span-4">中文字体</div>
                    <div className="col-span-2 text-center">英文</div>
                    <div className="col-span-3">字号</div>
                </div>
                <div className="space-y-1">
                    <StyleRow label="一级标题" confKey="heading1" />
                    <StyleRow label="二级标题" confKey="heading2" />
                    <StyleRow label="三级标题" confKey="heading3" />
                    <StyleRow label="正文段落" confKey="body" />
                    <StyleRow label="图表标题" confKey="caption" />
                    <StyleRow label="表格内容" confKey="table" />
                    <StyleRow label="参考文献" confKey="reference" />
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                     <div className="flex items-center justify-between">
                         <span className="font-bold text-slate-600 text-sm">公式编号</span>
                         <div className="flex bg-slate-100 rounded p-1 text-xs">
                             <button 
                               onClick={() => setStyles(prev => ({...prev, equationSeparator: '-'}))}
                               className={`px-3 py-1 rounded transition-colors ${styles.equationSeparator === '-' ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-500'}`}
                             >
                                (3-1)
                             </button>
                             <button 
                               onClick={() => setStyles(prev => ({...prev, equationSeparator: '.'}))}
                               className={`px-3 py-1 rounded transition-colors ${styles.equationSeparator === '.' ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-500'}`}
                             >
                                (3.1)
                             </button>
                         </div>
                     </div>
                     
                     <div className="flex items-center justify-between">
                         <span className="font-bold text-slate-600 text-sm">保留标题自动编号</span>
                         <div className="flex bg-slate-100 rounded p-1 text-xs">
                             <button 
                               onClick={() => setStyles(prev => ({...prev, keepHeadingNumbers: true}))}
                               className={`px-3 py-1 rounded transition-colors ${styles.keepHeadingNumbers ? 'bg-white shadow text-green-600 font-bold' : 'text-slate-500'}`}
                             >
                                保留(1.1)
                             </button>
                             <button 
                               onClick={() => setStyles(prev => ({...prev, keepHeadingNumbers: false}))}
                               className={`px-3 py-1 rounded transition-colors ${!styles.keepHeadingNumbers ? 'bg-white shadow text-red-600 font-bold' : 'text-slate-500'}`}
                             >
                                移除(Word自动)
                             </button>
                         </div>
                     </div>
                     <p className="text-[10px] text-slate-400">选择“移除”通常能激活 Word 样式的自动编号功能。若您的模版无自动编号，请选择“保留”。</p>

                     <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100">
                         <span className="font-bold text-slate-600 text-sm">页眉高级设置</span>
                         
                         <div className="flex flex-col gap-1 text-xs mt-1">
                             <div className="flex justify-between items-center mb-1">
                                <span className="text-slate-500">奇数页内容</span>
                                <div className="flex bg-slate-200 rounded p-0.5">
                                    <button 
                                      onClick={() => setStyles(prev => ({...prev, header: {...prev.header, oddPage: 'chapterTitle'}}))}
                                      className={`px-2 py-0.5 rounded transition-colors ${styles.header.oddPage === 'chapterTitle' ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-500'}`}
                                    >
                                       章节标题
                                    </button>
                                    <button 
                                      onClick={() => setStyles(prev => ({...prev, header: {...prev.header, oddPage: 'none'}}))}
                                      className={`px-2 py-0.5 rounded transition-colors ${styles.header.oddPage === 'none' ? 'bg-white shadow text-blue-600 font-bold' : 'text-slate-500'}`}
                                    >
                                       不修改
                                    </button>
                                </div>
                             </div>
                             
                             <div className="flex flex-col gap-1 mt-2">
                                <label className="text-slate-500 flex items-center gap-1">
                                   引用样式修正
                                   <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded" title="如果生成的页眉显示错误（如显示heading 1），请尝试在此处输入 '标题 1'">?</span>
                                </label>
                                <input 
                                  type="text"
                                  className="border rounded px-2 py-1 bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                                  placeholder="默认自动 (建议: 标题 1)"
                                  value={styles.header.headerReferenceStyle || ''}
                                  onChange={e => setStyles(prev => ({...prev, header: {...prev.header, headerReferenceStyle: e.target.value}}))}
                                />
                             </div>
                         </div>
                         
                         <div className="flex flex-col gap-1 text-xs mt-2 pt-2 border-t border-slate-200">
                             <span className="text-slate-500">偶数页文字</span>
                             <input 
                               type="text"
                               className="border rounded px-2 py-1 bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                               value={styles.header.evenPageText}
                               onChange={e => setStyles(prev => ({...prev, header: {...prev.header, evenPageText: e.target.value}}))}
                             />
                         </div>
                     </div>
                </div>

                <div className="mt-4 p-3 bg-blue-50 text-blue-700 text-[10px] rounded leading-relaxed">
                    注：若选择移除编号，系统将剥离类似 "1.1" 的前缀，依赖 Word 样式的自动编号。请在 Word 中更新域代码（全选 → F9）以刷新页眉和目录。
                </div>
            </div>
        )}

       <div className="flex-1 overflow-y-auto custom-scrollbar px-8 pb-8">
         {viewMode === 'visual' ? (
             <div className="bg-white p-6 rounded-xl border shadow-sm">
                 <StructureVisualizer formatRules={formatRules} thesis={thesis} />
             </div>
         ) : (
            <div className="max-w-4xl mx-auto bg-white shadow-2xl rounded-sm p-16 thesis-preview border relative">
              <div className="text-center mb-16">
                <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: styles.heading1.fontFamilyCI }}>
                  {thesis.title || "论文题目"}
                </h1>
                <p className="text-slate-500">硕士学位论文预览稿</p>
              </div>

              <div className="space-y-12">
                {thesis.chapters.map((ch, idx) => (
                  <section key={ch.id}>
                    <h2 className="text-xl font-bold mb-6 text-center" style={{ fontFamily: styles.heading1.fontFamilyCI }}>
                      {ch.title}
                    </h2>
                    
                    <div className="mb-6">
                      {renderContent(ch.content)}
                    </div>

                    {ch.subsections?.map((sub, sIdx) => (
                      <div key={sub.id} className="mt-8 mb-4">
                        <h3 className="text-lg font-bold mb-4" style={{ fontFamily: styles.heading2.fontFamilyCI }}>
                          {sub.title}
                        </h3>
                        <div className="mb-4">
                           {renderContent(sub.content)}
                        </div>

                        {/* Heading 3 Support */}
                        {sub.subsections?.map((h3, h3Idx) => (
                            <div key={h3.id} className="mt-4 mb-2 ml-2">
                                <h4 className="text-base font-bold mb-2" style={{ fontFamily: styles.heading3.fontFamilyCI }}>
                                    {h3.title}
                                </h4>
                                <div>
                                    {renderContent(h3.content)}
                                </div>
                            </div>
                        ))}
                      </div>
                    ))}
                  </section>
                ))}

                {references.length > 0 && (
                  <section className="mt-20 border-t pt-10">
                    <h2 className="text-xl font-bold text-center mb-8" style={{ fontFamily: styles.heading1.fontFamilyCI }}>参考文献</h2>
                    <div className="space-y-2 text-xs" style={{ fontFamily: styles.reference.fontFamilyCI }}>
                      {references.map((ref, idx) => (
                        <div key={idx} className="flex gap-2">
                          <span className="shrink-0">[{ref.id}]</span>
                          <span>{ref.description}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              <div className="mt-20 text-center text-slate-300 text-xs">
                - {thesis.title} 预览结束 -
              </div>
            </div>
         )}
       </div>
    </div>
  );
};

export default Previewer;