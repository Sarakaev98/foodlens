import assert from 'node:assert/strict';
import { it } from 'node:test';
import { PageFetcher } from '../web/page-fetcher';
import { TavilySearch, TavilyCreditBudget } from '../web/tavily-search';
it('the shared deadline aborts actual Tavily/page transports and prevents requests after expiry',async()=>{
 for(const kind of ['search','extract','page']){
  const controller=new AbortController();let calls=0,received:AbortSignal|undefined;
  const transport=(async(_url,init)=>{calls++;received=init!.signal!;return new Promise<Response>((_resolve,reject)=>received!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}) as typeof fetch;
  const search=new TavilySearch({apiKey:'fake',budget:new TavilyCreditBudget(10),logger:{log:()=>{},warn:()=>{}},fetch:transport});
  const pages=new PageFetcher({userAgent:'test',fetch:transport,resolve:async()=>['93.184.216.34']});
  const run=()=>kind==='page'?pages.fetchPage('https://example.com/p',controller.signal):kind==='search'?search.searchQuery('product',controller.signal):search.readPages(['https://example.com/p'],controller.signal);
  const pending=assert.rejects(run());for(let i=0;i<20;i++)await Promise.resolve();controller.abort();await pending;
  assert.equal(calls,1);assert.equal(received!.aborted,true);await assert.rejects(run());assert.equal(calls,1);
 }
});
