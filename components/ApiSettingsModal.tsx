import React, { useState, useEffect } from 'react';
import { ApiSettings, UsageStats } from '../types';
import { testApiConnection } from '../services/geminiService';

interface ApiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ApiSettings;
  onSave: (settings: ApiSettings) => void;
  usageStats?: UsageStats;
}

const ApiSettingsModal: React.FC<ApiSettingsModalProps> = ({ isOpen, onClose, settings, onSave, usageStats }) => {
  const [formData, setFormData] = useState<ApiSettings>(settings);
  const [activeTab, setActiveTab] = useState<'config' | 'usage'>('config');
  const [testResult, setTestResult] = useState<any>(null);
  const [isTesting, setIsTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFormData(settings);
      setActiveTab('config');
      setTestResult(null);
    }
  }, [isOpen, settings]);

  const handleReset = () => {
      // Reset to potentially env vars or empty
      const defaultKey = (typeof process !== 'undefined' && process.env && process.env.API_KEY) ? process.env.API_KEY : '';
      setFormData({
          apiKey: defaultKey,
          baseUrl: '',
          modelName: 'gemini-2.0-flash'
      });
  };

  const handleTest = async () => {
      setIsTesting(true);
      setTestResult(null);
      try {
          const res = await testApiConnection(formData);
          setTestResult(res);
      } catch (e) {
          setTestResult({ error: String(e) });
      } finally {
          setIsTesting(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in flex flex-col max-h-[90vh]">
        <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
          <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <span>⚙️</span> 模型 API 配置
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            ✕
          </button>
        </div>
        
        <div className="flex border-b border-slate-100 shrink-0">
            <button 
                onClick={() => setActiveTab('config')}
                className={`flex-1 py-3 text-sm font-bold text-center transition-colors ${activeTab === 'config' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50' : 'text-slate-500 hover:bg-slate-50'}`}
            >
                API 设置
            </button>
            <button 
                onClick={() => setActiveTab('usage')}
                className={`flex-1 py-3 text-sm font-bold text-center transition-colors ${activeTab === 'usage' ? 'text-green-600 border-b-2 border-green-600 bg-green-50' : 'text-slate-500 hover:bg-slate-50'}`}
            >
                用量统计 📊
            </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
            {activeTab === 'config' ? (
                 <div className="space-y-4">
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
                        <p className="text-[10px] text-slate-400 mt-1">如果您使用国内代理，请在此填写 (例如: https://api.proxy.com)</p>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Model Name</label>
                        <input 
                        type="text" 
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                        placeholder="gemini-2.0-flash"
                        value={formData.modelName}
                        onChange={e => setFormData({...formData, modelName: e.target.value})}
                        />
                        <div className="flex gap-2 mt-2 flex-wrap">
                            {['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'].map(m => (
                                <button 
                                    key={m}
                                    onClick={() => setFormData({...formData, modelName: m})}
                                    className={`text-[10px] px-2 py-1 rounded border ${formData.modelName === m ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-xs font-bold text-slate-500">API 连接测试 (Test)</label>
                            <button 
                                onClick={handleTest} 
                                disabled={isTesting}
                                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded transition-colors flex items-center gap-1"
                            >
                                {isTesting ? <span className="animate-spin">⏳</span> : '🧪 发送测试'}
                            </button>
                        </div>
                        {testResult && (
                            <div className="bg-slate-900 rounded-lg p-3 overflow-x-auto max-h-40 border border-slate-700">
                                <pre className="text-[10px] font-mono text-green-400 leading-tight">
                                    {JSON.stringify(testResult, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                 </div>
            ) : (
                <div className="space-y-6">
                    {usageStats ? (
                        <>
                           <div className="grid grid-cols-2 gap-4">
                               <div className="bg-slate-50 p-4 rounded-xl text-center border border-slate-100">
                                   <div className="text-2xl font-bold text-slate-800">{usageStats.totalCalls}</div>
                                   <div className="text-xs text-slate-500 uppercase tracking-wider">总 API 调用</div>
                               </div>
                               <div className="bg-slate-50 p-4 rounded-xl text-center border border-slate-100">
                                   <div className="text-2xl font-bold text-blue-600">{(usageStats.totalPromptTokens + usageStats.totalCompletionTokens).toLocaleString()}</div>
                                   <div className="text-xs text-slate-500 uppercase tracking-wider">总 Token 消耗</div>
                               </div>
                           </div>

                           <div className="space-y-3">
                               <h4 className="font-bold text-sm text-slate-700 border-b pb-2">消耗分布</h4>
                               <div className="flex items-center justify-between text-xs">
                                   <span className="text-slate-500">提示词 (Input)</span>
                                   <span className="font-mono">{usageStats.totalPromptTokens.toLocaleString()}</span>
                               </div>
                               <div className="flex items-center justify-between text-xs">
                                   <span className="text-slate-500">生成 (Output)</span>
                                   <span className="font-mono">{usageStats.totalCompletionTokens.toLocaleString()}</span>
                               </div>
                               <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden flex">
                                   <div 
                                      className="bg-blue-400 h-full" 
                                      style={{ width: `${(usageStats.totalPromptTokens / (usageStats.totalPromptTokens + usageStats.totalCompletionTokens || 1)) * 100}%` }}
                                   />
                                   <div 
                                      className="bg-green-400 h-full" 
                                      style={{ width: `${(usageStats.totalCompletionTokens / (usageStats.totalPromptTokens + usageStats.totalCompletionTokens || 1)) * 100}%` }}
                                   />
                               </div>
                           </div>

                           <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-xl text-center text-yellow-800 text-xs">
                               <span className="font-bold">估算成本 (Gemini Pro):</span> 
                               <span className="block text-lg mt-1 font-mono">
                                  ${((usageStats.totalPromptTokens / 1000000 * 0.125) + (usageStats.totalCompletionTokens / 1000000 * 0.60)).toFixed(5)}
                               </span>
                           </div>
                        </>
                    ) : (
                        <div className="text-center text-slate-400 py-10">
                            暂无使用数据
                        </div>
                    )}
                </div>
            )}
        </div>

        {activeTab === 'config' && (
            <div className="p-4 bg-slate-50 border-t flex justify-between items-center shrink-0">
            <button 
                onClick={handleReset}
                className="text-xs text-slate-400 hover:text-red-500 underline decoration-dotted"
            >
                重置默认
            </button>
            <div className="flex gap-3">
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
        )}
      </div>
    </div>
  );
};

export default ApiSettingsModal;