import { parseHTML } from 'linkedom';
import { fetchWithTimeout } from '../fetch-with-timeout.js';
import { blockedUrlReason } from '../url-guard.js';
import type { SearchResponse } from '../types.js';

export async function duckduckgoSearch(query:string,count:number):Promise<SearchResponse|null>{
  const start=Date.now();
  try{
    const response=await fetchWithTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,{headers:{'User-Agent':'Mozilla/5.0'}},10_000);
    if(!response.ok)return null;
    const {document}=parseHTML(await response.text());
    const results:SearchResponse['results']=[];
    for(const item of document.querySelectorAll('.result')){
      const a=item.querySelector('a.result__a');if(!a)continue;
      try{
        const link=new URL(a.getAttribute('href')!,'https://duckduckgo.com');
        const url=link.searchParams.get('uddg')??link.href;
        if(blockedUrlReason(url))continue;
        results.push({url,title:a.textContent?.trim()||url,snippet:item.querySelector('.result__snippet')?.textContent?.trim()||''});
        if(results.length>=count)break;
      }catch{}
    }
    return results.length?{results,source:'duckduckgo',timing:Date.now()-start}:null;
  }catch{return null;}
}
