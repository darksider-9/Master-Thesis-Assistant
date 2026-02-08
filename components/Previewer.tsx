
import React, { useState } from 'react';
import { ThesisStructure, FormatRules, Reference } from '../types';
import StructureVisualizer from './StructureVisualizer';

interface PreviewerProps {
  thesis: ThesisStructure;
  formatRules: FormatRules;
  references: Reference[];
}

const Previewer: React.FC<PreviewerProps> = ({ thesis, formatRules, references }) => {
  const [viewMode, setViewMode] = useState<'doc' | 'visual'>('doc');

  return (
    <div className="h-full flex flex-col">
       <div className="flex justify-end px-8 py-2 mb-2">
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
       </div>

       <div className="flex-1 overflow-y-auto custom-scrollbar px-8 pb-8">
         {viewMode === 'visual' ? (
             <div className="bg-white p-6 rounded-xl border shadow-sm">
                 <StructureVisualizer formatRules={formatRules} thesis={thesis} />
             </div>
         ) : (
            <div className="max-w-4xl mx-auto bg-white shadow-2xl rounded-sm p-16 thesis-preview border">
              <div className="text-center mb-16">
                <h1 className="text-2xl font-bold mb-4 font-serif">
                  {thesis.title || "论文题目"}
                </h1>
                <p className="text-slate-500">硕士学位论文预览稿</p>
              </div>

              <div className="space-y-12">
                {thesis.chapters.map((ch, idx) => (
                  <section key={ch.id}>
                    <h2 className="text-xl font-bold mb-6 text-center font-serif">
                      {ch.title}
                    </h2>
                    
                    <div className="leading-relaxed text-justify indent-8 text-sm font-serif">
                      {ch.content ? ch.content.replace(/<[^>]+>/g, '') : "内容正在生成中..."}
                    </div>

                    {ch.subsections?.map((sub, sIdx) => (
                      <div key={sub.id} className="mt-8">
                        <h3 className="text-lg font-bold mb-4 font-serif">
                          {sub.title}
                        </h3>
                        <div className="leading-relaxed text-justify indent-8 text-sm font-serif">
                          {sub.content ? sub.content.replace(/<[^>]+>/g, '') : "小节内容..."}
                        </div>
                      </div>
                    ))}
                  </section>
                ))}

                {references.length > 0 && (
                  <section className="mt-20 border-t pt-10">
                    <h2 className="text-xl font-bold text-center mb-8 font-serif">参考文献</h2>
                    <div className="space-y-2 text-xs">
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
