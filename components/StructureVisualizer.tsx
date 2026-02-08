
import React, { useState, useMemo } from 'react';
import { FormatRules, ThesisStructure, VisualNode, Chapter } from '../types';

interface StructureVisualizerProps {
  formatRules: FormatRules | null;
  thesis: ThesisStructure; 
}

// --- Helper: Build Visual Tree from Flat Blocks ---
const buildVisualTree = (rules: FormatRules, thesis: ThesisStructure): VisualNode[] => {
    if (!rules.mapping) return [];
    
    const hasAIChapters = thesis.chapters.length > 0;
    const rootNodes: VisualNode[] = [];
    
    // We iterate through SECTIONS defined by the parser
    rules.mapping.sections.filter(s => s.kind !== 'root').forEach(sec => {
        
        // Strategy: If AI chapters exist, we replace "Body" sections entirely with AI structure
        if (hasAIChapters && sec.kind === 'body') {
            return;
        }

        // 1. Create the Root Node for this Section (Level 1 Container)
        const secNode: VisualNode = {
            id: sec.id,
            label: sec.title || `[${sec.kind}]`,
            type: 'section_l1',
            kind: sec.kind,
            children: []
        };
        rootNodes.push(secNode);
        
        // 2. Get all blocks belonging to this section
        const blocks = rules.mapping!.blocks.filter(b => b.owner.sectionId === sec.id);
        
        // 3. Tree Construction State
        // activeL1: Usually the secNode itself for Body/Front/Back
        // activeL2: The current H2 container
        // activeL3: The current H3 container
        let activeL1: VisualNode = secNode; 
        let activeL2: VisualNode | null = null;
        let activeL3: VisualNode | null = null;

        blocks.forEach(b => {
            const node = mapBlockToNode(b);
            
            // --- HEADING LEVEL 1 ---
            if (b.level === 1) {
                // Critical Fix: If this H1 block matches the Section Title,
                // Do NOT add a new visual node (to avoid duplication),
                // BUT update activeL1 to be the secNode so children attach to the Section.
                if (secNode.label === b.text || (sec.kind === 'body' && blocks.indexOf(b) === 0)) {
                    activeL1 = secNode; 
                } else {
                    // It's a distinct H1 (rare in standard thesis, but possible)
                    activeL1 = node;
                    secNode.children.push(node);
                }
                // Reset deeper levels
                activeL2 = null;
                activeL3 = null;
            } 
            // --- HEADING LEVEL 2 ---
            else if (b.level === 2) {
                activeL2 = node;
                activeL3 = null;
                // Attach to current L1
                activeL1.children.push(node);
            } 
            // --- HEADING LEVEL 3 ---
            else if (b.level === 3) {
                activeL3 = node;
                // Attach to current L2 (fallback to L1)
                if (activeL2) activeL2.children.push(node);
                else activeL1.children.push(node);
            } 
            // --- CONTENT BLOCKS (Level 0) ---
            else {
                // Attach to the deepest active container
                if (activeL3) activeL3.children.push(node);
                else if (activeL2) activeL2.children.push(node);
                else activeL1.children.push(node);
            }
        });
    });

    // Inject AI Chapters if they exist
    if (hasAIChapters) {
        const aiNodes = thesis.chapters.map(mapChapterToVisual);
        
        // Insert between Front and Back (Find the first 'back' section)
        let insertIndex = rootNodes.findIndex(n => n.kind === 'back');
        if (insertIndex === -1) insertIndex = rootNodes.length;
        
        rootNodes.splice(insertIndex, 0, ...aiNodes);
    }

    return rootNodes;
};

const mapBlockToNode = (b: any): VisualNode => {
    let label = b.text || '[Empty]';
    // Truncate long text
    if (label.length > 50) label = label.substring(0, 50) + '...';
    
    let type: VisualNode['type'] = 'content_block';
    if (b.level === 1) type = 'section_l1';
    if (b.level === 2) type = 'section_l2';
    if (b.level === 3) type = 'section_l3';

    return {
        id: b.id,
        label,
        type,
        kind: b.kind,
        children: []
    };
};

const mapChapterToVisual = (ch: Chapter): VisualNode => {
    const node: VisualNode = {
        id: ch.id,
        label: ch.title,
        type: ch.level === 1 ? 'section_l1' : ch.level === 2 ? 'section_l2' : 'section_l3',
        kind: 'body',
        isAI: true,
        children: []
    };

    // Split Content into Blocks for Granular Visualization
    if (ch.content) {
         // Regex to split by placeholders but keep them
         const parts = ch.content.split(/(\[\[.*?\]\])/g).filter(p => p.trim());
         
         parts.forEach((p, idx) => {
             let kind = 'paragraph';
             let label = p;
             
             if (p.startsWith('[[FIG:')) {
                 kind = 'image_placeholder';
                 label = '🖼️ ' + p.replace('[[FIG:', '').replace(']]', '');
             } else if (p.startsWith('[[TBL:')) {
                 kind = 'table_placeholder';
                 label = '📊 ' + p.replace('[[TBL:', '').replace(']]', '');
             } else if (p.startsWith('[[REF:')) {
                 kind = 'reference_item';
                 label = '🔗 引用 ' + p;
             } else {
                 if (label.length > 50) label = label.substring(0, 50) + '...';
             }

             node.children.push({
                 id: `${ch.id}_block_${idx}`,
                 label: label,
                 type: 'content_block',
                 content: p,
                 kind,
                 children: [],
                 isAI: true
             });
         });
    }

    if (ch.subsections) {
        ch.subsections.forEach(sub => {
            node.children.push(mapChapterToVisual(sub));
        });
    }

    return node;
};

// --- Component: Tree Node ---
const TreeNode: React.FC<{ node: VisualNode; depth: number }> = ({ node, depth }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = node.children.length > 0;

    // Dynamic Style based on Depth and Type
    const getNodeStyle = () => {
        const base = "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all cursor-pointer select-none mb-1 text-sm";
        
        if (node.type === 'section_l1') {
            return `${base} bg-slate-800 text-white border-slate-700 shadow-sm font-bold py-2 mt-2`;
        }
        if (node.type === 'section_l2') {
            return `${base} bg-indigo-50 text-indigo-900 border-indigo-200 font-semibold mt-1`;
        }
        if (node.type === 'section_l3') {
            return `${base} bg-white text-slate-800 border-slate-200 font-medium ml-2`;
        }
        // Content Blocks
        if (node.kind?.includes('image')) return `${base} bg-orange-50 text-orange-700 border-orange-100 text-xs ml-4`;
        if (node.kind?.includes('table')) return `${base} bg-green-50 text-green-700 border-green-100 text-xs ml-4`;
        if (node.kind?.includes('toc')) return `${base} bg-slate-100 text-slate-500 border-slate-200 text-xs ml-4 italic`;
        
        return `${base} bg-transparent border-transparent hover:bg-slate-100 text-slate-500 text-xs ml-4`;
    };

    return (
        <div>
            <div className={getNodeStyle()} onClick={() => hasChildren && setIsExpanded(!isExpanded)}>
                {/* Expander */}
                <div className="w-4 flex justify-center shrink-0">
                    {hasChildren && (
                        <span className="text-[10px] transform transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                            ▶
                        </span>
                    )}
                    {node.type === 'content_block' && !node.kind?.includes('placeholder') && !node.kind?.includes('toc') && (
                        <span className="text-[8px] opacity-50">¶</span>
                    )}
                </div>

                {/* Content */}
                <span className="truncate flex-1">{node.label}</span>

                {/* Badges */}
                {node.isAI && node.type.startsWith('section') && (
                    <span className="text-[8px] bg-green-500 text-white px-1 rounded">AI</span>
                )}
                {node.kind && !['paragraph', 'heading', 'body'].includes(node.kind) && (
                    <span className="text-[8px] bg-white/20 text-current opacity-70 px-1 rounded border border-current">
                        {node.kind.toUpperCase().replace('_', ' ')}
                    </span>
                )}
            </div>

            {/* Children Recursion */}
            {isExpanded && hasChildren && (
                <div className={`border-l border-slate-300 ml-3 pl-1 ${depth === 0 ? 'mb-4' : ''}`}>
                    {node.children.map((child, idx) => (
                        <TreeNode key={`${child.id}-${idx}`} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

const StructureVisualizer: React.FC<StructureVisualizerProps> = ({ formatRules, thesis }) => {
  const treeData = useMemo(() => {
     if (!formatRules) return [];
     return buildVisualTree(formatRules, thesis);
  }, [formatRules, thesis]);

  if (!formatRules) return <div className="p-8 text-center text-slate-400">请先上传模版</div>;

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-3 bg-white border-b flex justify-between items-center shadow-sm z-10 shrink-0">
            <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                <span>🌳</span> 结构透视
            </h3>
            <div className="flex gap-2 text-[10px]">
                <span className="px-2 py-0.5 bg-slate-800 text-white rounded">Section</span>
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded">H2</span>
                <span className="px-2 py-0.5 bg-white border text-slate-600 rounded">H3</span>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {treeData.length === 0 ? (
                <div className="text-center text-slate-400 mt-10 text-xs">暂无结构数据</div>
            ) : (
                <div className="pb-10">
                    {treeData.map((node) => (
                        <TreeNode key={node.id} node={node} depth={0} />
                    ))}
                </div>
            )}
        </div>
    </div>
  );
};

export default StructureVisualizer;
