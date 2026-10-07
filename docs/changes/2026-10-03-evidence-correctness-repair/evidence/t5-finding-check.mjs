import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('./tree/packages/chart/src/index.ts',import.meta.url),'utf8');
const block=source.slice(source.indexOf('export function freezeDerivedFinding('),source.indexOf('export async function getProjectAccess('));
const header=source.slice(source.indexOf('export class ChartServiceError'),source.indexOf('/** Legacy arrays'));
// Extract exact snapshot function bodies. Only the existing logical finding builder
// is substituted to observe forwarding; this is not a buildEvidenceFinding test.
const text='import {createHash} from "node:crypto";\n'+header+block+'\nfunction buildEvidenceFinding(spec,summary){return JSON.stringify({spec,summary});}';
const {freezeDerivedFinding:freeze,findingForGenerationJob:find}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(text,{mode:'transform'})).toString('base64'));
const original={id:'e1',finding:'已审核发现'};
const frozen=freeze('r1',original);
const job={operation:'edit',baseRevisionId:'r1',editPatch:{title:'new'},generationAudit:{derivedFinding:frozen}};
original.finding='入队后修改';
assert.equal(find(job,{},null),'已审核发现');
assert.equal(find(JSON.parse(JSON.stringify(job)),{},null),'已审核发现');
for(const evidence of [undefined,{id:'e1',finding:''},{id:'e1',finding:'  '}])assert.throws(()=>freeze('r1',evidence),{code:'REVISION_PROVENANCE_INCOMPLETE'});
for(const broken of [{...job,generationAudit:null},{...job,baseRevisionId:'r2'},{...job,generationAudit:{derivedFinding:{...frozen,finding:'changed'}}}])assert.throws(()=>find(broken,{},null),{code:'REVISION_PROVENANCE_INCOMPLETE'});
const spec={fresh:'spec'},summary={fresh:'summary'};
for(const editPatch of [{transformPlan:{}},{encodings:{}}])assert.equal(find({...job,editPatch},spec,summary),JSON.stringify({spec,summary}));
console.log('PASS: frozen source mutation + serialized retry; missing/blank/source mismatch/hash corruption rejected; transform/encoding edits forward fresh spec+summary');
