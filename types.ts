


export interface ReferenceMetadata {
  title: string;
  authors: string[];
  journal?: string;
  year?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  type?: string; // Relaxed from union to string to allow 'journal-article' etc.
}

export interface Reference {
  id: number;
  description: string;
  placeholder?: string; // The [[REF:...]] string found in text
  metadata?: ReferenceMetadata; // New: Structured data for strict formatting
}

export type Step = 'upload' | 'title' | 'structure' | 'discussion' | 'writing' | 'export';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface TechnicalTerm {
  term: string; // Chinese Full Name (e.g. 生成对抗网络)
  englishName?: string; // English Full Name (e.g. Generative Adversarial Networks)
  acronym: string; // Acronym (e.g. GAN)
  firstOccurrenceBlockId?: string; // ID of the chapter/node where it was FIRST defined
}

export interface InterviewData {
    methodology?: string;
    dataSources?: string;
    experimentalDesign?: string;
    resultsAnalysis?: string;
}

export interface AgentLog {
  id: string;
  agentName: 'Supervisor' | 'Methodologist' | 'Writer' | 'Reviewer' | 'TermChecker' | 'Reference' | 'Fixer' | 'Planner' | 'Searcher';
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
    // New: Persistence for Search Settings
    searchApiKey?: string;
    searchProvider?: string;
    // Callback for tracking usage, not saved to JSON
    onUsage?: (usage: TokenUsage) => void;
}

// --- Search & History Types ---

export type SearchProvider = 'none' | 'semantic_scholar' | 'arxiv' | 'open_alex' | 'crossref' | 'serper';
export type CitationStyle = 'GB/T 7714' | 'APA' | 'IEEE' | 'MLA';

export interface SearchResult {
    id: string;
    title: string;
    abstract: string;
    authors: string[];
    year: string;
    url?: string;
    source: string;
    venue?: string; // Journal or Conference name
    doi?: string;
}

export interface SearchHistoryItem {
    id: string;
    timestamp: number;
    query: string;
    provider: SearchProvider;
    results: SearchResult[];
    blockId?: string; // Which block initiated this
}

// --- Chapter & Thesis Structure Types ---

// NEW: AI Context Persistence Interface
export interface ChapterAIContext {
    userInstruction?: string;
    refTemplate?: string;
    skeletonPlan?: SectionPlan;
    referenceInput?: string; // Manually added context or auto-searched context summary
    targetWordCount?: number;
}

export interface Chapter {
  id: string;
  title: string;
  level: number;
  content?: string;
  subsections?: Chapter[];
  status?: 'pending' | 'discussed' | 'completed';
  designConfirmed?: boolean;
  metadata?: {
      figureCount?: number;
      tableCount?: number;
      isCoreChapter?: boolean;
      methodology?: string;
      dataSources?: string;
      experimentalDesign?: string;
      resultsAnalysis?: string;
      figurePlan?: string[];
      tablePlan?: string[];
      // NEW: Store AI context here for persistence
      aiContext?: ChapterAIContext;
  };
  chatHistory?: ChatMessage[];
}

export interface ThesisStructure {
  title: string;
  chapters: Chapter[];
}

// --- Mapping & Parser Types ---

export type BlockKind = 'heading' | 'front_title' | 'back_title' | 'toc_title' | 'image_placeholder' | 'equation' | 'paragraph' | 'caption_figure' | 'caption_table' | 'table' | 'other';
export type MappingSectionKind = 'front' | 'toc' | 'body' | 'back' | 'root';

export interface MappingBlock {
  id: string;
  order: number;
  nodeType: 'p' | 'tbl' | 'sectPr';
  type: BlockKind;
  level: number;
  styleId?: string;
  text?: string;
  owner?: { sectionId: string };
  fields?: string[];
  bookmarks?: string[];
}

export interface TemplateBlock extends MappingBlock {}

export interface MappingSection {
  id: string;
  kind: MappingSectionKind;
  title: string;
  level: number;
  startOrder: number;
  endOrder: number;
  blocks: string[]; // block ids
}

export interface TemplateMappingJSON {
  source: string;
  headingStyleIds: { h1: string; h2: string; h3: string };
  sections: MappingSection[];
  blocks: MappingBlock[];
}

export interface FormatRules {
  rawXML: string;
  styleIds: { heading1: string; heading2: string; heading3: string; normal: string; caption: string };
  metadata: { paperSize: string };
  templateStructure: TemplateBlock[];
  mapping?: TemplateMappingJSON;
  fontMain: string;
  fontSizeNormal: string;
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
  searchHistory: SearchHistoryItem[];
  globalTerms: TechnicalTerm[]; // NEW: Persist global terms
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

export interface HeaderConfig {
    oddPage: 'chapterTitle' | 'none';
    evenPageText: string;
    headerReferenceStyle?: string; // New: Allow manual override of the style name (e.g. "标题 1" vs "Heading 1")
}

export interface StyleSettings {
  heading1: StyleConfig;
  heading2: StyleConfig;
  heading3: StyleConfig;
  body: StyleConfig;
  caption: StyleConfig;
  table: StyleConfig; 
  reference: StyleConfig;
  equationSeparator?: '-' | '.';
  header: HeaderConfig; // New Header Config
  keepHeadingNumbers?: boolean; // NEW: Toggle to keep/strip manual heading numbers in export
}

// --- Visualizer Types ---

export interface VisualNode {
  id: string;
  label: string;
  type: 'section_l1' | 'section_l2' | 'section_l3' | 'content_block';
  kind?: string; 
  children: VisualNode[];
  content?: string;
  isAI?: boolean;
}

// --- Advanced Mode: Skeleton & Planning Types ---

export type CitationStrategy = 'search_new' | 'use_existing' | 'none';

export interface SkeletonBlock {
  block_id: string;
  move: string;
  slots: {
    Claim: string;
    Evidence: string[];
    Mechanism?: string;
    KeywordsZH?: string[];
    KeywordsEN?: string[];
  };
  style_notes?: string;
  // NEW: Strategy for this specific block
  citation_strategy?: CitationStrategy; 
}

export interface SearchQueryInfo {
  block_id: string;
  query_sets: {
    broad_query?: string[];
    focused_query?: string[];
  };
}

export interface SectionPlan {
  section_id: string;
  section_title: string;
  skeleton_blocks: SkeletonBlock[];
  search_plan: {
    per_block_queries: SearchQueryInfo[];
  };
  writing_blueprint?: {
    section_flow: string;
  };
}

export interface SkeletonResponse {
  section_plans: SectionPlan[];
}