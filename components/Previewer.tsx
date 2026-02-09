import React, { useState } from 'react';
import { ThesisStructure, FormatRules, Reference, StyleSettings, StyleConfig, FontFamily, FontSizeName } from '../types';
import StructureVisualizer from './StructureVisualizer';
import { generateThesisXML } from '../services/xmlParser';

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
    equationSeparator: '-'
};

// Define a type that only includes keys mapping to StyleConfig (excluding equationSeparator)
type StyleConfigKey = Exclude<keyof StyleSettings, 'equationSeparator'>;

const Previewer: React.FC<PreviewerProps> = ({ thesis, formatRules, references }) => {
  const [viewMode, setViewMode] = useState<'doc' | 'visual'>('doc');
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [styles, setStyles] = useState<StyleSettings>(DEFAULT_SETTINGS);

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

        {/* Style Configuration Panel */}
        {showStylePanel && (
            <div className="absolute top-12 right-8 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 animate-fade-in p-5">
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

                <div className="mt-4 pt-4 border-t border-slate-100">
                     <div className="flex items-center justify-between">
                         <span className="font-bold text-slate-600 text-sm">公式编号格式</span>
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
                </div>

                <div className="mt-4 p-3 bg-blue-50 text-blue-700 text-[10px] rounded leading-relaxed">
                    注：导出时将强制覆盖模板中的原始样式。英文默认锁定 Times New Roman。
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