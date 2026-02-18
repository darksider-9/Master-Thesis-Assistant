
import React from 'react';
import { TechnicalTerm } from '../types';

interface TermManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    globalTerms: TechnicalTerm[];
    setGlobalTerms: React.Dispatch<React.SetStateAction<TechnicalTerm[]>>;
}

const TermManagerModal: React.FC<TermManagerModalProps> = ({ isOpen, onClose, globalTerms, setGlobalTerms }) => {
    if (!isOpen) return null;

    const handleDelete = (acronym: string) => {
        if (window.confirm(`确定要删除术语 "${acronym}" 的全局记录吗？\n删除后，下次 AI 遇到此词会重新生成完整定义。`)) {
            setGlobalTerms(prev => prev.filter(t => t.acronym !== acronym));
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[70vh] flex flex-col overflow-hidden border border-slate-200">
                <div className="p-4 border-b bg-teal-50 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">📚</span>
                        <div>
                            <h3 className="font-bold text-lg text-teal-900">全局专业术语库 (Terminology)</h3>
                            <p className="text-xs text-teal-600">管理全书已定义的专业名词，确保“首次全称，后续缩写”规则。</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 text-xl font-bold px-2">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-0 bg-slate-50">
                    {globalTerms.length === 0 ? (
                        <div className="text-center text-slate-400 py-20 flex flex-col items-center">
                            <span className="text-4xl mb-2">🍃</span>
                            <p>暂无记录</p>
                            <p className="text-xs mt-2">AI 会在“完成本章”校验时自动提取并添加新术语</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-500 uppercase bg-slate-100 border-b border-slate-200 sticky top-0">
                                <tr>
                                    <th className="px-6 py-3 font-bold">缩写 (Acronym)</th>
                                    <th className="px-6 py-3 font-bold">中文全称</th>
                                    <th className="px-6 py-3 font-bold">英文全称</th>
                                    <th className="px-6 py-3 font-bold">首次定义位置</th>
                                    <th className="px-6 py-3 font-bold text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {globalTerms.map((term, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-6 py-3 font-bold text-teal-700 font-mono">{term.acronym}</td>
                                        <td className="px-6 py-3 text-slate-700">{term.term}</td>
                                        <td className="px-6 py-3 text-slate-500 italic">{term.englishName}</td>
                                        <td className="px-6 py-3 text-xs text-slate-400 font-mono">{term.firstOccurrenceBlockId || 'Unknown'}</td>
                                        <td className="px-6 py-3 text-right">
                                            <button 
                                                onClick={() => handleDelete(term.acronym)}
                                                className="text-slate-400 hover:text-red-500 transition-colors"
                                                title="删除记录 (允许重新定义)"
                                            >
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                
                <div className="p-3 bg-white border-t text-[10px] text-slate-400 flex justify-between items-center">
                    <span>💡 提示：如果某个词在正文中被删除了定义，请在此处手动删除，以便下次生成时 AI 知道需要重新定义它。</span>
                    <span className="font-mono">Total: {globalTerms.length}</span>
                </div>
            </div>
        </div>
    );
};

export default TermManagerModal;
