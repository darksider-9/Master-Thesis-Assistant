

import { SearchProvider, SearchResult, ReferenceMetadata, ApiSettings } from "../types";

const TIMEOUT_MS = 120000; // Increased to 120 seconds for slow academic APIs

// Helper to fetch with timeout
const fetchWithTimeout = async (url: string, options: RequestInit = {}) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// Helper: Calculate Cosine Similarity for Titles (Simple Bag of Words)
const calculateTitleSimilarity = (t1: string, t2: string): number => {
    if (!t1 || !t2) return 0;
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
    const s1 = new Set(clean(t1));
    const s2 = new Set(clean(t2));
    
    if (s1.size === 0 || s2.size === 0) return 0;
    
    let intersection = 0;
    s1.forEach(w => { if (s2.has(w)) intersection++; });
    
    const union = new Set([...s1, ...s2]).size;
    return intersection / union; // Jaccard Index approximation
};

// --- New: Fetch Detailed Metadata via Multi-Source Aggregation ---
export const enrichReferenceMetadata = async (
    query: string, 
    settings: ApiSettings, 
    strictTitleMatch: boolean = false
): Promise<ReferenceMetadata | null> => {
    // We will query multiple providers in parallel to find the best match and most complete data.
    const promises: Promise<SearchResult[]>[] = [
        searchCrossref(query).catch(() => []),      // Best for DOI, Journal, Volume, Issue, Pages
        searchOpenAlex(query).catch(() => []),      // Good for Authors, Title cleaning
        searchSemanticScholar(query).catch(() => [])// Good for Abstract
    ];

    // If Serper Key is provided, use it as a powerful fallback or verifier
    if (settings.searchApiKey && settings.searchProvider === 'serper') {
        promises.push(searchSerper(query, settings.searchApiKey).catch(() => []));
    }

    try {
        const resultsArray = await Promise.all(promises);
        
        // Flatten results, identifying source
        const crossrefMatches = resultsArray[0] || [];
        const openAlexMatches = resultsArray[1] || [];
        const s2Matches = resultsArray[2] || [];
        const serperMatches = resultsArray[3] || [];

        // 1. Determine the "Anchor" result (The one we trust most for identity)
        // Crossref is preferred for citation data.
        let anchor = crossrefMatches[0];
        let anchorSource = 'crossref';

        if (!anchor) {
            anchor = openAlexMatches[0];
            anchorSource = 'openalex';
        }
        if (!anchor) {
            anchor = s2Matches[0];
            anchorSource = 's2';
        }
        if (!anchor) {
            anchor = serperMatches[0];
            anchorSource = 'serper';
        }

        if (!anchor) return null; // No results found anywhere

        // --- STRICT TITLE CHECK ---
        // If we expect a strict match (e.g. we already know the title), reject if similarity is low
        if (strictTitleMatch) {
            const similarity = calculateTitleSimilarity(query, anchor.title);
            // Threshold 0.4 allows for some variation (e.g. subtitle missing, slight punctuation diffs)
            // but rejects completely different papers.
            if (similarity < 0.4) {
                console.warn(`Enrichment Rejected: Title mismatch. Expected "${query}", Got "${anchor.title}" (Sim: ${similarity})`);
                return null;
            }
        }

        // 2. Initialize Metadata from Anchor
        // We map SearchResult back to ReferenceMetadata structure
        const meta: ReferenceMetadata = {
            title: anchor.title,
            authors: anchor.authors,
            year: anchor.year,
            journal: anchor.venue,
            doi: anchor.url?.includes('doi.org') ? anchor.url.replace('https://doi.org/', '') : undefined,
            type: 'journal-article' // default
        };

        // 3. Enrichment: Try to fill gaps using other sources
        // Helper: Simple title similarity check to ensure we merge the SAME paper
        const isSamePaper = (t1: string, t2: string) => calculateTitleSimilarity(t1, t2) > 0.6;

        // -> Fill from OpenAlex (if anchor wasn't OpenAlex)
        if (anchorSource !== 'openalex' && openAlexMatches.length > 0) {
            const match = openAlexMatches.find(r => isSamePaper(r.title, meta.title));
            if (match) {
                if (!meta.authors || meta.authors.length === 0 || match.authors.length > meta.authors.length) {
                    meta.authors = match.authors; // OpenAlex authors are often cleaner/more complete
                }
                if (!meta.doi && match.url?.includes('doi.org')) {
                    meta.doi = match.url.replace('https://doi.org/', '');
                }
                if (!meta.year || meta.year === 'N/A') meta.year = match.year;
            }
        }

        // -> Fill from Crossref (if anchor wasn't Crossref - rare but possible)
        if (anchorSource !== 'crossref' && crossrefMatches.length > 0) {
            const match = crossrefMatches.find(r => isSamePaper(r.title, meta.title));
            if (match) {
                // Crossref is authority on these:
                if (match.venue) meta.journal = match.venue;
                if (match.url?.includes('doi.org')) meta.doi = match.url.replace('https://doi.org/', '');
            }
        }

        // -> Attempt to get Volume/Issue/Pages via a dedicated single-item fetch if we have a title/doi
        // The search lists often don't return vol/issue. Let's try to get specific metadata if we have a DOI or clean title.
        const refinement = await fetchDetailedRefMetadata(meta.title);
        if (refinement) {
            // Overwrite with detailed bibliographic data if available
            if (refinement.volume) meta.volume = refinement.volume;
            if (refinement.issue) meta.issue = refinement.issue;
            if (refinement.pages) meta.pages = refinement.pages;
            if (refinement.journal) meta.journal = refinement.journal; // Official abbr or full name
            if (refinement.doi) meta.doi = refinement.doi;
            if (refinement.type) meta.type = refinement.type;
        }

        return meta;

    } catch (e) {
        console.error("Enrichment failed", e);
        return null;
    }
};

// --- Existing: Fetch Detailed Metadata for Strict Formatting (Crossref Single Item) ---
export const fetchDetailedRefMetadata = async (title: string): Promise<ReferenceMetadata | null> => {
    try {
        const politeMail = "thesis_assistant_user@example.com";
        // Search Crossref works by title to get the best match
        const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(title)}&rows=1&mailto=${politeMail}`;
        
        const res = await fetchWithTimeout(url);
        if (!res.ok) return null;
        
        const data = await res.json();
        const item = data.message?.items?.[0];
        
        if (!item) return null;

        // Map Crossref fields to our metadata structure
        return {
            title: item.title?.[0] || title,
            authors: item.author?.map((a: any) => `${a.family}, ${a.given}`) || [],
            journal: item['container-title']?.[0] || "",
            year: item.published?.['date-parts']?.[0]?.[0]?.toString() || "",
            volume: item.volume || "",
            issue: item.issue || "",
            pages: item.page || "",
            doi: item.DOI || "",
            type: item.type // 'journal-article', etc.
        };
    } catch (e) {
        console.warn("Crossref metadata fetch failed", e);
        return null;
    }
};

// 1. Semantic Scholar API
const searchSemanticScholar = async (query: string, apiKey?: string): Promise<SearchResult[]> => {
    // S2 Graph API (Free tier has limits, Key recommended for high volume)
    // We request abstract, title, year, authors
    // Added 'tldr' which is sometimes better than abstract for quick scanning, but we prefer abstract.
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=title,abstract,authors,year,url,venue,publicationDate`;
    
    const headers: HeadersInit = {};
    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    const res = await fetchWithTimeout(url, { headers });
    if (!res.ok) throw new Error(`S2 API Error: ${res.status}`);
    const data = await res.json();
    
    if (!data.data) return [];

    return data.data.map((item: any) => ({
        id: item.paperId,
        title: item.title,
        // Fallback logic for abstract
        abstract: item.abstract ? item.abstract.replace(/\n/g, " ").trim() : "（Semantic Scholar 未提供该文摘要，可能是因为版权限制）",
        authors: item.authors?.map((a: any) => a.name) || [],
        year: item.year?.toString() || item.publicationDate?.substring(0,4) || "N/A",
        url: item.url,
        source: 'Semantic Scholar'
    }));
};

// 2. ArXiv API (XML)
const searchArxiv = async (query: string): Promise<SearchResult[]> => {
    // ArXiv API is free and doesn't require key.
    // Query format: all:keyword
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`;
    
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`ArXiv API Error: ${res.status}`);
    const text = await res.text();
    
    // Parse XML in Browser
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, "text/xml");
    const entries = xmlDoc.getElementsByTagName("entry");
    
    const results: SearchResult[] = [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const title = entry.getElementsByTagName("title")[0]?.textContent || "";
        const summary = entry.getElementsByTagName("summary")[0]?.textContent || "";
        const published = entry.getElementsByTagName("published")[0]?.textContent || "";
        const id = entry.getElementsByTagName("id")[0]?.textContent || "";
        const authorNodes = entry.getElementsByTagName("author");
        const authors = [];
        for(let j=0; j<authorNodes.length; j++) {
            authors.push(authorNodes[j].getElementsByTagName("name")[0]?.textContent || "");
        }

        // CRITICAL FIX: ArXiv summaries have newlines that look like truncation in some UIs.
        // Replace newlines with spaces.
        const cleanSummary = summary.replace(/\s+/g, " ").trim();
        const cleanTitle = title.replace(/\s+/g, " ").trim();

        results.push({
            id: id,
            title: cleanTitle,
            abstract: cleanSummary || "（无摘要）",
            authors: authors,
            year: published.substring(0, 4), // YYYY-MM-DD
            url: id,
            source: 'ArXiv'
        });
    }
    return results;
};

// 3. OpenAlex API
const searchOpenAlex = async (query: string): Promise<SearchResult[]> => {
    // Best Practice: Provide a mailto to get into the "Polite Pool" (faster, higher limits)
    // We use a generic identification for this tool.
    const politeMail = "thesis_assistant_user@example.com"; 
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=has_abstract:true&per-page=5&mailto=${politeMail}`;
    
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`OpenAlex API Error: ${res.status}`);
    const data = await res.json();
    
    // Helper to reconstruct Inverted Index abstract
    const reconstructAbstract = (inverted: any) => {
        if (!inverted) return "";
        const sorted = Object.entries(inverted).flatMap(([word, positions]: any) => 
            positions.map((pos: number) => ({ word, pos }))
        ).sort((a: any, b: any) => a.pos - b.pos);
        return sorted.map((x: any) => x.word).join(" ");
    };

    return data.results.map((item: any) => {
        // Newer OpenAlex API sometimes has 'abstract' field directly if reconstructed, 
        // but typically it's abstract_inverted_index
        const abstractText = reconstructAbstract(item.abstract_inverted_index) || "（摘要解析失败）";

        return {
            id: item.id,
            title: item.title,
            abstract: abstractText,
            authors: item.authorships?.map((a: any) => a.author.display_name) || [],
            year: item.publication_year?.toString() || "N/A",
            url: item.doi || item.id,
            source: 'OpenAlex'
        };
    });
};

// 4. Crossref API
const searchCrossref = async (query: string): Promise<SearchResult[]> => {
    // Best Practice: Provide a mailto for Polite Pool
    const politeMail = "thesis_assistant_user@example.com";
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5&mailto=${politeMail}`;
    
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Crossref API Error: ${res.status}`);
    const data = await res.json();
    
    return data.message.items.map((item: any) => ({
        id: item.DOI,
        title: item.title?.[0] || "Untitled",
        abstract: item.abstract ? item.abstract.replace(/<[^>]+>/g, '') : "（Crossref API 通常只提供元数据，不提供完整摘要，建议尝试 OpenAlex）",
        authors: item.author?.map((a: any) => `${a.given} ${a.family}`) || [],
        year: item.published?.['date-parts']?.[0]?.[0]?.toString() || "N/A",
        url: item.URL,
        source: 'Crossref'
    }));
};

// 5. Serper API (Google Scholar)
const searchSerper = async (query: string, apiKey: string): Promise<SearchResult[]> => {
    if (!apiKey) throw new Error("Serper API 需要 API Key");
    
    const url = "https://google.serper.dev/scholar";
    const raw = JSON.stringify({
        "q": query,
        "gl": "cn",
        "hl": "zh-cn",
        "num": 5
    });

    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json'
        },
        body: raw
    });

    if (!res.ok) throw new Error(`Serper API Error: ${res.status}`);
    const data = await res.json();

    return (data.organic || []).map((item: any) => {
        // Serper result fix for year
        // item.year might be a number or string
        let year = (item.year || "").toString();
        
        // Validation: If year is not a standard 19xx/20xx year, or if we suspect it's part of an arXiv ID.
        // arXiv IDs often look like YYMM.xxxxx. 1709 = Sep 2017.
        // If year is "1709", it's suspicious.
        const isValidYear = /^(19|20)\d{2}$/.test(year);
        
        if (!isValidYear) {
            // Try to extract from snippet or attributes
            // Serper usually has 'snippet' or sometimes 'publicationInfo' (attributes)
            // We look for a 4-digit year in the snippet string
            const textToScan = (item.snippet || "") + " " + (item.publicationInfo || "");
            const matches = textToScan.match(/\b(19|20)\d{2}\b/g);
            if (matches && matches.length > 0) {
                // Take the last one as it's often the publication year at the end of citation
                year = matches[matches.length - 1]; 
            } else {
                year = "N/A";
            }
        }

        return {
            id: item.link || item.position,
            title: item.title,
            abstract: item.snippet || "（Google Scholar 只提供片段 Snippet，非完整摘要）",
            authors: [], // Serper doesn't strictly parse authors in 'organic' sometimes, contained in snippet
            year: year,
            url: item.link,
            source: 'Serper (Google Scholar)'
        };
    });
};

// Unified Switcher
export const searchAcademicPapers = async (
    query: string, 
    provider: SearchProvider, 
    apiKey?: string
): Promise<SearchResult[]> => {
    switch (provider) {
        case 'semantic_scholar':
            return searchSemanticScholar(query, apiKey);
        case 'arxiv':
            return searchArxiv(query);
        case 'open_alex':
            return searchOpenAlex(query);
        case 'crossref':
            return searchCrossref(query);
        case 'serper':
            return searchSerper(query, apiKey || "");
        case 'none':
        default:
            return [];
    }
};