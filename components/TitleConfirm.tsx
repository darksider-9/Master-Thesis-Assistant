
import React, { useState } from 'react';

interface TitleConfirmProps {
  initialTitle: string;
  onConfirm: (title: string) => void;
}

const TitleConfirm: React.FC<TitleConfirmProps> = ({ initialTitle, onConfirm }) => {
  const [title, setTitle] = useState(initialTitle);

  return (
    <div className="max-w-2xl mx-auto mt-20 text-center">
      <div className="mb-8">
        <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
          🎓
        </div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">确认论文题目</h2>
        <p className="text-slate-500">这将作为 AI 导师为您规划章节和撰写内容的核心依据</p>
      </div>

      <div className="bg-white p-8 rounded-2xl border shadow-sm">
        <label className="block text-left text-sm font-bold text-slate-700 mb-2">
          硕士学位论文题目
        </label>
        <input
          type="text"
          className="w-full text-xl p-4 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all placeholder:text-slate-300"
          placeholder="例如：基于深度学习的医学图像分割研究"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && onConfirm(title)}
          autoFocus
        />
        
        <div className="mt-8 flex justify-end">
          <button
            onClick={() => title.trim() && onConfirm(title)}
            disabled={!title.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-8 py-3 rounded-xl font-bold transition-all flex items-center gap-2"
          >
            下一步：章节设计
            <span className="text-lg">→</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TitleConfirm;
