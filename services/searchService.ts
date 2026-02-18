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

// --- CORE UTILS: Normalization & Extraction ---

function extractDoi(text: string): string | null {
  if (!text) return null;
  // Match doi.org links
  const linkRegex = /https?:\/\/doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
  const linkMatch = text.match(linkRegex);
  if (linkMatch) return linkMatch[1].trim();

  // Match standalone DOIs in text
  const textRegex = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i;
  const textMatch = text.match(textRegex);
  if (textMatch) return textMatch[0].trim();

  return null;
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[:：\-_()（）【】\[\].,;?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAuthor(authorName: string): string {
  if (!authorName) return "";
  const parts = authorName.trim().split(" ");
  if (parts.length < 2) return authorName.toLowerCase();
  const lastName = parts[parts.length - 1].toLowerCase();
  const firstNameInitial = parts[0][0].toLowerCase();
  return `${lastName} ${firstNameInitial}`;
}

// --- NEW: Precision Matching via OpenAlex ---
async function matchPaperFromOpenAlex(
  title: string,
  firstAuthor?: string,
  year?: string
): Promise<SearchResult | null> {
  const normalizedTitle = normalizeTitle(title);
  // Construct filter
  let filter = `title.search:${encodeURIComponent(normalizedTitle)}`;
  if (year && year !== 'N/A') {
      filter += `,publication_year:${year}`;
  }
  
  const politeMail = "thesis_assistant_user@example.com";
  const url = `https://api.openalex.org/works?filter=${filter}&per_page=5&mailto=${politeMail}`;

  try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) return null;
      const data = await res.json();
      
      if (!data.results || data.results.length === 0) return null;

      // Secondary Check: Author Matching (if provided)
      let matchedWork = data.results[0]; // Default to first best match
      
      if (firstAuthor) {
          const targetAuthorNorm = normalizeAuthor(firstAuthor);
          const strictMatch = data.results.find((work: any) => {
              const workFirstAuthor = work.authorships?.[0]?.author?.display_name || "";
              return normalizeAuthor(workFirstAuthor) === targetAuthorNorm;
          });
          if (strictMatch) matchedWork = strictMatch;
      }

      // Convert OpenAlex Work to SearchResult
      return {
          id: matchedWork.doi ? matchedWork.doi.replace('https://doi.org/', '') : matchedWork.id,
          title: matchedWork.title,
          abstract: matchedWork.abstract_inverted_index ? "（OpenAlex Abstract Available）" : "", // We treat metadata as priority
          authors: matchedWork.authorships?.map((a: any) => a.author.display_name) || [],
          year: matchedWork.publication_year?.toString() || "N/A",
          venue: matchedWork.host_venue?.display_name || matchedWork.primary_location?.source?.display_name,
          url: matchedWork.doi || matchedWork.id,
          source: 'OpenAlex (Matched)',
          doi: matchedWork.doi ? matchedWork.doi.replace('https://doi.org/', '') : undefined,
          // Extra metadata for enrichment
          volume: matchedWork.biblio?.volume,
          issue: matchedWork.biblio?.issue,
          pages: matchedWork.biblio?.first_page ? `${matchedWork.biblio.first_page}-${matchedWork.biblio.last_page || ''}` : undefined
      } as any; // Cast to any to allow extra fields temporarily
  } catch (e) {
      console.warn("OpenAlex Match Failed", e);
      return null;
  }
}

// --- New: Fetch Detailed Metadata via Multi-Source Aggregation ---
export const enrichReferenceMetadata = async (
    query: string, 
    settings: ApiSettings, 
    strictTitleMatch: boolean = false
): Promise<ReferenceMetadata | null> => {
    // 1. Try OpenAlex Match First (It is free and very structured)
    // If we have a query that looks like a title
    let bestMeta: ReferenceMetadata | null = null;

    try {
        const oaMatch = await matchPaperFromOpenAlex(query);
        if (oaMatch) {
            bestMeta = {
                title: oaMatch.title,
                authors: oaMatch.authors,
                year: oaMatch.year,
                journal: oaMatch.venue,
                volume: (oaMatch as any).volume,
                issue: (oaMatch as any).issue,
                pages: (oaMatch as any).pages,
                doi: oaMatch.doi,
                type: 'journal-article'
            };
        }
    } catch (e) {
        console.warn("Enrichment OA failed", e);
    }

    // 2. If OpenAlex failed or strict match required verification, try Crossref
    if (!bestMeta) {
        const crMeta = await fetchDetailedRefMetadata(query);
        if (crMeta) {
             if (strictTitleMatch) {
                 const sim = calculateTitleSimilarity(query, crMeta.title);
                 if (sim > 0.6) bestMeta = crMeta;
             } else {
                 bestMeta = crMeta;
             }
        }
    }

    return bestMeta;
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
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=title,abstract,authors,year,url,venue,publicationDate,externalIds`;
    
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
        abstract: item.abstract ? item.abstract.replace(/\n/g, " ").trim() : "（Semantic Scholar 未提供该文摘要）",
        authors: item.authors?.map((a: any) => a.name) || [],
        year: item.year?.toString() || item.publicationDate?.substring(0,4) || "N/A",
        url: item.url,
        venue: item.venue,
        doi: item.externalIds?.DOI,
        source: 'Semantic Scholar'
    }));
};

// 2. ArXiv API (XML)
const searchArxiv = async (query: string): Promise<SearchResult[]> => {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`ArXiv API Error: ${res.status}`);
    const text = await res.text();
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
        const authors = Array.from(entry.getElementsByTagName("author")).map(a => a.getElementsByTagName("name")[0]?.textContent || "");

        results.push({
            id: id,
            title: title.replace(/\s+/g, " ").trim(),
            abstract: summary.replace(/\s+/g, " ").trim(),
            authors: authors,
            year: published.substring(0, 4),
            url: id,
            source: 'ArXiv'
        });
    }
    return results;
};

// 3. OpenAlex API
const searchOpenAlex = async (query: string): Promise<SearchResult[]> => {
    const politeMail = "thesis_assistant_user@example.com"; 
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&filter=has_abstract:true&per-page=5&mailto=${politeMail}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`OpenAlex API Error: ${res.status}`);
    const data = await res.json();
    
    const reconstructAbstract = (inverted: any) => {
        if (!inverted) return "";
        const sorted = Object.entries(inverted).flatMap(([word, positions]: any) => 
            positions.map((pos: number) => ({ word, pos }))
        ).sort((a: any, b: any) => a.pos - b.pos);
        return sorted.map((x: any) => x.word).join(" ");
    };

    return data.results.map((item: any) => ({
        id: item.id,
        title: item.title,
        abstract: reconstructAbstract(item.abstract_inverted_index) || "（摘要解析失败）",
        authors: item.authorships?.map((a: any) => a.author.display_name) || [],
        year: item.publication_year?.toString() || "N/A",
        venue: item.host_venue?.display_name,
        doi: item.doi?.replace('https://doi.org/', ''),
        url: item.doi || item.id,
        source: 'OpenAlex'
    }));
};

// 4. Crossref API
const searchCrossref = async (query: string): Promise<SearchResult[]> => {
    const politeMail = "thesis_assistant_user@example.com";
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=5&mailto=${politeMail}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Crossref API Error: ${res.status}`);
    const data = await res.json();
    
    return data.message.items.map((item: any) => ({
        id: item.DOI,
        title: item.title?.[0] || "Untitled",
        abstract: "（Crossref API 通常只提供元数据，不提供完整摘要）",
        authors: item.author?.map((a: any) => `${a.given} ${a.family}`) || [],
        year: item.published?.['date-parts']?.[0]?.[0]?.toString() || "N/A",
        venue: item['container-title']?.[0],
        doi: item.DOI,
        url: item.URL,
        source: 'Crossref'
    }));
};

// 5. Serper API (Google Scholar Mode) - UPGRADED
const searchSerper = async (query: string, apiKey: string): Promise<SearchResult[]> => {
    if (!apiKey) throw new Error("Serper API 需要 API Key");
    
    // Switch to /scholar endpoint for better academic results
    const url = "https://google.serper.dev/scholar";
    const raw = JSON.stringify({
        "q": query,
        "gl": "cn",
        "hl": "zh-cn",
        "num": 5
    });

    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
        body: raw
    });

    if (!res.ok) throw new Error(`Serper API Error: ${res.status}`);
    const data = await res.json();

    const results: SearchResult[] = [];

    // Process Serper results with enrichment fallback
    for (const item of (data.organic || [])) {
        let authors: string[] = [];
        // Attempt to parse authors from "authors" array or snippet
        if (item.authors && Array.isArray(item.authors)) {
            authors = item.authors.map((a: any) => a.name);
        }

        const title = item.title;
        const link = item.link;
        const snippet = item.snippet || "";
        const year = item.year || "N/A";

        // Step 1: Pre-extract DOI from link or snippet
        const extractedDOI = extractDoi(link) || extractDoi(snippet);
        let finalMetadata: any = {};

        // Step 2: If no DOI, try fuzzy match on OpenAlex to fill gaps (vol, issue, pages)
        // This is crucial because Serper often lacks structured metadata
        if (!extractedDOI) {
             const match = await matchPaperFromOpenAlex(title, authors[0], year !== 'N/A' ? year : undefined);
             if (match) {
                 finalMetadata = {
                     doi: match.doi,
                     venue: (match as any).venue,
                     volume: (match as any).volume,
                     issue: (match as any).issue,
                     pages: (match as any).pages,
                     authors: match.authors.length > authors.length ? match.authors : authors
                 };
             }
        }

        results.push({
            id: extractedDOI || finalMetadata.doi || item.position?.toString() || Math.random().toString(),
            title: title,
            abstract: snippet,
            authors: finalMetadata.authors || authors,
            year: year,
            url: link,
            venue: item.publication || finalMetadata.venue || "Google Scholar",
            doi: extractedDOI || finalMetadata.doi,
            source: 'Serper (Scholar)'
        });
    }

    return results;
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
