
import {
  FormatRules,
  ThesisStructure,
  Reference,
  TemplateMappingJSON,
  MappingSection,
  MappingBlock,
  BlockKind,
  TemplateBlock,
  MappingSectionKind
} from "../types";

// -------------------- Namespaces --------------------
const NS = {
  pkg: "http://schemas.microsoft.com/office/2006/xmlPackage",
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  v: "urn:schemas-microsoft-com:vml"
};

const FIVE_SZ = "21"; // 10.5pt (五号字)

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
const hasFieldREF = (p: Element) => getInstrTexts(p).some(t => /\bREF\b/.test(t));

// -------------------- Low-Level XML Construction --------------------

// 1. Clone a paragraph but keep ONLY pPr (properties), remove all content
const cloneParaSkeleton = (p: Element, doc: Document) => {
  const clone = p.cloneNode(true) as Element;
  const pPr = getChildByTagNameNS(clone, NS.w, "pPr");
  while (clone.firstChild) clone.removeChild(clone.firstChild);
  if (pPr) clone.appendChild(pPr);
  return clone;
};

// 2. Ensure run has standard font size (Five / 10.5pt)
const ensureRunFiveSize = (r: Element, doc: Document) => {
  let rPr = getChildByTagNameNS(r, NS.w, "rPr");
  if (!rPr) {
    rPr = doc.createElementNS(NS.w, "w:rPr");
    if (r.firstChild) r.insertBefore(rPr, r.firstChild);
    else r.appendChild(rPr);
  }
  const ensure = (name: string) => {
    let el = getChildByTagNameNS(rPr!, NS.w, name);
    if (!el) {
      el = doc.createElementNS(NS.w, `w:${name}`);
      rPr!.appendChild(el);
    }
    el.setAttributeNS(NS.w, "w:val", FIVE_SZ);
  };
  ensure("sz");
  ensure("szCs");
};

const findFirstTextRun = (p: Element): Element | null => {
  const rs = p.getElementsByTagNameNS(NS.w, "r");
  for (let i = 0; i < rs.length; i++) {
    if (rs[i].getElementsByTagNameNS(NS.w, "t").length > 0) return rs[i];
  }
  return rs.length > 0 ? rs[0] : null;
};

// 3. Create a Run with Text
const makeRunTextLike = (sampleRun: Element | null, text: string, doc: Document) => {
  const r = sampleRun ? (sampleRun.cloneNode(true) as Element) : doc.createElementNS(NS.w, "w:r");
  // Clean content except rPr
  const rPr = getChildByTagNameNS(r, NS.w, "rPr");
  while (r.lastChild) {
    if (r.lastChild === rPr) break;
    r.removeChild(r.lastChild);
  }
  const t = doc.createElementNS(NS.w, "w:t");
  t.setAttribute("xml:space", "preserve");
  t.textContent = text;
  r.appendChild(t);
  ensureRunFiveSize(r, doc);
  return r;
};

// 4. Create Field Char (begin/separate/end)
const makeRunFldCharLike = (sampleRun: Element | null, fldCharType: string, doc: Document) => {
  const r = sampleRun ? (sampleRun.cloneNode(true) as Element) : doc.createElementNS(NS.w, "w:r");
  const rPr = getChildByTagNameNS(r, NS.w, "rPr");
  while (r.lastChild) {
    if (r.lastChild === rPr) break;
    r.removeChild(r.lastChild);
  }
  const fc = doc.createElementNS(NS.w, "w:fldChar");
  fc.setAttributeNS(NS.w, "w:fldCharType", fldCharType);
  r.appendChild(fc);
  ensureRunFiveSize(r, doc);
  return r;
};

// 5. Create Instruction Text (e.g. "SEQ Figure")
const makeRunInstrLike = (sampleRun: Element | null, instr: string, doc: Document) => {
  const r = sampleRun ? (sampleRun.cloneNode(true) as Element) : doc.createElementNS(NS.w, "w:r");
  const rPr = getChildByTagNameNS(r, NS.w, "rPr");
  while (r.lastChild) {
    if (r.lastChild === rPr) break;
    r.removeChild(r.lastChild);
  }
  const it = doc.createElementNS(NS.w, "w:instrText");
  it.setAttribute("xml:space", "preserve");
  it.textContent = instr;
  r.appendChild(it);
  ensureRunFiveSize(r, doc);
  return r;
};

// 6. Create Full Field Sequence (Begin -> Instr -> Separate -> Placeholder -> End)
const createFieldRuns = (doc: Document, sampleRun: Element | null, instr: string, placeholder: string) => {
  return [
    makeRunFldCharLike(sampleRun, "begin", doc),
    makeRunInstrLike(sampleRun, instr, doc),
    makeRunFldCharLike(sampleRun, "separate", doc),
    makeRunTextLike(sampleRun, placeholder, doc),
    makeRunFldCharLike(sampleRun, "end", doc)
  ];
};

const createBookmark = (doc: Document, name: string, id: number, type: "start" | "end") => {
  if (type === "start") {
    const bm = doc.createElementNS(NS.w, "w:bookmarkStart");
    bm.setAttributeNS(NS.w, "w:id", id.toString());
    bm.setAttributeNS(NS.w, "w:name", name);
    return bm;
  }
  const bm = doc.createElementNS(NS.w, "w:bookmarkEnd");
  bm.setAttributeNS(NS.w, "w:id", id.toString());
  return bm;
};

const setParaCenter = (p: Element, doc: Document) => {
  let pPr = getChildByTagNameNS(p, NS.w, "pPr");
  if (!pPr) {
    pPr = doc.createElementNS(NS.w, "w:pPr");
    if (p.firstChild) p.insertBefore(pPr, p.firstChild);
    else p.appendChild(pPr);
  }
  let jc = getChildByTagNameNS(pPr, NS.w, "jc");
  if (!jc) {
    jc = doc.createElementNS(NS.w, "w:jc");
    pPr.appendChild(jc);
  }
  jc.setAttributeNS(NS.w, "w:val", "center");
};

// -------------------- Parsing Constants & Strategies --------------------

const FRONT_KEYS = new Set(["摘要", "摘 要", "ABSTRACT", "目录", "目 录"]);
const LOT_KEY = "表格目录";
const LOF_KEY = "插图目录";
// Use regex for Back matter to catch "Publication" etc.
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

// -------------------- Parsing: Detect TOC Fields --------------------
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
    // Check switches to distinguish TOC from LOT/LOF
    if (/\bc\s*"table"/i.test(tocInstr) || /\\c\s*"table"/i.test(tocInstr)) pushed = "lot";
    else if (/\bc\s*"figure"/i.test(tocInstr) || /\\c\s*"figure"/i.test(tocInstr)) pushed = "lof";
    else pushed = "toc";
  }

  return { sawBegin, sawEnd, pushed, instrHits };
};

// -------------------- Heading Style Builder --------------------
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

// -------------------- Mapping Extractor --------------------
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
    level: 0 | 1 | 2 | 3,
    parentId: string | undefined,
    startOrder: number
  ): MappingSection => {
    const id = `${kind}_${sections.length + 1}`;
    const sec: MappingSection = { id, kind, title, level, parentId, startOrder, endOrder: startOrder, blocks: [] };
    sections.push(sec);
    return sec;
  };

  const root = makeSection("root", "ROOT", 0, undefined, 1);
  let currentSection = root;

  // Track hierarchy for ownership assignment
  const headingStack: { level: 1 | 2 | 3; title: string }[] = [];
  
  // Track TOC Fields
  const tocStack: TocField[] = [];
  let tocDepthId = 0;
  
  // High-level mode state
  let mode: "front" | "body" | "back" = "front";

  const enterSection = (kind: MappingSectionKind, title: string, level: 0 | 1 | 2 | 3, order: number) => {
    currentSection = makeSection(kind, title, level, root.id, order);
  };

  const currentTocKind = (): MappingSectionKind | null => {
    if (tocStack.length === 0) return null;
    const top = tocStack[tocStack.length - 1].type;
    return top; // 'toc' | 'lot' | 'lof'
  };

  const getOwner = () => ({
    sectionId: currentSection.id,
    h1: headingStack.find(x => x.level === 1)?.title,
    h2: headingStack.find(x => x.level === 2)?.title,
    h3: headingStack.find(x => x.level === 3)?.title
  });

  const pushBlock = (b: Omit<MappingBlock, "id">) => {
    const id = `b_${blocks.length + 1}`;
    const block: MappingBlock = { id, ...b };
    blocks.push(block);
    currentSection.blocks.push(id);
    currentSection.endOrder = Math.max(currentSection.endOrder, block.order);
    root.endOrder = Math.max(root.endOrder, block.order);
  };

  const children = Array.from(body.children);

  for (let i = 0; i < children.length; i++) {
    const node = children[i] as Element;
    const order = i + 1;
    const local = node.localName;

    if (local === "p" || node.nodeName.endsWith(":p")) {
      const txtRaw = getParaTextRaw(node);
      const txtNorm = normalizeTitle(txtRaw);
      const sid = extractStyleId(node) || undefined;
      const headingLevel = sid ? styleLevelMap[sid] : undefined;
      const bookmarks = getBookmarkNames(node);

      // 1. TOC Field Tracking
      const tocOp = detectTocFieldOp(node);
      if (tocOp.pushed) {
        tocDepthId += 1;
        tocStack.push({ type: tocOp.pushed, depthId: tocDepthId });
      }
      if (tocOp.sawEnd) {
        if (tocStack.length > 0) tocStack.pop();
      }

      // 2. Back Matter Detection (Highest Priority, strict text match)
      if (isBackMatterTitle(txtRaw)) {
        mode = "back";
        headingStack.length = 0;
        tocStack.length = 0; // Force exit TOC if malformed
        enterSection("back", txtNorm, 1, order);
        pushBlock({
          order, nodeType: "p", kind: "back_title", level: 1, styleId: sid, text: txtRaw,
          owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      // 3. Inside TOC/LOT/LOF
      const tocKind = currentTocKind();
      if (tocKind) {
        // Even inside TOC, if we see an explicit title for LOT/LOF, switch section
        if (isListOfTablesTitle(txtRaw)) {
             enterSection("lot", LOT_KEY, 1, order);
             pushBlock({
                order, nodeType: "p", kind: "toc_title", level: 1, styleId: sid, text: txtRaw,
                owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
             });
             continue;
        }
        if (isListOfFiguresTitle(txtRaw)) {
             enterSection("lof", LOF_KEY, 1, order);
             pushBlock({
                order, nodeType: "p", kind: "toc_title", level: 1, styleId: sid, text: txtRaw,
                owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
             });
             continue;
        }

        // Standard TOC Item
        pushBlock({
          order, nodeType: "p", kind: "toc_item", level: 0, styleId: sid, text: txtRaw,
          owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      // 4. Front Matter Titles
      if (isFrontMatterTitle(txtRaw)) {
        mode = "front";
        headingStack.length = 0;
        const isTocTitle = normalizeForMatch(txtRaw).toLowerCase().includes("目录");
        enterSection(isTocTitle ? "toc" : "front", txtNorm, 1, order);
        pushBlock({
            order, nodeType: "p", kind: isTocTitle ? "toc_title" : "front_title", level: 1, styleId: sid, text: txtRaw,
            owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      // 5. Body Start Detection
      if (mode !== "body" && headingLevel === 1) {
        mode = "body";
        headingStack.length = 0;
      }

      // 6. Body Headings (Level 1, 2, 3)
      if (mode === "body" && headingLevel) {
         // Update Stack
         while(headingStack.length > 0 && headingStack[headingStack.length - 1].level >= headingLevel) {
             headingStack.pop();
         }
         headingStack.push({ level: headingLevel, title: txtNorm });

         if (headingLevel === 1) {
             enterSection("body", txtNorm, 1, order);
         }
         
         pushBlock({
            order, nodeType: "p", kind: "heading", level: headingLevel, styleId: sid, text: txtRaw,
            owner: getOwner(), fields: tocOp.instrHits, bookmarks
         });
         continue;
      }

      // 7. Regular Content (Body, Front, Back)
      let kind: BlockKind = "paragraph";
      if (hasOMML(node)) kind = "equation";
      else if (hasImageLike(node)) kind = "image_para";
      else if (hasFieldSEQ(node) && /^(图|表)/.test(normalizeTitle(txtRaw))) {
        kind = normalizeTitle(txtRaw).startsWith("图") ? "caption_figure" : "caption_table";
      }

      pushBlock({
         order, nodeType: "p", kind, level: 0, styleId: sid, text: txtRaw,
         owner: mode === "body" ? getOwner() : { sectionId: currentSection.id },
         fields: tocOp.instrHits, bookmarks
      });

    } else if (local === "tbl") {
      pushBlock({
        order, nodeType: "tbl", kind: "table", level: 0,
        owner: mode === "body" ? getOwner() : { sectionId: currentSection.id }, text: "[表格]"
      });
    } else if (local === "sectPr") {
      pushBlock({
        order, nodeType: "sectPr", kind: "sectPr", level: 0,
        owner: mode === "body" ? getOwner() : { sectionId: currentSection.id }, text: ""
      });
    } else {
      pushBlock({
        order, nodeType: "other", kind: "other", level: 0,
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

// -------------------- Public Parser Function --------------------
export const parseWordXML = (xmlString: string): FormatRules => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  if (doc.documentElement.localName !== "package" && doc.documentElement.nodeName !== "pkg:package") {
    throw new Error("Invalid Word XML: Must be a Flat OPC (pkg:package) file.");
  }

  const stylesPart = getPkgPart(doc, "/word/styles.xml");
  if (!stylesPart) throw new Error("Missing /word/styles.xml part");
  const stylesRoot = getPartXmlRoot(stylesPart);
  const headingStyles = buildHeadingStyles(stylesRoot!);

  const docPart = getPkgPart(doc, "/word/document.xml");
  if (!docPart) throw new Error("Missing /word/document.xml part");
  const docRoot = getPartXmlRoot(docPart);
  const body = getChildByTagNameNS(docRoot!, NS.w, "body");
  if (!body) throw new Error("Missing w:body");

  const mapping = extractMapping(body, headingStyles, "template.xml");

  const templateStructure: TemplateBlock[] = mapping.blocks.map(b => ({
    order: b.order,
    nodeType: b.nodeType,
    type: b.kind as any,
    level: b.level,
    styleId: b.styleId,
    text: normalizeTitle(b.text || ""),
    path: b.owner.h1 ? [b.owner.h1, b.owner.h2, b.owner.h3].filter(Boolean).join(" / ") : b.owner.sectionId,
    owner: b.owner,
    fields: b.fields,
    bookmarks: b.bookmarks
  }));

  return {
    rawXML: xmlString,
    styleIds: {
      heading1: headingStyles[1],
      heading2: headingStyles[2],
      heading3: headingStyles[3],
      normal: "a3", 
      caption: "caption"
    },
    metadata: { paperSize: "A4" },
    templateStructure,
    mapping,
    fontMain: "SimSun",
    fontSizeNormal: "10.5pt"
  };
};

// -------------------- Generation Logic --------------------
let globalId = 60000;

// === ADDED: New Helper to find Table Prototypes ===
const createTableNodeTS = (doc: Document, proto: Element | null): Element => {
  const tbl = doc.createElementNS(NS.w, "w:tbl");
  const tblPr = doc.createElementNS(NS.w, "w:tblPr");
  const tblW = doc.createElementNS(NS.w, "w:tblW");
  tblW.setAttributeNS(NS.w, "w:type", "dxa");
  tblW.setAttributeNS(NS.w, "w:w", "9000"); // Approx page width
  tblPr.appendChild(tblW);
  
  // Center table
  const tblJc = doc.createElementNS(NS.w, "w:tblJc");
  tblJc.setAttributeNS(NS.w, "w:val", "center");
  tblPr.appendChild(tblJc);
  
  // Borders
  const tblBorders = doc.createElementNS(NS.w, "w:tblBorders");
  ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].forEach(border => {
      const b = doc.createElementNS(NS.w, `w:${border}`);
      b.setAttributeNS(NS.w, "w:val", "single");
      b.setAttributeNS(NS.w, "w:sz", "4");
      tblBorders.appendChild(b);
  });
  tblPr.appendChild(tblBorders);
  tbl.appendChild(tblPr);

  // Use prototype if provided to clone style
  if (proto) {
      // Logic to copy table properties if needed
  }

  // Create a 2x2 grid
  for(let i=0; i<2; i++) {
      const tr = doc.createElementNS(NS.w, "w:tr");
      for(let j=0; j<2; j++) {
          const tc = doc.createElementNS(NS.w, "w:tc");
          const tcPr = doc.createElementNS(NS.w, "w:tcPr");
          const tcW = doc.createElementNS(NS.w, "w:tcW");
          tcW.setAttributeNS(NS.w, "w:type", "dxa");
          tcW.setAttributeNS(NS.w, "w:w", "4500");
          tcPr.appendChild(tcW);
          tc.appendChild(tcPr);
          
          const p = doc.createElementNS(NS.w, "w:p");
          setParaCenter(p, doc);
          p.appendChild(makeRunTextLike(null, i===0 ? "Header" : "Data", doc));
          tc.appendChild(p);
          tr.appendChild(tc);
      }
      tbl.appendChild(tr);
  }
  return tbl;
};

// === ADDED: New Finders ===
const findEquationPrototype = (body: Element): Element | null => {
  const ps = body.getElementsByTagNameNS(NS.w, "p");
  for (let i = 0; i < ps.length; i++) {
      if (hasOMML(ps[i])) return ps[i];
  }
  return null;
};

const findCaptionPrototype = (body: Element): Element | null => {
  const ps = body.getElementsByTagNameNS(NS.w, "p");
  for (let i = 0; i < ps.length; i++) {
      if (hasFieldSEQ(ps[i])) return ps[i];
  }
  return null;
};

const findTablePrototype = (body: Element): Element | null => {
    const tbls = body.getElementsByTagNameNS(NS.w, "tbl");
    return tbls.length > 0 ? tbls[0] : null;
};

// === UPDATED: Use Prototypes in CreateContentNodes ===
const createContentNodes = (
    contentRaw: string, 
    doc: Document, 
    protos: { normal: Element, caption: Element | null, equation: Element | null, table: Element | null }
): Element[] => {
    const nodes: Element[] = [];
    if (!contentRaw) return nodes;

    const sample = findFirstTextRun(protos.normal);
    const parts = contentRaw.split(/(\[\[.*?\]\])/g);

    parts.forEach(part => {
        if (!part.trim()) return;

        if (part.startsWith("[[FIG:")) {
            const desc = part.replace(/^\[\[FIG:/, "").replace(/\]\]$/, "");
            const bm = `_Fig_${globalId}`;
            
            // Image Placeholder
            const pImg = cloneParaSkeleton(protos.normal, doc);
            setParaCenter(pImg, doc);
            pImg.appendChild(makeRunTextLike(sample, "[图片占位]", doc));
            nodes.push(pImg);

            // Caption
            const pFig = cloneParaSkeleton(protos.caption || protos.normal, doc);
            setParaCenter(pFig, doc);
            pFig.appendChild(createBookmark(doc, bm, globalId, "start"));
            pFig.appendChild(makeRunTextLike(sample, "图 ", doc));
            createFieldRuns(doc, sample, "STYLEREF 1 \\s", "X").forEach(r => pFig.appendChild(r));
            pFig.appendChild(makeRunTextLike(sample, "-", doc));
            createFieldRuns(doc, sample, "SEQ Figure \\* ARABIC \\s 1", "1").forEach(r => pFig.appendChild(r));
            pFig.appendChild(createBookmark(doc, bm, globalId, "end"));
            pFig.appendChild(makeRunTextLike(sample, "  " + desc, doc));
            nodes.push(pFig);
            globalId++;

        } else if (part.startsWith("[[TBL:")) {
            const desc = part.replace(/^\[\[TBL:/, "").replace(/\]\]$/, "");
            const bm = `_Tbl_${globalId}`;

            // Caption (usually above table)
            const pTbl = cloneParaSkeleton(protos.caption || protos.normal, doc);
            setParaCenter(pTbl, doc);
            pTbl.appendChild(createBookmark(doc, bm, globalId, "start"));
            pTbl.appendChild(makeRunTextLike(sample, "表 ", doc));
            createFieldRuns(doc, sample, "STYLEREF 1 \\s", "X").forEach(r => pTbl.appendChild(r));
            pTbl.appendChild(makeRunTextLike(sample, "-", doc));
            createFieldRuns(doc, sample, "SEQ Table \\* ARABIC \\s 1", "1").forEach(r => pTbl.appendChild(r));
            pTbl.appendChild(createBookmark(doc, bm, globalId, "end"));
            pTbl.appendChild(makeRunTextLike(sample, "  " + desc, doc));
            nodes.push(pTbl);

            // Table
            nodes.push(createTableNodeTS(doc, protos.table));
            globalId++;

        } else if (part.startsWith("[[EQ:")) {
            const content = part.replace(/^\[\[EQ:/, "").replace(/\]\]$/, "");
            const bm = `_Eq_${globalId}`;
            
            // Equation Paragraph
            // If we have an equation prototype, try to clone it, otherwise use normal
            const pEq = protos.equation ? (protos.equation.cloneNode(true) as Element) : cloneParaSkeleton(protos.normal, doc);
            // Simple approach: append text if we can't fully parse OMML
            setParaCenter(pEq, doc);
            
            // Clean content if cloned
            if (protos.equation) {
                // Clear existing runs but keep OMML if possible? No, difficult.
                // Fallback to text representation for now
                while(pEq.firstChild) pEq.removeChild(pEq.firstChild);
                // Re-add pPr
                const pPr = getChildByTagNameNS(protos.equation, NS.w, "pPr");
                if (pPr) pEq.appendChild(pPr.cloneNode(true));
            }

            pEq.appendChild(makeRunTextLike(sample, content + "    ", doc));
            pEq.appendChild(createBookmark(doc, bm, globalId, "start"));
            pEq.appendChild(makeRunTextLike(sample, "(", doc));
            createFieldRuns(doc, sample, "STYLEREF 1 \\s", "X").forEach(r => pEq.appendChild(r));
            pEq.appendChild(makeRunTextLike(sample, ".", doc));
            createFieldRuns(doc, sample, "SEQ equation \\* ARABIC \\s 1", "1").forEach(r => pEq.appendChild(r));
            pEq.appendChild(makeRunTextLike(sample, ")", doc));
            pEq.appendChild(createBookmark(doc, bm, globalId, "end"));
            
            nodes.push(pEq);
            globalId++;
            
        } else {
            const p = cloneParaSkeleton(protos.normal, doc);
            const refParts = part.split(/(\[\[REF:\d+\]\])/);
            refParts.forEach(rp => {
                const m = rp.match(/\[\[REF:(\d+)\]\]/);
                if (m) {
                    const id = m[1];
                    const bm = `_Ref_${id}`;
                    p.appendChild(makeRunTextLike(sample, "[", doc));
                    createFieldRuns(doc, sample, `REF ${bm} \\r \\h`, id).forEach(r => p.appendChild(r));
                    p.appendChild(makeRunTextLike(sample, "]", doc));
                } else {
                    p.appendChild(makeRunTextLike(sample, rp, doc));
                }
            });
            nodes.push(p);
        }
    });
    return nodes;
};

// Strips "第1章", "1.1", "1.1.1" etc. for insertion
const stripHeadingNumbering = (title: string): string => {
    return title.replace(/^(第[一二三四五六七八九十]+章\s*|\d+(\.\d+)*\s*)/, "").trim();
};

export const generateThesisXML = (thesis: ThesisStructure, rules: FormatRules, references: Reference[]): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rules.rawXML, "text/xml");

  const docPart = getPkgPart(doc, "/word/document.xml");
  const docRoot = getPartXmlRoot(docPart!);
  const body = getChildByTagNameNS(docRoot!, NS.w, "body");
  if (!body) throw new Error("Invalid Document Structure");

  // 1. Re-map live DOM to find deletion ranges
  const stylesPart = getPkgPart(doc, "/word/styles.xml");
  const stylesRoot = stylesPart ? getPartXmlRoot(stylesPart) : null;
  const headingStyles = stylesRoot ? buildHeadingStyles(stylesRoot) : {
    1: rules.styleIds.heading1, 2: rules.styleIds.heading2, 3: rules.styleIds.heading3
  };

  const liveMapping = extractMapping(body, headingStyles, "live");

  // 2. Identify Prototypes (Styles) from existing mapping before deletion
  // === UPDATED: Extended Prototypes ===
  const protos: Record<number, Element | null> = { 1: null, 2: null, 3: null };
  let genericProtoNormal: Element | null = null;
  const extendedProtos: { caption: Element | null, equation: Element | null, table: Element | null } = {
      caption: findCaptionPrototype(body),
      equation: findEquationPrototype(body),
      table: findTablePrototype(body)
  };

  for (const b of liveMapping.blocks) {
     if (b.nodeType !== 'p') continue;
     // Order is 1-based, child access is 0-based
     const el = body.children[b.order - 1]; 
     if (!el) continue;

     if (!genericProtoNormal && b.kind === 'paragraph') {
         genericProtoNormal = el;
     }
     if (b.kind === 'heading') {
         if (!protos[b.level]) protos[b.level] = el;
     }
     if (protos[1] && protos[2] && protos[3] && genericProtoNormal) break; 
  }
  // Fallback
  if (!genericProtoNormal && body.children.length > 0) genericProtoNormal = body.children[0];

  // 3. Identify Range to Delete (Body Start -> Back Start)
  const bodyH1 = liveMapping.sections.find(s => s.kind === "body" && s.level === 1);
  const firstBack = liveMapping.sections.find(s => s.kind === "back");

  let startIdx = bodyH1 ? bodyH1.startOrder - 1 : -1;
  let endIdx = firstBack ? firstBack.startOrder - 1 : -1;

  if (startIdx >= 0 && endIdx < 0) {
    const kids = Array.from(body.children);
    endIdx = kids.length;
    for (let i = kids.length - 1; i >= 0; i--) {
      if (kids[i].localName === "sectPr") {
        endIdx = i;
        break;
      }
    }
  }

  // 4. Delete & Prepare Anchor
  let anchorNode: Element | null = null;

  if (startIdx >= 0 && endIdx > startIdx) {
    const snapshot = Array.from(body.children);
    anchorNode = snapshot[endIdx] ?? null; // The node *before* which we insert

    // Delete everything in the body range
    for (let i = startIdx; i < endIdx; i++) {
      const n = snapshot[i];
      if (n && n.parentNode === body) body.removeChild(n);
    }
  } else {
      anchorNode = body.lastElementChild;
      if (anchorNode && anchorNode.localName !== 'sectPr') anchorNode = null; 
  }

  // 5. Recursive Generation
  const generateLevel = (chapters: typeof thesis.chapters, level: number) => {
      chapters.forEach(ch => {
          const prototype = protos[level] || protos[1] || genericProtoNormal;
          if (!prototype) return;

          // A. Insert Heading
          const newHeading = cloneParaSkeleton(prototype, doc);
          const titleClean = stripHeadingNumbering(ch.title);
          const sample = findFirstTextRun(prototype);
          
          newHeading.appendChild(makeRunTextLike(sample, titleClean, doc));
          body.insertBefore(newHeading, anchorNode);

          // B. Insert Content (Blocks)
          // === UPDATED: Pass Extended Prototypes ===
          const contentNodes = createContentNodes(
              ch.content || "[内容待生成]", 
              doc, 
              { normal: genericProtoNormal!, ...extendedProtos }
          );
          contentNodes.forEach(n => body.insertBefore(n, anchorNode));

          // C. Recurse for Subsections
          if (ch.subsections) {
              generateLevel(ch.subsections, level + 1);
          }
      });
  };

  generateLevel(thesis.chapters, 1);

  // 6. Inject References (After "参考文献" title in Back Matter)
  if (references.length > 0) {
      const liveKids = Array.from(body.children);
      let refHeader: Element | null = null;
      for (const node of liveKids) {
          const txt = getParaTextRaw(node);
          if (isBackMatterTitle(txt) && normalizeForMatch(txt).includes("参考文献")) {
              refHeader = node;
              break;
          }
      }

      if (refHeader) {
          let refCursor = refHeader.nextSibling;
          references.forEach(ref => {
             const bm = `_Ref_${ref.id}`;
             const p = cloneParaSkeleton(genericProtoNormal!, doc);
             const sample = findFirstTextRun(genericProtoNormal!);
             p.appendChild(createBookmark(doc, bm, globalId, "start"));
             p.appendChild(makeRunTextLike(sample, `[${ref.id}] ${ref.description}`, doc));
             p.appendChild(createBookmark(doc, bm, globalId, "end"));
             
             body.insertBefore(p, refCursor);
             globalId++;
          });
      }
  }

  // 7. Update Fields flag
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
