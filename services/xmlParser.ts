
import {
  FormatRules,
  ThesisStructure,
  Reference,
  TemplateMappingJSON,
  MappingSection,
  MappingBlock,
  BlockKind,
  TemplateBlock,
  MappingSectionKind,
  StyleSettings,
  StyleConfig
} from "../types";

// -------------------- Namespaces --------------------
const NS = {
  pkg: "http://schemas.microsoft.com/office/2006/xmlPackage",
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  v: "urn:schemas-microsoft-com:vml"
};

const NS_RELS = "http://schemas.openxmlformats.org/package/2006/relationships";

// -------------------- Text Normalization --------------------
const normalizeTitle = (s: string) =>
  (s || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeForMatch = (s: string) =>
  (s || "")
    .replace(/\u3000/g, "")
    .replace(/\s+/g, "")
    .trim();

// -------------------- Regex for Stripping Prefixes --------------------
const HEADING_PREFIX_RE = /^(第[零一二三四五六七八九十\d]+章|[\d\.]+)(\s+(第[零一二三四五六七八九十\d]+章|[\d\.]+))*\s*/;

const stripHeadingNumbering = (title: string): string => {
    return title.replace(HEADING_PREFIX_RE, "").trim();
};

const stripRefPrefix = (desc: string): string => {
    return desc.replace(/^(\[\d+\]|\d+\.|Reference \d+)\s*/i, "").trim();
};

// -------------------- DOM Helpers --------------------
const getChildByTagNameNS = (parent: Element, ns: string, localName: string): Element | null => {
  const direct = parent.getElementsByTagNameNS(ns, localName);
  if (direct.length > 0) return direct[0];
  for (let i = 0; i < parent.children.length; i++) {
    const c = parent.children[i];
    if (c.localName === localName && c.namespaceURI === ns) return c;
  }
  return null;
};

const getAttrNS = (el: Element, ns: string, localName: string): string | null => {
  if (el.hasAttributeNS(ns, localName)) return el.getAttributeNS(ns, localName);
  return el.getAttribute(localName) || el.getAttribute(`w:${localName}`) || null;
};

const getPkgPart = (doc: Document, name: string): Element | null => {
  const parts = doc.getElementsByTagNameNS(NS.pkg, "part");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].getAttributeNS(NS.pkg, "name") === name) return parts[i];
  }
  return null;
};

const getPartXmlRoot = (part: Element): Element | null => {
  const xmlData = getChildByTagNameNS(part, NS.pkg, "xmlData");
  return xmlData ? (xmlData.firstElementChild as Element) : null;
};

const extractStyleId = (p: Element): string | null => {
  const pPr = getChildByTagNameNS(p, NS.w, "pPr");
  if (!pPr) return null;
  const pStyle = getChildByTagNameNS(pPr, NS.w, "pStyle");
  return pStyle ? getAttrNS(pStyle, NS.w, "val") : null;
};

const getParaTextRaw = (p: Element): string => {
  const tNodes = p.getElementsByTagNameNS(NS.w, "t");
  let text = "";
  for (let i = 0; i < tNodes.length; i++) text += tNodes[i].textContent || "";
  return text;
};

const getInstrTexts = (p: Element): string[] => {
  const instrs = p.getElementsByTagNameNS(NS.w, "instrText");
  const out: string[] = [];
  for (let i = 0; i < instrs.length; i++) {
    const t = (instrs[i].textContent || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
};

const getBookmarkNames = (node: Element): string[] => {
  const bms = node.getElementsByTagNameNS(NS.w, "bookmarkStart");
  const out: string[] = [];
  for (let i = 0; i < bms.length; i++) {
    const name = getAttrNS(bms[i], NS.w, "name");
    if (name) out.push(name);
  }
  return out;
};

const hasOMML = (p: Element) =>
  p.getElementsByTagNameNS(NS.m, "oMath").length > 0 ||
  p.getElementsByTagNameNS(NS.m, "oMathPara").length > 0;

const hasImageLike = (p: Element) =>
  p.getElementsByTagNameNS(NS.w, "drawing").length > 0 ||
  p.getElementsByTagNameNS(NS.w, "pict").length > 0 ||
  p.getElementsByTagNameNS(NS.v, "shape").length > 0;

const hasFieldSEQ = (p: Element) => getInstrTexts(p).some(t => /\bSEQ\b/.test(t));

// -------------------- Parsing Constants --------------------

const FRONT_KEYS = new Set(["摘要", "摘 要", "ABSTRACT", "目录", "目 录"]);
const LOT_KEY = "表格目录";
const LOF_KEY = "插图目录";

const isBackMatterTitle = (txtRaw: string) => {
  const t = normalizeForMatch(txtRaw);
  return t === "致谢" || t === "参考文献" || t === "作者简介" || t === "附录" || /^攻读.*期间.*发表/.test(t);
};
const isFrontMatterTitle = (txtRaw: string) => {
    const t = normalizeForMatch(txtRaw).toLowerCase();
    return t === "摘要" || t === "abstract" || t === "目录" || t === "插图目录" || t === "表格目录";
};
const isListOfTablesTitle = (txtRaw: string) => normalizeForMatch(txtRaw) === normalizeForMatch(LOT_KEY);
const isListOfFiguresTitle = (txtRaw: string) => normalizeForMatch(txtRaw) === normalizeForMatch(LOF_KEY);

// --- IMPROVED: Build Heading Styles with Heuristics ---
const buildHeadingStyles = (stylesRoot: Element) => {
  const candidates: Record<number, { id: string, name: string }[]> = { 1: [], 2: [], 3: [] };
  
  const styles = stylesRoot.getElementsByTagNameNS(NS.w, "style");
  for (let i = 0; i < styles.length; i++) {
    const st = styles[i];
    if (getAttrNS(st, NS.w, "type") !== "paragraph") continue;
    const sid = getAttrNS(st, NS.w, "styleId");
    if (!sid) continue;

    // Get Name
    const nameNode = getChildByTagNameNS(st, NS.w, "name");
    const nameVal = nameNode ? getAttrNS(nameNode, NS.w, "val") || "" : "";

    const pPr = getChildByTagNameNS(st, NS.w, "pPr");
    if (!pPr) continue;
    const ol = getChildByTagNameNS(pPr, NS.w, "outlineLvl");
    if (!ol) continue;
    const v = getAttrNS(ol, NS.w, "val");
    if (v === null) continue;
    
    const lvl = parseInt(v, 10); // 0 = Heading 1, 1 = Heading 2 ...
    if (!Number.isNaN(lvl)) {
       const mappedLvl = lvl + 1; // Map 0->1, 1->2
       if (mappedLvl >= 1 && mappedLvl <= 3) {
           candidates[mappedLvl].push({ id: sid, name: nameVal });
       }
    }
  }

  const pickBest = (lvl: number, defaultId: string) => {
      const list = candidates[lvl];
      if (!list || list.length === 0) return defaultId;
      
      // Priority 1: Name contains "Heading X" or "标题 X"
      const nameMatch = list.find(c => {
          const n = c.name.toLowerCase();
          return n.includes(`heading ${lvl}`) || n.includes(`标题 ${lvl}`) || n.includes(`heading${lvl}`) || n.includes(`标题${lvl}`);
      });
      if (nameMatch) return nameMatch.id;

      // Priority 2: ID contains "HeadingX" or just "X"
      const idMatch = list.find(c => {
          const id = c.id.toLowerCase();
          return id === `${lvl}` || id === `heading${lvl}` || id.includes(`heading${lvl}`);
      });
      if (idMatch) return idMatch.id;

      // Fallback: First one found
      return list[0].id;
  };

  return {
      1: pickBest(1, "2"),
      2: pickBest(2, "4"),
      3: pickBest(3, "5")
  };
};

// Helper to get Style Name from ID (Important for Headers)
const getStyleNameById = (stylesRoot: Element, styleId: string): string | null => {
    const styles = stylesRoot.getElementsByTagNameNS(NS.w, "style");
    for (let i = 0; i < styles.length; i++) {
        if (getAttrNS(styles[i], NS.w, "styleId") === styleId) {
            const nameNode = getChildByTagNameNS(styles[i], NS.w, "name");
            return nameNode ? getAttrNS(nameNode, NS.w, "val") : styleId;
        }
    }
    return styleId; // Fallback to ID if name not found
};

// --- NEW HELPER: Check for Auto Numbering in Styles ---
const isStyleAutoNumbered = (stylesRoot: Element | null, styleId: string): boolean => {
    if (!stylesRoot) return false;
    const styles = stylesRoot.getElementsByTagNameNS(NS.w, "style");
    for (let i = 0; i < styles.length; i++) {
        const st = styles[i];
        if (getAttrNS(st, NS.w, "styleId") === styleId) {
            const pPr = getChildByTagNameNS(st, NS.w, "pPr");
            if (pPr && pPr.getElementsByTagNameNS(NS.w, "numPr").length > 0) return true;
        }
    }
    return false;
};

const isProtoAutoNumbered = (p: Element): boolean => {
     const pPr = getChildByTagNameNS(p, NS.w, "pPr");
     if (!pPr) return false;
     return pPr.getElementsByTagNameNS(NS.w, "numPr").length > 0;
};

const getDocRelationships = (doc: Document): Record<string, string> => {
    const relsPart = getPkgPart(doc, "/word/_rels/document.xml.rels");
    const map: Record<string, string> = {};
    if (!relsPart) return map;

    const xmlData = getChildByTagNameNS(relsPart, NS.pkg, "xmlData");
    if (!xmlData || !xmlData.firstElementChild) return map;

    const rels = xmlData.firstElementChild.getElementsByTagNameNS(NS_RELS, "Relationship");
    for (let i = 0; i < rels.length; i++) {
        const id = rels[i].getAttribute("Id");
        const target = rels[i].getAttribute("Target");
        if (id && target) {
            map[id] = target;
        }
    }
    return map;
};

// -------------------- DEBUG HELPER --------------------
export interface HeaderDebugInfo {
    sectionIndex: number;
    detectedH1Style: string;
    sectionStartText: string; // NEW: The text starting this section
    headers: {
        type: string | null; // default (odd), even, first
        file: string;
        data: { text: string; fields: string[] };
    }[];
}

export const inspectHeaderDebugInfo = (xmlString: string): HeaderDebugInfo[] => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    
    // 1. Detect H1 Style Name for Debug Info
    const stylesPart = getPkgPart(doc, "/word/styles.xml");
    let detectedH1 = "Unknown";
    if (stylesPart) {
        const stylesRoot = getPartXmlRoot(stylesPart);
        if (stylesRoot) {
            const hStyles = buildHeadingStyles(stylesRoot);
            detectedH1 = getStyleNameById(stylesRoot, hStyles[1]) || "Unknown";
        }
    }

    // 2. Parse Relationships
    const relsMap = getDocRelationships(doc);

    // 3. Parse Headers Content Map
    const headerContentMap: Record<string, {text: string, fields: string[]}> = {};
    const parts = doc.getElementsByTagNameNS(NS.pkg, "part");
    for(let i=0; i<parts.length; i++) {
        const name = parts[i].getAttributeNS(NS.pkg, "name");
        if(name && (name.includes("/word/header") || name.includes("/word/footer"))) {
             // Extract content
             const xmlData = getChildByTagNameNS(parts[i], NS.pkg, "xmlData");
             const root = xmlData?.firstElementChild;
             if(root) {
                 const texts = Array.from(root.getElementsByTagNameNS(NS.w, "t")).map(n => n.textContent || "").join(" ");
                 const instrs = Array.from(root.getElementsByTagNameNS(NS.w, "instrText")).map(n => n.textContent || "");
                 // Cleanup name to match rels target (e.g. /word/header1.xml -> header1.xml)
                 const shortName = name.split('/').pop()!;
                 headerContentMap[shortName] = { text: texts, fields: instrs };
             }
        }
    }

    // 4. Scan Sections in Document (Improved Linear Scan)
    const debugInfo: HeaderDebugInfo[] = [];
    const docPart = getPkgPart(doc, "/word/document.xml");
    const docRoot = getPartXmlRoot(docPart!);
    const body = getChildByTagNameNS(docRoot!, NS.w, "body");
    
    if(body) {
        let sectIndex = 1;
        let currentSectionStartText = "";
        
        // Helper to extract refs from a sectPr
        const extractRefs = (sectPr: Element, index: number, startText: string) => {
            const refs = sectPr.getElementsByTagNameNS(NS.w, "headerReference");
            const sectInfo: HeaderDebugInfo = { 
                sectionIndex: index, 
                detectedH1Style: detectedH1, 
                sectionStartText: startText || "(空白节 / Empty Section)",
                headers: [] 
            };
            for(let i=0; i<refs.length; i++) {
                const type = refs[i].getAttributeNS(NS.w, "type"); // default (odd), even, first
                const rid = refs[i].getAttributeNS(NS.r, "id");
                if(rid && relsMap[rid]) {
                    const target = relsMap[rid].split('/').pop()!;
                    sectInfo.headers.push({
                        type,
                        file: target,
                        data: headerContentMap[target] || { text: "Not Found", fields: [] }
                    });
                }
            }
            return sectInfo;
        };

        const children = Array.from(body.childNodes);
        
        for (let i = 0; i < children.length; i++) {
            const node = children[i] as Element;
            
            if (node.localName === 'p') {
                // Capture the start text of the section if we haven't yet
                const text = getParaTextRaw(node).trim();
                if (!currentSectionStartText && text) {
                    currentSectionStartText = text.substring(0, 50);
                }
                
                // Check for Section Break inside Paragraph Properties (pPr -> sectPr)
                const pPr = getChildByTagNameNS(node, NS.w, "pPr");
                const sectPr = pPr ? getChildByTagNameNS(pPr, NS.w, "sectPr") : null;
                
                if (sectPr) {
                    // This section break ends the current section
                    debugInfo.push(extractRefs(sectPr, sectIndex++, currentSectionStartText));
                    currentSectionStartText = ""; // Reset for next section
                }
            } 
            else if (node.localName === 'sectPr') {
                // This is a standalone section break (usually end of doc, or odd formatting)
                debugInfo.push(extractRefs(node, sectIndex++, currentSectionStartText));
                currentSectionStartText = "";
            }
            else if (node.localName === 'tbl' && !currentSectionStartText) {
                 currentSectionStartText = "[表格 / Table]";
            }
        }
    }

    return debugInfo;
}

// -------------------- GENERATION LOGIC --------------------

let globalId = 80000; 

interface Prototypes {
    h1: Element | null;
    h2: Element | null;
    h3: Element | null;
    normal: Element | null;
    caption: Element | null;
    refEntry: Element | null;
    table: Element | null;
}

const findPrototypes = (body: Element, headingStyles: Record<number, string>): Prototypes => {
    const protos: Prototypes = { h1: null, h2: null, h3: null, normal: null, caption: null, refEntry: null, table: null };
    const children = Array.from(body.children);
    let seenRefTitle = false;

    // Pass 1: Strict Body Search (Avoid Front/Back Matter if possible)
    for (const node of children) {
        if (node.localName === 'tbl') {
            if (!protos.table) protos.table = node;
            continue;
        }
        if (node.localName !== 'p') continue;

        const styleId = extractStyleId(node);
        const text = getParaTextRaw(node);
        const normalizedText = normalizeForMatch(text);

        if (styleId === headingStyles[1] && !protos.h1 && !isFrontMatterTitle(text) && !isBackMatterTitle(text)) protos.h1 = node;
        else if (styleId === headingStyles[2] && !protos.h2) protos.h2 = node;
        else if (styleId === headingStyles[3] && !protos.h3) protos.h3 = node;

        if (isBackMatterTitle(text) && normalizedText.includes("参考文献")) seenRefTitle = true;
        else if (seenRefTitle && !protos.refEntry && text.trim()) protos.refEntry = node;

        if (!protos.normal && 
            styleId !== headingStyles[1] && 
            styleId !== headingStyles[2] && 
            styleId !== headingStyles[3] &&
            !hasFieldSEQ(node) &&
            !isFrontMatterTitle(text) &&
            !isBackMatterTitle(text) &&
            text.trim().length > 5
        ) {
            protos.normal = node;
        }
        
        if (hasFieldSEQ(node) && !protos.caption) protos.caption = node;
    }

    // Pass 2: Fallback for H1 (If template is empty and only has Abstract/TOC as H1)
    if (!protos.h1) {
        for (const node of children) {
            if (node.localName !== 'p') continue;
            const styleId = extractStyleId(node);
            if (styleId === headingStyles[1]) {
                protos.h1 = node;
                break;
            }
        }
    }

    if (!protos.normal) {
        protos.normal = children.find(c => c.localName === 'p' && !extractStyleId(c)) || children.find(c => c.localName === 'p') || null;
    }
    return protos;
};

// --- STYLE OVERRIDES ---
const applyStyleOverrides = (doc: Document, node: Element, config?: StyleConfig) => {
    if (!config) return;

    const runs = node.getElementsByTagNameNS(NS.w, "r");
    for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        let rPr = getChildByTagNameNS(r, NS.w, "rPr");
        if (!rPr) {
            rPr = doc.createElementNS(NS.w, "w:rPr");
            r.insertBefore(rPr, r.firstChild);
        }

        let rFonts = getChildByTagNameNS(rPr, NS.w, "rFonts");
        if (!rFonts) {
            rFonts = doc.createElementNS(NS.w, "w:rFonts");
            rPr.appendChild(rFonts);
        }
        rFonts.setAttributeNS(NS.w, "w:ascii", config.fontFamilyAscii);
        rFonts.setAttributeNS(NS.w, "w:hAnsi", config.fontFamilyAscii);
        rFonts.setAttributeNS(NS.w, "w:eastAsia", config.fontFamilyCI);
        rFonts.setAttributeNS(NS.w, "w:hint", "eastAsia");

        const oldSz = getChildByTagNameNS(rPr, NS.w, "sz");
        if (oldSz) rPr.removeChild(oldSz);
        const oldSzCs = getChildByTagNameNS(rPr, NS.w, "szCs");
        if (oldSzCs) rPr.removeChild(oldSzCs);

        const sz = doc.createElementNS(NS.w, "w:sz");
        sz.setAttributeNS(NS.w, "w:val", config.fontSize);
        rPr.appendChild(sz);

        const szCs = doc.createElementNS(NS.w, "w:szCs");
        szCs.setAttributeNS(NS.w, "w:val", config.fontSize);
        rPr.appendChild(szCs);
    }
};


const cloneWithText = (doc: Document, proto: Element, newText: string) => {
    const clone = proto.cloneNode(true) as Element;
    let sampleRun = getChildByTagNameNS(clone, NS.w, "r");
    if (!sampleRun) {
        sampleRun = doc.createElementNS(NS.w, "w:r");
        clone.appendChild(sampleRun);
    }
    
    const pPr = getChildByTagNameNS(clone, NS.w, "pPr");
    while (clone.firstChild) {
        if (clone.firstChild === pPr) clone.removeChild(clone.firstChild);
        else clone.removeChild(clone.firstChild);
    }
    if (pPr) clone.appendChild(pPr);

    const newRun = sampleRun.cloneNode(true) as Element;
    const rPr = getChildByTagNameNS(newRun, NS.w, "rPr");
    while (newRun.firstChild) newRun.removeChild(newRun.firstChild);
    if (rPr) newRun.appendChild(rPr);

    const t = doc.createElementNS(NS.w, "w:t");
    t.setAttribute("xml:space", "preserve");
    t.textContent = newText;
    newRun.appendChild(t);
    clone.appendChild(newRun);
    return clone;
};

const createFieldRuns = (doc: Document, sampleRun: Element, instr: string, display: string) => {
    const makeRun = (type: 'begin' | 'end' | 'separate' | 'instr' | 'text', val?: string) => {
        const r = sampleRun.cloneNode(true) as Element;
        const rPr = getChildByTagNameNS(r, NS.w, "rPr");
        while (r.firstChild) r.removeChild(r.firstChild);
        if (rPr) r.appendChild(rPr);

        if (type === 'text') {
            const t = doc.createElementNS(NS.w, "w:t");
            t.setAttribute("xml:space", "preserve");
            t.textContent = val || "";
            r.appendChild(t);
        } else if (type === 'instr') {
            const it = doc.createElementNS(NS.w, "w:instrText");
            it.setAttribute("xml:space", "preserve");
            it.textContent = val || "";
            r.appendChild(it);
        } else {
            const f = doc.createElementNS(NS.w, "w:fldChar");
            f.setAttributeNS(NS.w, "w:fldCharType", type);
            r.appendChild(f);
        }
        return r;
    };

    return [
        makeRun('begin'),
        makeRun('instr', instr),
        makeRun('separate'),
        makeRun('text', display),
        makeRun('end')
    ];
};

const createBookmark = (doc: Document, name: string, id: string, type: "start" | "end") => {
    const tagName = type === "start" ? "w:bookmarkStart" : "w:bookmarkEnd";
    const el = doc.createElementNS(NS.w, tagName);
    el.setAttributeNS(NS.w, "w:id", id);
    if (type === "start") el.setAttributeNS(NS.w, "w:name", name);
    return el;
};

// --- NEW HELPER: Strict Linear Math Run ---
const createMathRun = (doc: Document, text: string) => {
    const r = doc.createElementNS(NS.m, "m:r");
    
    // m:rPr with sty p (Strict Linear Format Hint)
    const mRPr = doc.createElementNS(NS.m, "m:rPr");
    const sty = doc.createElementNS(NS.m, "m:sty");
    sty.setAttributeNS(NS.m, "m:val", "p");
    mRPr.appendChild(sty);
    r.appendChild(mRPr);

    // w:rPr with Cambria Math
    const wRPr = doc.createElementNS(NS.w, "w:rPr");
    const rFonts = doc.createElementNS(NS.w, "w:rFonts");
    rFonts.setAttributeNS(NS.w, "w:ascii", "Cambria Math");
    rFonts.setAttributeNS(NS.w, "w:hAnsi", "Cambria Math");
    wRPr.appendChild(rFonts);
    r.appendChild(wRPr);

    const t = doc.createElementNS(NS.m, "m:t");
    t.textContent = text;
    r.appendChild(t);
    
    return r;
};

// --- Helpers for Headers & Math ---

const updateHeadersAndFooters = (doc: Document, h1StyleName: string, settings?: StyleSettings, allowedParts?: Set<string>) => {
    const parts = doc.getElementsByTagNameNS(NS.pkg, "part");
    
    // User Override has priority, otherwise use auto-detected
    const targetStyleName = settings?.header.headerReferenceStyle || h1StyleName || "标题 1";

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const name = part.getAttributeNS(NS.pkg, "name");
        
        // Filter: Only process if it is a header/footer
        const isHeaderFooter = name && (name.includes("/word/header") || name.includes("/word/footer"));
        if (!isHeaderFooter) continue;
        
        // Filter: If allowedParts whitelist is provided, ensure this part is in it
        if (allowedParts && name && !allowedParts.has(name)) {
            continue;
        }

        const xmlData = getChildByTagNameNS(part, NS.pkg, "xmlData");
        if (!xmlData) continue;

        const root = xmlData.firstElementChild;
        if (!root) continue;
        
        let foundTargetRef = false; // Flag to track if we've already handled the primary ref

        // 1. Fix STYLEREF to point to the correct Heading 1 Style Name
        const instrs = root.getElementsByTagNameNS(NS.w, "instrText");
        
        for (let j = 0; j < instrs.length; j++) {
            const instrNode = instrs[j];
            const text = instrNode.textContent || "";
            
            // Logic A: Standard STYLEREF Replacement
            if (text.includes("STYLEREF") && settings?.header.oddPage === 'chapterTitle') {
                const isMatchingTarget = text.includes(`"${targetStyleName}"`) || text.includes(targetStyleName);
                
                // If this is a STYLEREF to our target style...
                if (isMatchingTarget || text.toLowerCase().includes("heading 1")) {
                     if (foundTargetRef) {
                         // DUPLICATE DETECTED: This is likely the second part of a [Num] [Text] split.
                         // Since our L1 is now Manual (Full Text), we don't want this second one.
                         // We replace it with an empty QUOTE field which renders nothing.
                         instrNode.textContent = ' QUOTE "" ';
                         continue;
                     }
                     
                     // FIRST OCCURRENCE: Keep it, but ensure switches are clean so it shows Full Text.
                     // Remove \n (num only) or \t (text only) switches to let it default to Full Text?
                     // Actually, if we leave it as is, and the paragraph has NO numbering,
                     // STYLEREF should default to text.
                     // But if it has \n (num only), and there is no num, it might show nothing or weirdness.
                     // Safest is to remove switches.
                     let newText = text.replace(
                        /STYLEREF\s+(?:\\"[^"]+\\"|"[^"]+"|[^\s\\]+)/i, 
                        `STYLEREF "${targetStyleName}"`
                    );
                    
                    // Remove common switches \n, \r, \t to force full paragraph capture
                    // Preserve \* MERGEFORMAT if you want, or just strip all switches
                    // Let's strip \n, \r, \t specifically.
                    newText = newText.replace(/\\n/gi, "").replace(/\\r/gi, "").replace(/\\t/gi, "");
                    
                    instrNode.textContent = newText;
                    foundTargetRef = true;
                    continue;
                }
            }
            
            // Logic B: Handle Split XML Nodes (Common in Word for "Heading 1" text only)
            const trimmed = text.trim().replace(/^"/, "").replace(/"$/, ""); // Remove quotes
            const lowerTrimmed = trimmed.toLowerCase();
            
            if ((lowerTrimmed === "标题 1" || lowerTrimmed === "标题1" || lowerTrimmed === "heading 1" || lowerTrimmed === "heading1") && settings?.header.oddPage === 'chapterTitle') {
                // If we already found a ref, this might be a loose node belonging to the second ref.
                // It's hard to be precise without parsing context. 
                // But generally, update the name.
                instrNode.textContent = targetStyleName;
            }
        }

        // 2. Fix Static Text (Even Headers)
        const texts = root.getElementsByTagNameNS(NS.w, "t");
        for (let j = 0; j < texts.length; j++) {
            const tNode = texts[j];
            const content = tNode.textContent || "";
            // If it matches the school name pattern or is just a static even header
            if (content.includes("东南大学硕士学位论文") || content.includes("硕士学位论文")) {
                if (settings?.header.evenPageText) {
                    tNode.textContent = settings.header.evenPageText;
                }
            }
        }
    }
};

// --- Refactored Content Node Creator ---
const createContentNodes = (
    contentRaw: string, 
    doc: Document, 
    protos: Prototypes,
    chapterIndex: number,
    counters: { fig: number; tbl: number; eq: number },
    styleSettings?: StyleSettings
): Element[] => {
    const nodes: Element[] = [];
    if (!contentRaw) return nodes;

    // --- STRATEGY CHANGE: PRE-PROCESS TO FORCE BLOCK ELEMENTS ONTO NEW LINES ---
    // If AI outputs "Text [[EQ:...]] Text", we force it to: "Text \n\n [[EQ:...]] \n\n Text"
    // This ensures they are split into separate paragraphs below.
    // We use a specific regex to capture FIG, TBL, EQ blocks.
    const processedRaw = contentRaw
        .replace(/(\[\[(?:FIG|TBL|EQ):[\s\S]*?\]\])/g, "\n\n$1\n\n");

    const paragraphs = processedRaw.split(/\n\s*\n/).filter(p => p.trim());
    
    const baseProto = protos.normal || protos.h1;
    if (!baseProto) return nodes;
    
    let sampleRun = getChildByTagNameNS(baseProto, NS.w, "r");
    if (!sampleRun) {
        sampleRun = doc.createElementNS(NS.w, "w:r");
        const rPr = doc.createElementNS(NS.w, "w:rPr");
        sampleRun.appendChild(rPr);
    }

    paragraphs.forEach(pText => {
        const trimmed = pText.trim();
        if (!trimmed) return;

        // --- BLOCK ELEMENTS (Exclusive Paragraphs) ---
        if (trimmed.startsWith("[[FIG:")) {
             counters.fig++;
             const desc = trimmed.replace(/^\[\[FIG:/, "").replace(/\]\]$/, "");
             const bmId = (globalId++).toString();
             const bmName = `_Fig_${bmId}`;
             
             // Image Placeholder
             const pImg = cloneWithText(doc, baseProto, "（在此处插入图片）");
             let pPr = getChildByTagNameNS(pImg, NS.w, "pPr");
             if(!pPr) { pPr = doc.createElementNS(NS.w, "w:pPr"); pImg.appendChild(pPr); }
             let jc = getChildByTagNameNS(pPr, NS.w, "jc");
             if(!jc) { jc = doc.createElementNS(NS.w, "w:jc"); pPr.appendChild(jc); }
             jc.setAttributeNS(NS.w, "w:val", "center");
             
             if (styleSettings) applyStyleOverrides(doc, pImg, styleSettings.body);
             nodes.push(pImg);

             // Caption
             let pCap = protos.caption ? protos.caption.cloneNode(true) as Element : baseProto.cloneNode(true) as Element;
             const capPr = getChildByTagNameNS(pCap, NS.w, "pPr");
             while (pCap.firstChild) if(pCap.firstChild !== capPr) pCap.removeChild(pCap.firstChild); else pCap.removeChild(pCap.firstChild);
             if(capPr) pCap.appendChild(capPr);
             
             if(!capPr) { const newPr = doc.createElementNS(NS.w, "w:pPr"); pCap.appendChild(newPr); }
             const finalPr = getChildByTagNameNS(pCap, NS.w, "pPr")!;
             let capJc = getChildByTagNameNS(finalPr, NS.w, "jc");
             if(!capJc) { capJc = doc.createElementNS(NS.w, "w:jc"); finalPr.appendChild(capJc); }
             capJc.setAttributeNS(NS.w, "w:val", "center");

             let capSample = null;
             if (protos.caption) {
                 const r = getChildByTagNameNS(protos.caption, NS.w, "r");
                 if (r) capSample = r.cloneNode(true) as Element;
             }
             if (!capSample && sampleRun) capSample = sampleRun.cloneNode(true) as Element;
             if (!capSample) capSample = doc.createElementNS(NS.w, "w:r");

             const appendText = (t: string) => {
                 const r = capSample!.cloneNode(true) as Element;
                 const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                 while (r.firstChild) r.removeChild(r.firstChild);
                 if(rPr) r.appendChild(rPr);
                 const wt = doc.createElementNS(NS.w, "w:t");
                 wt.setAttribute("xml:space", "preserve");
                 wt.textContent = t;
                 r.appendChild(wt);
                 pCap.appendChild(r);
             };

             pCap.appendChild(createBookmark(doc, bmName, bmId, "start"));
             appendText("图 ");
             appendText(chapterIndex.toString());
             appendText("-");
             createFieldRuns(doc, capSample, "SEQ Figure \\* ARABIC \\s 1", counters.fig.toString()).forEach(n => pCap.appendChild(n));
             pCap.appendChild(createBookmark(doc, bmName, bmId, "end"));
             appendText("  " + desc);
             
             if (styleSettings) applyStyleOverrides(doc, pCap, styleSettings.caption);
             nodes.push(pCap);
        }
        else if (trimmed.startsWith("[[TBL:")) {
             counters.tbl++;
             const desc = trimmed.replace(/^\[\[TBL:/, "").replace(/\]\]$/, "");
             
             let pCap = protos.caption ? protos.caption.cloneNode(true) as Element : baseProto.cloneNode(true) as Element;
             const capPr = getChildByTagNameNS(pCap, NS.w, "pPr");
             while (pCap.firstChild) if(pCap.firstChild !== capPr) pCap.removeChild(pCap.firstChild); else pCap.removeChild(pCap.firstChild);
             if(capPr) pCap.appendChild(capPr);
             
             if(!capPr) { const newPr = doc.createElementNS(NS.w, "w:pPr"); pCap.appendChild(newPr); }
             const finalPr = getChildByTagNameNS(pCap, NS.w, "pPr")!;
             let capJc = getChildByTagNameNS(finalPr, NS.w, "jc");
             if(!capJc) { capJc = doc.createElementNS(NS.w, "w:jc"); finalPr.appendChild(capJc); }
             capJc.setAttributeNS(NS.w, "w:val", "center");
             
             let capSample = null;
             if (protos.caption) {
                 const r = getChildByTagNameNS(protos.caption, NS.w, "r");
                 if (r) capSample = r.cloneNode(true) as Element;
             }
             if (!capSample && sampleRun) capSample = sampleRun.cloneNode(true) as Element;
             if (!capSample) capSample = doc.createElementNS(NS.w, "w:r");

             const appendText = (t: string) => {
                 const r = capSample!.cloneNode(true) as Element;
                 const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                 while (r.firstChild) r.removeChild(r.firstChild);
                 if(rPr) r.appendChild(rPr);
                 const wt = doc.createElementNS(NS.w, "w:t");
                 wt.setAttribute("xml:space", "preserve");
                 wt.textContent = t;
                 r.appendChild(wt);
                 pCap.appendChild(r);
             };
             
             const bmId = (globalId++).toString();
             const bmName = `_Tbl_${bmId}`;

             pCap.appendChild(createBookmark(doc, bmName, bmId, "start"));
             appendText("表 ");
             appendText(chapterIndex.toString());
             appendText("-");
             createFieldRuns(doc, capSample, "SEQ Table \\* ARABIC \\s 1", counters.tbl.toString()).forEach(n => pCap.appendChild(n));
             pCap.appendChild(createBookmark(doc, bmName, bmId, "end"));
             appendText("  " + desc);
             
             if (styleSettings) applyStyleOverrides(doc, pCap, styleSettings.caption);
             nodes.push(pCap);

             if (protos.table) {
                 nodes.push(protos.table.cloneNode(true) as Element);
             } else {
                 const tNode = cloneWithText(doc, baseProto, "[此处插入表格]");
                 if (styleSettings) applyStyleOverrides(doc, tNode, styleSettings.table);
                 nodes.push(tNode);
             }
        }
        else if (trimmed.startsWith("[[EQ:")) {
             counters.eq++;
             const eqText = trimmed.replace(/^\[\[EQ:/, "").replace(/\]\]$/, "");
             
             const p = baseProto.cloneNode(true) as Element;
             // clear children but keep pPr using simpler logic
             const pPr = getChildByTagNameNS(p, NS.w, "pPr");
             while (p.lastChild) {
                 if (p.lastChild !== pPr) p.removeChild(p.lastChild);
                 else if (p.childNodes.length === 1) break;
                 else p.removeChild(p.lastChild); 
             }
             if (pPr && !p.firstChild) p.appendChild(pPr);

             const oMathPara = doc.createElementNS(NS.m, "m:oMathPara");
             const oMath = doc.createElementNS(NS.m, "m:oMath");
             oMathPara.appendChild(oMath);

             const separator = styleSettings?.equationSeparator || '-';
             // Linear format string for Word to compile
             const linearMathString = `${eqText}#(${chapterIndex}${separator}${counters.eq})`;
             
             // Use Strict Math Run (Equation 2 Style)
             const mR = createMathRun(doc, linearMathString);
             oMath.appendChild(mR);

             p.appendChild(oMathPara);
             nodes.push(p);
        }
        // --- TEXT PARAGRAPHS (May contain Inline SYM/REF) ---
        else {
             const p = baseProto.cloneNode(true) as Element;
             const pPr = getChildByTagNameNS(p, NS.w, "pPr");
             while (p.firstChild) if(p.firstChild !== pPr) p.removeChild(p.firstChild); else p.removeChild(p.firstChild);
             if (pPr) p.appendChild(pPr);

             // Split by inline tags
             const parts = trimmed.split(/(\[\[(?:SYM|REF):.*?\]\])/g);
             
             parts.forEach(part => {
                 if (!part) return;
                 
                 if (part.startsWith("[[SYM:")) {
                    const symText = part.replace(/^\[\[SYM:/, "").replace(/\]\]$/, "");
                    
                    const oMath = doc.createElementNS(NS.m, "m:oMath");
                    // Use Strict Math Run for Inline too
                    const mR = createMathRun(doc, symText);
                    oMath.appendChild(mR);
                    p.appendChild(oMath);
                 } 
                 else if (part.startsWith("[[REF:")) {
                    if (part.match(/^\[\[REF:\d+\]\]$/)) {
                        const id = part.match(/\d+/)?.[0];
                        const bmName = `_Ref_${id}_target`;
                        
                        const refRun = sampleRun!.cloneNode(true) as Element;
                        while (refRun.firstChild) refRun.removeChild(refRun.firstChild);
                        let rPr = getChildByTagNameNS(sampleRun!, NS.w, "rPr");
                        if (rPr) rPr = rPr.cloneNode(true) as Element;
                        else rPr = doc.createElementNS(NS.w, "w:rPr");
                        refRun.appendChild(rPr);
                        
                        const vertAlign = doc.createElementNS(NS.w, "w:vertAlign");
                        vertAlign.setAttributeNS(NS.w, "w:val", "superscript");
                        rPr.appendChild(vertAlign);
                        
                        createFieldRuns(doc, refRun, `REF ${bmName} \\h`, `[${id}]`).forEach(n => p.appendChild(n));
                    }
                 } 
                 else {
                     // Regular Text
                     const r = sampleRun!.cloneNode(true) as Element;
                     const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                     while(r.firstChild) r.removeChild(r.firstChild);
                     if(rPr) r.appendChild(rPr);
                     
                     const t = doc.createElementNS(NS.w, "w:t");
                     t.setAttribute("xml:space", "preserve");
                     t.textContent = part;
                     r.appendChild(t);
                     p.appendChild(r);
                 }
             });
             
             if (styleSettings) applyStyleOverrides(doc, p, styleSettings.body);
             nodes.push(p);
        }
    });

    return nodes;
};

const extractMapping = (
    body: Element, 
    headingStyles: Record<number, string>, 
    sourceName: string
): TemplateMappingJSON => {
    const sections: MappingSection[] = [];
    const blocks: MappingBlock[] = [];
    
    // Initial Section (Root/Front)
    let currentSection: MappingSection = {
        id: `sec_${globalId++}`,
        kind: 'front',
        title: 'Front Matter',
        level: 0,
        startOrder: 0,
        endOrder: 0,
        blocks: []
    };
    sections.push(currentSection);

    const children = Array.from(body.children);
    
    children.forEach((node, idx) => {
        // We track p, tbl, sectPr
        if (node.localName !== 'p' && node.localName !== 'tbl' && node.localName !== 'sectPr') return;
        
        const order = idx;
        const blockId = `blk_${globalId++}`;
        
        let type: BlockKind = 'other';
        let level = 0;
        let text = "";
        let styleId: string | null = null;
        
        // 1. Analyze Node
        if (node.localName === 'p') {
            text = getParaTextRaw(node);
            styleId = extractStyleId(node);
            
            if (styleId === headingStyles[1]) { type = 'heading'; level = 1; }
            else if (styleId === headingStyles[2]) { type = 'heading'; level = 2; }
            else if (styleId === headingStyles[3]) { type = 'heading'; level = 3; }
            else {
                if (isFrontMatterTitle(text)) { type = 'front_title'; level = 1; }
                else if (isBackMatterTitle(text)) { type = 'back_title'; level = 1; }
                else if (isListOfTablesTitle(text)) type = 'toc_title'; // LOT
                else if (isListOfFiguresTitle(text)) type = 'toc_title'; // LOF
                else if (hasImageLike(node)) type = 'image_placeholder';
                else if (hasOMML(node)) type = 'equation';
                else type = 'paragraph';
                
                // Heuristic for caption
                if (styleId && (styleId.toLowerCase().includes('caption') || styleId === 'caption')) {
                     if (text.includes('图')) type = 'caption_figure';
                     else if (text.includes('表')) type = 'caption_table';
                     else type = 'caption_figure';
                }
            }
        } else if (node.localName === 'tbl') {
            type = 'table';
        }
        
        // 2. Section Segmentation Logic
        let startNewSection = false;
        let nextKind: MappingSectionKind = currentSection.kind;
        
        // If we hit a Level 1 Heading, or specific front/back titles
        if (level === 1) {
            startNewSection = true;
            if (isFrontMatterTitle(text)) {
                nextKind = 'front';
                if (text.includes('目录')) nextKind = 'toc';
            } else if (isBackMatterTitle(text)) {
                nextKind = 'back';
            } else {
                nextKind = 'body';
            }
        }
        
        if (startNewSection) {
             // Close previous
             currentSection.endOrder = order - 1;
             
             // Open new
             currentSection = {
                 id: `sec_${globalId++}`,
                 kind: nextKind,
                 title: text || `Section ${sections.length}`,
                 level: 1,
                 startOrder: order,
                 endOrder: order,
                 blocks: []
             };
             sections.push(currentSection);
        }
        
        // 3. Create Block
        const blk: MappingBlock = {
            id: blockId,
            order,
            nodeType: node.localName as any,
            type,
            level,
            styleId: styleId || undefined,
            text,
            owner: { sectionId: currentSection.id },
            fields: node.localName === 'p' ? getInstrTexts(node) : undefined,
            bookmarks: getBookmarkNames(node)
        };
        
        blocks.push(blk);
        currentSection.blocks.push(blockId);
        currentSection.endOrder = order;
    });

    return {
        source: sourceName,
        headingStyleIds: { h1: headingStyles[1], h2: headingStyles[2], h3: headingStyles[3] },
        sections,
        blocks
    };
};

export const generateThesisXML = (thesis: ThesisStructure, rules: FormatRules, references: Reference[], styleSettings?: StyleSettings): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rules.rawXML, "text/xml");
    
    const docPart = getPkgPart(doc, "/word/document.xml");
    const docRoot = getPartXmlRoot(docPart!);
    const body = getChildByTagNameNS(docRoot!, NS.w, "body");
    if (!body) throw new Error("Format Error: No body found");

    const stylesPart = getPkgPart(doc, "/word/styles.xml");
    const stylesRoot = getPartXmlRoot(stylesPart!);
    const headingStyles = stylesRoot ? buildHeadingStyles(stylesRoot) : {
        1: rules.styleIds.heading1, 2: rules.styleIds.heading2, 3: rules.styleIds.heading3
    };

    const h1StyleName = stylesRoot ? getStyleNameById(stylesRoot, headingStyles[1]) : "标题 1";

    // --- REORDERED LOGIC: Scan Body & Section Properties FIRST ---
    const children = Array.from(body.children);
    let startDeleteIdx = -1;
    let endDeleteIdx = -1;
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.localName === 'p') {
            const sid = extractStyleId(node);
            const txt = getParaTextRaw(node);
            if (sid === headingStyles[1] && !isFrontMatterTitle(txt) && !isBackMatterTitle(txt)) {
                startDeleteIdx = i;
                break;
            }
        }
    }
    for (let i = (startDeleteIdx === -1 ? 0 : startDeleteIdx); i < children.length; i++) {
        const node = children[i];
        if (node.localName === 'p') {
            if (isBackMatterTitle(getParaTextRaw(node))) {
                endDeleteIdx = i;
                break;
            }
        }
        if (node.localName === 'sectPr') {
             endDeleteIdx = i;
             break;
        }
    }
    if (endDeleteIdx === -1) endDeleteIdx = children.length;

    // --- NEW LOGIC: Robust Body SectPr Detection ---
    let effectiveBodySectPr: Element | null = null;
    if (startDeleteIdx !== -1) {
        if (endDeleteIdx < children.length && children[endDeleteIdx].localName === 'sectPr') {
             effectiveBodySectPr = children[endDeleteIdx];
        } 
        else {
             for (let i = endDeleteIdx; i < children.length; i++) {
                 const node = children[i];
                 if (node.localName === 'sectPr') {
                     effectiveBodySectPr = node;
                     break;
                 }
                 if (node.localName === 'p') {
                     const pPr = getChildByTagNameNS(node, NS.w, 'pPr');
                     const sectPr = pPr ? getChildByTagNameNS(pPr, NS.w, 'sectPr') : null;
                     if (sectPr) {
                         effectiveBodySectPr = sectPr;
                         break;
                     }
                 }
             }
        }
        if (!effectiveBodySectPr) {
            const last = body.lastElementChild;
            if (last && last.localName === 'sectPr') effectiveBodySectPr = last;
        }
    }

    // Identify Whitelisted Header Parts
    let bodyHeaderPartNames: Set<string> | undefined = undefined;
    if (startDeleteIdx !== -1 && effectiveBodySectPr) {
        const relsMap = getDocRelationships(doc);
        const headerRefs = effectiveBodySectPr.getElementsByTagNameNS(NS.w, "headerReference");
        if (headerRefs.length > 0) {
            bodyHeaderPartNames = new Set();
            for (let i = 0; i < headerRefs.length; i++) {
                const rid = getAttrNS(headerRefs[i], NS.r, "id");
                if (rid && relsMap[rid]) {
                    const target = relsMap[rid];
                    const partName = target.startsWith('/') ? `/word${target}` : `/word/${target}`;
                    bodyHeaderPartNames.add(partName);
                }
            }
        }
    }

    // --- HEADER FIX START (Scoped to Body Parts) ---
    // Update headers to point to this style name (not ID!)
    updateHeadersAndFooters(doc, h1StyleName || "标题 1", styleSettings, bodyHeaderPartNames);
    // --- HEADER FIX END ---

    const protos = findPrototypes(body, headingStyles);

    let anchorNode: Node | null = null;
    
    // --- Remove Old Body Content ---
    if (startDeleteIdx !== -1) {
        const toRemove = children.slice(startDeleteIdx, endDeleteIdx);
        toRemove.forEach(n => body.removeChild(n));
        anchorNode = children[endDeleteIdx];
    } else {
        const sectPr = getChildByTagNameNS(body, NS.w, "sectPr");
        anchorNode = sectPr;
    }

    let l1ChapterIndex = 0;
    let chapterCounters = { fig: 0, tbl: 0, eq: 0 };
    let lastInsertedPara: Element | null = null;

    const insertChapter = (ch: typeof thesis.chapters[0]) => {
        let pTitle: Element | null = null;
        let titleText = ch.title;
        
        if (ch.level === 1) {
             l1ChapterIndex++;
             chapterCounters = { fig: 0, tbl: 0, eq: 0 };
             
             if (protos.h1) {
                // LEVEL 1: Use Manual Full Title ("第一章 绪论")
                // Do NOT strip prefix.
                // Do REMOVE numPr to prevent double numbering (since we manually typed "第一章")
                pTitle = cloneWithText(doc, protos.h1, titleText);
                
                const pPr = getChildByTagNameNS(pTitle, NS.w, "pPr");
                if (pPr) {
                    const numPr = getChildByTagNameNS(pPr, NS.w, "numPr");
                    if (numPr) pPr.removeChild(numPr);
                }

                if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading1);
             }
        } else if (ch.level === 2 && protos.h2) {
             // LEVEL 2: STRIP Prefix ("1.1 标题" -> "标题").
             // Do NOT remove numPr (rely on Auto Numbering to add "1.1")
             const strippedTitle = stripHeadingNumbering(titleText);
             pTitle = cloneWithText(doc, protos.h2, strippedTitle);
             if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading2);
        } else if (ch.level === 3 && protos.h3) {
             // LEVEL 3: STRIP Prefix ("1.1.1 标题" -> "标题").
             // Do NOT remove numPr (rely on Auto Numbering to add "1.1.1")
             const strippedTitle = stripHeadingNumbering(titleText);
             pTitle = cloneWithText(doc, protos.h3, strippedTitle);
             if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading3);
        } else {
             pTitle = cloneWithText(doc, protos.h1 || protos.normal!, titleText);
        }

        if (pTitle) {
            body.insertBefore(pTitle, anchorNode);
            lastInsertedPara = pTitle;
        }

        if (ch.content) {
            const contentNodes = createContentNodes(ch.content, doc, protos, l1ChapterIndex, chapterCounters, styleSettings);
            contentNodes.forEach(n => {
                body.insertBefore(n, anchorNode);
                lastInsertedPara = n;
            });
        }

        if (ch.subsections) ch.subsections.forEach(insertChapter);
    };

    thesis.chapters.forEach(insertChapter);
    
    // --- Re-attach Body Section Properties (Same logic as before) ---
    if (startDeleteIdx !== -1) {
         const lastRemoved = children[endDeleteIdx - 1];
         let lostSectPr: Element | null = null;
         if (lastRemoved) {
             if (lastRemoved.localName === 'sectPr') lostSectPr = lastRemoved;
             else if (lastRemoved.localName === 'p') {
                 const pPr = getChildByTagNameNS(lastRemoved, NS.w, 'pPr');
                 const sp = pPr ? getChildByTagNameNS(pPr, NS.w, 'sectPr') : null;
                 if (sp) lostSectPr = sp;
             }
         }
         
         const targetPara = lastInsertedPara as Element | null;
         if (lostSectPr && targetPara && targetPara.localName === 'p') {
             let pPr = getChildByTagNameNS(targetPara, NS.w, "pPr");
             if (!pPr) {
                 pPr = doc.createElementNS(NS.w, "w:pPr");
                 targetPara.insertBefore(pPr, targetPara.firstChild);
             }
             const oldSectPr = getChildByTagNameNS(pPr, NS.w, "sectPr");
             if (oldSectPr) pPr.removeChild(oldSectPr);
             pPr.appendChild(lostSectPr.cloneNode(true));
         }
    }

    const currentKids = Array.from(body.children);
    const refHeader = currentKids.find(n => {
        if (n.localName !== 'p') return false;
        const txt = getParaTextRaw(n);
        return isBackMatterTitle(txt) && normalizeForMatch(txt).includes("参考文献");
    });

    if (refHeader && references.length > 0 && protos.refEntry) {
        // --- NEW LOGIC: Remove old dummy references from template ---
        let sibling = refHeader.nextSibling;
        const nodesToRemove: Node[] = [];
        
        // Scan forward until we hit something that clearly isn't a reference or end of doc
        while (sibling) {
            const next = sibling.nextSibling;
            if (sibling.nodeType === 1 && (sibling as Element).localName === 'p') {
                const text = getParaTextRaw(sibling as Element).trim();
                // Heuristic: If it looks like [1] ... or is empty, remove it.
                // If it looks like "Back Matter Title" (e.g. Thanks), stop.
                if (isBackMatterTitle(text) && !text.includes("参考文献")) {
                    break;
                }
                
                // Matches [1], [12], 1., Reference 1, or empty
                if (/^(\[\d+\]|\d+\.|Reference \d+)/i.test(text) || text === "") {
                    nodesToRemove.push(sibling);
                } else {
                    // Stop if we hit a normal paragraph that doesn't look like a ref?
                    // Safe bet: just stop.
                    break;
                }
            } else if (sibling.nodeType === 1 && (sibling as Element).localName === 'sectPr') {
                 // Stop at section break
                 break;
            }
            sibling = next;
        }
        
        nodesToRemove.forEach(n => body.removeChild(n));

        const insertRefAfter = refHeader.nextSibling;
        
        references.forEach(ref => {
            const bmId = (globalId++).toString();
            const bmName = `_Ref_${ref.id}_target`;
            
            const pRef = protos.refEntry!.cloneNode(true) as Element;
            const pPr = getChildByTagNameNS(pRef, NS.w, "pPr");
            while (pRef.firstChild) pRef.removeChild(pRef.firstChild);
            if (pPr) pRef.appendChild(pPr);
            
            let sampleRun = getChildByTagNameNS(protos.refEntry!, NS.w, "r");
            if (!sampleRun) sampleRun = doc.createElementNS(NS.w, "w:r");

            const cleanDesc = stripRefPrefix(ref.description);

            const createCleanRun = (text: string) => {
                const r = sampleRun!.cloneNode(true) as Element;
                const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                while(r.firstChild) r.removeChild(r.firstChild);
                if(rPr) r.appendChild(rPr);
                const t = doc.createElementNS(NS.w, "w:t");
                t.setAttribute("xml:space", "preserve");
                t.textContent = text;
                r.appendChild(t);
                return r;
            };

            pRef.appendChild(createBookmark(doc, bmName, bmId, "start"));
            pRef.appendChild(createCleanRun(`[${ref.id}]`));
            pRef.appendChild(createBookmark(doc, bmName, bmId, "end"));
            pRef.appendChild(createCleanRun(` ${cleanDesc}`));

            if(styleSettings) applyStyleOverrides(doc, pRef, styleSettings.reference);
            body.insertBefore(pRef, insertRefAfter);
        });
    }

    const settingsPart = getPkgPart(doc, "/word/settings.xml");
    if (settingsPart) {
        const settingsRoot = getPartXmlRoot(settingsPart);
        if (settingsRoot) {
            let uf = getChildByTagNameNS(settingsRoot, NS.w, "updateFields");
            if (!uf) {
                uf = doc.createElementNS(NS.w, "w:updateFields");
                settingsRoot.appendChild(uf);
            }
            uf.setAttributeNS(NS.w, "w:val", "true");
        }
    }

    return new XMLSerializer().serializeToString(doc);
};

export const parseWordXML = (xmlString: string): FormatRules => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    if (doc.documentElement.localName !== "package" && doc.documentElement.nodeName !== "pkg:package") {
        throw new Error("Invalid Word XML");
    }
    const stylesPart = getPkgPart(doc, "/word/styles.xml");
    const stylesRoot = getPartXmlRoot(stylesPart!);
    const headingStyles = buildHeadingStyles(stylesRoot!);
    const docPart = getPkgPart(doc, "/word/document.xml");
    const docRoot = getPartXmlRoot(docPart!);
    const body = getChildByTagNameNS(docRoot!, NS.w, "body");
    const mapping = extractMapping(body!, headingStyles, "template.xml");
     const templateStructure: TemplateBlock[] = mapping.blocks.map(b => ({
        order: b.order, nodeType: b.nodeType, type: b.type, level: b.level, styleId: b.styleId,
        text: normalizeTitle(b.text || ""), owner: b.owner, fields: b.fields, bookmarks: b.bookmarks
      }));
    return {
        rawXML: xmlString,
        styleIds: { heading1: headingStyles[1], heading2: headingStyles[2], heading3: headingStyles[3], normal: "a3", caption: "caption" },
        metadata: { paperSize: "A4" }, templateStructure, mapping, fontMain: "SimSun", fontSizeNormal: "10.5pt"
    };
};
