
import React, { useState, useEffect } from 'react';
import { Step, FormatRules, ThesisStructure, Chapter, Reference, ProjectState, ApiSettings, UsageStats, AgentLog, TokenUsage, SearchHistoryItem } from './types';
import { parseWordXML, generateThesisXML } from './services/xmlParser';
import Sidebar from './components/Sidebar';
import FormatAnalyzer from './components/FormatAnalyzer';
import StructurePlanner from './components/StructurePlanner';
import MethodologyDiscussion from './components/MethodologyDiscussion';
import WritingDashboard from './components/WritingDashboard';
import Previewer from './components/Previewer';
import TitleConfirm from './components/TitleConfirm';
import ApiSettingsModal from './components/ApiSettingsModal';

const INITIAL_USAGE: UsageStats = {
    totalCalls: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    byPhase: {
        structure: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        discussion: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        writing: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        review: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }
};

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [formatRules, setFormatRules] = useState<FormatRules | null>(null);
  const [thesis, setThesis] = useState<ThesisStructure>({
    title: "",
    chapters: []
  });
  const [references, setReferences] = useState<Reference[]>([]);
  
  // Global Persistence State
  const [agentLogs, setAgentLogs] = useState<AgentLog[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats>(INITIAL_USAGE);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]); // New: Search History

  // API Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => {
    // Load from localStorage or default env
    const saved = localStorage.getItem('thesis_api_settings');
    let defaultKey = "";
    try {
      // Safely check for process.env in case it's not polyfilled
      if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
        defaultKey = process.env.API_KEY;
      }
    } catch (e) {
      // Ignore reference errors
    }

    return saved ? JSON.parse(saved) : {
      apiKey: defaultKey,
      baseUrl: "",
      modelName: "gemini-3-pro-preview"
    };
  });

  // Prompt for settings if key is missing
  useEffect(() => {
    if (!apiSettings.apiKey) {
      setIsSettingsOpen(true);
    }
  }, []);

  const handleSaveSettings = (newSettings: ApiSettings) => {
    setApiSettings(prev => ({ ...prev, ...newSettings }));
    localStorage.setItem('thesis_api_settings', JSON.stringify(newSettings));
  };

  // --- Global Logging & Stats Handlers ---

  const addAgentLog = (agent: AgentLog['agentName'], message: string, status: AgentLog['status'] = 'processing') => {
    setAgentLogs(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      agentName: agent,
      message,
      timestamp: Date.now(),
      status
    }]);
  };

  const handleUsageUpdate = (usage: TokenUsage) => {
      setUsageStats(prev => {
          // Identify phase based on currentStep
          let phaseKey: keyof UsageStats['byPhase'] = 'writing';
          if (currentStep === 'structure') phaseKey = 'structure';
          if (currentStep === 'discussion') phaseKey = 'discussion';
          
          const currentPhaseStats = prev.byPhase[phaseKey];

          return {
              totalCalls: prev.totalCalls + 1,
              totalPromptTokens: prev.totalPromptTokens + usage.promptTokens,
              totalCompletionTokens: prev.totalCompletionTokens + usage.completionTokens,
              byPhase: {
                  ...prev.byPhase,
                  [phaseKey]: {
                      promptTokens: currentPhaseStats.promptTokens + usage.promptTokens,
                      completionTokens: currentPhaseStats.completionTokens + usage.completionTokens,
                      totalTokens: currentPhaseStats.totalTokens + usage.totalTokens
                  }
              }
          };
      });
  };

  // Inject callback into settings passed down to components
  const settingsWithCallback: ApiSettings = {
      ...apiSettings,
      onUsage: handleUsageUpdate
  };


  const handleFileUpload = (xmlContent: string) => {
    try {
      const rules = parseWordXML(xmlContent);
      setFormatRules(rules);
    } catch (e) {
      alert("解析 XML 失败，请检查文件格式。");
      console.error(e);
    }
  };

  const handleTitleConfirm = (title: string) => {
    setThesis(prev => ({ ...prev, title }));
    setCurrentStep('structure'); 
  };

  // Critical: This function is called when Structure is Confirmed in Stage 3.
  const handleStructureUpdate = async (newThesis: ThesisStructure) => {
      if (!formatRules) return;
      
      try {
          const newXml = generateThesisXML(newThesis, formatRules, references);
          const newRules = parseWordXML(newXml);
          
          setFormatRules(newRules);
          setThesis(newThesis);
          setCurrentStep('discussion');
          
      } catch (e) {
          console.error("Structure Update Failed", e);
          alert("模版结构同步失败，请检查控制台");
      }
  };

  const handleExportXML = () => {
    if (!formatRules) {
      alert("请先上传模版文件！");
      return;
    }
    
    try {
      const xml = generateThesisXML(thesis, formatRules, references);
      const blob = new Blob([xml], { type: 'text/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${thesis.title || 'thesis'}_draft.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export Error:", e);
      alert(`导出 XML 失败: ${e instanceof Error ? e.message : '未知错误'}\n请检查控制台获取详情。`);
    }
  };

  // --- Project Persistence ---
  const handleSaveProject = () => {
    const state: ProjectState = {
      version: "1.2", // Bump version for search history support
      timestamp: Date.now(),
      step: currentStep,
      thesis,
      formatRules,
      references,
      apiSettings: {
          apiKey: apiSettings.apiKey,
          baseUrl: apiSettings.baseUrl,
          modelName: apiSettings.modelName,
          // NEW: Persist Search Settings
          searchApiKey: apiSettings.searchApiKey,
          searchProvider: apiSettings.searchProvider
      },
      agentLogs,
      usageStats,
      searchHistory // Save history
    };
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thesis_project_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const state: ProjectState = JSON.parse(content);
        
        // Restore State
        if (state.thesis) setThesis(state.thesis);
        if (state.formatRules) setFormatRules(state.formatRules);
        if (state.references) setReferences(state.references);
        if (state.step) setCurrentStep(state.step);
        if (state.agentLogs) setAgentLogs(state.agentLogs);
        if (state.usageStats) setUsageStats(state.usageStats);
        if (state.searchHistory) setSearchHistory(state.searchHistory); // Restore history
        
        // Restore API Settings if they exist in the file
        if (state.apiSettings) {
           setApiSettings(prev => ({...prev, ...state.apiSettings}));
        }
        
        alert("项目加载成功！完整状态已恢复。");
      } catch (err) {
        console.error(err);
        alert("项目文件解析失败，请确保文件格式正确。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <Sidebar 
        currentStep={currentStep} 
        setCurrentStep={setCurrentStep}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      <ApiSettingsModal 
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={apiSettings}
        onSave={handleSaveSettings}
        usageStats={usageStats}
      />
      
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 bg-white border-b flex items-center justify-between px-8 shadow-sm z-10">
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="bg-blue-600 text-white p-1 rounded">AI</span>
            硕士论文助手
          </h1>
          <div className="flex items-center gap-4">
            {currentStep === 'export' && (
              <button 
                onClick={handleExportXML}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                下载 XML 稿件
              </button>
            )}
            <div className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded">
              {formatRules ? `模版: ${formatRules.fontMain} / ${formatRules.fontSizeNormal}` : "未加载模版"}
            </div>
            {(!apiSettings.apiKey) && (
                <div onClick={() => setIsSettingsOpen(true)} className="cursor-pointer text-xs bg-red-100 text-red-600 px-3 py-1 rounded animate-pulse font-bold">
                    ⚠️ 未配置 API Key
                </div>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {currentStep === 'upload' && (
            <FormatAnalyzer 
              onUpload={handleFileUpload} 
              formatRules={formatRules}
              onNext={() => setCurrentStep('title')}
            />
          )}

          {currentStep === 'title' && (
            <TitleConfirm 
              initialTitle={thesis.title} 
              onConfirm={handleTitleConfirm} 
            />
          )}

          {currentStep === 'structure' && (
            <StructurePlanner 
              thesis={thesis} 
              onStructureConfirmed={handleStructureUpdate}
              setThesis={setThesis}
              apiSettings={settingsWithCallback}
              formatRules={formatRules}
            />
          )}

          {currentStep === 'discussion' && (
            <MethodologyDiscussion 
              thesis={thesis}
              setThesis={setThesis}
              onNext={() => setCurrentStep('writing')}
              apiSettings={settingsWithCallback}
            />
          )}

          {currentStep === 'writing' && (
            <WritingDashboard 
              thesis={thesis} 
              setThesis={setThesis}
              formatRules={formatRules!}
              references={references}
              setReferences={setReferences}
              apiSettings={settingsWithCallback}
              setApiSettings={setApiSettings} // Pass setter for search key persistence
              agentLogs={agentLogs}
              addLog={addAgentLog}
              searchHistory={searchHistory}
              setSearchHistory={setSearchHistory}
            />
          )}

          {currentStep === 'export' && (
            <Previewer thesis={thesis} formatRules={formatRules!} references={references} />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
