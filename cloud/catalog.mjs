import builtins from './builtin-lessons.json' with {type:'json'};
import {availableLesson} from './curriculum.mjs';
import {studyPath} from './study-path.mjs';

export const builtinLessons=builtins.map(l=>({...l,legacy:['escape','capture','connect'].includes(l.id)}));
const builtinById=new Map(builtinLessons.map(l=>[l.id,l]));
const caches=new WeakMap(),snapshotDetails=new WeakMap();
const growthShapes=new WeakMap();
const rows=async stmt=>(await stmt.all()).results||[];
const missingSchema=error=>/no such table|does not exist/i.test(error?.message||'');
const version=row=>row?`${row.epoch}:${row.revision}`:'empty:0';
// Bump this presentation version if the bundled curriculum/curation changes.
const formatVersion='catalog-study-v1';
export function catalogChanged(){return Object.assign(new Error('题库已更新，正在重新读取。'),{catalogChanged:true,status:503})}
export async function catalogVersion(env,hh){
 try{const row=await env.DB.prepare('SELECT epoch,revision FROM catalog_versions WHERE household_id=?').bind(hh).first();return {token:formatVersion+':'+version(row),row};}
 catch(error){if(missingSchema(error))return null;throw error}
}
export async function explanationVersion(env,hh,profileId){
 try{return version(await env.DB.prepare('SELECT epoch,revision FROM explanation_versions WHERE household_id=? AND profile_id=?').bind(hh,profileId).first())}
 catch(error){if(missingSchema(error))return null;throw error}
}
export async function syncSnapshot(env,hh,proposed){
 const selection='FROM households h JOIN profiles p ON p.household_id=h.id',order=" WHERE h.id=? ORDER BY CASE WHEN p.id=? THEN 0 WHEN p.id='parent' THEN 1 ELSE 2 END,p.created_at,p.id LIMIT 1";
 try{
  const row=await env.DB.prepare('SELECT h.revision,p.id AS profile_id,c.epoch AS catalog_epoch,c.revision AS catalog_revision,e.epoch AS explanation_epoch,e.revision AS explanation_revision '+selection+' LEFT JOIN catalog_versions c ON c.household_id=h.id LEFT JOIN explanation_versions e ON e.household_id=h.id AND e.profile_id=p.id'+order).bind(hh,proposed||'').first();
  if(!row)return {revision:0,profile_id:'',catalog_revision:null,explanation_revision:null,requires_refresh:true};
  return {revision:row.revision,profile_id:row.profile_id,catalog_revision:formatVersion+':'+version(row.catalog_epoch?{epoch:row.catalog_epoch,revision:row.catalog_revision}:null),explanation_revision:version(row.explanation_epoch?{epoch:row.explanation_epoch,revision:row.explanation_revision}:null),requires_refresh:false};
 }catch(error){
  if(!missingSchema(error))throw error;
  const row=await env.DB.prepare('SELECT h.revision,p.id AS profile_id '+selection+order).bind(hh,proposed||'').first();
  return {revision:row?.revision||0,profile_id:row?.profile_id||'',catalog_revision:null,explanation_revision:null,requires_refresh:true};
 }
}
function householdCache(env){let cache=caches.get(env.DB);if(!cache){cache=new Map();caches.set(env.DB,cache)}return cache}
export async function loadCatalog(env,hh){
 const cache=householdCache(env),previous=cache.get(hh),current=await catalogVersion(env,hh);
 if(current){
  if(previous?.version===current.token)return previous.catalog;
  // One statement binds every directory row to the generation it was read from.
  const entries=await rows(env.DB.prepare('SELECT v.epoch,v.revision,c.id,c.index_json FROM catalog_versions v LEFT JOIN lesson_catalog c ON c.household_id=v.household_id WHERE v.household_id=? ORDER BY c.id LIMIT 2048').bind(hh));
  const token=formatVersion+':'+version(entries[0]),catalog=Object.freeze([...builtinLessons,...entries.filter(r=>r.id!==null).map(r=>JSON.parse(r.index_json))]);
  const details={version:token,catalog,full:new Map(),publicText:null};cache.set(hh,details);snapshotDetails.set(catalog,details);return catalog;
 }
 // Until the additive migration is installed, preserve the original exact-text
 // comparison, including same-length direct SQL edits without a family revision.
 const texts=(await rows(env.DB.prepare('SELECT lesson_json FROM lessons WHERE household_id=? ORDER BY id LIMIT 2048').bind(hh))).map(r=>r.lesson_json);
 if(previous?.texts&&texts.length===previous.texts.length&&texts.every((text,i)=>text===previous.texts[i]))return previous.catalog;
 const catalog=Object.freeze([...builtinLessons,...texts.map(text=>JSON.parse(text))]),details={version:null,texts,catalog,publicText:null};cache.set(hh,details);snapshotDetails.set(catalog,details);return catalog;
}
export function snapshotVersion(catalog){return snapshotDetails.get(catalog)?.version??null}
// Growth needs real positions to avoid awarding rotated copies twice. Keep the
// small geometry projection per catalog generation; warm responses add no SQL.
export async function growthCatalog(env,hh,catalog,evidence){
 const details=snapshotDetails.get(catalog);if(!details?.version)return catalog;
 let cache=growthShapes.get(catalog);if(!cache){cache={shapes:new Map(),projection:null};growthShapes.set(catalog,cache);}const shapes=cache.shapes;
 const byId=new Map(catalog.map(lesson=>[lesson.id,lesson]));
 const missing=[...new Set(evidence.map(record=>record.lesson_id))].filter(id=>byId.has(id)&&!Array.isArray(byId.get(id).stones)&&!shapes.has(id));
 for(let offset=0;offset<missing.length;offset+=90){
  const ids=missing.slice(offset,offset+90);
  const entries=await rows(env.DB.prepare(`SELECT v.epoch,v.revision,l.id,json_extract(l.lesson_json,'$.size') AS size,json_extract(l.lesson_json,'$.to_play') AS to_play,json_extract(l.lesson_json,'$.stones') AS stones FROM catalog_versions v LEFT JOIN lessons l ON l.household_id=v.household_id AND l.id IN (${ids.map(()=>'?').join(',')}) WHERE v.household_id=?`).bind(...ids,hh));
  if(formatVersion+':'+version(entries[0])!==details.version)throw catalogChanged();
  for(const row of entries)if(row.id){shapes.set(row.id,{size:row.size,to_play:row.to_play,...(row.stones?{stones:JSON.parse(row.stones)}:{})});cache.projection=null;}
 }
 if(!cache.projection)cache.projection=Object.freeze(catalog.map(lesson=>shapes.has(lesson.id)?{...lesson,...shapes.get(lesson.id)}:lesson));return cache.projection;
}
export async function fullLesson(env,hh,catalog,id){
 const builtin=builtinById.get(id);if(builtin)return builtin;
 const details=snapshotDetails.get(catalog);if(!details?.version)return catalog.find(l=>l.id===id)||null;
 if(details.full.has(id)){const lesson=details.full.get(id);details.full.delete(id);details.full.set(id,lesson);return lesson;}
 const row=await env.DB.prepare('SELECT v.epoch,v.revision,l.lesson_json FROM catalog_versions v LEFT JOIN lessons l ON l.household_id=v.household_id AND l.id=? WHERE v.household_id=?').bind(id,hh).first();
 if(formatVersion+':'+version(row)!==details.version)throw catalogChanged();
 const lesson=row?.lesson_json?JSON.parse(row.lesson_json):null;if(lesson){details.full.set(id,lesson);if(details.full.size>32)details.full.delete(details.full.keys().next().value);}return lesson;
}
export function lessonListItem(l){const out={};for(const k of ['id','title','prompt','hint','skill','difficulty','size','sequence','family_id','variant','source','concept','choices'])if(l[k]!==undefined)out[k]=l[k];if(l.objective?.kind==='choose_answer')out.interaction='choose_answer';const path=studyPath(l);if(path)out.study_path=path;return out}
export async function publicCatalogText(env,hh,catalog){
 const details=snapshotDetails.get(catalog);if(details?.publicText!==null&&details?.publicText!==undefined)return details.publicText;
 let list;
 if(details?.version){
  const entries=await rows(env.DB.prepare('SELECT v.epoch,v.revision,c.id,c.public_json,c.objective_kind FROM catalog_versions v LEFT JOIN lesson_catalog c ON c.household_id=v.household_id WHERE v.household_id=? ORDER BY c.id LIMIT 2048').bind(hh));
  if(formatVersion+':'+version(entries[0])!==details.version)throw catalogChanged();
  list=[...builtinLessons,...entries.filter(r=>r.id!==null).map(r=>({...JSON.parse(r.public_json),objective:{kind:r.objective_kind}}))];
 }else list=catalog;
 const visibleIds=new Set(catalog.filter(availableLesson).map(l=>l.id));const text=JSON.stringify(list.filter(l=>visibleIds.has(l.id)).map(lessonListItem));if(details)details.publicText=text;return text;
}
