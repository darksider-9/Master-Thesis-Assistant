
import React from 'react';
import { ThesisStructure, FormatRules, Reference } from '../types';

interface PreviewerProps {
  thesis: ThesisStructure;
  formatRules: FormatRules;
  references: Reference[];
}

const Previewer: React.FC<PreviewerProps> = ({ thesis, formatRules, references }) => {
  return (
    <div className="max-w-4xl mx-auto bg-white shadow-2xl rounded-sm p-16 thesis-preview border">
      <div className="text-center mb-16">
        <h1 className="text-2xl font-bold mb-4" style={{ fontFamily: formatRules.fontHeading }}>
          {thesis.title || "论文题目"}
        </h1>
        <p className="text-slate-500">硕士学位论文预览稿</p>
      </div>

      <div className="space-y-12">
        {thesis.chapters.map((ch, idx) => (
          <section key={ch.id}>
            <h2 
              className="font-bold mb-6 text-center" 
              style={{ fontSize: formatRules.fontSizeH1, fontFamily: formatRules.fontHeading }}
            >
              第{idx + 1}章 {ch.title}
            </h2>
            
            <div 
              className="leading-relaxed text-justify"
              style={{ 
                fontSize: formatRules.fontSizeNormal, 
                fontFamily: formatRules.fontMain,
                textIndent: '2em'
              }}
            >
              {ch.content || "内容正在生成中..."}
            </div>

            {ch.subsections?.map((sub, sIdx) => (
              <div key={sub.id} className="mt-8">
                <h3 
                  className="font-bold mb-4" 
                  style={{ fontSize: formatRules.fontSizeH2, fontFamily: formatRules.fontHeading }}
                >
                  {idx + 1}.{sIdx + 1} {sub.title}
                </h3>
                <div 
                  className="leading-relaxed text-justify"
                  style={{ fontSize: formatRules.fontSizeNormal, fontFamily: formatRules.fontMain }}
                >
                  {sub.content || "小节内容..."}
                </div>
              </div>
            ))}
          </section>
        ))}

        {references.length > 0 && (
          <section className="mt-20 border-t pt-10">
            <h2 className="text-xl font-bold text-center mb-8" style={{ fontFamily: formatRules.fontHeading }}>参考文献</h2>
            <div className="space-y-2 text-xs">
              {references.map((ref, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="shrink-0">[{ref.id}]</span>
                  <span>相关论文文献: {ref.description}</span>
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
  );
};

export default Previewer;
