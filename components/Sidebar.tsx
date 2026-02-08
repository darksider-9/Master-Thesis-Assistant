
import React, { useRef } from 'react';
import { Step } from '../types';

interface SidebarProps {
  currentStep: Step;
  setCurrentStep: (step: Step) => void;
  onSaveProject?: () => void;
  onLoadProject?: (file: File) => void;
  onOpenSettings: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentStep, setCurrentStep, onSaveProject, onLoadProject, onOpenSettings }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const steps: { id: Step; label: string; icon: string }[] = [
    { id: 'upload', label: '1. 格式解析', icon: '📄' },
    { id: 'title', label: '2. 题目确认', icon: '🏷️' },
    { id: 'structure', label: '3. 章节设计', icon: '🏗️' },
    { id: 'discussion', label: '4. 核心探讨', icon: '💭' },
    { id: 'writing', label: '5. 智能撰写', icon: '✍️' },
    { id: 'export', label: '6. 导出预览', icon: '📤' },
  ];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0] && onLoadProject) {
      onLoadProject(e.target.files[0]);
    }
    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col">
      <div className="p-6">
        <div className="text-blue-400 font-bold tracking-widest text-xs uppercase mb-8">THESIS COMPANION</div>
        <nav className="space-y-2">
          {steps.map((step) => (
            <button
              key={step.id}
              onClick={() => setCurrentStep(step.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                currentStep === step.id
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50'
                  : 'hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span>{step.icon}</span>
              {step.label}
            </button>
          ))}
        </nav>

        {/* Project Management Section */}
        <div className="mt-8 pt-8 border-t border-slate-800">
          <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">项目管理</p>
          <div className="space-y-2">
            <button 
              onClick={onSaveProject}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
            >
              <span>💾</span> 保存进度 (.json)
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 hover:text-white transition-colors border border-slate-700"
            >
              <span>📂</span> 加载进度
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".json" 
              onChange={handleFileChange}
            />
          </div>
        </div>
      </div>

      <div className="mt-auto p-6 border-t border-slate-800">
        <button 
            onClick={onOpenSettings}
            className="flex items-center gap-3 p-3 bg-slate-800 hover:bg-slate-700 w-full rounded-lg transition-colors group mb-2"
        >
            <div className="w-8 h-8 rounded-full bg-slate-700 group-hover:bg-blue-600 flex items-center justify-center text-white text-xs transition-colors">⚙️</div>
            <div className="text-left">
                <div className="text-xs font-bold text-white">模型 API 设置</div>
                <div className="text-[10px] text-slate-400">配置 Key & URL</div>
            </div>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
