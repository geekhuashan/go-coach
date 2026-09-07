// Called only after the Worker's household-session check; never touches D1.
const BASE_HEADERS={
 'Cache-Control':'private, no-store',
 'X-Content-Type-Options':'nosniff',
 'Accept-Ranges':'bytes'
};
function failure(request,status,message,extra={}){
 return new Response(request.method==='HEAD'?null:JSON.stringify({error:message}),{
  status,headers:{...BASE_HEADERS,'Content-Type':'application/json; charset=utf-8',...extra}
 });
}
function singleRange(value,size){
 if(value===null)return null;
 const match=/^bytes=(\d*)-(\d*)$/i.exec(value.trim());
 if(!match||(!match[1]&&!match[2]))throw new Error('Invalid range');
 const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
 if((first!==null&&!Number.isSafeInteger(first))||(last!==null&&!Number.isSafeInteger(last))||size===0)throw new Error('Invalid range');
 if(first===null){if(last===0)throw new Error('Invalid suffix');return {start:Math.max(0,size-last),end:size-1};}
 if(first>=size||(last!==null&&last<first))throw new Error('Unsatisfiable range');
 return {start:first,end:last===null?size-1:Math.min(last,size-1)};
}
export async function videoResponse(request,env){
 const match=/^\/api\/videos\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\.mp4$/.exec(new URL(request.url).pathname);
 if(!match)return failure(request,404,'视频不存在。');
 if(!['GET','HEAD'].includes(request.method))return failure(request,405,'请求方法不支持。',{Allow:'GET, HEAD'});
 if(!env.VIDEOS)return failure(request,503,'视频存储暂未配置。');
 const key=`teaching/${match[1]}.mp4`;
 try{
  const metadata=await env.VIDEOS.head(key);
  if(!metadata)return failure(request,404,'视频不存在。');
  const size=metadata.size;
  if(!Number.isSafeInteger(size)||size<0)return failure(request,503,'视频暂时无法读取。');
  let range;
  try{range=singleRange(request.headers.get('Range'),size);}
  catch{return failure(request,416,'请求的视频范围无效。',{'Content-Range':`bytes */${size}`});}
  const status=range?206:200,length=range?range.end-range.start+1:size;
  const headers={...BASE_HEADERS,'Content-Type':'video/mp4','Content-Length':String(length)};
  if(range)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;
  if(request.method==='HEAD')return new Response(null,{status,headers});
  // Keep the size/range metadata and streamed bytes on the same object version.
  const options={onlyIf:{etagMatches:metadata.etag}};
  if(range)options.range={offset:range.start,length};
  const object=await env.VIDEOS.get(key,options);
  if(!object)return failure(request,404,'视频不存在。');
  if(!object.body)return failure(request,503,'视频正在更新，请稍后重试。');
  return new Response(object.body,{status,headers});
 }catch{return failure(request,503,'视频暂时无法读取，请稍后重试。');}
}
