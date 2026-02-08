
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

type TocFieldType = "toc" | "lot" | "lof";
type TocField = { type: TocFieldType; depthId: number };

// -------------------- Parsing Helpers --------------------
const detectTocFieldOp = (p: Element) => {
  const runs = p.getElementsByTagNameNS(NS.w, "r");
  let sawBegin = false;
  const instrHits: string[] = [];
  let sawEnd = false;

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i] as Element;
    const fldChar = r.getElementsByTagNameNS(NS.w, "fldChar")[0] as Element | undefined;
    if (fldChar) {
      const t = getAttrNS(fldChar, NS.w, "fldCharType");
      if (t === "begin") sawBegin = true;
      if (t === "end") sawEnd = true;
    }
    const instrs = r.getElementsByTagNameNS(NS.w, "instrText");
    for (let j = 0; j < instrs.length; j++) {
      const it = (instrs[j].textContent || "").replace(/\s+/g, " ").trim();
      if (it) instrHits.push(it);
    }
  }

  const tocInstr = instrHits.find(x => /^TOC\b/.test(x));
  let pushed: TocFieldType | null = null;
  if (tocInstr) {
    if (/\bc\s*"table"/i.test(tocInstr) || /\\c\s*"table"/i.test(tocInstr)) pushed = "lot";
    else if (/\bc\s*"figure"/i.test(tocInstr) || /\\c\s*"figure"/i.test(tocInstr)) pushed = "lof";
    else pushed = "toc";
  }

  return { sawBegin, sawEnd, pushed, instrHits };
};

const buildHeadingStyles = (stylesRoot: Element) => {
  const res: Record<number, string> = {};
  const styles = stylesRoot.getElementsByTagNameNS(NS.w, "style");
  for (let i = 0; i < styles.length; i++) {
    const st = styles[i];
    if (getAttrNS(st, NS.w, "type") !== "paragraph") continue;
    const sid = getAttrNS(st, NS.w, "styleId");
    if (!sid) continue;
    const pPr = getChildByTagNameNS(st, NS.w, "pPr");
    if (!pPr) continue;
    const ol = getChildByTagNameNS(pPr, NS.w, "outlineLvl");
    if (!ol) continue;
    const v = getAttrNS(ol, NS.w, "val");
    if (v === null) continue;
    const lvl = parseInt(v, 10);
    if (!Number.isNaN(lvl)) {
      if (lvl === 0 && !res[1]) res[1] = sid;
      else if (lvl === 1 && !res[2]) res[2] = sid;
      else if (lvl === 2 && !res[3]) res[3] = sid;
    }
  }
  res[1] ||= "2";
  res[2] ||= "4";
  res[3] ||= "5";
  return res;
};

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

    if (!protos.normal) {
        protos.normal = children.find(c => c.localName === 'p' && !extractStyleId(c)) || children.find(c => c.localName === 'p') || null;
    }
    return protos;
};

// --- STYLE OVERRIDES ---
// Injects user-configured Font and Size into the node's runs
const applyStyleOverrides = (doc: Document, node: Element, config?: StyleConfig) => {
    if (!config) return;

    // Apply to ALL runs inside this node (or potential children)
    const runs = node.getElementsByTagNameNS(NS.w, "r");
    for (let i = 0; i < runs.length; i++) {
        const r = runs[i];
        let rPr = getChildByTagNameNS(r, NS.w, "rPr");
        if (!rPr) {
            rPr = doc.createElementNS(NS.w, "w:rPr");
            r.insertBefore(rPr, r.firstChild);
        }

        // 1. Fonts (rFonts)
        // Check existing
        let rFonts = getChildByTagNameNS(rPr, NS.w, "rFonts");
        if (!rFonts) {
            rFonts = doc.createElementNS(NS.w, "w:rFonts");
            rPr.appendChild(rFonts);
        }
        // Force set attributes
        rFonts.setAttributeNS(NS.w, "w:ascii", config.fontFamilyAscii);
        rFonts.setAttributeNS(NS.w, "w:hAnsi", config.fontFamilyAscii);
        // Important: w:eastAsia controls Chinese font
        rFonts.setAttributeNS(NS.w, "w:eastAsia", config.fontFamilyCI);
        // Hint implies we are using EastAsian typography primarily
        rFonts.setAttributeNS(NS.w, "w:hint", "eastAsia");

        // 2. Font Size (sz and szCs)
        // Remove existing to avoid conflicts
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

// --- Refactored Content Node Creator ---
const createContentNodes = (
    contentRaw: string, 
    doc: Document, 
    protos: Prototypes,
    h1StyleId: string,
    styleSettings?: StyleSettings
): Element[] => {
    const nodes: Element[] = [];
    if (!contentRaw) return nodes;

    const blockParts = contentRaw.split(/(\[\[(?:FIG|TBL):.*?\]\])/g);
    
    const baseProto = protos.normal || protos.h1;
    if (!baseProto) return nodes;
    
    let sampleRun = getChildByTagNameNS(baseProto, NS.w, "r");
    if (!sampleRun) {
        sampleRun = doc.createElementNS(NS.w, "w:r");
        const rPr = doc.createElementNS(NS.w, "w:rPr");
        sampleRun.appendChild(rPr);
    }

    blockParts.forEach(part => {
        if (!part) return; 

        // CASE A: Figure
        if (part.startsWith("[[FIG:")) {
             const desc = part.replace(/^\[\[FIG:/, "").replace(/\]\]$/, "");
             const bmId = (globalId++).toString();
             const bmName = `_Fig_${bmId}`;
             
             // Image Placeholder
             const pImg = cloneWithText(doc, baseProto, "（在此处插入图片）");
             let pPr = getChildByTagNameNS(pImg, NS.w, "pPr");
             if(!pPr) { pPr = doc.createElementNS(NS.w, "w:pPr"); pImg.appendChild(pPr); }
             let jc = getChildByTagNameNS(pPr, NS.w, "jc");
             if(!jc) { jc = doc.createElementNS(NS.w, "w:jc"); pPr.appendChild(jc); }
             jc.setAttributeNS(NS.w, "w:val", "center");
             
             // Apply Body Style to Placeholder
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
             createFieldRuns(doc, capSample, `STYLEREF "${h1StyleId}" \\s`, "X").forEach(n => pCap.appendChild(n));
             appendText("-");
             createFieldRuns(doc, capSample, "SEQ Figure \\* ARABIC \\s 1", "1").forEach(n => pCap.appendChild(n));
             pCap.appendChild(createBookmark(doc, bmName, bmId, "end"));
             appendText("  " + desc);
             
             // Apply Caption Style
             if (styleSettings) applyStyleOverrides(doc, pCap, styleSettings.caption);
             nodes.push(pCap);
        }
        // CASE B: Table
        else if (part.startsWith("[[TBL:")) {
             const desc = part.replace(/^\[\[TBL:/, "").replace(/\]\]$/, "");
             
             // Table Caption (Top)
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
             createFieldRuns(doc, capSample, `STYLEREF "${h1StyleId}" \\s`, "X").forEach(n => pCap.appendChild(n));
             appendText("-");
             createFieldRuns(doc, capSample, "SEQ Table \\* ARABIC \\s 1", "1").forEach(n => pCap.appendChild(n));
             pCap.appendChild(createBookmark(doc, bmName, bmId, "end"));
             appendText("  " + desc);
             
             if (styleSettings) applyStyleOverrides(doc, pCap, styleSettings.caption);
             nodes.push(pCap);

             // Table Body
             if (protos.table) {
                 nodes.push(protos.table.cloneNode(true) as Element);
             } else {
                 const tNode = cloneWithText(doc, baseProto, "[此处插入表格]");
                 if (styleSettings) applyStyleOverrides(doc, tNode, styleSettings.table);
                 nodes.push(tNode);
             }
        }
        // CASE C: Text
        else {
            const paragraphLines = part.split(/\n+/);
            paragraphLines.forEach(line => {
                if (line.length === 0) return; 

                const p = baseProto.cloneNode(true) as Element;
                const pPr = getChildByTagNameNS(p, NS.w, "pPr");
                while (p.firstChild) if(p.firstChild !== pPr) p.removeChild(p.firstChild); else p.removeChild(p.firstChild);
                if (pPr) p.appendChild(pPr);

                const subParts = line.split(/(\[\[(?:REF|EQ):.*?\]\])/g);
                
                subParts.forEach(sp => {
                    if (!sp) return;

                    if (sp.match(/^\[\[REF:\d+\]\]$/)) {
                        const id = sp.match(/\d+/)?.[0];
                        const bmName = `_Ref_${id}_target`;
                        
                        const r = sampleRun!.cloneNode(true) as Element;
                        const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                        while(r.firstChild) r.removeChild(r.firstChild);
                        if(rPr) r.appendChild(rPr);
                        
                        const t1 = doc.createElementNS(NS.w, "w:t");
                        t1.setAttribute("xml:space", "preserve");
                        t1.textContent = "[";
                        r.appendChild(t1);
                        p.appendChild(r);

                        createFieldRuns(doc, sampleRun!, `REF ${bmName} \\r \\h`, id || "0").forEach(n => p.appendChild(n));

                        const r2 = r.cloneNode(true) as Element;
                        const t2 = doc.createElementNS(NS.w, "w:t");
                        t2.setAttribute("xml:space", "preserve");
                        t2.textContent = "]";
                        r2.appendChild(t2);
                        p.appendChild(r2);
                    } 
                    else if (sp.startsWith("[[EQ:")) {
                         const eqText = sp.replace(/^\[\[EQ:/, "").replace(/\]\]$/, "");
                         const r = sampleRun!.cloneNode(true) as Element;
                         const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                         while(r.firstChild) r.removeChild(r.firstChild);
                         if(rPr) r.appendChild(rPr);
                         
                         const t = doc.createElementNS(NS.w, "w:t");
                         t.setAttribute("xml:space", "preserve");
                         t.textContent = eqText; 
                         r.appendChild(t);
                         p.appendChild(r);
                    }
                    else {
                         const r = sampleRun!.cloneNode(true) as Element;
                         const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                         while(r.firstChild) r.removeChild(r.firstChild);
                         if(rPr) r.appendChild(rPr);
                         
                         const t = doc.createElementNS(NS.w, "w:t");
                         t.setAttribute("xml:space", "preserve");
                         t.textContent = sp;
                         r.appendChild(t);
                         p.appendChild(r);
                    }
                });
                
                if (styleSettings) applyStyleOverrides(doc, p, styleSettings.body);
                nodes.push(p);
            });
        }
    });
    return nodes;
};

// -------------------- MAPPING EXTRACTION --------------------

const extractMapping = (
  body: Element,
  headingStyleIds: Record<number, string>,
  sourceName: string
): TemplateMappingJSON => {
  const styleLevelMap: Record<string, 1 | 2 | 3> = {};
  styleLevelMap[headingStyleIds[1]] = 1;
  styleLevelMap[headingStyleIds[2]] = 2;
  styleLevelMap[headingStyleIds[3]] = 3;

  const sections: MappingSection[] = [];
  const blocks: MappingBlock[] = [];

  const makeSection = (
    kind: MappingSectionKind,
    title: string,
    level: number,
    parentId: string | undefined,
    startOrder: number
  ): MappingSection => {
    const id = `${kind}_${sections.length + 1}`;
    // If there was a previous section, update its endOrder
    if (sections.length > 0) {
      const prev = sections[sections.length - 1];
      // Only close if it hasn't been closed properly (simple heuristic)
      if (prev.endOrder === -1 || prev.endOrder < prev.startOrder) {
        prev.endOrder = startOrder - 1;
      }
    }
    const sec: MappingSection = { id, kind, title, level, parentId, startOrder, endOrder: -1, blocks: [] };
    sections.push(sec);
    return sec;
  };

  const root = makeSection("root", "ROOT", 0, undefined, 1);
  let currentSection = root;
  
  const headingStack: { level: 1 | 2 | 3; title: string }[] = [];
  const tocStack: TocField[] = [];
  let tocDepthId = 0;
  let mode: "front" | "body" | "back" = "front";

  const enterSection = (kind: MappingSectionKind, title: string, level: number, order: number) => {
    currentSection = makeSection(kind, title, level, root.id, order);
  };

  const currentTocKind = (): MappingSectionKind | null => {
    if (tocStack.length === 0) return null;
    return tocStack[tocStack.length - 1].type;
  };

  const getOwner = () => ({
    sectionId: currentSection.id,
    h1: headingStack.find(x => x.level === 1)?.title,
    h2: headingStack.find(x => x.level === 2)?.title,
    h3: headingStack.find(x => x.level === 3)?.title
  });

  const pushBlock = (b: Omit<MappingBlock, "id">) => {
    const id = `bk_${blocks.length + 1}`;
    const block: MappingBlock = { id, ...b };
    blocks.push(block);
    currentSection.blocks.push(id);
    currentSection.endOrder = block.order;
  };

  const children = Array.from(body.children);

  for (let i = 0; i < children.length; i++) {
    const node = children[i] as Element;
    const order = i + 1;
    const local = node.localName;

    // Detect node type
    let nodeType: 'p' | 'tbl' | 'sectPr' | 'other' = 'other';
    if (local === 'p' || node.nodeName.endsWith(":p")) nodeType = 'p';
    else if (local === 'tbl') nodeType = 'tbl';
    else if (local === 'sectPr') nodeType = 'sectPr';

    if (nodeType === 'p') {
      const txtRaw = getParaTextRaw(node);
      const txtNorm = normalizeTitle(txtRaw);
      const sid = extractStyleId(node) || undefined;
      const headingLevel = sid ? styleLevelMap[sid] : undefined;
      const bookmarks = getBookmarkNames(node);
      const tocOp = detectTocFieldOp(node);
      
      if (tocOp.pushed) {
        tocDepthId += 1;
        tocStack.push({ type: tocOp.pushed, depthId: tocDepthId });
      }
      if (tocOp.sawEnd) {
        if (tocStack.length > 0) tocStack.pop();
      }

      if (isBackMatterTitle(txtRaw)) {
        mode = "back";
        headingStack.length = 0;
        tocStack.length = 0;
        enterSection("back", txtNorm, 1, order);
        pushBlock({
          order, nodeType: "p", type: "back_title", level: 1, styleId: sid, text: txtRaw,
          owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      const tocKind = currentTocKind();
      if (tocKind) {
        if (isListOfTablesTitle(txtRaw)) {
             enterSection("lot", LOT_KEY, 1, order);
             pushBlock({
                order, nodeType: "p", type: "toc_title", level: 1, styleId: sid, text: txtRaw,
                owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
             });
             continue;
        }
        if (isListOfFiguresTitle(txtRaw)) {
             enterSection("lof", LOF_KEY, 1, order);
             pushBlock({
                order, nodeType: "p", type: "toc_title", level: 1, styleId: sid, text: txtRaw,
                owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
             });
             continue;
        }
        // Fallback for "目录" appearing inside TOC area
        if (isFrontMatterTitle(txtRaw) && txtRaw.includes("目录") && currentSection.kind !== 'toc') {
             enterSection("toc", "目录", 1, order);
             pushBlock({
                order, nodeType: "p", type: "toc_title", level: 1, styleId: sid, text: txtRaw,
                owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
             });
             continue;
        }

        pushBlock({
          order, nodeType: "p", type: "toc_item", level: 0, styleId: sid, text: txtRaw,
          owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      if (isFrontMatterTitle(txtRaw)) {
        mode = "front";
        headingStack.length = 0;
        const isTocTitle = normalizeForMatch(txtRaw).toLowerCase().includes("目录");
        enterSection(isTocTitle ? "toc" : "front", txtNorm, 1, order);
        pushBlock({
            order, nodeType: "p", type: isTocTitle ? "toc_title" : "front_title", level: 1, styleId: sid, text: txtRaw,
            owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      if (mode !== "body" && headingLevel === 1) {
        mode = "body";
        headingStack.length = 0;
      }

      if (mode === "body" && headingLevel) {
         while(headingStack.length > 0 && headingStack[headingStack.length - 1].level >= headingLevel) {
             headingStack.pop();
         }
         headingStack.push({ level: headingLevel, title: txtNorm });
         if (headingLevel === 1) {
             enterSection("body", txtNorm, 1, order);
         }
         pushBlock({
            order, nodeType: "p", type: "heading", level: headingLevel, styleId: sid, text: txtRaw,
            owner: getOwner(), fields: tocOp.instrHits, bookmarks
         });
         continue;
      }

      let kind: BlockKind = "paragraph";
      if (hasOMML(node)) kind = "equation";
      else if (hasImageLike(node)) kind = "image_placeholder";
      else if (hasFieldSEQ(node) && /^(图|表)/.test(normalizeTitle(txtRaw))) {
        kind = normalizeTitle(txtRaw).startsWith("图") ? "caption_figure" : "caption_table";
      }

      pushBlock({
         order, nodeType: "p", type: kind, level: 0, styleId: sid, text: txtRaw,
         owner: mode === "body" ? getOwner() : { sectionId: currentSection.id },
         fields: tocOp.instrHits, bookmarks
      });

    } else if (nodeType === 'tbl') {
      pushBlock({
        order, nodeType: "tbl", type: "table", level: 0,
        owner: mode === "body" ? getOwner() : { sectionId: currentSection.id }, text: "[表格]"
      });
    } else if (nodeType === 'sectPr') {
      pushBlock({
        order, nodeType: "sectPr", type: "section", level: 0,
        owner: mode === "body" ? getOwner() : { sectionId: currentSection.id }, text: ""
      });
    } else {
      pushBlock({
        order, nodeType: "other", type: "other", level: 0,
        owner: mode === "body" ? getOwner() : { sectionId: currentSection.id }, text: ""
      });
    }
  }

  return {
    source: sourceName,
    headingStyleIds: { h1: headingStyleIds[1], h2: headingStyleIds[2], h3: headingStyleIds[3] },
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
    const stylesRoot = stylesPart ? getPartXmlRoot(stylesPart) : null;
    const headingStyles = stylesRoot ? buildHeadingStyles(stylesRoot) : {
        1: rules.styleIds.heading1, 2: rules.styleIds.heading2, 3: rules.styleIds.heading3
    };

    const protos = findPrototypes(body, headingStyles);

    // ... (Deletion logic)
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
    let anchorNode: Node | null = null;
    if (startDeleteIdx !== -1) {
        const toRemove = children.slice(startDeleteIdx, endDeleteIdx);
        toRemove.forEach(n => body.removeChild(n));
        anchorNode = children[endDeleteIdx];
    } else {
        const sectPr = getChildByTagNameNS(body, NS.w, "sectPr");
        anchorNode = sectPr;
    }

    const insertChapter = (ch: typeof thesis.chapters[0]) => {
        let pTitle: Element | null = null;
        const titleText = stripHeadingNumbering(ch.title);

        if (ch.level === 1 && protos.h1) {
             pTitle = cloneWithText(doc, protos.h1, titleText);
             if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading1);
        } else if (ch.level === 2 && protos.h2) {
             pTitle = cloneWithText(doc, protos.h2, titleText);
             if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading2);
        } else if (ch.level === 3 && protos.h3) {
             pTitle = cloneWithText(doc, protos.h3, titleText);
             if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading3);
        } else {
             pTitle = cloneWithText(doc, protos.h1 || protos.normal!, titleText);
        }

        if (pTitle) body.insertBefore(pTitle, anchorNode);

        if (ch.content) {
            const contentNodes = createContentNodes(ch.content, doc, protos, headingStyles[1] || "1", styleSettings);
            contentNodes.forEach(n => body.insertBefore(n, anchorNode));
        }

        if (ch.subsections) ch.subsections.forEach(insertChapter);
    };

    thesis.chapters.forEach(insertChapter);

    // Reference Insertion
    const currentKids = Array.from(body.children);
    const refHeader = currentKids.find(n => {
        if (n.localName !== 'p') return false;
        const txt = getParaTextRaw(n);
        return isBackMatterTitle(txt) && normalizeForMatch(txt).includes("参考文献");
    });

    if (refHeader && references.length > 0 && protos.refEntry) {
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

            // Avoid "[1][1]" by stripping [1] from description
            const cleanDesc = stripRefPrefix(ref.description);

            pRef.appendChild(createBookmark(doc, bmName, bmId, "start"));
            
            const r = sampleRun!.cloneNode(true) as Element;
            const rPr = getChildByTagNameNS(r, NS.w, "rPr");
            while(r.firstChild) r.removeChild(r.firstChild);
            if(rPr) r.appendChild(rPr);
            const t = doc.createElementNS(NS.w, "w:t");
            t.setAttribute("xml:space", "preserve");
            t.textContent = `[${ref.id}] ${cleanDesc}`;
            r.appendChild(t);
            pRef.appendChild(r);
            pRef.appendChild(createBookmark(doc, bmName, bmId, "end"));

            if(styleSettings) applyStyleOverrides(doc, pRef, styleSettings.reference);
            body.insertBefore(pRef, insertRefAfter);
        });
    }

    // Update Fields
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
