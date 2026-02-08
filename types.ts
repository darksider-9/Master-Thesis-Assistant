
export interface FormatRules {
  rawXML: string; // The full pkg:package XML string
  // Map internal style IDs (e.g., "2", "a5") to logical roles
  styleIds: {
    heading1: string;
    heading2: string;
    heading3: string;
    normal: string;
    caption: string; // Generic caption style
  };
  // Metadata for UI
  metadata: {
    paperSize?: string;
    margins?: string;
  };
  // Legacy flat structure for UI visualization
  templateStructure: TemplateBlock[];
  // New robust mapping for generation
  mapping?: TemplateMappingJSON;
  
  fontMain: string;
  fontSizeNormal: string;
}

export type BlockKind = 
    | 'front_title' | 'toc' | 'toc_item' | 'toc_title' | 'back_title'
    | 'heading' | 'paragraph'
    | 'caption_figure' | 'caption_table'
    | 'equation' | 'image_placeholder'
    | 'reference_section' | 'reference_item'
    | 'section' // Legacy support
    | 'other'
    | 'table';

export interface TemplateBlock {
  order: number;
  // Fix: Added 'other' to support all node types from parser mapping
  nodeType: 'p' | 'tbl' | 'sectPr' | 'other';
  type: BlockKind;
  level: number; // 0 normal, 1-3
  styleId?: string;
  text?: string;
  owner?: { sectionId: string; h1?: string; h2?: string; h3?: string };
  fields?: string[];
  bookmarks?: string[];
}

export type MappingSectionKind = 'front' | 'toc' | 'lot' | 'lof' | 'body' | 'back' | 'root';

export interface MappingSection {
  id: string;
  kind: MappingSectionKind;
  title: string;
  level: number;
  parentId?: string; // For nested structure if needed
  startOrder: number;
  endOrder: number;
  blocks: string[]; // Block IDs
}

export interface MappingBlock extends TemplateBlock {
  id: string;
}

export interface TemplateMappingJSON {
  source: string;
  headingStyleIds: { h1: string; h2: string; h3: string };
  sections: MappingSection[];
  blocks: MappingBlock[];
}

export interface VisualNode {
  id: string;
  label: string;
  type: string;
  kind?: string;
  children: VisualNode[];
  content?: string;
  isAI?: boolean;
}

export interface ThesisStructure {
  title: string;
  chapters: Chapter[];
}

export interface Chapter {
  id: string;
  title: string;
  level: number;
  content?: string;
  subsections: Chapter[];
  status: 'pending' | 'discussed' | 'completed';
  chatHistory?: ChatMessage[];
  metadata?: {
      figureCount?: number;
      tableCount?: number;
      isCoreChapter?: boolean;
      methodology?: string;
      dataSources?: string;
      experimentalDesign?: string;
      resultsAnalysis?: string;
  };
  designConfirmed?: boolean;
}

export interface Reference {
  id: number;
  description: string;
  placeholder?: string; // The [[REF:...]] string found in text
}

export type Step = 'upload' | 'title' | 'structure' | 'discussion' | 'writing' | 'export';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface TechnicalTerm {
  term: string;
  fullName: string;
  acronym: string;
}

export interface InterviewData {
    methodology?: string;
    dataSources?: string;
    experimentalDesign?: string;
    resultsAnalysis?: string;
}

export interface AgentLog {
  id: string;
  agentName: 'Supervisor' | 'Methodologist' | 'Writer' | 'Reviewer' | 'TermChecker' | 'Reference' | 'Fixer';
  message: string;
  timestamp: number;
  status: 'processing' | 'success' | 'warning' | 'error';
}

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface UsageStats {
    totalCalls: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    // Breakdown by phase
    byPhase: {
        structure: TokenUsage;
        discussion: TokenUsage;
        writing: TokenUsage;
        review: TokenUsage;
    };
}

export interface ApiSettings {
    apiKey: string;
    baseUrl?: string;
    modelName: string;
    // Callback for tracking usage, not saved to JSON
    onUsage?: (usage: TokenUsage) => void;
}

export interface ProjectState {
  version: string;
  timestamp: number;
  step: Step;
  thesis: ThesisStructure;
  formatRules: FormatRules | null;
  references: Reference[];
  apiSettings?: Omit<ApiSettings, 'onUsage'>;
  agentLogs: AgentLog[];
  usageStats: UsageStats;
}

// --- Style Configuration Types ---

export type FontFamily = 'SimSun' | 'SimHei' | 'FangSong' | 'KaiTi';
export type FontSizeName = '小初' | '一号' | '小一' | '二号' | '小二' | '三号' | '小三' | '四号' | '小四' | '五号' | '小五';

export interface StyleConfig {
  fontFamilyCI: FontFamily; // Chinese Font
  fontFamilyAscii: string; // English Font (Fixed to Times New Roman mostly)
  fontSize: string; // Internal Word value (half-points), e.g., "24" for 12pt
  fontSizeName: FontSizeName; // Display name
}

export interface StyleSettings {
  heading1: StyleConfig;
  heading2: StyleConfig;
  heading3: StyleConfig;
  body: StyleConfig;
  caption: StyleConfig;
  table: StyleConfig; 
  reference: StyleConfig;
}
