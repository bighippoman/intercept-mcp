export interface CitablePassage { text: string; heading: string; startIndex: number; endIndex: number; citationUrl: string; }

/** Rank verbatim excerpts; no generated answer is presented as a source quote. */
export function relevantPassages(content: string, query: string, url: string, limit=3): CitablePassage[] {
  const terms=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[])].filter(w=>!['the','and','for','with','how','what','does','are','this','that'].includes(w));
  const candidates: Array<CitablePassage & {score:number}>=[];
  let heading=content.match(/^#\s+(.+)/m)?.[1]??url;
  for(let start=0;start<content.length;){
    let end=Math.min(start+2000,content.length);
    const boundary=content.lastIndexOf('\n\n',end);if(end<content.length&&boundary>start+700)end=boundary;
    const text=content.slice(start,end);heading=text.match(/^#{1,6}\s+(.+)/m)?.[1]??heading;
    const lower=text.toLowerCase(),matches=terms.filter(t=>lower.includes(t));
    const score=matches.length+terms.filter(t=>heading.toLowerCase().includes(t)).length*2;
    const quote=text.replace(/^#+\s+/gm,'').replace(/[*`_\[\]]/g,'').replace(/\s+/g,' ').trim().slice(0,100);
    if(score>0)candidates.push({text,heading,startIndex:start,endIndex:end,citationUrl:`${url.split('#')[0]}#:~:text=${encodeURIComponent(quote)}`,score});
    start=end===content.length?end:end-100;
  }
  return candidates.sort((a,b)=>b.score-a.score).slice(0,limit).map(({score,...p})=>p);
}
