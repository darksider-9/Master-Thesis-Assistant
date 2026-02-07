
export interface FormatRules {
  rawXML: string; // The original template string
  fontMain: string;
  fontHeading: string;
  fontSizeNormal: string;
  fontSizeH1: string;
  fontSizeH2: string;
  fontSizeH3: string;
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  lineSpacing: string;
  styleMap: {
    heading1: string;
    heading2: string;
    heading3: string;
    normal: string;
    captionFigure: string;
    captionTable: string;
    sectionTitle: string; // e.g. a36
    referenceItem: string; // e.g. a41
  };
}

export interface ThesisStructure {
  title: string;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  level: number;
  title: string;
  content?: string;
  rawModelOutput?: string; 
  subsections?: Chapter[];
  status: 'pending' | 'discussed' | 'drafting' | 'completed';
  designConfirmed: boolean;
  metadata: InterviewData; 
  chatHistory?: ChatMessage[];
  targetWordCount?: number;
}

export interface InterviewData {
  methodology?: string; 
  formulas?: string;     
  dataSources?: string;  
  experimentalDesign?: string; 
  resultsAnalysis?: string; 
  figureCount: number;
  tableCount: number;
  figurePlan?: {id: number, desc: string}[]; 
  tablePlan?: {id: number, desc: string}[];
  isCoreChapter: boolean; 
}

export interface Reference {
  id: number;
  placeholder: string;
  description: string;
}

export interface TechnicalTerm {
  term: string;
  fullName: string;
  acronym: string;
  firstMentionedChapterId?: string;
}

export type Step = 'upload' | 'title' | 'structure' | 'discussion' | 'writing' | 'export';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface AgentLog {
  id: string;
  agentName: 'Supervisor' | 'Writer' | 'TermChecker' | 'Reference' | 'Figure' | 'AutoNumber' | 'Fixer';
  message: string;
  timestamp: number;
  status: 'processing' | 'success' | 'warning';
}

export interface ProjectState {
  version: string;
  timestamp: number;
  step: Step;
  thesis: ThesisStructure;
  formatRules: FormatRules | null;
  references: Reference[];
}
