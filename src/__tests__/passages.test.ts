import {describe,it,expect} from 'vitest';
import {relevantPassages} from '../passages.js';
import {runPipeline} from '../pipeline.js';
import {requestSignal} from '../request-context.js';
describe('research evidence and provider latency',()=>{
 it('returns verbatim deep passages with source offsets and a citation',()=>{
  const content='# Introduction\n\n'+('General overview of the surrounding subject. '.repeat(100))+'\n\n## Quantum error correction\n\nA surface code uses stabilizer measurements to detect errors.';
  const result=relevantPassages(content,'quantum error correction','https://example.org/paper');
  expect(result.length).toBeGreaterThan(0);expect(result[0].text).toContain('stabilizer');expect(content.slice(result[0].startIndex,result[0].endIndex)).toBe(result[0].text);expect(result[0].citationUrl).toContain('https://example.org/paper#:~:text=');
 });
 it('does not wait for a stalled hosted provider after usable content arrives',async()=>{
  let cancelled=false;const start=Date.now();
  const result=await runPipeline('https://example.org/',[
   {name:'fast',tier:2,fetch:async()=>({content:'Readable full document',source:'fast',quality:.8,timing:1})},
   {name:'stalled',tier:2,fetch:()=>new Promise((_,reject)=>requestSignal()!.addEventListener('abort',()=>{cancelled=true;reject(new Error('cancelled'));},{once:true}))},
  ]);
  expect(result.result.source).toBe('fast');expect(Date.now()-start).toBeLessThan(800);expect(cancelled).toBe(true);
 });
});
