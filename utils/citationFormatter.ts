import { SearchResult, CitationStyle, ReferenceMetadata } from "../types";

// Helper to check if an object is likely a full metadata object
const isMetadata = (data: any): data is ReferenceMetadata => {
    return data && typeof data.title === 'string';
};

export const formatCitation = (paperOrMeta: SearchResult | ReferenceMetadata, style: CitationStyle): string => {
    // Unify input to ReferenceMetadata-like structure
    const title = paperOrMeta.title;
    const authors = paperOrMeta.authors || [];
    const year = (paperOrMeta as any).year || (paperOrMeta as any).publicationDate?.substring(0,4) || "N/A";
    const journal = (paperOrMeta as any).venue || (paperOrMeta as any).journal || "Unknown Journal";
    const url = (paperOrMeta as any).url || "";
    
    // Detailed fields (often missing in raw search, but present after enrichment)
    const volume = (paperOrMeta as any).volume || "";
    const issue = (paperOrMeta as any).issue || "";
    const pages = (paperOrMeta as any).pages || "";
    const doi = (paperOrMeta as any).doi || "";

    const authorsStr = authors.length > 0 ? authors.join(", ") : "Unknown Author";
    const firstAuthor = authors[0] || "Unknown";
    const etAl = authors.length > 1 ? " et al." : "";
    
    switch (style) {
        case 'GB/T 7714':
            // Format: [序号] 主要责任者. 题名[J]. 刊名, 年, 卷(期): 起止页码.
            // Authors: First 3, uppercase surnames
            const gbAuthors = authors.slice(0, 3).map(name => {
                // Try to uppercase surname if possible (heuristic)
                // Assuming "First Last" or "Last, First"
                if (name.includes(',')) return name.toUpperCase(); // Already Last, First
                const parts = name.split(' ');
                if (parts.length > 1) {
                    const last = parts.pop();
                    return `${last!.toUpperCase()} ${parts.join(' ').toUpperCase()}`; // LAST FIRST
                }
                return name.toUpperCase();
            });
            
            const authorPart = gbAuthors.join(", ") + (authors.length > 3 ? ", et al" : "");
            
            let details = `${year}`;
            if (volume) details += `, ${volume}`;
            if (issue) details += `(${issue})`;
            if (pages) details += `: ${pages}`;
            
            // Heuristic for type: Journal [J], Conference [C]
            // If we have volume/issue it's likely a Journal.
            const typeMark = (volume && issue) ? '[J]' : '[C]'; 

            return `${authorPart}. ${title}${typeMark}. ${journal}, ${details}.`;

        case 'APA':
            // Author, A. A., & Author, B. B. (Year). Title of the article. Name of the Periodical, volume(issue), pp–pp. https://doi.org/xx
            let apaDetails = "";
            if (volume) apaDetails += `, ${volume}`;
            if (issue) apaDetails += `(${issue})`;
            if (pages) apaDetails += `, ${pages}`;
            
            const doiStr = doi ? ` https://doi.org/${doi}` : (url ? ` ${url}` : '');
            
            return `${authorsStr} (${year}). ${title}. ${journal}${apaDetails}.${doiStr}`;

        case 'IEEE':
            // J. K. Author, “Title of paper,” Abbrev. Title of Periodical, vol. x, no. x, pp. xxx-xxx, Abbrev. Month, year.
            let ieeeDetails = "";
            if (volume) ieeeDetails += `, vol. ${volume}`;
            if (issue) ieeeDetails += `, no. ${issue}`;
            if (pages) ieeeDetails += `, pp. ${pages}`;
            
            return `${firstAuthor}${etAl}, "${title}," ${journal}${ieeeDetails}, ${year}.`;

        case 'MLA':
            // Author. "Title." Title of Container, vol. 1, no. 1, Year, pp. 1-10.
            let mlaDetails = `${year}`;
            if (volume) mlaDetails = `vol. ${volume}, ` + mlaDetails;
            if (issue) mlaDetails = `no. ${issue}, ` + mlaDetails; // order roughly vol, no, year
            if (pages) mlaDetails += `, pp. ${pages}`;

            return `${firstAuthor}${etAl}. "${title}." ${journal}, ${mlaDetails}.`;

        default:
            return `${authorsStr}. ${title}. ${journal}, ${year}.`;
    }
};

export const generateContextEntry = (paper: SearchResult, style: CitationStyle, existingId?: number): string => {
    const citation = formatCitation(paper, style);
    const prefix = existingId 
        ? `[Ref (已存 ID:${existingId})]` 
        : `[Ref (新增)]`;
    
    return `${prefix} ${citation}\n【摘要】: ${paper.abstract}\n【DOI】: ${paper.doi || 'N/A'}\n\n`;
};
