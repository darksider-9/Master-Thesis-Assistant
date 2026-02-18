
import React, { useState } from 'react';
import { ApiSettings, Reference, SearchResult, CitationStyle, Chapter } from '../types';
import { searchAcademicPapers, enrichReferenceMetadata } from '../services/searchService';
import { filterSearchResultsAI, standardizeReferencesGlobal } from '../services/geminiService';
import { formatCitation } from '../utils/citationFormatter';

interface SearchDebuggerProps {
    isOpen: boolean;
    onClose: () => void;
    apiSettings: ApiSettings;
    references: Reference[];
    setReferences: React.Dispatch<React.SetStateAction<Reference[]>>;
    citationStyle: CitationStyle;
}

interface LogStep {
    id: number;
    title: string;
    status: 'pending' | 'success' | 'error';
    data?: any;
    summary?: string;
}

const SearchDebugger: React.FC<SearchDebuggerProps> = ({ isOpen, onClose, apiSettings, references, setReferences, citationStyle }) => {
    const [keywords, setKeywords] = useState("U-Net medical image segmentation");
    const [context, setContext] = useState("本文主要探讨U-Net在医学图像分割中的应用，特别是针对小样本数据的改进。");
    const [logs, setLogs] = useState<LogStep[]>([]);
    const [isRunning, setIsRunning] = useState(false);

    if (!isOpen) return null;

    const addLog = (title: string, status: LogStep['status'] = 'pending', data?: any, summary?: string) => {
        setLogs(prev => {
            return [...prev, { id: Date.now(), title, status, data, summary }];
        });
    };

    const updateLastLog = (status: LogStep['status'], data?: any, summary?: string) => {
        setLogs(prev => {
            const newLogs = [...prev];
            const last = newLogs[newLogs.length - 1];
            if (last) {
                newLogs[newLogs.length - 1] = { ...last, status, data, summary };
            }
            return newLogs;
        });
    };

    const runDebugSequence = async () => {
        setIsRunning(true);
        setLogs([]);
        
        try {
            // STEP 1: Search
            addLog("1. 执行多源搜索 (Keywords: " + keywords + ")");
            const providers = ['semantic_scholar', 'arxiv', 'open_alex', 'crossref'];
            if (apiSettings.searchProvider === 'serper') providers.push('serper');

            // Simulate parallel search like Auto-Pilot
            const searchPromises = providers.map(p => 
                searchAcademicPapers(keywords, p as any, apiSettings.searchApiKey).catch(e => ({ error: e.message, provider: p }))
            );
            
            const rawResults = await Promise.all(searchPromises);
            const flatResults = rawResults.flat().filter((r: any) => !r.error && r.title);
            
            updateLastLog('success', flatResults, `共找到 ${flatResults.length} 条原始结果`);

            if (flatResults.length === 0) throw new Error("未找到任何文献");

            // STEP 2: Filter
            addLog("2. AI 智能筛选 (Context: " + context.slice(0, 20) + "...)");
            const selectedIds = await filterSearchResultsAI(context, flatResults as SearchResult[], apiSettings);
            
            const selectedPapers = (flatResults as SearchResult[]).filter(r => selectedIds.includes(r.id));
            updateLastLog('success', selectedPapers, `AI 选中了 ${selectedPapers.length} 篇文献`);

            if (selectedPapers.length === 0) throw new Error("AI 认为没有匹配的文献");

            // STEP 3: Enrich & Create Temp Refs
            addLog("3. 元数据补全 (Enrichment)");
            const enrichedRefs: Reference[] = [];
            
            for (const paper of selectedPapers) {
                // Try strictly enriching based on the title found
                const meta = await enrichReferenceMetadata(paper.title, apiSettings, true);
                
                // Fallback to search result info if enrichment fails slightly
                const finalMeta = meta || {
                    title: paper.title,
                    authors: paper.authors,
                    year: paper.year,
                    journal: paper.venue,
                    type: 'journal-article' // default assumption
                };

                enrichedRefs.push({
                    id: -1, // Temp ID, will be reassigned later
                    description: formatCitation(paper, citationStyle), // Rough initial format
                    metadata: finalMeta
                });
            }
            updateLastLog('success', enrichedRefs, `已生成 ${enrichedRefs.length} 个待格式化对象 (包含详细元数据)`);

            // STEP 4: AI Formatting (The Standardizer) - CRITICAL: Calling the EXACT SAME function as the main app
            addLog(`4. 调用全局标准生成器 (${citationStyle})`);
            
            // We mock a list of refs with valid temporary IDs to pass to the agent
            const mockGlobalRefs = enrichedRefs.map((r, i) => ({ ...r, id: 9000 + i }));
            
            // We create a "Mock Chapter" containing the user's debug context.
            // This ensures that if standardizeReferencesGlobal tries to find context for the refs, 
            // it sees the text you entered in the debugger.
            const mockChapters: Chapter[] = [{
                id: 'debug_chapter',
                title: 'Debug Context',
                level: 1,
                content: context, // Inject the context here so the standardizer can "see" it if it needs to plan searches
                subsections: []
            }];

            // Log callback to visualize internal steps of the standardizer
            const internalLogs: string[] = [];
            const logWrapper = (msg: string) => internalLogs.push(msg);

            const standardizedRefs = await standardizeReferencesGlobal(
                mockGlobalRefs, 
                mockChapters, // Pass mock context
                apiSettings, 
                citationStyle,
                logWrapper 
            );

            // Show internal logs from the standardizer service
            updateLastLog('success', standardizedRefs, `标准器内部日志:\n${internalLogs.join('\n')}`);

            // STEP 5: Final Preview (New)
            addLog(`5. 最终参考文献格式预览 (Final Output)`);
            // Extract the formatted strings (description field) for easy viewing
            const previewOutput = standardizedRefs.map(r => r.description);
            updateLastLog('success', previewOutput, "这是 AI 最终生成的标准格式，请仔细核对。");

            // Small delay to ensure UI updates and logs render before alert blocks the thread
            await new Promise(r => setTimeout(r, 500));

            // STEP 6: Add to Global List (Confirmation)
            if (window.confirm(`调试成功！\n\n请确认 Step 5 中的格式是否准确？\n\n点击【确定】将这 ${standardizedRefs.length} 条引用添加到您的正式参考文献列表中。`)) {
                setReferences(prev => {
                    const nextId = prev.length > 0 ? Math.max(...prev.map(r => r.id)) + 1 : 1;
                    const newRefs = standardizedRefs.map((r, i) => ({
                        ...r,
                        id: nextId + i
                    }));
                    return [...prev, ...newRefs];
                });
                alert("已添加至列表末尾。");
                onClose();
            }

        } catch (e: any) {
            updateLastLog('error', e, e.message);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden animate-fade-in border border-slate-200">
                <div className="p-4 border-b bg-indigo-50 flex justify-between items-center shrink-0">
                    <h3 className="font-bold text-lg text-indigo-900 flex items-center gap-2">
                        🐞 文献搜索逻辑实验室 (Search Debugger)
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 font-bold px-2">✕</button>
                </div>

                <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
                    {/* Left: Controls */}
                    <div className="w-full md:w-1/3 p-4 border-r border-slate-100 bg-slate-50 flex flex-col gap-4 overflow-y-auto">
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">搜索关键词组 (Keywords)</label>
                            <textarea 
                                className="w-full p-2 border rounded text-xs h-20"
                                value={keywords}
                                onChange={e => setKeywords(e.target.value)}
                                placeholder="e.g. Transformer attention mechanism NLP"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">模拟 Auto-Pilot 提取的关键词</p>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">相关段落/论点 (Claim Context)</label>
                            <textarea 
                                className="w-full p-2 border rounded text-xs h-32"
                                value={context}
                                onChange={e => setContext(e.target.value)}
                                placeholder="输入一段文本，AI 将基于此筛选最相关的论文..."
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">目标格式</label>
                            <div className="px-2 py-1 bg-white border rounded text-xs font-mono">{citationStyle}</div>
                        </div>

                        <button 
                            onClick={runDebugSequence}
                            disabled={isRunning}
                            className="mt-auto w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded font-bold shadow disabled:bg-slate-300 transition-colors flex justify-center items-center gap-2"
                        >
                            {isRunning ? <span className="animate-spin">⏳</span> : '▶'} 运行完整流程
                        </button>
                    </div>

                    {/* Right: Visualization */}
                    <div className="w-full md:w-2/3 p-6 overflow-y-auto bg-white custom-scrollbar">
                        <h4 className="text-sm font-bold text-slate-400 mb-4 uppercase tracking-wider">Execution Log</h4>
                        <div className="space-y-6">
                            {logs.length === 0 && (
                                <div className="text-center text-slate-300 py-20">
                                    点击左侧运行按钮开始调试...
                                </div>
                            )}
                            {logs.map((step, idx) => (
                                <div key={step.id} className="relative pl-6 border-l-2 border-indigo-100 last:border-transparent">
                                    <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 ${
                                        step.status === 'pending' ? 'bg-white border-indigo-300' :
                                        step.status === 'success' ? 'bg-green-500 border-green-500' :
                                        'bg-red-500 border-red-500'
                                    }`}></div>
                                    
                                    <div className="mb-2 flex justify-between items-start">
                                        <span className={`font-bold text-sm ${step.status === 'error' ? 'text-red-600' : 'text-slate-800'}`}>
                                            {step.title}
                                        </span>
                                        {step.status === 'pending' && <span className="text-xs text-indigo-400 animate-pulse">Running...</span>}
                                    </div>

                                    {step.summary && (
                                        <div className="text-xs text-slate-500 mb-2 font-medium bg-slate-50 p-1.5 rounded inline-block whitespace-pre-wrap">
                                            {step.summary}
                                        </div>
                                    )}

                                    {step.data && (
                                        <div className="bg-slate-900 rounded-lg p-3 overflow-x-auto">
                                            <pre className="text-[10px] font-mono text-green-400 leading-tight">
                                                {JSON.stringify(step.data, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SearchDebugger;
