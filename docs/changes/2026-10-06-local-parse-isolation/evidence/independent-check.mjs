import assert from 'node:assert/strict';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=pathToFileURL(resolve(process.argv[2])+'/');
const {withIntakeCancellation}=await import(new URL('apps/api/src/intake-cancellation.ts',root));
const {createLocalParser}=await import(new URL('apps/api/src/local-parse.ts',root));
for(const name of ['empty','crash','malformed']) {
  const p=createLocalParser({workerUrl:new URL(`apps/api/test/fixtures/local-parse-${name}.mjs`,root)});
  await assert.rejects(p.parse({sourceType:'csv',bytes:Buffer.from('a\n1')}),{code:'DATA_PARSE_WORKER_FAILED'});
  await p.close(); console.log(`${name}: PASS`);
}
const p=createLocalParser({workerUrl:new URL('apps/api/test/fixtures/local-parse-busy.mjs',root),timeoutMs:100});
await assert.rejects(p.parse({sourceType:'csv',bytes:Buffer.from('a\n1')}),{code:'DATA_PARSE_TIMEOUT'});
await p.close(); console.log('timeout: PASS');
const q=createLocalParser({workerUrl:new URL('apps/api/test/fixtures/local-parse-busy.mjs',root)});
const c=new AbortController();
const pending=q.parse({sourceType:'csv',bytes:Buffer.from('a\n1'),signal:c.signal});
const rejected=assert.rejects(pending,{code:'DATA_PARSE_CANCELLED'});
await assert.rejects(q.parse({sourceType:'csv',bytes:Buffer.from('a\n1')}),{code:'DATA_PARSE_BUSY'});
setTimeout(()=>c.abort(),100); await rejected; await q.close(); console.log('busy and cancel: PASS');
let finish, fail;
const done=new Promise((r,j)=>{finish=r;fail=j;});
let called=false;
const server=http.createServer((req,res)=>{
  req.resume();
  req.on('end',()=>setTimeout(async()=>{
    try {
      await assert.rejects(withIntakeCancellation({raw:req,server:{}},{raw:res},async()=>{called=true;}),{name:'AbortError'});
      assert.equal(called,false);
      console.log(JSON.stringify({requestComplete:req.complete,requestAborted:req.aborted,responseDestroyed:res.destroyed,called,rejected:'AbortError'}));
      finish();
    } catch(error) {fail(error);}
  },120));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const client=http.request({host:'127.0.0.1',port:server.address().port,method:'POST',headers:{'Content-Length':2}});
client.on('error',()=>{});client.end('{}');setTimeout(()=>client.destroy(),50);
try {await done;} finally {await new Promise(r=>server.close(r));}
