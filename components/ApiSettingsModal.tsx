
import React, { useState, useEffect } from 'react';
import { ApiSettings } from '../types';

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ApiSettings;
  onSave: (settings: ApiSettings) => void;
}

const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose, settings, onSave }) => {
  const [formData, setFormData] = useState<ApiSettings>(settings);

  useEffect(() => {
    if (isOpen) {
      setFormData(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-fade-in">
        <div className="p-6 border-b bg-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <span>⚙️</span> 模型 API 配置
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            ✕
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">API Key <span className="text-red-500">*</span></label>
            <input 
              type="password" 
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="sk-..."
              value={formData.apiKey}
              onChange={e => setFormData({...formData, apiKey: e.target.value})}
            />
            <p className="text-[10px] text-slate-400 mt-1">您的 Key 仅存储在本地浏览器中，不会上传至服务器。</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Base URL (可选)</label>
            <input 
              type="text" 
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="https://generativelanguage.googleapis.com"
              value={formData.baseUrl || ''}
              onChange={e => setFormData({...formData, baseUrl: e.target.value})}
            />
            <p className="text-[10px] text-slate-400 mt-1">如果您使用代理地址，请在此填写。</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">Model Name</label>
            <input 
              type="text" 
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
              placeholder="gemini-3-pro-preview"
              value={formData.modelName}
              onChange={e => setFormData({...formData, modelName: e.target.value})}
            />
            <div className="flex gap-2 mt-2">
                {['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash-preview'].map(m => (
                    <button 
                        key={m}
                        onClick={() => setFormData({...formData, modelName: m})}
                        className="text-[10px] bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded border border-slate-200"
                    >
                        {m}
                    </button>
                ))}
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
          >
            取消
          </button>
          <button 
            onClick={() => { onSave(formData); onClose(); }}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-md transition-colors"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
};

export default ApiSettingsModal;
