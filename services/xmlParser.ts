
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

// -------------------- Parsing Constants & Strategies --------------------

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
  const headingStack: { level: 1 | 2 | 3; title: string }[] = [];
  const tocStack: TocField[] = [];
  let tocDepthId = 0;
  let mode: "front" | "body" | "back" = "front";

  const enterSection = (kind: MappingSectionKind, title: string, level: 0 | 1 | 2 | 3, order: number) => {
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
          order, nodeType: "p", kind: "back_title", level: 1, styleId: sid, text: txtRaw,
          owner: { sectionId: currentSection.id }, fields: tocOp.instrHits, bookmarks
        });
        continue;
      }

      const tocKind = currentTocKind();
      if (tocKind) {
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
        pushBlock({
          order, nodeType: "p", kind: "toc_item", level: 0, styleId: sid, text: txtRaw,
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
            order, nodeType: "p", kind: isTocTitle ? "toc_title" : "front_title", level: 1, styleId: sid, text: txtRaw,
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
            order, nodeType: "p", kind: "heading", level: headingLevel, styleId: sid, text: txtRaw,
            owner: getOwner(), fields: tocOp.instrHits, bookmarks
         });
         continue;
      }

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

// =========================================================================================
// ==========================  GENERATION LOGIC REWRITE  ===================================
// =========================================================================================

let globalId = 80000; // Bookmarks and Reference IDs

/**
 * 核心思想：原型克隆 (Prototype Cloning)
 * 不手动创建 <w:p>，而是找到模版中已有的“一级标题”、“正文”、“参考文献条目”等段落，
 * 复制它 (cloneNode)，保留 w:pPr 和 w:rPr，然后把内容替换掉。
 */

interface Prototypes {
    h1: Element | null;
    h2: Element | null;
    h3: Element | null;
    normal: Element | null;   // 真正的正文
    caption: Element | null;
    refEntry: Element | null;
    table: Element | null;
}

// Helper: 扫描 Body 提取原型
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

        // 识别标题原型
        if (styleId === headingStyles[1] && !protos.h1) {
            // 排除前置标题（摘要目录）
            if (!isFrontMatterTitle(text) && !isBackMatterTitle(text)) protos.h1 = node;
        }
        else if (styleId === headingStyles[2] && !protos.h2) protos.h2 = node;
        else if (styleId === headingStyles[3] && !protos.h3) protos.h3 = node;

        // 识别参考文献条目（在“参考文献”标题后的第一个非空段落）
        if (isBackMatterTitle(text) && normalizedText.includes("参考文献")) {
            seenRefTitle = true;
        } else if (seenRefTitle && !protos.refEntry && text.trim()) {
            protos.refEntry = node;
        }

        // 识别正文原型 (KEY FIX: 确保不是标题，且有一定长度，防止误判空行)
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
        
        // 识别图表标题 (SEQ)
        if (hasFieldSEQ(node) && !protos.caption) protos.caption = node;
    }

    // Fallback: 如果实在没找到 Normal，随便找个没样式的 P
    if (!protos.normal) {
        protos.normal = children.find(c => c.localName === 'p' && !extractStyleId(c)) || children.find(c => c.localName === 'p') || null;
    }
    
    return protos;
};

// Helper: 克隆并替换文本 (保留样式的核心)
const cloneWithText = (doc: Document, proto: Element, newText: string) => {
    const clone = proto.cloneNode(true) as Element;
    
    // 1. 保留 w:pPr (段落属性: 间距, 对齐, 大纲级别)
    // 2. 找到第一个 w:r (Run) 作为样式样本 (保留 w:rPr: 字体, 字号)
    let sampleRun = getChildByTagNameNS(clone, NS.w, "r");
    if (!sampleRun) {
        // 如果原型是空段落，可能没有 run，创建一个标准的
        sampleRun = doc.createElementNS(NS.w, "w:r");
        const rPr = doc.createElementNS(NS.w, "w:rPr");
        // 默认五号字 (防止太小)
        const sz = doc.createElementNS(NS.w, "w:sz"); sz.setAttributeNS(NS.w, "w:val", "21");
        rPr.appendChild(sz);
        sampleRun.appendChild(rPr);
    }

    // 3. 清空 clone 的所有子节点 (除了 pPr)
    const pPr = getChildByTagNameNS(clone, NS.w, "pPr");
    while (clone.firstChild) {
        if (clone.firstChild === pPr) {
            // pPr 移到最前面，防止被删后还在后面
            clone.removeChild(clone.firstChild);
        } else {
            clone.removeChild(clone.firstChild);
        }
    }
    if (pPr) clone.appendChild(pPr); // 放回 pPr

    // 4. 创建新 Run 并插入文本
    const newRun = sampleRun.cloneNode(true) as Element;
    // 清空 Run 的内容 (保留 rPr)
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

// Helper: 创建域代码 Run (Begin, Instr, Sep, Result, End)
const createFieldRuns = (doc: Document, sampleRun: Element, instr: string, display: string) => {
    const makeRun = (type: 'begin' | 'end' | 'separate' | 'instr' | 'text', val?: string) => {
        const r = sampleRun.cloneNode(true) as Element;
        // 清理内容
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

// 生成正文内容节点 (处理图表占位符)
const createContentNodes = (
    contentRaw: string, 
    doc: Document, 
    protos: Prototypes
): Element[] => {
    const nodes: Element[] = [];
    if (!contentRaw) return nodes;

    const parts = contentRaw.split(/(\[\[.*?\]\])/g);
    // 必须有正文原型，否则无法生成
    const baseProto = protos.normal || protos.h1; // Fallback to H1 is dangerous but better than crash
    if (!baseProto) return nodes;

    // 提取正文原型的样式 Run
    let sampleRun = getChildByTagNameNS(baseProto, NS.w, "r");

    parts.forEach(part => {
        if (!part.trim()) return;

        if (part.startsWith("[[FIG:")) {
             const desc = part.replace(/^\[\[FIG:/, "").replace(/\]\]$/, "");
             const bmId = (globalId++).toString();
             const bmName = `_Fig_${bmId}`;
             
             // 1. 图片占位 (居中正文)
             const pImg = cloneWithText(doc, baseProto, "（在此处插入图片）");
             // 强制居中
             let pPr = getChildByTagNameNS(pImg, NS.w, "pPr");
             if(!pPr) { pPr = doc.createElementNS(NS.w, "w:pPr"); pImg.appendChild(pPr); }
             let jc = getChildByTagNameNS(pPr, NS.w, "jc");
             if(!jc) { jc = doc.createElementNS(NS.w, "w:jc"); pPr.appendChild(jc); }
             jc.setAttributeNS(NS.w, "w:val", "center");
             nodes.push(pImg);

             // 2. 图注 (如果有 caption 原型用原型，没有用正文改居中)
             let pCap = protos.caption ? protos.caption.cloneNode(true) as Element : baseProto.cloneNode(true) as Element;
             // 清理内容
             const capPr = getChildByTagNameNS(pCap, NS.w, "pPr");
             while (pCap.firstChild) if(pCap.firstChild !== capPr) pCap.removeChild(pCap.firstChild); else pCap.removeChild(pCap.firstChild); // remove pPr too to re-append later
             if(capPr) pCap.appendChild(capPr);
             
             // 强制居中
             if(!capPr) { const newPr = doc.createElementNS(NS.w, "w:pPr"); pCap.appendChild(newPr); }
             const finalPr = getChildByTagNameNS(pCap, NS.w, "pPr")!;
             let capJc = getChildByTagNameNS(finalPr, NS.w, "jc");
             if(!capJc) { capJc = doc.createElementNS(NS.w, "w:jc"); finalPr.appendChild(capJc); }
             capJc.setAttributeNS(NS.w, "w:val", "center");

             // 构造内容: BM_Start -> 图 -> STYLEREF -> - -> SEQ -> BM_End -> Text
             // 需要 Sample Run
             let capSample = sampleRun;
             if (protos.caption) {
                 const r = getChildByTagNameNS(protos.caption, NS.w, "r");
                 if (r) capSample = r;
             }
             if (!capSample) capSample = doc.createElementNS(NS.w, "w:r"); // Fallback

             const appendText = (t: string) => {
                 const r = capSample!.cloneNode(true) as Element;
                 // clear r children except rPr
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
             createFieldRuns(doc, capSample, "STYLEREF 1 \\s", "X").forEach(n => pCap.appendChild(n));
             appendText("-");
             createFieldRuns(doc, capSample, "SEQ Figure \\* ARABIC \\s 1", "1").forEach(n => pCap.appendChild(n));
             pCap.appendChild(createBookmark(doc, bmName, bmId, "end"));
             appendText("  " + desc);
             
             nodes.push(pCap);
        }
        else if (part.startsWith("[[TBL:")) {
             const desc = part.replace(/^\[\[TBL:/, "").replace(/\]\]$/, "");
             // Table logic similar to Fig but caption usually above
             const pCap = cloneWithText(doc, baseProto, `表 [编号] ${desc} (请更新域代码)`);
             // Force center
             const pPr = getChildByTagNameNS(pCap, NS.w, "pPr");
             if (pPr) {
                let jc = getChildByTagNameNS(pPr, NS.w, "jc");
                if (!jc) { jc = doc.createElementNS(NS.w, "w:jc"); pPr.appendChild(jc); }
                jc.setAttributeNS(NS.w, "w:val", "center");
             }
             nodes.push(pCap);

             // Insert Table Proto
             if (protos.table) {
                 nodes.push(protos.table.cloneNode(true) as Element);
             } else {
                 // Fallback Text Table
                 nodes.push(cloneWithText(doc, baseProto, "[此处插入表格]"));
             }
        }
        else if (part.startsWith("[[REF:")) {
            // Inline reference logic [[REF:1]] -> [1] (Hyperlink)
            // Implementation requires splitting the paragraph. 
            // For simplicity in this fix, we output strict text.
            const id = part.match(/\d+/)?.[0] || "?";
            const p = cloneWithText(doc, baseProto, `[${id}]`);
            // To do it right inline is complex without splitting runs. 
            // We treat the whole block as normal text for now if mixed.
            // Better strategy: The parser usually returns [[REF:1]] inside text.
            // We handled that below.
        }
        else {
            // Normal Text
            // Handle Inline Refs inside this text block
            // e.g. "According to [[REF:1]], we know..."
            const subParts = part.split(/(\[\[REF:\d+\]\])/g);
            if (subParts.length === 1) {
                nodes.push(cloneWithText(doc, baseProto, part));
            } else {
                // Complex paragraph construction
                const p = baseProto.cloneNode(true) as Element;
                // Clear kids except pPr
                const pPr = getChildByTagNameNS(p, NS.w, "pPr");
                while (p.firstChild) p.removeChild(p.firstChild);
                if (pPr) p.appendChild(pPr);

                subParts.forEach(sp => {
                    if (sp.match(/^\[\[REF:\d+\]\]$/)) {
                        const id = sp.match(/\d+/)?.[0];
                        const bmName = `_Ref_${id}_target`;
                        if (sampleRun) {
                           const appendRun = (t: string) => {
                               const r = sampleRun!.cloneNode(true) as Element;
                               const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                               while(r.firstChild) r.removeChild(r.firstChild);
                               if(rPr) r.appendChild(rPr);
                               const wt = doc.createElementNS(NS.w, "w:t");
                               wt.setAttribute("xml:space", "preserve");
                               wt.textContent = t;
                               r.appendChild(wt);
                               p.appendChild(r);
                           };
                           appendRun("[");
                           createFieldRuns(doc, sampleRun, `REF ${bmName} \\r \\h`, id || "0").forEach(n => p.appendChild(n));
                           appendRun("]");
                        }
                    } else if (sp) {
                        // Text run
                         if (sampleRun) {
                            const r = sampleRun.cloneNode(true) as Element;
                            const rPr = getChildByTagNameNS(r, NS.w, "rPr");
                            while(r.firstChild) r.removeChild(r.firstChild);
                            if(rPr) r.appendChild(rPr);
                            const wt = doc.createElementNS(NS.w, "w:t");
                            wt.setAttribute("xml:space", "preserve");
                            wt.textContent = sp;
                            r.appendChild(wt);
                            p.appendChild(r);
                         }
                    }
                });
                nodes.push(p);
            }
        }
    });

    return nodes;
};

// Main Export Function
export const generateThesisXML = (thesis: ThesisStructure, rules: FormatRules, references: Reference[]): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rules.rawXML, "text/xml");
    
    // 1. 获取 Body
    const docPart = getPkgPart(doc, "/word/document.xml");
    const docRoot = getPartXmlRoot(docPart!);
    const body = getChildByTagNameNS(docRoot!, NS.w, "body");
    if (!body) throw new Error("Format Error: No body found");

    // 2. 准备样式表
    const stylesPart = getPkgPart(doc, "/word/styles.xml");
    const stylesRoot = stylesPart ? getPartXmlRoot(stylesPart) : null;
    const headingStyles = stylesRoot ? buildHeadingStyles(stylesRoot) : {
        1: rules.styleIds.heading1, 2: rules.styleIds.heading2, 3: rules.styleIds.heading3
    };

    // 3. 提取原型 (KEY STEP)
    const protos = findPrototypes(body, headingStyles);

    // 4. 定位正文区域并清空旧正文
    // 策略：保留前置部分（摘要目录），保留后置部分（参考文献致谢），只替换中间的章节。
    const children = Array.from(body.children);
    let startDeleteIdx = -1;
    let endDeleteIdx = -1;

    // 找 H1 章节开始
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.localName === 'p') {
            const sid = extractStyleId(node);
            const txt = getParaTextRaw(node);
            // 遇到第一个非 FrontMatter 的 H1 -> 正文开始
            if (sid === headingStyles[1] && !isFrontMatterTitle(txt) && !isBackMatterTitle(txt)) {
                startDeleteIdx = i;
                break;
            }
        }
    }

    // 找 后置部分开始
    for (let i = (startDeleteIdx === -1 ? 0 : startDeleteIdx); i < children.length; i++) {
        const node = children[i];
        if (node.localName === 'p') {
            if (isBackMatterTitle(getParaTextRaw(node))) {
                endDeleteIdx = i;
                break;
            }
        }
        if (node.localName === 'sectPr') {
             endDeleteIdx = i; // End of section
             break;
        }
    }

    if (endDeleteIdx === -1) endDeleteIdx = children.length;
    
    // 如果找不到正文 H1，可能是一个空模版，直接插在 sectPr 前
    let anchorNode: Node | null = null;
    if (startDeleteIdx !== -1) {
        // 删除旧章节
        const toRemove = children.slice(startDeleteIdx, endDeleteIdx);
        toRemove.forEach(n => body.removeChild(n));
        anchorNode = children[endDeleteIdx]; // 插入点在后置部分之前
    } else {
        // Append at end (before sectPr)
        const sectPr = getChildByTagNameNS(body, NS.w, "sectPr");
        anchorNode = sectPr;
    }

    // 5. 写入新章节
    const insertChapter = (ch: typeof thesis.chapters[0]) => {
        let pTitle: Element | null = null;
        const titleText = ch.title; // 此时 title 可能包含 "1.1 xxx"

        if (ch.level === 1 && protos.h1) {
             pTitle = cloneWithText(doc, protos.h1, titleText);
        } else if (ch.level === 2 && protos.h2) {
             pTitle = cloneWithText(doc, protos.h2, titleText);
        } else if (ch.level === 3 && protos.h3) {
             pTitle = cloneWithText(doc, protos.h3, titleText);
        } else {
             // Fallback
             pTitle = cloneWithText(doc, protos.h1 || protos.normal!, titleText);
        }

        if (pTitle) body.insertBefore(pTitle, anchorNode);

        // 插入内容
        if (ch.content) {
            const contentNodes = createContentNodes(ch.content, doc, protos);
            contentNodes.forEach(n => body.insertBefore(n, anchorNode));
        }

        // 递归
        if (ch.subsections) ch.subsections.forEach(insertChapter);
    };

    thesis.chapters.forEach(insertChapter);

    // 6. 插入参考文献
    // 寻找“参考文献”标题节点
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
            
            // Clone Ref Proto
            const pRef = protos.refEntry!.cloneNode(true) as Element;
            // Clear content, keep pPr
            const pPr = getChildByTagNameNS(pRef, NS.w, "pPr");
            while (pRef.firstChild) pRef.removeChild(pRef.firstChild);
            if (pPr) pRef.appendChild(pPr);
            
            // Sample Run
            let sampleRun = getChildByTagNameNS(protos.refEntry!, NS.w, "r");
            if (!sampleRun) sampleRun = doc.createElementNS(NS.w, "w:r"); // fallback

            // Construct: BM_Start -> Text -> BM_End
            pRef.appendChild(createBookmark(doc, bmName, bmId, "start"));
            
            const r = sampleRun!.cloneNode(true) as Element;
            const rPr = getChildByTagNameNS(r, NS.w, "rPr");
            while(r.firstChild) r.removeChild(r.firstChild);
            if(rPr) r.appendChild(rPr);
            const t = doc.createElementNS(NS.w, "w:t");
            t.setAttribute("xml:space", "preserve");
            t.textContent = `[${ref.id}] ${ref.description}`;
            r.appendChild(t);
            pRef.appendChild(r);

            pRef.appendChild(createBookmark(doc, bmName, bmId, "end"));

            body.insertBefore(pRef, insertRefAfter);
        });
    }

    // 7. 更新 Fields
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
