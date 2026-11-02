import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {duckduckgoSearch} from '../../search/duckduckgo.js';
const html=Array.from({length:3},(_,i)=>`<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2F${i+1}">Result ${i+1}</a><div class="result__snippet">Description ${i+1}</div></div>`).join('');
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>new Response(html))));
afterEach(()=>vi.unstubAllGlobals());
describe('DuckDuckGo HTML fallback',()=>{
 it('parses titles, redirect destinations and snippets',async()=>{const result=await duckduckgoSearch('test query',5);expect(result?.results).toHaveLength(3);expect(result?.results[0]).toEqual({url:'https://example.org/1',title:'Result 1',snippet:'Description 1'});});
 it('respects count',async()=>expect((await duckduckgoSearch('test',2))?.results).toHaveLength(2));
 it('returns unavailable for network failures',async()=>{vi.mocked(fetch).mockRejectedValue(new Error('network'));expect(await duckduckgoSearch('test',5)).toBeNull();});
 it('rejects challenge pages with no search results',async()=>{vi.mocked(fetch).mockResolvedValue(new Response('Please verify you are human'));expect(await duckduckgoSearch('test',5)).toBeNull();});
});
