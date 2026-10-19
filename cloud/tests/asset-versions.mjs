// Browsers keep `?v=` static files for a year. A changed file must carry a new version.
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../../static/',import.meta.url),manifestUrl=new URL('./asset-versions.json',import.meta.url);
const REF=/(["'])(\.?\/[A-Za-z0-9_./-]+)\?v=([A-Za-z0-9_.-]+)\1/g;

export function scanAssetVersions(){
 const found={},errors=[];
 for(const name of readdirSync(root).filter(name=>/\.(html|js)$/.test(name)).sort()){
  for(const [,,ref,v] of readFileSync(new URL(name,root),'utf8').matchAll(REF)){
   const path='/'+ref.replace(/^\.?\//,'');
   if(found[path]&&found[path].v!==v)errors.push(`${path} 在不同文件里版本不一致：${found[path].v} / ${v}`);
   found[path]||={v,sha256:createHash('sha256').update(readFileSync(new URL('.'+path,root))).digest('hex')};
  }
 }
 return {assets:Object.fromEntries(Object.entries(found).sort(([a],[b])=>a.localeCompare(b))),errors};
}
export const readManifest=()=>JSON.parse(readFileSync(manifestUrl,'utf8'));
export function compareAssetVersions(current,recorded){
 const problems=[];
 for(const [path,entry] of Object.entries(current)){
  const old=recorded[path];
  if(old&&old.v===entry.v&&old.sha256!==entry.sha256)problems.push(`${path} 内容变了但 ?v=${entry.v} 没有升级`);
  else if(!old||old.v!==entry.v)problems.push(`${path} 的版本记录需要更新`);
 }
 for(const path of Object.keys(recorded))if(!current[path])problems.push(`${path} 已不再引用，需要更新版本记录`);
 return problems;
}

if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv.includes('--write')){
 const {assets,errors}=scanAssetVersions();let recorded={};try{recorded=readManifest()}catch{}
 const stale=compareAssetVersions(assets,recorded).filter(problem=>problem.includes('没有升级'));
 if(errors.length||stale.length){console.error([...errors,...stale].join('\n')+'\n先升级引用这些文件的 ?v= 版本号，再运行本命令。');process.exit(1);}
 writeFileSync(manifestUrl,JSON.stringify(assets,null,1)+'\n');console.log(`已记录 ${Object.keys(assets).length} 个带版本号的静态文件。`);
}
