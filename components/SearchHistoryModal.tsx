
import React, { useState } from 'react';
import { SearchHistoryItem, SearchResult, CitationStyle } from '../types';
import { formatCitation } from '../utils/citationFormatter';

interface SearchHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    history: SearchHistoryItem[];
    onCite: (result: SearchResult) => void;
}

const SearchHistoryModal: React.FC<SearchHistoryModalProps> = ({ isOpen, onClose, history, onCite }) => {
    const [expandedSearchId, setExpandedSearchId] = useState<string | null>(null);
    const [previewStyle, setPreviewStyle] = useState<CitationStyle>('GB/T 7714');

    if (!isOpen) return null;

    // Reverse history to show newest first
    const sortedHistory = [...history].reverse();

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-fade-in">
                <div className="p-4 border-b bg-slate-50 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">📜</span>
                        <div>
                            <h3 className="font-bold text-lg text-slate-800">文献搜索历史档案</h3>
                            <p className="text-xs text-slate-500">记录了所有通过高级模式进行的搜索请求与返回结果</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 text-xl font-bold px-2">✕</button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-slate-100 space-y-4">
                    {sortedHistory.length === 0 ? (
                        <div className="text-center text-slate-400 py-20">暂无搜索记录</div>
                    ) : (
                        sortedHistory.map((item) => (
                            <div key={item.id} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                                <div 
                                    className="p-3 bg-slate-50 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
                                    onClick={() => setExpandedSearchId(expandedSearchId === item.id ? null : item.id)}
                                >
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs font-mono text-slate-400">
                                            {new Date(item.timestamp).toLocaleString()}
                                        </span>
                                        <span className={`text-xs px-2 py-0.5 rounded border ${item.provider === 'none' ? 'bg-gray-100' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                                            {item.provider}
                                        </span>
                                        <span className="font-bold text-slate-700">"{item.query}"</span>
                                        <span className="text-xs text-slate-500">
                                            (找到 {item.results.length} 条)
                                        </span>
                                    </div>
                                    <div className="text-slate-400 text-xs">
                                        {expandedSearchId === item.id ? '▼ 收起' : '▶ 展开详情'}
                                    </div>
                                </div>

                                {expandedSearchId === item.id && (
                                    <div className="p-4 border-t border-slate-100 bg-white">
                                        <div className="mb-2 flex justify-end">
                                            <select 
                                                className="text-xs border rounded px-2 py-1 bg-slate-50"
                                                value={previewStyle}
                                                onChange={(e) => setPreviewStyle(e.target.value as CitationStyle)}
                                            >
                                                <option value="GB/T 7714">预览: GB/T 7714</option>
                                                <option value="APA">预览: APA</option>
                                                <option value="IEEE">预览: IEEE</option>
                                            </select>
                                        </div>
                                        <div className="space-y-4">
                                            {item.results.map((res, idx) => (
                                                <div key={idx} className="border border-slate-100 rounded p-3 hover:border-blue-200 transition-colors">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <h4 className="font-bold text-sm text-blue-700 w-3/4">{res.title}</h4>
                                                        <button 
                                                            onClick={() => { onCite(res); onClose(); }}
                                                            className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200 hover:bg-green-100"
                                                        >
                                                            + 引用此条
                                                        </button>
                                                    </div>
                                                    <p className="text-xs text-slate-500 mb-2">
                                                        {res.authors.join(', ')} ({res.year}) - {res.source}
                                                    </p>
                                                    <div className="text-xs bg-slate-50 p-2 rounded text-slate-600 mb-2 max-h-24 overflow-y-auto custom-scrollbar">
                                                        <span className="font-bold">Abstract: </span>{res.abstract}
                                                    </div>
                                                    <div className="text-[10px] font-mono text-slate-400 bg-gray-50 p-1.5 rounded border border-gray-100 select-all">
                                                        {formatCitation(res, previewStyle)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default SearchHistoryModal;
