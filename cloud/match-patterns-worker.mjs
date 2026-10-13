import {analyzeMatchPatterns} from './match-patterns.mjs';
// Replaying full games runs off the UI thread, never in the Cloudflare request.
self.onmessage=event=>{
 try{const {state,catalog=[],profileId}=event.data||{};self.postMessage(analyzeMatchPatterns(state,{catalog,profileId}));}
 catch{self.postMessage({error:'这盘棋暂时无法生成棋型回看，请稍后重试。'});}
};
