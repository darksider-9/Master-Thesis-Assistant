
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

// --- Helpers for Headers & Math ---

const createMathNode = (doc: Document, text: string) => {
    const oMath = doc.createElementNS(NS.m, "m:oMath");
    const r = doc.createElementNS(NS.m, "m:r");
    // Standard Cambria Math font usage implies standard run properties are optional here, 
    // but we can add them if needed. Word defaults are usually fine for inline math.
    const t = doc.createElementNS(NS.m, "m:t");
    t.textContent = text;
    r.appendChild(t);
    oMath.appendChild(r);
    return oMath;
};

const fixStaticHeaders = (doc: Document) => {
    const parts = doc.getElementsByTagNameNS(NS.pkg, "part");
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const name = part.getAttributeNS(NS.pkg, "name");
        // Look for header parts
        if (name && name.includes("/word/header")) {
            const xmlData = getChildByTagNameNS(part, NS.pkg, "xmlData");
            if (!xmlData) continue;
            
            // Search for specific static text nodes from the template
            const texts = xmlData.getElementsByTagNameNS(NS.w, "t");
            for (let j = 0; j < texts.length; j++) {
                const tNode = texts[j];
                const content = tNode.textContent || "";
                if (content.includes("插图目录") || content.includes("表格目录")) {
                    // Found a static header! We must replace this Run with a STYLEREF field.
                    const run = tNode.parentNode as Element;
                    const paragraph = run.parentNode as Element;
                    
                    if (run.localName === "r" && paragraph.localName === "p") {
                        // We use a simplified version of createFieldRuns here because we don't have a 'sampleRun' with styles from the header.
                        // We'll clone the existing run to keep the header styles (font size, etc).
                        const makeFieldRun = (type: 'begin' | 'end' | 'separate' | 'instr' | 'text', val?: string) => {
                            const newR = run.cloneNode(true) as Element;
                            while (newR.firstChild) newR.removeChild(newR.firstChild);
                            const rPr = getChildByTagNameNS(run, NS.w, "rPr");
                            if (rPr) newR.appendChild(rPr.cloneNode(true));
                            
                            if (type === 'text') {
                                const t = doc.createElementNS(NS.w, "w:t");
                                t.setAttribute("xml:space", "preserve");
                                t.textContent = val || "";
                                newR.appendChild(t);
                            } else if (type === 'instr') {
                                const it = doc.createElementNS(NS.w, "w:instrText");
                                it.setAttribute("xml:space", "preserve");
                                it.textContent = val || "";
                                newR.appendChild(it);
                            } else {
                                const f = doc.createElementNS(NS.w, "w:fldChar");
                                f.setAttributeNS(NS.w, "w:fldCharType", type);
                                newR.appendChild(f);
                            }
                            return newR;
                        };

                        const fieldRuns = [
                            makeFieldRun('begin'),
                            makeFieldRun('instr', ' STYLEREF "标题 1" \\* MERGEFORMAT '),
                            makeFieldRun('separate'),
                            makeFieldRun('text', '章节标题'), // Placeholder
                            makeFieldRun('end')
                        ];

                        // Insert new runs before the old run, then remove the old run
                        fieldRuns.forEach(fr => paragraph.insertBefore(fr, run));
                        paragraph.removeChild(run);
                        
                        // Break after fixing this occurrence to avoid messing up if multiple text nodes existed for same string
                        break; 
                    }
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
             counters.fig++;
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
        // CASE B: Table
        else if (part.startsWith("[[TBL:")) {
             counters.tbl++;
             const desc = part.replace(/^\[\[TBL:/, "").replace(/\]\]$/, "");
             
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
                        
                        const refRun = sampleRun!.cloneNode(true) as Element;
                        while (refRun.firstChild) refRun.removeChild(refRun.firstChild);

                        let rPr = getChildByTagNameNS(sampleRun!, NS.w, "rPr");
                        if (rPr) {
                            rPr = rPr.cloneNode(true) as Element;
                        } else {
                            rPr = doc.createElementNS(NS.w, "w:rPr");
                        }
                        refRun.appendChild(rPr);
                        
                        const vertAlign = doc.createElementNS(NS.w, "w:vertAlign");
                        vertAlign.setAttributeNS(NS.w, "w:val", "superscript");
                        rPr.appendChild(vertAlign);
                        
                        createFieldRuns(doc, refRun, `REF ${bmName} \\h`, `[${id}]`).forEach(n => p.appendChild(n));
                    } 
                    else if (sp.startsWith("[[EQ:")) {
                         counters.eq++;
                         const eqText = sp.replace(/^\[\[EQ:/, "").replace(/\]\]$/, "");
                         
                         // 1. MathML Object (Inline)
                         // We insert the math object directly into the paragraph
                         const mathNode = createMathNode(doc, eqText);
                         p.appendChild(mathNode);

                         // 2. Spacing
                         const rSpace = sampleRun!.cloneNode(true) as Element;
                         while(rSpace.firstChild) rSpace.removeChild(rSpace.firstChild);
                         const rPrSpace = getChildByTagNameNS(sampleRun!, NS.w, "rPr");
                         if(rPrSpace) rSpace.appendChild(rPrSpace.cloneNode(true));
                         const tSpace = doc.createElementNS(NS.w, "w:t");
                         tSpace.setAttribute("xml:space", "preserve");
                         tSpace.textContent = "\u00A0\u00A0\u00A0\u00A0"; 
                         rSpace.appendChild(tSpace);
                         p.appendChild(rSpace);

                         // 3. Numbering
                         const separator = styleSettings?.equationSeparator || '-';
                         const appendText = (txt: string) => {
                             const rNum = sampleRun!.cloneNode(true) as Element;
                             const rPrNum = getChildByTagNameNS(rNum, NS.w, "rPr");
                             while(rNum.firstChild) rNum.removeChild(rNum.firstChild);
                             if(rPrNum) rNum.appendChild(rPrNum);
                             const tNum = doc.createElementNS(NS.w, "w:t");
                             tNum.setAttribute("xml:space", "preserve");
                             tNum.textContent = txt;
                             rNum.appendChild(tNum);
                             p.appendChild(rNum);
                         };

                         appendText("(");
                         appendText(chapterIndex.toString());
                         appendText(separator);
                         createFieldRuns(doc, sampleRun!, "SEQ Equation \\* ARABIC \\s 1", counters.eq.toString()).forEach(n => p.appendChild(n));
                         appendText(")");
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
    
    // FIX 1: Fix Static Headers before doing anything else
    fixStaticHeaders(doc);

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

    let l1ChapterIndex = 0;
    let chapterCounters = { fig: 0, tbl: 0, eq: 0 };

    const insertChapter = (ch: typeof thesis.chapters[0]) => {
        let pTitle: Element | null = null;
        const titleText = stripHeadingNumbering(ch.title);

        if (ch.level === 1) {
             l1ChapterIndex++;
             chapterCounters = { fig: 0, tbl: 0, eq: 0 };
             
             if (protos.h1) {
                pTitle = cloneWithText(doc, protos.h1, titleText);
                if(styleSettings) applyStyleOverrides(doc, pTitle, styleSettings.heading1);
             }
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
            const contentNodes = createContentNodes(ch.content, doc, protos, l1ChapterIndex, chapterCounters, styleSettings);
            contentNodes.forEach(n => body.insertBefore(n, anchorNode));
        }

        if (ch.subsections) ch.subsections.forEach(insertChapter);
    };

    thesis.chapters.forEach(insertChapter);

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
