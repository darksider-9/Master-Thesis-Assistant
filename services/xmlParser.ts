
import { FormatRules, ThesisStructure, Chapter, Reference } from '../types';

const NS = {
  w: "http://schemas.microsoft.com/office/word/2003/wordml",
  wx: "http://schemas.microsoft.com/office/word/2003/auxHint",
  v: "urn:schemas-microsoft-com:vml",
  o: "urn:schemas-microsoft-com:office:office"
};

// Based on user's Python script logic
const STYLE_LEVEL_DEFAULTS: Record<string, number> = {
  "2": 1,   // heading 1
  "4": 2,   // heading 2
  "5": 3,   // heading 3
  "a36": 0, // Section Titles (Abstract, TOC, Refs, etc.)
  "a3": -1, // Body Text (Normal)
  "a41": -2 // Reference Item
};

const FRONT_TITLES: Record<string, string> = {
  "摘 要": "CN_ABSTRACT",
  "Abstract": "EN_ABSTRACT",
  "目 录": "TOC",
  "表格目录": "LIST_OF_TABLES",
  "插图目录": "LIST_OF_FIGURES",
  "致谢": "ACKNOWLEDGEMENTS",
  "致 谢": "ACKNOWLEDGEMENTS", // Handle variation
  "参考文献": "REFERENCES",
  "作者简介": "AUTHOR_BIO",
};

export const parseWordXML = (xmlString: string): FormatRules => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");

  // Helper to safely get attribute
  const getVal = (context: Element | Document, selector: string, attr: string = "w:val") => {
    try {
      const escapedSelector = selector.replace(/:/g, '\\:');
      const el = context.querySelector(escapedSelector);
      return el ? el.getAttribute(attr) : null;
    } catch (e) {
      return null;
    }
  };

  // --- Style Discovery ---
  // We use the defaults from the Python script as the baseline, 
  // but we scan the style definitions to see if we can confirm them or find aliases.
  const styleMap = {
    heading1: "2",
    heading2: "4",
    heading3: "5",
    normal: "a3",
    captionFigure: "caption",
    captionTable: "caption",
    sectionTitle: "a36",
    referenceItem: "a41"
  };

  const styles = xmlDoc.getElementsByTagName("w:style");
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
    const styleId = style.getAttribute("w:styleId");
    const nameNode = style.getElementsByTagName("w:name")[0];
    const nameVal = nameNode ? nameNode.getAttribute("w:val")?.toLowerCase() : "";

    if (!styleId || !nameVal) continue;

    // Refine if explicit names are found (optional, fallback to defaults usually works for this template)
    if (nameVal === "heading 1" || nameVal.includes("标题 1")) styleMap.heading1 = styleId;
    else if (nameVal === "heading 2" || nameVal.includes("标题 2")) styleMap.heading2 = styleId;
    else if (nameVal === "heading 3" || nameVal.includes("标题 3")) styleMap.heading3 = styleId;
    else if (nameVal === "normal" || nameVal === "正文") styleMap.normal = styleId;
  }

  // --- Extract Basic Metrics for Preview ---
  const fontSizeNormalRaw = parseInt(getVal(xmlDoc, `w:style[w:styleId="${styleMap.normal}"] w:sz`) || "21");
  const fontSizeH1Raw = parseInt(getVal(xmlDoc, `w:style[w:styleId="${styleMap.heading1}"] w:sz`) || "32");
  
  const margins = {
    top: parseInt(getVal(xmlDoc, 'w:pgMar', 'w:top') || "1440") / 1440 * 2.54,
    bottom: parseInt(getVal(xmlDoc, 'w:pgMar', 'w:bottom') || "1440") / 1440 * 2.54,
    left: parseInt(getVal(xmlDoc, 'w:pgMar', 'w:left') || "1440") / 1440 * 2.54,
    right: parseInt(getVal(xmlDoc, 'w:pgMar', 'w:right') || "1440") / 1440 * 2.54,
  };

  return {
    rawXML: xmlString,
    fontMain: "SimSun",
    fontHeading: "SimHei",
    fontSizeNormal: `${fontSizeNormalRaw / 2}pt`,
    fontSizeH1: `${fontSizeH1Raw / 2}pt`,
    fontSizeH2: "14pt",
    fontSizeH3: "12pt",
    margins,
    lineSpacing: "20pt",
    styleMap
  };
};

/**
 * ------------------------------------------------------------------
 * Core Logic: Anchor Zone Replacement (基于锚点区间的替换)
 * ------------------------------------------------------------------
 */
export const generateThesisXML = (thesis: ThesisStructure, rules: FormatRules, references: Reference[]) => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rules.rawXML, "text/xml");
  const body = doc.getElementsByTagName("w:body")[0];
  
  if (!body) throw new Error("Invalid WordXML: No w:body found");

  // --- 1. Helper Functions ---

  const createParagraph = (text: string, styleId: string, align: 'left'|'center'|'both' = 'both') => {
    const p = doc.createElementNS(NS.w, "w:p");
    
    // Properties
    const pPr = doc.createElementNS(NS.w, "w:pPr");
    
    // Style
    const pStyle = doc.createElementNS(NS.w, "w:pStyle");
    pStyle.setAttribute("w:val", styleId);
    pPr.appendChild(pStyle);
    
    // Alignment
    if (align !== 'left') { // Word default is often left, but for thesis usually 'both' (justified) or 'center'
      const jc = doc.createElementNS(NS.w, "w:jc");
      jc.setAttribute("w:val", align);
      pPr.appendChild(jc);
    }
    
    // Special handling for References (List formatting)
    if (styleId === rules.styleMap.referenceItem) {
      const listPr = doc.createElementNS(NS.w, "w:listPr");
      const ilvl = doc.createElementNS(NS.w, "w:ilvl");
      ilvl.setAttribute("w:val", "0");
      const ilfo = doc.createElementNS(NS.w, "w:ilfo");
      ilfo.setAttribute("w:val", "5"); // Hardcoded as per user spec (listDefId=3 -> ilfo=5 usually)
      listPr.appendChild(ilvl);
      listPr.appendChild(ilfo);
      pPr.appendChild(listPr);
    }

    p.appendChild(pPr);

    // Text Run
    const r = doc.createElementNS(NS.w, "w:r");
    const t = doc.createElementNS(NS.w, "w:t");
    t.textContent = text;
    r.appendChild(t);
    p.appendChild(r);

    return p;
  };

  const createFigureBox = (desc: string) => {
    // Simple placeholder paragraph for figure
    return createParagraph(`[此处插入图片: ${desc}]`, rules.styleMap.captionFigure, 'center');
  };

  // Extract plain text from a paragraph node (for identification)
  const getParaText = (p: Element): string => {
    let text = "";
    const tNodes = p.getElementsByTagName("w:t");
    for (let i = 0; i < tNodes.length; i++) {
      text += tNodes[i].textContent;
    }
    return text.trim();
  };

  const getParaStyle = (p: Element): string | null => {
    const pPr = p.getElementsByTagName("w:pPr")[0];
    if (!pPr) return null;
    const pStyle = pPr.getElementsByTagName("w:pStyle")[0];
    return pStyle ? pStyle.getAttribute("w:val") : null;
  };

  // --- 2. Build Document Map (Find Anchors) ---
  
  // We need to identify the START node of each section.
  const anchors: Record<string, Element> = {};
  
  // Also track the first Heading 1 to identify Body Start
  let bodyStartNode: Element | null = null; 

  const children = Array.from(body.childNodes);
  
  for (const node of children) {
    if (node.nodeType !== 1 || node.nodeName !== "w:p") continue;
    
    const p = node as Element;
    const styleId = getParaStyle(p);
    const text = getParaText(p);
    
    // Check Front Matter Titles (style a36)
    if (styleId === rules.styleMap.sectionTitle) {
      // Fuzzy match text to known titles
      for (const [keyText, keyName] of Object.entries(FRONT_TITLES)) {
        if (text.replace(/\s+/g, '').includes(keyText.replace(/\s+/g, ''))) {
          if (!anchors[keyName]) {
             anchors[keyName] = p;
          }
        }
      }
    }
    
    // Check Chapter Headings (Heading 1)
    if (styleId === rules.styleMap.heading1) {
       if (!bodyStartNode) {
         // The first H1 is considered the start of the body
         bodyStartNode = p; 
       }
    }
  }

  // --- 3. Content Generation Helpers ---

  const parseNodes = (content: string | undefined): Element[] => {
    if (!content) return [];
    const nodes: Element[] = [];
    const parts = content.split(/(<[^>]+>.*?<\/[^>]+>|<[^>]+\/>)/g).filter(p => p.trim());
    
    parts.forEach(part => {
      const pMatch = part.match(/<p style="(.*?)">(.*?)<\/p>/);
      if (pMatch) {
        let styleId = pMatch[1];
        let text = pMatch[2];
        text = text.replace(/\[(\d+)\]/g, "[$1]");
        
        // Determine alignment based on style
        let align: 'left'|'center'|'both' = 'both';
        if (styleId === rules.styleMap.heading1 || styleId === rules.styleMap.sectionTitle) align = 'center';
        if (styleId === rules.styleMap.captionFigure || styleId === rules.styleMap.captionTable) align = 'center';

        nodes.push(createParagraph(text, styleId, align));
      }
      
      const figMatch = part.match(/<figure_placeholder id="(.*?)" desc="(.*?)" \/>/);
      if (figMatch) {
        nodes.push(createFigureBox(figMatch[2]));
      }
    });
    return nodes;
  };

  const getChapterNodes = () => {
    let nodes: Element[] = [];
    
    const process = (ch: Chapter) => {
      // 1. Title
      let styleId = rules.styleMap.heading1;
      let align: 'left' | 'center' = 'center';
      
      if (ch.level === 2) { styleId = rules.styleMap.heading2; align = 'left'; }
      if (ch.level === 3) { styleId = rules.styleMap.heading3; align = 'left'; }
      
      nodes.push(createParagraph(ch.title, styleId, align));
      
      // 2. Content
      if (ch.content) {
        nodes = nodes.concat(parseNodes(ch.content));
      }
      
      // 3. Subsections
      ch.subsections?.forEach(process);
    };

    thesis.chapters.forEach(process);
    return nodes;
  };

  const getRefNodes = () => {
    if (!references || references.length === 0) {
      // Fallback dummy refs if none provided
      return [
        createParagraph("[1] OpenAI. GPT-4 Technical Report. 2023.", rules.styleMap.referenceItem),
        createParagraph("[2] Google. Gemini 1.5 Pro. 2024.", rules.styleMap.referenceItem)
      ];
    }
    return references.map(ref => 
      createParagraph(`[${ref.id}] ${ref.description}`, rules.styleMap.referenceItem)
    );
  };

  // --- 4. Replacement Execution Function ---

  /**
   * Replaces all content between startNode and endNode (exclusive) with newNodes.
   * If endNode is null, replaces until end of body.
   */
  const replaceZone = (startNode: Element | null, endNode: Element | null, newNodes: Element[]) => {
    if (!startNode) return; // Zone start not found, skip

    // 1. Delete intermediate nodes
    let curr = startNode.nextSibling;
    while (curr && curr !== endNode) {
      const next = curr.nextSibling;
      body.removeChild(curr);
      curr = next;
    }

    // 2. Insert new nodes after startNode
    // We insert them in reverse order immediately after startNode to maintain correct order,
    // OR easier: insertBefore the `endNode` (or append if endNode is null)
    // But since we deleted everything between start and end, `startNode.nextSibling` is now `endNode`.
    
    const refNode = startNode.nextSibling; // This should be endNode or null
    
    newNodes.forEach(node => {
      body.insertBefore(node, refNode);
    });
  };

  // --- 5. Execute Replacements ---

  // ZONE 1: Abstract CN
  // Start: anchors.CN_ABSTRACT -> End: anchors.EN_ABSTRACT
  replaceZone(
    anchors.CN_ABSTRACT, 
    anchors.EN_ABSTRACT || anchors.TOC, 
    [createParagraph("本文提出了一种... (AI生成摘要)", rules.styleMap.normal)]
  );

  // ZONE 2: Abstract EN
  // Start: anchors.EN_ABSTRACT -> End: anchors.TOC
  replaceZone(
    anchors.EN_ABSTRACT, 
    anchors.TOC || bodyStartNode, 
    [createParagraph("This thesis proposes... (AI Abstract)", rules.styleMap.normal)]
  );

  // ZONE 3: Body Chapters
  // Start: bodyStartNode -> End: anchors.REFERENCES or anchors.ACKNOWLEDGEMENTS
  // We need to define the end of the body carefully.
  // It usually ends where References start.
  const bodyEndNode = anchors.REFERENCES || anchors.ACKNOWLEDGEMENTS || anchors.AUTHOR_BIO || null;
  
  if (bodyStartNode) {
    // Note: The template likely has "Chapter 1" already. We want to KEEP the start node (the title)?
    // No, replaceZone keeps the start node. But our `getChapterNodes` generates titles too.
    // So we actually want to replace the *Existing* Chapter 1 Title as well, or update its text.
    // However, `replaceZone` keeps the start node.
    // Strategy: We will delete the `bodyStartNode` (old Chap 1 title) manually and insert new chapters
    // relative to its previous position. 
    
    // Actually, `replaceZone` assumes startNode is a section header like "Abstract" that we KEEP.
    // For Body, the "Heading 1" in template is likely "第一章 绪论". We generated a NEW "第一章 绪论".
    // So we should remove the old one.
    
    // Let's create a specific logic for Body:
    // Insert new chapters BEFORE `bodyEndNode`.
    // Remove everything from `bodyStartNode` UP TO `bodyEndNode`.
    
    // 1. Find reference point for insertion (where body used to start)
    const insertRef = bodyEndNode; 
    
    // 2. Remove old body (including the first heading)
    let curr: Node | null = bodyStartNode;
    while(curr && curr !== bodyEndNode) {
        const next: Node | null = curr.nextSibling;
        body.removeChild(curr);
        curr = next;
    }
    
    // 3. Insert new body
    const newBodyNodes = getChapterNodes();
    newBodyNodes.forEach(node => {
        body.insertBefore(node, insertRef);
    });

  } else {
    // If no body start found (empty template?), just append before References
    const insertRef = bodyEndNode;
    const newBodyNodes = getChapterNodes();
    newBodyNodes.forEach(node => {
      if (insertRef) body.insertBefore(node, insertRef);
      else body.appendChild(node);
    });
  }

  // ZONE 4: References
  // Start: anchors.REFERENCES -> End: anchors.ACKNOWLEDGEMENTS
  replaceZone(
    anchors.REFERENCES,
    anchors.ACKNOWLEDGEMENTS || anchors.AUTHOR_BIO,
    getRefNodes()
  );

  // ZONE 5: Acknowledgements
  // Start: anchors.ACKNOWLEDGEMENTS -> End: anchors.AUTHOR_BIO
  replaceZone(
    anchors.ACKNOWLEDGEMENTS,
    anchors.AUTHOR_BIO || null,
    [createParagraph("感谢导师的悉心指导...", rules.styleMap.normal)]
  );

  return new XMLSerializer().serializeToString(doc);
};
