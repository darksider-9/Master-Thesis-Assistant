
import { SearchResult, CitationStyle } from "../types";

export const formatCitation = (paper: SearchResult, style: CitationStyle): string => {
    const authors = paper.authors.length > 0 ? paper.authors.join(", ") : "Unknown Author";
    const firstAuthor = paper.authors[0] || "Unknown";
    const etAl = paper.authors.length > 1 ? " et al." : "";
    const etAlZh = paper.authors.length > 3 ? "等" : ""; // Simplified logic
    
    // Clean abstract for raw usage
    const cleanAbstract = paper.abstract ? paper.abstract.replace(/\s+/g, ' ').trim() : "（无摘要）";

    // Venue fallback
    const venue = paper.venue || "Journal/Conference";

    switch (style) {
        case 'GB/T 7714':
            // Basic approximation of GB/T 7714-2015
            // [序号] 主要责任者. 题名: 其他题名信息[文献类型标志]. 其他责任者. 版本项. 出版地: 出版者, 出版年: 引文页码[引用日期]. 获取和访问路径.
            // Example: [1] Canny J. A computational approach to edge detection[J]. IEEE Transactions on pattern analysis and machine intelligence, 1986 (6): 679-698.
            // Since we often lack specific volume/issue/pages from simple APIs, we do our best.
            const authorsGB = paper.authors.slice(0, 3).map(a => a.toUpperCase()).join(", ") + (paper.authors.length > 3 ? ", et al" : "");
            return `${authorsGB}. ${paper.title}[J]. ${venue}, ${paper.year}.`;

        case 'APA':
            // Author, A. A., & Author, B. B. (Year). Title of the article. Name of the Periodical, volume(issue), #–#. https://doi.org/xxxx
            return `${authors}. (${paper.year}). ${paper.title}. ${venue}. ${paper.url ? paper.url : ''}`;

        case 'IEEE':
            // [1] J. K. Author, “Title of the paper,” Abbrev. Title of Periodical, vol. x, no. x, pp. xxx-xxx, Abbrev. Month, year.
            return `${firstAuthor}${etAl}, "${paper.title}," ${venue}, ${paper.year}.`;

        case 'MLA':
            // Author. "Title of Source." Title of Container, Other Contributors, Version, Number, Publisher, Publication Date, Location.
            return `${firstAuthor}${etAl}. "${paper.title}." ${venue}, ${paper.year}.`;

        default:
            return `${authors}. ${paper.title}. ${paper.year}.`;
    }
};

export const generateContextEntry = (paper: SearchResult, style: CitationStyle, existingId?: number): string => {
    const citation = formatCitation(paper, style);
    const prefix = existingId 
        ? `[Ref (已存 ID:${existingId})]` 
        : `[Ref (新增)]`;
    
    // We strictly append the full citation format so the AI sees exactly what to put in the Bibliography
    return `${prefix} ${citation}\n【摘要/Abstract】: ${paper.abstract}\n【引用格式/Format】: ${style}\n\n`;
};
