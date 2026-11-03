// Manual real-network test. Not imported by pnpm test. Never prints credentials or raw Google errors.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const mode=process.argv[2];
if(!['--smoke-only','--integration-only'].includes(mode)){
  console.log('Run after pnpm test: node apps/api/scripts/smoke-google-goal-match.cjs --smoke-only (then --integration-only)');
  process.exit(1);
}
process.loadEnvFile(path.join(root,'apps/api/.env'));
const {GoogleGoalMatchProvider}=require(path.join(root,'packages/ai/dist/index.js'));
const {prepareGoalMatchV4,validateGoalMatchAiOutput,reconcileGoalMatch}=require(path.join(root,'packages/scoring/dist/index.js'));
const {normalizeMetaProductAnalysis}=require(path.join(root,'packages/ai/dist/providers/meta/meta-product-normalizer.js'));
const {MOCK_META_PRODUCT_ANALYSIS}=require(path.join(root,'packages/ai/dist/providers/mock/mock-product-analysis.js'));
const {GoalMatchService}=require('../dist-test/modules/goal-match/goal-match.service.js');
const {CHIPS,eatHealthierPlan}=require('../dist-test/modules/goal-match/test/goal-match-v4.fixtures.js');
const {Logger}=require(path.join(root,'node_modules/@nestjs/common'));
Logger.overrideLogger(false);
const reportFile=path.join(root,'docs/goal-match-google-live-results.json');
const key=process.env.GOOGLE_API_KEY??'';
const config={apiKey:key,project:process.env.GOOGLE_CLOUD_PROJECT,location:process.env.GOOGLE_CLOUD_LOCATION,
  model:process.env.GOOGLE_GEMINI_MODEL};
const safe=value=>{
  const text=JSON.stringify(value,null,2);
  return key?text.replaceAll(key,'[REDACTED]'):text;
};
function save(report){const text=safe(report);if(key && text.includes(key))throw Error('Unsafe report');fs.writeFileSync(reportFile,text+'\n');}
const yogurt=normalizeMetaProductAnalysis(MOCK_META_PRODUCT_ANALYSIS,{productId:'google-smoke-yogurt',analyzedAt:'2026-10-29T00:00:00.000Z'});
const plan=eatHealthierPlan();
function realProvider(requests){
  return new GoogleGoalMatchProvider({...config,fetch:async(url,init)=>{
    const started=Date.now();
    try{
      // Always the real network. This wrapper only records safe diagnostics and parsed generated JSON.
      const response=await globalThis.fetch(url,init);
      const entry={status:response.status,latencyMs:Date.now()-started};
      try{
        const body=await response.clone().json();
        if(response.ok){
          const parts=body.candidates?.[0]?.content?.parts??[];
          const text=parts.filter(p=>p.thought!==true&&typeof p.text==='string').map(p=>p.text).join('');
          try{entry.rawAiOutput=JSON.parse(text);}catch{entry.generatedText=text;}
          entry.finishReason=body.candidates?.[0]?.finishReason??null;
        }else{
          entry.googleStatus=body.error?.status??null;
          entry.reasonCodes=(body.error?.details??[]).map(d=>d.reason).filter(r=>typeof r==='string'&&/^[A-Z_]+$/.test(r));
        }
      }catch{}
      requests.push(entry);return response;
    }catch{
      requests.push({status:null,latencyMs:Date.now()-started,networkFailure:true});
      throw Error('Google transport unavailable');
    }
  }});
}
(async()=>{
  if(mode==='--smoke-only'){
    const requests=[];const provider=realProvider(requests);const prepared=prepareGoalMatchV4(yogurt,plan);
    if(prepared.state!=='ready')throw Error('Fixture not ready');
    const started=Date.now();
    const previous=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):null;
    const report={model:provider.model,project:provider.project,location:provider.location,secret:'[REDACTED]',
      endpoint:'https://aiplatform.googleapis.com/v1/projects/'+provider.project+'/locations/'+provider.location+'/publishers/google/models/'+provider.model+':generateContent',
      smoke:null,integration:'not_run',
      ...(previous && previous.model!==provider.model?{previousSmoke:{model:previous.model,smoke:previous.smoke}}:{})};
    try{
      const output=await provider.evaluateGoalMatch(prepared.input);
      const validation=validateGoalMatchAiOutput(output,prepared.input);
      report.smoke={success:true,latencyMs:Date.now()-started,requests,rawAiOutput:output,validator:validation,
        deterministicScore:prepared.deterministic.value,
        reconciliation:reconcileGoalMatch({...prepared,ai:validation.valid?validation.output:null,
          validationAdjusted:validation.valid?validation.adjusted:false,aiStatus:validation.valid?undefined:'invalid',
          metadata:{model:provider.model,cacheHit:false}})};
    }catch(error){
      report.smoke={success:false,latencyMs:Date.now()-started,requests,error:{code:error.code??'unavailable',httpStatus:error.httpStatus??null}};
    }
    save(report);console.log(safe(report));
    if(!report.smoke.success || !report.smoke.validator?.valid)process.exitCode=2;
    return;
  }
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
  if(!report.smoke?.success || !report.smoke.validator?.valid)throw Error('Successful validated smoke required before integration');
  const requests=[];const provider=realProvider(requests);const service=new GoalMatchService(provider);
  if(report.model!==provider.model || report.project!==provider.project || report.location!==provider.location)throw Error('Smoke configuration changed');
  const first=await service.evaluate(yogurt,plan),repeat=await service.evaluate(yogurt,plan);
  const yogurtRequests=requests.length;
  const chips=await service.evaluate(CHIPS,plan);
  report.integration={yogurt:{first,repeat,httpRequests:yogurtRequests,requests:requests.slice(0,yogurtRequests)},
    chips:{result:chips,requests:requests.slice(yogurtRequests)},totalHttpRequests:requests.length};
  for(const [name,product] of [['yogurt',yogurt],['chips',CHIPS]]){
    const prepared=prepareGoalMatchV4(product,plan);
    for(const request of report.integration[name].requests)
      if(request.rawAiOutput)request.validator=validateGoalMatchAiOutput(request.rawAiOutput,prepared.input);
  }
  save(report);console.log(safe(report.integration));
})().catch(()=>{console.error('Google manual test could not complete; no credentials or upstream error text were printed.');process.exitCode=1;});
