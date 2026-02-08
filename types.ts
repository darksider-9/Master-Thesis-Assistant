
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

export interface TemplateBlock {
  order: number;
  // Fix: Added 'other' to support all node types from parser mapping
  nodeType: 'p' | 'tbl' | 'sectPr' | 'other';
  type:
    | 'front_title' | 'toc' | 'toc_item' | 'toc_title' | 'back_title'
    | 'heading' | 'paragraph'
    | 'caption_figure' | 'caption_table'
    | 'equation' | 'image_placeholder'
    | 'reference_section' | 'reference_item'
    | 'section' // Legacy support
    | 'other'
    | 'table';
  level: number; // 0 normal, 1-3 for headings
  styleId?: string;
  text: string;
  path?: string; // e.g. "绪论 / 研究背景"
  owner?: { h1?: string; h2?: string; h3?: string; sectionId?: string }; // Hierarchy ownership
  fields?: string[]; // instrText content
  bookmarks?: string[]; // bookmarkStart names
  tableRows?: string[][]; // Content preview if table
}

// --- New Mapping Types ---

export type MappingSectionKind = "front" | "toc" | "lot" | "lof" | "body" | "back" | "root";

export interface MappingSection {
  id: string;
  kind: MappingSectionKind;
  title: string;
  level: 0 | 1 | 2 | 3;
  parentId?: string;
  startOrder: number;
  endOrder: number;     // inclusive
  blocks: string[];     // block ids
}

export type BlockKind =
  | "heading"
  | "front_title"
  | "back_title"
  | "toc_title"
  | "toc_item"
  | "paragraph"
  | "image_para"
  | "equation"
  | "caption_figure"
  | "caption_table"
  | "table"
  | "sectPr"
  | "other";

export interface MappingBlock {
  id: string;
  order: number;           // 1-based
  nodeType: "p" | "tbl" | "sectPr" | "other";
  kind: BlockKind;
  level: 0 | 1 | 2 | 3;
  styleId?: string;
  text?: string;
  owner: { sectionId: string; h1?: string; h2?: string; h3?: string };
  fields?: string[];
  bookmarks?: string[];
  rows?: string[][];
}

export interface TemplateMappingJSON {
  source: string;
  headingStyleIds: { h1: string; h2: string; h3: string };
  sections: MappingSection[];
  blocks: MappingBlock[];
}

// --- Visualization Types ---
export interface VisualNode {
  id: string;
  label: string;
  type: 'section_l1' | 'section_l2' | 'section_l3' | 'content_block' | 'placeholder';
  kind?: string; // e.g. "Abstract", "TOC", "Body"
  content?: string; // For previewing text content
  children: VisualNode[];
  isAI?: boolean; // True if from AI structure
  status?: 'empty' | 'filled' | 'pending';
}

export interface ApiSettings {
  apiKey: string;
  baseUrl?: string;
  modelName: string;
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
  status: 'pending' | 'discussed' | 'drafting' | 'completed';
  designConfirmed: boolean;
  metadata: InterviewData; 
  chatHistory?: ChatMessage[];
  subsections?: Chapter[];
}

export interface InterviewData {
  methodology?: string; 
  formulas?: string;     
  dataSources?: string;  
  experimentalDesign?: string; 
  resultsAnalysis?: string; 
  figureCount: number;
  tableCount: number;
  isCoreChapter: boolean; 
}

export interface Reference {
  id: number;
  placeholder: string; // e.g. "[[REF:1]]"
  description: string;
}

export interface TechnicalTerm {
  term: string;
  fullName: string;
  acronym: string;
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
  apiSettings?: ApiSettings;
}
