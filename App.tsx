
import React, { useState } from 'react';
import { Step, FormatRules, ThesisStructure, Chapter, Reference, ProjectState } from './types';
import { parseWordXML, generateThesisXML } from './services/xmlParser';
import Sidebar from './components/Sidebar';
import FormatAnalyzer from './components/FormatAnalyzer';
import StructurePlanner from './components/StructurePlanner';
import MethodologyDiscussion from './components/MethodologyDiscussion';
import WritingDashboard from './components/WritingDashboard';
import Previewer from './components/Previewer';
import TitleConfirm from './components/TitleConfirm';

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<Step>('upload');
  const [formatRules, setFormatRules] = useState<FormatRules | null>(null);
  const [thesis, setThesis] = useState<ThesisStructure>({
    title: "",
    chapters: []
  });
  const [references, setReferences] = useState<Reference[]>([]);

  const handleFileUpload = (xmlContent: string) => {
    const rules = parseWordXML(xmlContent);
    setFormatRules(rules);
    setCurrentStep('title'); // Move to Title Confirmation after upload
  };

  const handleTitleConfirm = (title: string) => {
    setThesis(prev => ({ ...prev, title }));
    setCurrentStep('structure'); // Move to Structure Planning after title is confirmed
  };

  const handleExportXML = () => {
    if (!formatRules) return;
    const xml = generateThesisXML(thesis, formatRules, references);
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${thesis.title || 'thesis'}_draft.xml`;
    a.click();
  };

  // --- Project Persistence ---
  const handleSaveProject = () => {
    const state: ProjectState = {
      version: "1.0",
      timestamp: Date.now(),
      step: currentStep,
      thesis,
      formatRules,
      references
    };
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `thesis_project_${Date.now()}.json`;
    a.click();
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
        
        alert("项目加载成功！");
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
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {currentStep === 'upload' && (
            <FormatAnalyzer onUpload={handleFileUpload} />
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
              onConfirm={() => setCurrentStep('discussion')}
              setThesis={setThesis}
            />
          )}

          {currentStep === 'discussion' && (
            <MethodologyDiscussion 
              thesis={thesis}
              setThesis={setThesis}
              onNext={() => setCurrentStep('writing')}
            />
          )}

          {currentStep === 'writing' && (
            <WritingDashboard 
              thesis={thesis} 
              setThesis={setThesis}
              formatRules={formatRules!}
              references={references}
              setReferences={setReferences}
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
