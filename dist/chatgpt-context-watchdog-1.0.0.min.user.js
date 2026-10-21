// ==UserScript==
// @name         ChatGPT Context Watchdog (Local)
// @namespace    local.chatgpt.context.watchdog
// @version      1.0.0
// @author       f0rset1
// @description  Local-only context size watchdog for ChatGPT. One guarded, same-origin cache-only favicon lookup; no chat-data network traffic.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
  ChatGPT Context Watchdog (Local)

  Community attribution:
  Inspired by the architecture and ideas of:
  "ChatGPT-Token_Counter" by Pushpak1203
  https://github.com/Pushpak1203/ChatGPT-Token_Counter

  Design constraints:
  - Chromium; one self-contained, local-only Tampermonkey userscript
  - DOM observation and bounded one-shot checks; no network interception,
    server downloads or periodic polling; one favicon cache-only lookup is allowed
  - Per-chat UUID-keyed state:v2 ledger; ordinary capture does not overwrite
    known messages; explicit Edit/Regenerate and confirmed Repair are exceptions
  - SPA route and DOM ownership checks prevent cross-chat/ghost capture
  - Read-only Audit; Repair and Undo require explicit confirmation
  - User attachments, heuristic image estimates and large-paste fallback
  - Local context budgets, calibration and HANDOFF without model internals

  Scope and limitations:
  First-seen, confirmed-complete messages may be backfilled on load or scroll.
  Partially hydrated messages are deferred; ordinary scans skip known UUIDs.
  Explicit edits/regenerations can update a known UUID after completion.
  Audit may remeasure observed messages for comparison but never edits the ledger.
  The estimates use observable locally recorded chat text and accessible user
  attachments; they are not the model's actual context utilization.
  Forecasts are heuristic, and ambiguous message UUIDs are deferred.
  The script cannot inspect hidden system context, actual Project retrieval,
  internal compaction or the model's true remaining context window.
*/
(()=>{var c="cgpt-context-watchdog",he=`${c}:settings:v1`,_t=`${c}:state:v2:`,jt=`${c}:ended-history:v2`,Xi=75,Li=256,ve=Object.freeze({markdown:'[class*="MarkdownRoot-"]',userText:".whitespace-pre-wrap",searchUnit:"[data-chatgpt-search-unit-key]",searchMessageIds:"[data-chatgpt-search-message-ids]"}),yi="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",io=new RegExp(yi,"gi"),no=new RegExp(`^${yi}$`,"i"),oo=new RegExp(`^msg:(${yi})$`,"i"),ao=new RegExp(`(?:^|/)c/(${yi})(?:/|$)`,"i"),st=4e3,At=`Create a concise, self-contained handoff for continuing this conversation in a new chat. Use the conversation's language.

In short bullets, capture the goal or topic, current state, key facts, decisions and their reasons, user preferences and constraints, confirmed results, and open questions. Prioritize the latest user corrections and requests. Preserve exact names, values, paths, and links when relevant, and note any files or sources the new chat will need.

Use only the context available to you. Flag gaps and uncertainty, and omit repetition and irrelevant details. End with a ready-to-paste request for the next step.`;function vi(e){return typeof e=="string"&&e.trim().length>0&&e.length<=st}var xe=Object.freeze([Object.freeze({key:"metadataOnlyOptimisticBase",default:300,min:50,max:3e3,integer:!0,label:"Optimistic base (tokens)",hint:"Starting optimistic token allowance before file-size and type adjustments.",field:"metadataOptBase"}),Object.freeze({key:"metadataOnlyOptimisticSizeFactor",default:1200,min:100,max:6e3,integer:!0,label:"Optimistic size factor",hint:"Optimistic size contribution per log2(1 + file size in MiB), before file-type weighting.",field:"metadataOptSize"}),Object.freeze({key:"metadataOnlyOptimisticMax",default:1e4,min:1e3,max:3e4,integer:!0,label:"Optimistic maximum",hint:"Upper limit for the optimistic metadata-only token estimate, after file-type weighting.",field:"metadataOptMax"}),Object.freeze({key:"metadataOnlyPessimisticBase",default:2e3,min:200,max:12e3,integer:!0,label:"Pessimistic base (tokens)",hint:"Starting pessimistic token allowance before file-size and type adjustments.",field:"metadataPessBase"}),Object.freeze({key:"metadataOnlyPessimisticSizeFactor",default:9e3,min:500,max:3e4,integer:!0,label:"Pessimistic size factor",hint:"Pessimistic size contribution per log2(1 + file size in MiB), before file-type weighting.",field:"metadataPessSize"}),Object.freeze({key:"metadataOnlyPessimisticMax",default:5e4,min:5e3,max:15e4,integer:!0,label:"Pessimistic maximum",hint:"Upper limit for the pessimistic metadata-only token estimate, after file-type weighting.",field:"metadataPessMax"}),Object.freeze({key:"metadataOnlyTypeFactorSpreadsheet",default:1.15,min:.25,max:2,integer:!1,label:"Spreadsheets",hint:"Scales both estimates for CSV, TSV, XLS, XLSX and ODS files when content is not read.",field:"metadataSpreadsheet"}),Object.freeze({key:"metadataOnlyTypeFactorTextCode",default:1,min:.25,max:2,integer:!1,label:"Text / code",hint:"Scales both estimates for text and code files when content is not read.",field:"metadataTextCode"}),Object.freeze({key:"metadataOnlyTypeFactorPdf",default:1,min:.25,max:2,integer:!1,label:"PDF",hint:"Scales both estimates for PDF files when content is not read.",field:"metadataPdf"}),Object.freeze({key:"metadataOnlyTypeFactorDocument",default:.85,min:.25,max:2,integer:!1,label:"Documents",hint:"Scales both estimates for DOC, DOCX, ODT and RTF files when content is not read.",field:"metadataDocument"}),Object.freeze({key:"metadataOnlyTypeFactorPresentation",default:.8,min:.25,max:2,integer:!1,label:"Presentations",hint:"Scales both estimates for PPT, PPTX and ODP files when content is not read.",field:"metadataPresentation"}),Object.freeze({key:"metadataOnlyTypeFactorArchive",default:.5,min:.25,max:2,integer:!1,label:"Archives",hint:"Scales both estimates for ZIP, 7z, RAR, GZ and TAR files when content is not read.",field:"metadataArchive"}),Object.freeze({key:"metadataOnlyTypeFactorOther",default:.65,min:.25,max:2,integer:!1,label:"Other",hint:"Scales both estimates for file types outside the other six groups.",field:"metadataOther"})]);var M={conservativeBudget:8e4,normalBudget:12e4,optimisticBudget:18e4,messageOverhead:8,hiddenOptimistic:4e3,hiddenPessimistic:16e3,averageImageTokens:2e3,historicalFileFallbackTokens:1e3,localFileParsingLimitMiB:Xi,historyPriorStrength:4,...Object.fromEntries(xe.map(e=>[e.key,e.default])),budgetCalibrationBase:null,budgetCalibrationWeight:0,fileOptimisticPct:25,filePessimisticPct:75,imageOptimisticPct:20,imagePessimisticPct:80,pastedMinChars:1e4,pastedEnglishCharsPerToken:4,pastedCyrillicCharsPerToken:2.75,proseCyrillicCharsPerToken:2.38,proseLatinCharsPerToken:3.45,proseDigitsCharsPerToken:2.6,prosePunctuationCharsPerToken:1.5,proseOtherCharsPerToken:1,proseMinTokensPerWord:1.45,codeCharsPerToken:2.3,handoffPrompt:At,badgePosition:null,viewStyle:"soft",viewTheme:"chatgpt",logoPreference:"openai",watchdogPaused:!1},Qi=new Set(["png","jpg","jpeg","webp","gif","bmp","avif","heic","heif","tif","tiff"]),en=new Set(["txt","md","markdown","csv","tsv","json","jsonl","xml","html","htm","js","mjs","cjs","ts","tsx","jsx","py","rb","php","java","kt","kts","c","cc","cpp","cxx","h","hpp","cs","go","rs","swift","scala","sh","bash","zsh","fish","ps1","sql","yaml","yml","toml","ini","cfg","conf","log","tex","r","lua","dart","vue","svelte","css","scss","less"]),ro=new Set([...en,"pdf","doc","docx","odt","rtf","xls","xlsx","ods","ppt","pptx","odp","zip","7z","rar","gz","tar"]),so={B:1,KB:1e3,MB:1e3**2,GB:1e3**3,KIB:1024,MIB:1024**2,GIB:1024**3};var T={enabled:!1,mutationBatches:0,mutations:0,queuedEvents:0,processedEvents:0,noChangeScans:0,duplicateTextMutations:0,timings:Object.create(null)},L={...M},w=null;function co(e,t){L=e,w=t}var ct=null,Xe={stop:!1,send:!1,actions:null},ke=null,D=new Map,H=new Map,tn=0,Qe=null,nn="startup",De=null,$t=new Map,lt=0;function Re(e){return L=e}function Fe(e){return ct=e}function lo(e){return w=e}function et(e){return Xe=e}function Ie(e){return ke=e}function le(e){return Qe=e}function we(e){return lt=e}function be(e){return nn=e}function uo(e){return tn=e}function xi(e){return De=e}function po(e){return $t=e}var qt=new WeakMap,Ne=new WeakSet,Kt=new WeakMap,Se=new WeakSet,on=new WeakSet,mo=null,ki=!1,an=!1,Pt=null,dt=!1,Gt=null,te=0;function Be(e){return Gt=e}function ze(e){return Pt=e}function ut(e){return dt=e}function Ce(e){return te=e}function pt(e){return qt=e}function fo(e){return Ne=e}function Te(e){return Kt=e}function go(e){return Se=e}function ho(e){mo=e}function wo(){mo?.()}function rn(e){return ki=e}function bo(e){return an=e}var R=new Set,K=new Map,mt=new WeakMap;function Si(){mt=new WeakMap}var Le=new Map,oe=new Map,_=new Map;function F(e){return Le.get(e)||0}function Mt(e){if(e){Le.set(e,F(e)+1);for(let[t,i]of _)i.chatKey===e&&_.delete(t)}}var sn=!1,Lo=null;function yo(e){Lo=e}function vo(e){Lo?.(e,12e3)}function de(e){return sn=e}var x={phase:"unknown",work:{initial:!0,backfill:!1,completion:!1},route:null},Y=new Map,ue=0;function Ue(e){return ue=e}var Ci=!1,xo=null;function C(){return L.watchdogPaused===!0||!Ci}function Ti(){return Ci}function cn(e){let t=!!e;return t===Ci?!1:(Ci=t,!0)}function ko(e){xo=e}function Ai(){xo?.()}var So="form[data-chatgpt-composer]",zr='[contenteditable="true"][role="textbox"]';function Ae(e){return!!e?.isConnected&&!e.closest('[hidden], [inert], [aria-hidden="true"]')&&e.getClientRects().length>0&&getComputedStyle(e).visibility==="visible"}function $i(e){if(!Ae(e))return!1;if(e.matches(So))return!0;for(let t of e.querySelectorAll("#prompt-textarea"))if(Ae(t))return!0;if(!Ae(e.closest("main")))return!1;for(let t of e.querySelectorAll(zr))if(Ae(t))return!0;return!1}function Co(e){let t=e?.closest?.("form");return $i(t)?t:null}function To(){for(let e of document.querySelectorAll("main"))if(Ae(e)){for(let t of e.querySelectorAll("form"))if($i(t))return t}for(let e of document.querySelectorAll(So))if($i(e))return e;for(let e of document.querySelectorAll("#prompt-textarea")){let t=e.closest("form");if(Ae(e)&&$i(t))return t}return null}function Ao(e,t,i=null){let n=e.target;if(e.type==="attributes"){if(!(n instanceof Element))return!1;if(n.matches('main, form, [role="textbox"], [contenteditable]'))return!0;if(t)return n.contains(t);if(i?.has(n))return i.get(n);let o=!!n.querySelector('main, form, [role="textbox"][contenteditable], #prompt-textarea');return i?.set(n,o),o}if(e.type!=="childList")return!1;if(t&&!t.isConnected)return!0;for(let o of[...e.addedNodes,...e.removedNodes])if(o instanceof Element&&(o.matches('main, form, [role="textbox"], [contenteditable]')||o.childElementCount>0&&o.querySelector('main, form, [role="textbox"][contenteditable]')||t&&o.contains(t)))return!0;return!1}var E=[],pe="context",dn=!1,ft=!1,a=null,Et=null,ln=null;function $o(e){ln=e}function Vt(){if(!ln)throw new Error("Watchdog UI has not been initialized");return ln()}function Po(e){return pe=e}function Mo(e){return a=e}function Eo(e){return ft=e}function Oo(e){return dn=e}function Do(e){return Et=e}function un(){T.mutationBatches=T.mutations=0,T.queuedEvents=T.processedEvents=T.noChangeScans=0,T.duplicateTextMutations=0,T.timings=Object.create(null)}function W(){return T.enabled?performance.now():null}function U(e,t){if(t===null)return;let i=performance.now()-t,n=T.timings[e]||(T.timings[e]={count:0,total:0,max:0});n.count++,n.total+=i,n.max=Math.max(n.max,i);let o=n.recent||(n.recent=[]);o.length===64&&o.shift(),o.push(i)}function tt(e){if(!T.enabled)return localStorage.getItem(e);let t=performance.now();try{return localStorage.getItem(e)}finally{U("storageRead",t)}}var ie={name:"none",visible:0,raw:0,collapsed:0,ambiguous:0,noLayout:0};function G(){let e=location.pathname.match(ao);return e?`chat:${e[1].toLowerCase()}`:null}function $e(e=w){return _t+encodeURIComponent(e)}function pn(e=w){return e&&R.has(e)?"CORRUPT LEDGER \u2014 read-only. Export/backup the raw localStorage entry before resetting.":dt?"CORRUPT CALIBRATION HISTORY \u2014 raw bytes preserved; recording blocked.":K.has(he)?K.get(he):e&&K.get(e)||""}function Z(e,t,i=null){e&&K.set(e,t),i&&console.warn("[Context Watchdog] storage problem:",i),sn||(de(!0),vo(t))}function Pe(e){return{chatKey:e,messages:{},repairHistory:[],attachmentLedgerVersion:2,files:{},domImages:{},updatedAt:0}}function fn(e){return!!e&&typeof e=="object"&&!Array.isArray(e)}function mn(e,t,i=!1){return Object.hasOwn(e,t)?typeof e[t]=="number"&&Number.isFinite(e[t])&&e[t]>=0:!i}function Io(e){return fn(e)&&mn(e,"tokens",!0)&&mn(e,"chars")&&(e.role===void 0||typeof e.role=="string")&&(e.fingerprint===void 0||typeof e.fingerprint=="string")}function Ro(e,t=!1){if(!fn(e))return!1;for(let i of t?["tokens","width","height","firstSeenAt","lastSeenAt"]:["tokens","size","durationSeconds","addedAt","historySeenAt"])if(!mn(e,i))return!1;return!0}function Fo(e){return Io(e)}function gt(e,t,i=JSON.parse){if(!t)return Pe(e);let n=i(t);if(!n||typeof n!="object"||Array.isArray(n)||!n.messages||typeof n.messages!="object"||Array.isArray(n.messages)||n.files!=null&&(typeof n.files!="object"||Array.isArray(n.files))||n.domImages!=null&&(typeof n.domImages!="object"||Array.isArray(n.domImages)))throw new Error("Unexpected state:v2 ledger structure");if(!Object.values(n.messages).every(Io)||n.attachmentLedgerVersion===2&&(!Object.values(n.files||{}).every(o=>Ro(o))||!Object.values(n.domImages||{}).every(o=>Ro(o,!0)))||n.repairHistory!==void 0&&(!Array.isArray(n.repairHistory)||!n.repairHistory.every(o=>fn(o)&&typeof o.id=="string"&&Fo(o.before)&&Fo(o.after))))throw new Error("Corrupt state:v2 nested ledger record");return{...Pe(e),messages:n.messages,repairHistory:Array.isArray(n.repairHistory)?n.repairHistory:[],files:n.attachmentLedgerVersion===2?n.files||{}:{},domImages:n.attachmentLedgerVersion===2?n.domImages||{}:{},updatedAt:n.updatedAt||0}}function y(e=w){let t=W();try{if(!e)return ct||Fe(Pe(null)),ct;if(R.has(e))return Pe(e);try{let i=tt($e(e)),n=gt(e,i,o=>{let s=W();try{return JSON.parse(o)}finally{U("ledgerParse",s)}});return mt.set(n,{raw:i,epoch:F(e)}),n}catch(i){return R.add(e),Z(e,"CORRUPT LEDGER: writes blocked. Back up the original storage entry.",i),Pe(e)}}finally{U("ledgerLoad",t)}}var Ot=Object.freeze({conservativeBudget:{min:1e4,max:1e9,integer:!0},normalBudget:{min:1e4,max:1e9,integer:!0},optimisticBudget:{min:1e4,max:1e9,integer:!0},messageOverhead:{min:0,max:1e5,integer:!0},hiddenOptimistic:{min:0,max:1e8,integer:!0},hiddenPessimistic:{min:0,max:1e8,integer:!0},historyPriorStrength:{min:1,max:1e6,integer:!0},budgetCalibrationWeight:{min:0,max:1,integer:!1},averageImageTokens:{min:100,max:1e6,integer:!0},historicalFileFallbackTokens:{min:0,max:1e7,integer:!0},localFileParsingLimitMiB:{min:0,max:Li,integer:!0},fileOptimisticPct:{min:0,max:100,integer:!0},filePessimisticPct:{min:0,max:100,integer:!0},imageOptimisticPct:{min:0,max:100,integer:!0},imagePessimisticPct:{min:0,max:100,integer:!0},pastedMinChars:{min:0,max:1e7,integer:!0},pastedEnglishCharsPerToken:{min:.25,max:20,integer:!1},pastedCyrillicCharsPerToken:{min:.25,max:20,integer:!1},proseCyrillicCharsPerToken:{min:.25,max:20,integer:!1},proseLatinCharsPerToken:{min:.25,max:20,integer:!1},proseDigitsCharsPerToken:{min:.25,max:20,integer:!1},prosePunctuationCharsPerToken:{min:.25,max:20,integer:!1},proseOtherCharsPerToken:{min:.25,max:20,integer:!1},proseMinTokensPerWord:{min:0,max:10,integer:!1},codeCharsPerToken:{min:.25,max:20,integer:!1},...Object.fromEntries(xe.map(e=>[e.key,{min:e.min,max:e.max,integer:e.integer}]))});function gn(e){let t=Ot[e],i=M[e];if(!t||!Number.isFinite(i))throw new Error("Unknown numeric setting: "+e);let n=i===0?0:10**(Math.floor(Math.log10(Math.abs(i)))-2);return Number(Math.max(t.integer?1:.01,n).toPrecision(12))}function hn(e,t){let i=Ot[e];if(!i||!Number.isFinite(t)||t<i.min||t>i.max)return null;let n=gn(e),o=M[e],s=Math.ceil((i.min-o)/n-1e-9),r=Math.floor((i.max-o)/n+1e-9),d=Math.min(r,Math.max(s,Math.round((t-o)/n+1e-10))),l=(String(n).split(".")[1]||"").length;return Number((o+d*n).toFixed(l))}function it(){try{let e=JSON.parse(tt(he)||"{}"),t=e&&typeof e=="object"&&!Array.isArray(e)?e:{},i=(r,d=M[r])=>{let l=Ot[r];if(!l)throw new Error("Missing numeric specification: "+r);let u=t[r];if(u==null||u==="")return d;let p=Number(u);return!Number.isFinite(p)||p<l.min||p>l.max?d:l.integer?Math.round(p):p},n=i("normalBudget"),o={...M,conservativeBudget:i("conservativeBudget",Math.max(1e4,Math.round(n*2/3))),normalBudget:n,optimisticBudget:i("optimisticBudget",Math.min(1e9,Math.round(n*1.5))),messageOverhead:i("messageOverhead"),hiddenOptimistic:i("hiddenOptimistic"),hiddenPessimistic:i("hiddenPessimistic"),historyPriorStrength:i("historyPriorStrength"),budgetCalibrationWeight:i("budgetCalibrationWeight"),averageImageTokens:i("averageImageTokens"),historicalFileFallbackTokens:i("historicalFileFallbackTokens"),localFileParsingLimitMiB:i("localFileParsingLimitMiB"),pastedMinChars:i("pastedMinChars"),pastedEnglishCharsPerToken:i("pastedEnglishCharsPerToken"),pastedCyrillicCharsPerToken:i("pastedCyrillicCharsPerToken"),proseCyrillicCharsPerToken:i("proseCyrillicCharsPerToken"),proseLatinCharsPerToken:i("proseLatinCharsPerToken"),proseDigitsCharsPerToken:i("proseDigitsCharsPerToken"),prosePunctuationCharsPerToken:i("prosePunctuationCharsPerToken"),proseOtherCharsPerToken:i("proseOtherCharsPerToken"),proseMinTokensPerWord:i("proseMinTokensPerWord"),codeCharsPerToken:i("codeCharsPerToken"),badgePosition:t.badgePosition&&Number.isFinite(t.badgePosition.left)&&Number.isFinite(t.badgePosition.top)?{left:t.badgePosition.left,top:t.badgePosition.top}:null,handoffPrompt:vi(t.handoffPrompt)?t.handoffPrompt:M.handoffPrompt,viewStyle:["soft","sharp"].includes(t.viewStyle)?t.viewStyle:M.viewStyle,viewTheme:["light","dark","system","chatgpt"].includes(t.viewTheme)?t.viewTheme:M.viewTheme,logoPreference:["openai","watchdog"].includes(t.logoPreference)?t.logoPreference:M.logoPreference,watchdogPaused:typeof t.watchdogPaused=="boolean"?t.watchdogPaused:!1};for(let r of xe)o[r.key]=i(r.key);if(o.metadataOnlyOptimisticBase>o.metadataOnlyPessimisticBase||o.metadataOnlyOptimisticSizeFactor>o.metadataOnlyPessimisticSizeFactor||o.metadataOnlyOptimisticMax>o.metadataOnlyPessimisticMax)for(let r of xe)o[r.key]=M[r.key];let s=t.budgetCalibrationBase;if(s&&typeof s=="object"&&!Array.isArray(s)){let r=Number(s.conservativeBudget),d=Number(s.normalBudget),l=Number(s.optimisticBudget);[r,d,l].every(u=>Number.isInteger(u)&&u>=1e4&&u<=1e9)&&r<=d&&d<=l&&(o.budgetCalibrationBase={conservativeBudget:r,normalBudget:d,optimisticBudget:l})}for(let r of["fileOptimisticPct","filePessimisticPct","imageOptimisticPct","imagePessimisticPct"])o[r]=i(r);return o.conservativeBudget<=o.normalBudget&&o.normalBudget<=o.optimisticBudget||(o.conservativeBudget=M.conservativeBudget,o.normalBudget=M.normalBudget,o.optimisticBudget=M.optimisticBudget,o.budgetCalibrationBase=null,o.budgetCalibrationWeight=0),o.hiddenPessimistic<o.hiddenOptimistic&&(o.hiddenOptimistic=M.hiddenOptimistic,o.hiddenPessimistic=M.hiddenPessimistic),o.fileOptimisticPct>o.filePessimisticPct&&(o.fileOptimisticPct=M.fileOptimisticPct,o.filePessimisticPct=M.filePessimisticPct),o.imageOptimisticPct>o.imagePessimisticPct&&(o.imageOptimisticPct=M.imageOptimisticPct,o.imagePessimisticPct=M.imagePessimisticPct),o}catch{return{...M}}}function No(e,t,i,n=JSON.parse){if(e&&!t)throw new Error("Ledger was reset in another tab");let o=gt(i.chatKey,e,n),s=gt(i.chatKey,t,n);if(Object.keys(o.messages).some(l=>!Object.hasOwn(s.messages,l)))throw new Error("Previously saved message IDs disappeared (possible chat reset)");let r={...s},d=(l,u)=>JSON.stringify(l)===JSON.stringify(u);for(let l of["messages","files","domImages"]){let u=o[l]||{},p=i[l]||{},m=s[l]||{},f={...m};for(let g of new Set([...Object.keys(u),...Object.keys(p)]))if(!d(p[g],u[g])){if(!d(m[g],u[g])&&!d(m[g],p[g]))throw new Error(`Concurrent ${l} change: ${g}`);Object.hasOwn(p,g)?f[g]=p[g]:delete f[g]}r[l]=f}if(!d(i.repairHistory,o.repairHistory)){if(!d(s.repairHistory,o.repairHistory)&&!d(s.repairHistory,i.repairHistory))throw new Error("Concurrent Audit repair history change");r.repairHistory=i.repairHistory}return r}function Zt(e,t,i,n,o=null,s=null){let r=W();try{try{let d,l=W();try{d=JSON.stringify(t)}finally{U("storageEncode",l)}let u=W();try{localStorage.setItem(e,d)}finally{U("storageCommit",u)}return s?.(d),!0}catch(d){return o?.(),Z(i,n,d),!1}}finally{U("storageWrite",r)}}function V(){return Zt(he,L,he,"STORAGE WRITE FAILED: settings were not saved.",null,()=>K.delete(he))}function ae(e){if(!e.chatKey)return e.attachmentLedgerVersion=2,e.updatedAt=Date.now(),Fe(e),!0;if(R.has(e.chatKey))return Z(e.chatKey,"CORRUPT LEDGER: writes blocked. Back up the original storage entry."),!1;if(!mt.has(e))return Z(e.chatKey,"STORAGE CONFLICT: missing ledger baseline; reload before retrying."),!1;let t=mt.get(e);if(t.epoch!==F(e.chatKey))return Z(e.chatKey,"STORAGE CONFLICT: missing ledger baseline after chat reset; rescan before retrying."),!1;let i=t.raw,n=e;try{let o=tt($e(e.chatKey));o!==i&&(n=No(i,o,e,s=>{let r=W();try{return JSON.parse(s)}finally{U("ledgerParse",r)}}))}catch(o){return Z(e.chatKey,`STORAGE CONFLICT: ${String(o?.message||o)}. Reload or rescan before retrying.`,o),!1}return n.attachmentLedgerVersion=2,n.updatedAt=Date.now(),Zt($e(e.chatKey),n,e.chatKey,"STORAGE WRITE FAILED: new counts were not saved.",null,o=>{mt.set(e,{raw:o,epoch:F(e.chatKey)})})?(n!==e?Object.assign(e,n):e.updatedAt=n.updatedAt,[..._.values()].some(o=>o.chatKey===e.chatKey)||(K.delete(e.chatKey),de(!1)),!0):!1}function We(e){let t=e?.closest?.(ve.searchUnit)||(e?.matches?.(ve.searchUnit)?e:null);if(!t||!t.closest?.("main"))return null;let i=t.getAttribute("data-chatgpt-search-unit-key")||"",n=/(?:^|:)(user|assistant)$/i.exec(i)?.[1]?.toLowerCase();return n?{unit:t,key:i,role:n}:null}function Pi(e){if(!e)return null;let t=[e.getAttribute("data-chatgpt-search-message-ids")];for(let n of e.querySelectorAll(ve.searchMessageIds))n.closest(ve.searchUnit)===e&&t.push(n.getAttribute("data-chatgpt-search-message-ids"));let i=new Set;for(let n of t)for(let o of String(n).matchAll(io))i.add(o[0].toLowerCase());return i.size===1?`msg:${[...i][0]}`:null}function He(e){let t=We(e);if(t)return t.role;let i=e.getAttribute?.("data-message-author-role")||e.getAttribute?.("data-message-role")||e.closest?.("[data-message-author-role]")?.getAttribute("data-message-author-role")||e.closest?.("[data-message-role]")?.getAttribute("data-message-role");return i==="user"||i==="assistant"?i:null}function Dt(e){return(e||"").replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,`

`).trim()}function ht(e){let t=2166136261;for(let i=0;i<e.length;i++)t^=e.charCodeAt(i),t=Math.imul(t,16777619);return(t>>>0).toString(16).padStart(8,"0")}var Bo=new Uint8Array(128);for(let e of".,!?;:'\"()[]{}<>@#$%^&*_=+~`|\\/-")Bo[e.charCodeAt(0)]=1;function Mi(e){if(!e)return 0;let t=0,i=0,n=0,o=0,s=0,r=0,d=!1;for(let u=0;u<e.length;u++){let p=e.charCodeAt(u);if(p>=9&&p<=13||p===32||p===160||p===5760||p>=8192&&p<=8202||p===8232||p===8233||p===8239||p===8287||p===12288||p===65279){d=!1;continue}d||(r++,d=!0),p>=1024&&p<=1327?t++:p>=65&&p<=90||p>=97&&p<=122?i++:p>=48&&p<=57?n++:p===8211||p===8212||p<128&&Bo[p]?o++:s++}let l=t/L.proseCyrillicCharsPerToken+i/L.proseLatinCharsPerToken+n/L.proseDigitsCharsPerToken+o/L.prosePunctuationCharsPerToken+s/L.proseOtherCharsPerToken;return Math.ceil(Math.max(l,r*L.proseMinTokensPerWord))}function Ur(e){return e?Math.ceil(e.length/L.codeCharsPerToken):0}function Wr(e,t){let n=We(e)?.unit||e,o=s=>{let r=[...n.matches?.(s)?[n]:[],...n.querySelectorAll(s)].filter(d=>!d.hidden&&!d.closest?.('[hidden], [inert], [aria-hidden="true"]'));return r.filter(d=>!r.some(l=>l!==d&&l.contains(d)))};if(t==="user"){let s=o(ve.userText).filter(r=>!r.closest?.('pre, code, form, [contenteditable="true"]'));return s.length?{roots:s,source:"unit-user-text",scope:n}:{roots:[n],source:"unit-user",scope:n}}if(t==="assistant"){let s=o(ve.markdown);return s.length?{roots:s,source:"unit-markdown",scope:n}:{roots:[n],source:"unit-assistant",scope:n}}return{roots:[],source:"fallback",scope:n}}function Hr(e,t=He(e)){let i=Wr(e,t),n=[],o=[];for(let s of i.roots){let r=s.cloneNode(!0),d=i.source==="unit-user";if(r.querySelectorAll((d?"":'button, [role="button"], ')+'svg, [hidden], [inert], [aria-hidden="true"], [data-testid*="copy"], [data-testid*="feedback"], [contenteditable="true"], [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"]').forEach(u=>u.remove()),d&&r.querySelectorAll('button, [role="button"]').forEach(u=>{let p=(u.getAttribute("aria-label")||u.getAttribute("title")||"").toLowerCase();/^(copy|edit|delete|share|retry|regenerate|копировать|изменить|редактировать|удалить|поделиться|ещё действия)/i.test(p)&&u.remove()}),r.hidden||r.getAttribute?.("aria-hidden")==="true")continue;for(let u of["pre","code"])for(let p of r.querySelectorAll(u)){let m=Dt(p.textContent);m&&o.push(m),p.remove()}let l=Dt(r.textContent);l&&n.push(l)}return{prose:Dt(n.join(`
`)),code:Dt(o.join(`
`)),source:i.source,roots:i.roots.length}}function Yt(e,t){let i=Hr(e,t);return{parts:i,chars:i.prose.length+i.code.length,tokens:_r(i),fingerprint:`v3:${ht(JSON.stringify([t,i.prose,i.code]))}`}}function _r(e){return Mi(e.prose)+Ur(e.code)+L.messageOverhead}function wn(e){return`${e.name}|${e.size}|${e.lastModified||0}`}function Jt(e){let t=/\.([^.]+)$/.exec(e||"");return t?t[1].toLowerCase():""}function Ei(e){let t=Jt(e?.name||"");return(e?.type||"").startsWith("image/")||Qi.has(t)}function bn(e){return en.has(e)}function j(e){return String(e||"").replace(/^\s*(?:download|file|attachment|файл|вложение)\s*[:\-–—]?\s*/i,"").trim().toLowerCase()}function Xt(e){return/^(?:вставленный\s+текст|pasted[\s_-]+(?:text|content))(?:\s*\((?:\d{8}-\d{6}|\d+)\))?(?:\.(?:txt|md))?$/iu.test(j(e))}function zo(e){let i=String(e||"").replace(/\u00a0/g," ").replace(/[·•]/g," ").replace(/\s+/g," ").trim().replace(/\s+(?:документ|document)$/iu,"").trim();return Xt(i)?i:""}function Uo(e){let i=String(e||"").matchAll(/([^\n\r<>:"/\\|?*]{1,180}\.([A-Za-z0-9]{1,10}))/g);for(let n of i){let o=String(n[1]||"").replace(/^\s*(?:download|file|attachment|файл|вложение)\s*[:\-–—]?\s*/i,"").trim(),s=Jt(o);if(ro.has(s)&&!Qi.has(s))return o}return""}function Wo(e){let i=String(e||"").match(/(\d+(?:[.,]\d+)?)\s*(GiB|MiB|KiB|GB|MB|KB|B|ГБ|МБ|КБ|Б)(?=\s|$|[),;])/i);if(!i)return 0;let n=Number(i[1].replace(",","."));if(!Number.isFinite(n)||n<=0)return 0;let o=i[2].toUpperCase().replace(/К/g,"K").replace(/М/g,"M").replace(/Г/g,"G").replace(/Б/g,"B"),s=so[o]||0;return s?Math.round(n*s):0}function Ho(e){let t=Number(e)||0;return t<=0?"size unknown":t<1e3?`${Math.round(t)} B`:t<1e3**2?`${(t/1e3).toFixed(t>=1e5?0:1)} KB`:t<1e3**3?`${(t/1e3**2).toFixed(t>=1e7?0:1)} MB`:`${(t/1e3**3).toFixed(1)} GB`}function jr(e,t=M){let i=Jt(e);return["csv","tsv","xls","xlsx","ods"].includes(i)?t.metadataOnlyTypeFactorSpreadsheet:bn(i)?t.metadataOnlyTypeFactorTextCode:i==="pdf"?t.metadataOnlyTypeFactorPdf:["doc","docx","odt","rtf"].includes(i)?t.metadataOnlyTypeFactorDocument:["ppt","pptx","odp"].includes(i)?t.metadataOnlyTypeFactorPresentation:["zip","7z","rar","gz","tar"].includes(i)?t.metadataOnlyTypeFactorArchive:t.metadataOnlyTypeFactorOther}function _o(e,t=M){let i=Number(e?.size)||0;if(i<=0)return{optimistic:0,pessimistic:0};let n=Math.max(i/1024**2,.001),o=Math.log2(1+n),s=jr(e.name||"",t),r=Math.min(t.metadataOnlyOptimisticMax,(t.metadataOnlyOptimisticBase+o*t.metadataOnlyOptimisticSizeFactor)*s),d=Math.min(t.metadataOnlyPessimisticMax,(t.metadataOnlyPessimisticBase+o*t.metadataOnlyPessimisticSizeFactor)*s);return{optimistic:Math.max(0,Math.ceil(r)),pessimistic:Math.max(0,Math.ceil(d))}}function nt(e,t){let i=Number(e)||0,n=Number(t)||0;return!i||!n||Math.abs(i-n)<=Math.max(4096,n*.02)}function Qt(e,t=He(e)){if(t!=="user"&&t!=="assistant")return null;let i=We(e);if(i)return Pi(i.unit);let n=e.getAttribute?.("data-message-id"),o=typeof n=="string"&&n.match(no);return o?`msg:${o[0].toLowerCase()}`:null}function*ye(e){for(let[t,i]of(e||[]).entries()){let n=He(i);yield{el:i,index:t,role:n,id:Qt(i,n)}}}function jo(e){let t=new Set;for(let{id:i}of ye(e))i&&t.add(i);return t}function _e(e,t){return!!e&&!t.ambiguousIds.has(e)}function ei(e){let t=e.nodes;return e.identities?t.map((i,n)=>({el:i,index:n,...e.identities.get(i)})):[...ye(t)]}function qr(e,t){if(e===t)return 0;let i=e.compareDocumentPosition(t);return i&Node.DOCUMENT_POSITION_FOLLOWING?-1:i&Node.DOCUMENT_POSITION_PRECEDING?1:0}function qo(e){if(!e?.isConnected||e.closest?.('[hidden], [inert], [aria-hidden="true"]'))return!1;let t=e.getBoundingClientRect?.();return!!t&&t.width>0&&t.height>0}function q(){let e=W();try{let t=[...document.querySelectorAll(`main ${ve.searchUnit}`)].filter(u=>/(?:^|:)(?:user|assistant)$/i.test(u.getAttribute("data-chatgpt-search-unit-key")||"")),i=t.filter(qo),n=t.length-i.length;if(!i.length){let u=[...document.querySelectorAll("main [data-message-id][data-message-author-role], main [data-message-id][data-message-role]")];i.push(...u.filter(qo)),n+=u.length-i.length}let o=new Set,s=new Map,r=new Set,d=new WeakMap,l=[];for(let u of i){if(o.has(u))continue;o.add(u);let p=u.hasAttribute("data-chatgpt-search-unit-key")?We(u):null,m=p?.role||He(u);if(!m)continue;let f=p?Pi(u):Qt(u,m);if(!f){d.set(u,{role:m,id:null}),l.push(u);continue}let g=s.get(f);if(g){!g.contains(u)&&!u.contains(g)&&r.add(f);continue}s.set(f,u),d.set(u,{role:m,id:f}),l.push(u)}return l.sort(qr),{name:i.length?i[0].hasAttribute("data-chatgpt-search-unit-key")?"search-units":"message-id":"no-message-ids",nodes:l,identities:d,rawCount:i.length,noLayout:n,collapsed:i.length-l.length,ambiguousIds:r}}finally{U("collect",e)}}function Kr(e){return!!e&&!e.hidden&&e.getAttribute("aria-hidden")!=="true"&&e.getClientRects().length>0}var Rt=Object.freeze({stop:['button[data-testid="stop-button"]','button[aria-label="Stop streaming"]','button[aria-label="Stop generating"]','button[aria-label="Stop"]','button[aria-label="\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u044E"]','button[aria-label="\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C"]'].join(", "),send:['button[data-testid="send-button"]','button[data-testid="composer-submit-button"]',"button#composer-submit-button",'button[aria-label="Send prompt"]','button[aria-label="Send message"]','button[aria-label="Send"]','button[aria-label="\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435"]','button[aria-label="\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C"]'].join(", ")});function Oi(e){for(let t of document.querySelectorAll(e))if(Kr(t))return!0;return!1}function Ko(){return{stop:Oi(Rt.stop),send:Oi(Rt.send)}}function je(e=q){if(Oi(Rt.stop))return et({stop:!0,send:!1,actions:null}),"generating";if(Oi(Rt.send))return et({stop:!1,send:!0,actions:null}),"ready";let n=!!document.querySelector("form[data-chatgpt-composer], #prompt-textarea"),o=n?yn(e()):!1;return et({stop:!1,send:!1,actions:o}),n&&o?"ready":"unknown"}var Ft=['button[data-testid="copy-turn-action-button"]','button[aria-label="\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C"]','button[aria-label="Copy"]','button[aria-label="\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442"]','button[aria-label="Copy response"]','button[aria-label="\u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043E\u0442\u0432\u0435\u0442 \u0437\u0430\u043D\u043E\u0432\u043E"]','button[aria-label="Regenerate"]','button[aria-label="Regenerate response"]','button[aria-label="\u041F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u0432\u0441\u043B\u0443\u0445"]','button[aria-label="Read aloud"]'].join(", ");function Ln(e){return e instanceof Element?e.matches(Ft)||!!e.querySelector(Ft):!1}function yn(e=null){let t=(e||q()).nodes;if(!t.length)return!1;let i=t[t.length-1];if(He(i)!=="assistant")return!1;let n=i.closest?.('[data-testid^="conversation-turn-"], [data-virtualized-turn-content], [data-message-author-role="assistant"]');if(n&&n.querySelector(Ft))return!0;for(let o of document.querySelectorAll(`main ${Ft.replaceAll(", ",", main ")}`))if(i.compareDocumentPosition(o)&Node.DOCUMENT_POSITION_FOLLOWING)return!0;return!1}function Di(e){ie.name=e.name,ie.visible=e.nodes.length,ie.raw=e.rawCount,ie.collapsed=e.collapsed,ie.ambiguous=e.ambiguousIds.size,ie.noLayout=e.noLayout||0}function wt(){if(Pt)return Pt;Be(null);try{let e=JSON.parse(tt(jt)||"[]");if(!Array.isArray(e)||!e.every(vn))throw new Error("Invalid calibration history samples");ze(e),ut(!1)}catch(e){ze([]),ut(!0),Z(null,"CORRUPT CALIBRATION HISTORY: raw bytes preserved; recording blocked.",e)}return Pt}function vn(e){if(!e||typeof e!="object"||Array.isArray(e)||typeof e.chatKey!="string"||!e.chatKey)return!1;for(let t of["seen","optimistic","pessimistic","knownAttachmentTokens","knownImages","turns","savedAt"])if(e[t]!==void 0&&(typeof e[t]!="number"||!Number.isFinite(e[t])||e[t]<0))return!1;return typeof e.seen=="number"&&typeof e.pessimistic=="number"}function xn(e){return Pt===null&&wt(),dt||!Array.isArray(e)||!e.every(vn)?(Z(null,"CALIBRATION HISTORY NOT SAVED: invalid stored or pending samples."),!1):Zt(jt,e,w,"STORAGE WRITE FAILED: limit calibration was not saved.",()=>{ze(null),Be(null)})?(ze(e),Be(null),!0):!1}function kn(e,t=!1){let i=0,n=0,o=0,s=0;for(let r of e)vn(r)&&(t&&(!Number.isFinite(Number(r.seen))||!Number.isFinite(Number(r.pessimistic)))||(i++,n+=Number(r.seen)||0,o+=Number(r.optimistic)||0,s+=Number(r.pessimistic)||0));return i?{n:i,avgSeen:Math.round(n/i),avgOptimistic:Math.round(o/i),avgPessimistic:Math.round(s/i)}:{n:0,avgSeen:0,avgOptimistic:0,avgPessimistic:0}}function Go(){return Gt?Gt:(Be(kn(wt(),!0)),Gt)}function Vo(){return{conservativeBudget:L.conservativeBudget,normalBudget:L.normalBudget,optimisticBudget:L.optimisticBudget}}function bt(){return{conservative:L.conservativeBudget,normal:L.normalBudget,optimistic:L.optimisticBudget,historyWeight:L.budgetCalibrationWeight||0}}function Zo(e,t){if(!t.n||t.avgPessimistic<=0)return{...e,weight:0};let i=Math.max(1,Number(L.historyPriorStrength)||4),n=t.n/(t.n+i),o=Math.max(1e4,e.normalBudget),s=t.avgPessimistic,r=(p,m)=>Math.round(p*(1-n)+m*n),d=Math.max(1e4,Math.min(1e9,r(e.conservativeBudget,s*e.conservativeBudget/o))),l=Math.max(d,Math.min(1e9,r(e.normalBudget,s))),u=Math.max(l,Math.min(1e9,r(e.optimisticBudget,s*e.optimisticBudget/o)));return{conservativeBudget:d,normalBudget:l,optimisticBudget:u,weight:n}}function J(e,t,i){return Math.min(Math.max(e,t),i)}var ti=null,Sn=!1;function Yo(){Sn||(Sn=!0,requestAnimationFrame(()=>{Sn=!1,N()}))}function ii(){let e=a.panel.getBoundingClientRect();ti={height:e.height,width:e.width,viewportWidth:document.documentElement.clientWidth||window.innerWidth,viewportHeight:document.documentElement.clientHeight||window.innerHeight,inlineHeight:a.panel.style.height},a.panel.style.height=`${e.height}px`}function N(){if(!a||a.panel.hidden)return;let e=a.confirmDialog?.open?a.confirmDialog:a.settingsDialog?.open?a.settingsDialog:a.aboutDialog?.open?a.aboutDialog:a.limitDialog?.open?a.limitDialog:null;if(!e)return;let t=a.panel.getBoundingClientRect(),i=a.panelFrame.getBoundingClientRect(),n=document.documentElement.clientWidth||window.innerWidth,o=document.documentElement.clientHeight||window.innerHeight,s=8,r=Math.max(1,o-s*2),d=Math.max(1,Math.min(n-s*2,t.width-18));e.style.width=`${d}px`;let l=getComputedStyle(e),u=e.lastElementChild,p=parseFloat(l.paddingBottom)||0,m=parseFloat(l.borderBottomWidth)||0,f=u?u.offsetTop+u.offsetHeight+p+m:e.scrollHeight,g=Math.min(r,Math.max(1,Math.ceil(f+2)));e.style.height=`${g}px`;let b=e.scrollHeight-e.clientHeight;b>0&&g<r&&(g=Math.min(r,g+Math.ceil(b)+1),e.style.height=`${g}px`);let h=a.panel.querySelector(".cw-title")?.getBoundingClientRect(),S=Math.max(t.top+9,(h?.bottom??t.top+44)+8),k=J(t.left+9,s,Math.max(s,n-d-s)),I=J(S,s,Math.max(s,o-g-s));e.style.left=`${k-i.left}px`,e.style.top=`${I-i.top}px`,e.style.transform="none",a.settingsScrim.style.borderRadius=getComputedStyle(a.panel).borderRadius}var Cn=new WeakMap;function Jo(e){for(let t of e.querySelectorAll("dialog")){let i=Cn.get(t);if(i){for(let n of i)n.disconnect();Cn.delete(t)}}ti=null}function Xo(e){if(e.dataset.cwLayoutObserved==="1")return;e.dataset.cwLayoutObserved="1";let t=new MutationObserver(()=>{e.open&&Yo()}),i=[t];Cn.set(e,i),t.observe(e,{subtree:!0,childList:!0,characterData:!0,attributes:!0,attributeFilter:["hidden","open","class"]});let n=e.querySelector(".cw-dialog-content")||e.querySelector(".cw-about-glossary");if(n&&typeof ResizeObserver=="function"){let o=new ResizeObserver(()=>{e.open&&Yo()});o.observe(n),i.push(o)}}function Tn(e){return ti=e}var Qo="http://www.w3.org/2000/svg",An=Object.freeze(["M218,98L205,111L192,130L180,155L173,176L167,201L163,232L164,281L167,301L172,321L179,341L190,363L192,372L192,392L187,422L187,443L189,459L196,483L212,513L232,535L247,546L258,552L261,564L266,574L278,587L283,590L284,593L285,607L274,644L268,675L266,695L266,722L271,758L279,786L292,815L304,834L304,842L302,851L290,877L245,934L237,947L226,971L223,986L223,998L225,1007L234,1026L254,1052L278,1076L296,1090L319,1105L303,1087L286,1061L278,1043L271,1018L269,1004L270,975L278,947L283,935L285,934L290,953L294,962L312,989L328,1005L356,1025L376,1036L406,1074L436,1104L460,1123L493,1144L525,1159L551,1167L534,1157L505,1135L476,1106L456,1081L441,1058L442,1056L471,1070L486,1075L498,1077L454,1043L431,1021L404,991L384,963L373,944L375,943L397,953L376,935L357,915L339,889L328,864L323,840L325,839L331,844L340,848L331,838L313,812L299,784L289,752L284,712L284,698L287,667L293,639L302,611L302,590L304,581L314,561L325,550L327,552L323,561L320,579L322,602L327,618L333,620L341,628L345,636L348,648L348,678L352,693L358,706L381,734L385,742L387,752L390,747L401,736L416,727L417,728L393,777L377,801L369,784L357,770L360,778L364,799L364,825L360,834L357,849L358,865L362,879L373,898L389,914L404,924L416,930L439,938L458,941L473,941L498,936L514,949L535,960L553,965L573,967L590,974L607,979L630,981L646,979L668,972L679,967L698,965L718,959L732,952L753,936L777,941L802,940L819,936L846,924L858,916L874,901L882,890L888,878L892,862L892,844L889,831L886,825L885,810L887,792L893,770L883,781L873,801L854,771L840,743L835,729L836,728L842,731L853,739L863,750L864,753L864,749L868,737L875,727L887,714L898,695L901,686L903,673L904,640L909,628L920,616L924,599L925,579L923,565L919,554L920,552L931,566L937,579L938,574L938,560L935,543L929,526L923,516L923,512L932,503L937,506L943,516L952,544L953,571L949,589L949,611L960,647L966,682L967,719L963,748L958,767L950,788L939,810L925,831L911,848L927,838L928,839L922,866L907,897L888,922L863,947L855,953L876,944L878,945L864,970L842,999L819,1024L801,1041L768,1068L755,1077L773,1073L792,1065L802,1059L804,1060L798,1071L786,1088L756,1121L747,1129L772,1115L800,1095L833,1063L847,1045L848,1049L831,1081L845,1071L861,1057L882,1034L890,1030L918,1010L938,990L951,972L959,956L964,941L964,935L966,934L973,948L980,971L982,995L979,1021L972,1044L964,1061L947,1087L931,1105L960,1086L978,1071L995,1054L1012,1033L1023,1014L1028,995L1027,979L1025,971L1016,950L1003,930L968,887L960,875L949,850L947,834L959,815L973,784L979,765L985,730L984,679L979,652L966,607L967,592L980,580L985,573L989,565L992,552L1005,545L1016,537L1033,520L1044,504L1055,481L1060,465L1063,447L1063,416L1058,388L1058,376L1062,360L1072,340L1082,308L1086,285L1088,242L1087,241L1086,218L1082,194L1075,168L1068,149L1056,125L1049,115L1032,97L1016,88L997,83L976,83L960,86L938,94L904,114L883,131L859,154L821,198L783,254L765,288L758,306L746,312L739,318L735,324L733,333L731,335L700,329L661,330L641,327L613,327L595,330L552,329L536,331L520,335L518,333L516,324L512,318L503,311L494,308L491,305L486,292L470,262L458,242L426,196L393,157L369,133L355,121L326,101L303,90L281,84L274,83L249,84L236,88Z","M522,915L522,927L525,934L530,940L538,946L555,953L611,961L639,961L640,960L649,960L670,956L696,953L707,949L718,942L726,933L729,925L728,914L722,905L714,908L703,908L695,905L681,894L671,889L668,889L663,894L653,900L630,905L620,905L607,903L591,896L583,889L581,889L572,893L558,904L548,908L537,908L529,905Z M564,660L564,665L567,660L581,648L590,644L599,642L619,642L620,643L656,642L667,645L678,651L689,662L690,665L690,659L686,650L678,642L672,638L662,634L641,631L637,632L611,631L610,632L595,633L589,635L576,642L569,649Z M864,602L863,605L860,600L853,601L852,606L854,609L860,610L859,615L855,623L844,634L836,638L841,637L849,633L857,625L861,619L863,613Z M377,845L377,863L380,874L386,885L398,898L417,910L438,916L452,916L462,910L458,898L458,886L460,875L469,854L480,839L476,828L477,818L490,803L488,798L488,793L484,791L482,788L482,782L486,778L491,777L496,766L507,751L510,742L510,725L513,715L519,705L532,692L521,688L509,689L492,697L483,703L470,715L469,713L476,702L487,689L499,679L511,672L544,638L565,622L581,614L594,610L609,607L631,606L632,607L643,607L663,611L672,614L694,626L702,632L739,670L759,683L771,695L783,713L782,715L768,702L759,696L743,689L732,688L721,692L734,705L739,713L743,725L743,742L746,751L757,766L762,777L767,778L771,782L772,785L770,790L765,793L765,796L762,802L768,810L774,815L776,819L776,829L772,839L782,852L792,875L794,886L794,897L793,903L790,909L800,916L813,916L828,912L839,907L851,899L864,885L869,876L873,863L873,845L866,824L828,755L798,695L785,675L776,664L758,646L749,639L732,628L713,618L683,607L660,602L644,601L643,600L603,601L568,608L545,616L517,630L493,647L471,670L454,695L419,763L388,817L380,834Z M815,829L821,830L824,834L823,839L817,843L814,842L810,838L811,832Z M433,829L438,829L442,833L442,838L436,843L432,842L428,837L429,833Z M792,821L797,821L801,825L802,829L797,835L792,835L787,829L788,824Z M456,821L462,822L465,826L464,832L460,835L455,835L451,830L452,824Z M812,794L817,795L820,798L820,805L815,809L810,808L806,804L806,799Z M438,794L443,795L447,801L446,805L441,809L436,808L432,803L433,798Z M787,786L792,787L796,792L795,797L790,801L784,800L781,796L781,791Z M463,786L468,787L472,792L472,796L467,801L462,801L457,796L458,790Z M789,756L796,758L799,763L798,768L793,772L787,771L783,766L784,760Z M461,756L467,758L470,763L469,768L464,772L458,771L454,765L455,760Z M761,743L768,745L771,750L770,755L765,759L760,759L755,754L755,748Z M488,743L492,743L498,748L498,754L493,759L486,758L482,753L483,747Z M455,600L454,601L455,608L461,609L464,606L464,602L461,599Z M366,606L369,619L378,636L385,644L394,651L408,657L433,658L440,656L455,649L469,639L453,646L439,650L432,651L416,650L403,645L391,636L381,622L377,608L378,595L372,602Z M886,606L881,603L873,593L874,610L872,619L868,627L858,639L851,644L840,649L830,651L812,650L796,645L783,639L800,651L814,657L825,659L844,657L852,654L862,648L874,636L880,626Z M392,583L387,594L387,609L389,615L394,624L402,632L411,637L416,638L405,632L398,625L393,617L389,603L389,594Z M785,576L775,588L768,604L762,614L762,617L769,629L777,630L790,636L784,629L778,617L776,606L777,593L780,584Z M468,576L471,580L475,590L476,609L470,626L462,636L471,631L483,629L491,616L479,590Z M812,575L812,578L814,580L819,580L821,577L820,574L816,572Z M833,570L825,576L823,581L823,586L825,591L830,596L837,598L842,597L849,592L852,584L851,579L848,574L844,571Z M431,570L425,576L424,579L424,587L426,591L429,594L437,597L447,594L452,587L451,576L445,570L442,569Z M780,571L787,564L796,558L805,554L816,551L833,551L847,555L855,559L869,570L877,580L870,567L856,552L844,545L834,542L816,542L803,547L797,551L786,562Z M472,570L467,562L452,548L441,543L426,541L412,544L395,554L384,566L377,579L390,565L397,560L409,554L420,551L439,551L449,554L461,560L468,565Z M749,458L738,459L723,467L715,475L711,481L704,497L703,522L707,536L713,547L721,555L727,558L738,557L744,551L747,545L750,533L759,519L761,520L759,528L760,528L770,517L777,513L783,511L799,512L795,504L786,495L774,489L775,487L783,487L776,477L770,472L757,467L758,465L766,465L762,462Z M498,459L488,464L495,465L496,466L495,468L492,468L483,472L476,478L471,487L478,487L479,489L464,497L457,505L454,512L469,511L476,513L482,516L494,529L492,521L494,519L502,531L506,545L511,554L517,558L526,558L533,554L540,547L547,534L551,515L551,508L548,493L542,480L535,471L523,462L510,458Z M764,343L784,355L801,368L834,400L858,430L875,455L879,463L878,464L871,462L897,483L915,502L923,494L922,493L924,491L923,489L924,488L925,489L908,468L884,446L876,431L856,404L834,382L808,363L788,352Z M486,343L471,348L452,357L419,379L391,407L378,425L367,446L439,376L463,357L481,345Z M978,125L967,128L956,133L937,146L925,156L902,179L888,196L864,231L848,262L840,284L836,313L848,287L856,274L872,256L886,245L887,248L879,265L872,287L868,309L867,335L869,327L874,316L884,302L885,303L885,311L884,312L885,337L892,365L894,368L898,347L901,340L915,360L924,382L926,394L926,411L923,425L919,434L931,435L937,437L949,444L963,457L966,462L965,463L948,463L957,469L968,479L977,485L984,488L989,489L995,488L996,489L994,496L988,504L979,511L976,511L984,515L993,516L1001,514L1009,510L1018,502L1025,492L1033,472L1035,460L1035,440L1033,430L1032,429L1021,440L1010,448L1008,446L1016,434L1027,410L1030,396L1032,392L1035,371L1022,389L1007,404L991,415L990,413L1010,382L1026,350L1039,315L1048,274L1049,254L1050,253L1050,224L1049,223L1049,216L1048,222L1039,245L1028,265L1020,276L1019,273L1026,246L1029,225L1029,215L1030,214L1030,187L1026,163L1018,144L1009,133L1003,129L995,126Z M272,125L255,126L244,131L233,143L225,161L221,182L221,217L225,245L232,272L231,275L222,263L212,244L207,232L203,217L202,217L202,228L201,229L202,268L205,288L211,314L219,338L231,366L244,391L259,414L258,416L244,407L227,390L215,372L217,393L221,407L226,420L241,447L239,448L234,445L217,430L215,440L216,467L221,484L226,494L232,502L244,512L256,516L264,516L275,512L268,508L259,499L256,494L255,489L256,488L262,489L270,487L284,479L291,472L305,463L288,462L287,461L290,456L299,447L311,439L318,436L333,433L329,425L326,414L326,391L329,378L338,358L351,341L353,345L358,368L364,353L367,337L367,305L366,304L367,302L376,313L385,335L384,314L380,291L368,254L364,247L365,245L378,256L391,271L401,286L409,302L413,314L411,294L407,279L399,258L383,228L367,204L350,182L318,150L294,133L283,128Z","M522,914L525,908L529,904L537,907L548,907L558,903L572,892L581,888L583,888L591,895L601,900L620,904L630,904L647,901L657,897L668,888L671,888L681,893L695,904L703,907L714,907L722,904L727,910L729,916L727,910L718,901L698,871L684,853L667,836L655,827L641,820L634,818L619,818L609,821L600,825L586,835L564,857L534,899L525,908Z M488,744L484,747L483,753L486,757L493,758L497,754L497,748L492,744Z M488,744L492,744L497,748L497,754L493,758L488,758L483,753L484,747Z M677,705L672,715L662,725L639,737L633,745L633,773L637,788L641,794L649,802L675,819L690,833L706,853L727,883L746,901L760,909L779,915L812,917L800,917L793,913L789,909L791,906L793,897L793,886L791,875L781,852L771,839L775,829L775,819L773,815L767,810L761,802L763,799L764,793L769,790L763,793L757,788L756,785L757,782L762,778L756,766L745,751L743,747L743,743L743,747L738,751L735,750L731,745L735,739L741,739L742,741L742,725L737,711L733,705L720,692L727,688L737,687L728,684L717,685L704,691L696,697Z M575,704L556,696L540,686L531,684L524,684L515,687L526,688L533,692L520,705L514,715L511,725L511,741L512,739L518,739L522,743L522,745L519,750L514,751L510,748L510,743L510,747L492,775L491,778L496,782L497,786L492,792L489,793L488,792L491,803L486,810L479,816L477,821L477,828L481,839L470,854L465,864L460,879L459,898L463,910L452,917L439,917L466,916L476,914L488,910L503,902L513,894L526,880L550,847L562,833L580,817L604,802L614,791L618,782L620,772L620,746L619,743L615,738L609,734L599,730L589,723L581,714Z M552,668L552,676L554,681L558,686L570,692L579,692L586,689L590,683L590,679L586,671L588,663L594,659L600,659L605,662L608,666L611,674L611,685L607,696L602,701L595,705L588,706L590,710L599,718L609,722L618,721L621,717L624,679L625,678L625,671L627,667L631,692L632,717L637,722L645,722L654,718L665,707L665,706L659,705L652,701L647,696L643,685L644,672L647,665L652,660L661,659L667,664L668,672L664,679L664,683L672,691L676,692L687,691L696,686L700,681L702,676L702,667L697,656L687,646L673,638L678,641L687,650L691,659L690,666L688,662L678,652L667,646L656,643L634,643L633,644L599,643L585,647L578,651L568,660L564,666L563,660L566,652L576,641L581,638L568,645L560,652L557,656Z M891,451L909,468L925,488L924,489L925,491L923,492L924,494L916,502L915,501L914,502L905,493L913,501L924,517L923,512L932,503L935,504L938,508L932,497L922,483L910,469Z"]);function $n(e,t){let i=e.createElementNS(Qo,"path");return i.setAttribute("d",t),i}function Ri(e=document){let t=e.createElementNS(Qo,"svg");t.setAttribute("class","cw-watchdog-svg"),t.setAttribute("viewBox","0 0 1254 1254"),t.setAttribute("aria-hidden","true"),t.setAttribute("focusable","false");let i=$n(e,An[0]);i.setAttribute("fill","var(--cw-watchdog-ink, #080808)"),i.setAttribute("stroke","var(--cw-watchdog-outline, #fff)"),i.setAttribute("stroke-width","1.6"),i.setAttribute("stroke-linejoin","round"),i.setAttribute("vector-effect","non-scaling-stroke"),i.setAttribute("paint-order","stroke fill");let n=$n(e,An[1]);n.setAttribute("fill","#fff"),n.setAttribute("fill-rule","evenodd");let o=$n(e,An[2]);return o.setAttribute("fill","var(--cw-watchdog-gray, #3f3e3e)"),o.setAttribute("fill-rule","evenodd"),t.append(i,n,o),t}var ot="http://www.w3.org/2000/svg",ia=16384,Gr=/^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+\-eE]+$/,Vr=/^(?:none|currentColor|black|white|#[0-9a-fA-F]{3,8})$/,Zr=/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/,na=new Set(["x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","width","height","stroke-width","stroke-miterlimit","opacity"]),ea=new Set(["fill","fill-rule","clip-rule","stroke","stroke-width","stroke-linecap","stroke-linejoin","stroke-miterlimit","opacity"]),Yr=new Set(["path","g","rect","circle","ellipse","line","polygon","polyline"]),Jr=/^\s*:root\s*\{\s*fill\s*:\s*#000\s*;\s*\}\s*@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{\s*fill\s*:\s*#fff\s*;\s*\}\s*\}\s*$/;function Xr(e){let t=[...e.children],i=[...e.attributes];return t.length!==2||t[0].localName!=="style"||t[1].localName!=="path"||t[0].namespaceURI!==ot||t[1].namespaceURI!==ot||t[0].attributes.length!==0||t[1].attributes.length!==1||!t[1].hasAttribute("d")||i.length!==5||e.getAttribute("xmlns")!==ot||e.getAttribute("width")!=="180"||e.getAttribute("height")!=="180"||e.getAttribute("viewBox")!=="0 0 180 180"||e.getAttribute("fill")!=="none"||[...t[0].childNodes].some(n=>n.nodeType!==3)?!1:Jr.test(t[0].textContent||"")}var Lt=null,re=null,En=null,Pn=!1,Mn=0;function ta(e,t){return e==="d"?t.length>0&&t.length<=15e3&&Gr.test(t):e==="points"?t.length<=4096&&/^[0-9\s.,+\-eE]+$/.test(t):["fill","stroke"].includes(e)?Vr.test(t):["fill-rule","clip-rule"].includes(e)?["evenodd","nonzero"].includes(t):["stroke-linejoin"].includes(e)?["round","bevel","miter"].includes(t):["stroke-linecap"].includes(e)?["round","square","butt"].includes(t):na.has(e)?t.length<32&&Zr.test(t)&&Number.isFinite(Number(t))&&Math.abs(Number(t))<=1e5:e==="transform"?t.length<=160&&/^(?:(?:translate|scale|rotate|matrix)\([0-9\s.,+\-eE]+\)\s*)+$/.test(t):!1}function Qr(e,t,i){switch(t){case"fill":e.setAttribute("fill",i);return;case"fill-rule":e.setAttribute("fill-rule",i);return;case"clip-rule":e.setAttribute("clip-rule",i);return;case"stroke":e.setAttribute("stroke",i);return;case"stroke-width":e.setAttribute("stroke-width",i);return;case"stroke-linecap":e.setAttribute("stroke-linecap",i);return;case"stroke-linejoin":e.setAttribute("stroke-linejoin",i);return;case"stroke-miterlimit":e.setAttribute("stroke-miterlimit",i);return;case"opacity":e.setAttribute("opacity",i);return;case"d":e.setAttribute("d",i);return;case"points":e.setAttribute("points",i);return;case"transform":e.setAttribute("transform",i);return;case"x":e.setAttribute("x",i);return;case"y":e.setAttribute("y",i);return;case"x1":e.setAttribute("x1",i);return;case"x2":e.setAttribute("x2",i);return;case"y1":e.setAttribute("y1",i);return;case"y2":e.setAttribute("y2",i);return;case"cx":e.setAttribute("cx",i);return;case"cy":e.setAttribute("cy",i);return;case"r":e.setAttribute("r",i);return;case"rx":e.setAttribute("rx",i);return;case"ry":e.setAttribute("ry",i);return;case"width":e.setAttribute("width",i);return;case"height":e.setAttribute("height",i);return;default:throw new Error("Non-whitelisted SVG attribute")}}function es(e,t=document){if(typeof e!="string"||!e.length||e.length>ia)return null;let i=new DOMParser().parseFromString(e,"image/svg+xml");if(i.querySelector("parsererror")||i.doctype||[...i.childNodes].some(m=>m.nodeType!==1&&m.nodeType!==8)||i.documentElement?.localName!=="svg"||i.documentElement.namespaceURI!==ot)return null;let n=i.documentElement,o=[...n.children].some(m=>m.localName==="style");if(o&&!Xr(n))return null;let r=n.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);if(!r||r.length!==4||r.some(m=>!Number.isFinite(m))||r[2]<=0||r[3]<=0||r[2]>2048||r[3]>2048)return null;let d=t.createElementNS(ot,"svg");d.setAttribute("viewBox",r.join(" ")),d.setAttribute("width","18"),d.setAttribute("height","18"),d.setAttribute("fill","currentColor"),d.setAttribute("focusable","false"),d.setAttribute("aria-hidden","true");let l=new Set(["xmlns","viewBox","width","height",...ea]);for(let m of n.attributes)if(!l.has(m.name)||m.name!=="xmlns"&&m.name!=="viewBox"&&!ta(m.name,m.value)||m.name==="xmlns"&&m.value!==ot)return null;let u=0;function p(m,f,g){if(g>6)return!1;for(let b of m.childNodes){if(b.nodeType===3&&!b.textContent.trim()||b.nodeType===8||o&&m===n&&b.localName==="style")continue;if(b.nodeType!==1||b.namespaceURI!==ot||!Yr.has(b.localName)||++u>32)return!1;let h=t.createElementNS(ot,b.localName);for(let S of b.attributes){let k=S.name;if(!(ea.has(k)||k==="d"||k==="points"||k==="transform"||na.has(k))||!ta(k,S.value))return!1;Qr(h,k,S.value)}if(b.localName==="path"&&!h.hasAttribute("d")||["polygon","polyline"].includes(b.localName)&&!h.hasAttribute("points")||!p(b,h,g+1))return!1;f.appendChild(h)}return!0}return!p(n,d,0)||!u?null:d}function ts(e){if(location.protocol!=="https:")return null;let t=/^\/cdn\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/,i=[...e.querySelectorAll('head link[rel~="icon"]')].filter(o=>!o.type||o.type==="image/svg+xml").map(o=>{try{let s=o.getAttribute("href")||"";if(s.includes("%")||s.includes("\\")||/(?:^|\/)\.{1,2}(?:\/|$)/.test(s))return null;let r=new URL(s,location.href);return r.origin!==location.origin||r.protocol!=="https:"||r.username||r.password||r.search||r.hash||!t.test(r.pathname)?null:r.href}catch{return null}}).filter(Boolean),n=[...new Set(i)];return n.length===1?n[0]:null}async function is(e){let t=ts(e);if(!t||navigator.serviceWorker?.controller)return null;try{let i=await window.fetch(t,{mode:"same-origin",cache:"only-if-cached",credentials:"same-origin",redirect:"error"});if(!i.ok||(i.headers.get("content-type")||"").split(";")[0].trim().toLowerCase()!=="image/svg+xml")return null;let n=Number(i.headers.get("content-length"));return Number.isFinite(n)&&n>ia?null:es(await i.text(),e)}catch{return null}}function On(){if(!Lt?.isConnected||!re?.isConnected)return;let e=Lt.querySelector(".cw-title-info .cw-brand-mark");e&&(e.hidden=L.logoPreference!=="watchdog");let t=L.logoPreference==="openai"&&En;if(t){if(re.firstElementChild?.isEqualNode(t)&&re.classList.contains("cw-has-site-logo"))return;re.replaceChildren(t.cloneNode(!0)),re.classList.add("cw-has-site-logo")}else{if(!re.classList.contains("cw-has-site-logo")&&re.firstElementChild?.classList.contains("cw-watchdog-svg"))return;re.replaceChildren(Ri(re.ownerDocument)),re.classList.remove("cw-has-site-logo")}let i=Lt.querySelector(".cw-floating-tip"),n=i?.hidden?null:i?.querySelector(".cw-tip-logo");if(n){let o=re.cloneNode(!0);o.classList.add("cw-tip-logo"),n.replaceWith(o)}}function ns(e=!0){if(L.logoPreference==="openai"){L.logoPreference="watchdog",e&&V();for(let t of Lt?.querySelectorAll("[data-cw-view-logo]")||[])t.setAttribute("aria-pressed",String(t.dataset.cwViewLogo==="watchdog"));On()}}function ni(e=!1,t=!0){if(!Lt?.isConnected||!re?.isConnected||(e&&(++Mn,Pn=!1,En=null),On(),L.logoPreference!=="openai"||Pn))return;Pn=!0;let i=++Mn;is(Lt.ownerDocument).then(n=>{i!==Mn||L.logoPreference!=="openai"||(n?(En=n,On()):ns(t))})}function oa(e,t){Lt=e,re=t,ni()}function la(){return!!window.matchMedia?.("(prefers-color-scheme: dark)").matches}function os(){let e=document.querySelector("#__next, #root");for(let t of[document.documentElement,document.body,e])if(t){for(let i of["data-theme","data-color-mode","data-mode"]){let n=(t.getAttribute(i)||"").toLowerCase();if(n==="dark"||n==="light")return n}if(t.classList.contains("dark"))return"dark";if(t.classList.contains("light"))return"light"}for(let t of[document.documentElement,document.body,e]){if(!t)continue;let i=getComputedStyle(t).colorScheme.trim().toLowerCase();if(i==="dark"||i==="only dark")return"dark";if(i==="light"||i==="only light")return"light"}for(let t of[e,document.body,document.documentElement]){if(!t)continue;let n=getComputedStyle(t).backgroundColor.match(/^rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, ]+([\d.]+))?\)$/);if(!n||n[4]!==void 0&&Number(n[4])<.8)continue;return Number(n[1])*.2126+Number(n[2])*.7152+Number(n[3])*.0722<145?"dark":"light"}return la()?"dark":"light"}function Dn(){return L.viewTheme==="light"||L.viewTheme==="dark"?L.viewTheme:L.viewTheme==="system"?la()?"dark":"light":os()}function vt(){a?.root&&(a.root.dataset.cwStyle=L.viewStyle,a.root.dataset.cwPalette=Dn())}var Fi=null,aa=null,ra=null,sa=null,as=["class","style","data-theme","data-color-mode","data-mode"];function ca(){let e=document.body,t=document.querySelector("#__next, #root"),i=t?.parentElement||null;if(aa===e&&ra===t&&sa===i)return!1;Fi.disconnect(),aa=e,ra=t,sa=i;let n=new Set([document.documentElement,e,t]),o=new Set([document.documentElement,e,i]);for(let s of new Set([...n,...o])){if(!s)continue;let r=n.has(s);Fi.observe(s,{attributes:r,...r?{attributeFilter:as}:{},childList:o.has(s)})}return!0}function da(){Fi||(Fi=new MutationObserver(e=>{let t=ca();L.viewTheme==="chatgpt"&&(t||e.some(i=>i.type==="attributes"))&&vt()}),ca())}function yt(){if(a?.settingsDialog)for(let e of a.settingsDialog.querySelectorAll("[data-cw-view-style], [data-cw-view-theme], [data-cw-view-logo]")){let t=e.dataset.cwViewStyle||e.dataset.cwViewTheme||e.dataset.cwViewLogo,i=e.hasAttribute("data-cw-view-style")?L.viewStyle===t:e.hasAttribute("data-cw-view-logo")?L.logoPreference===t:L.viewTheme===t;e.setAttribute("aria-pressed",String(i))}}function ua(e,t){let i=e==="style"?"viewStyle":e==="logo"?"logoPreference":"viewTheme";if(!(e==="style"?["soft","sharp"]:e==="logo"?["openai","watchdog"]:["light","dark","system","chatgpt"]).includes(t)||L[i]===t)return;let o=L[i];if(L[i]=t,!V()){L[i]=o,yt();return}vt(),e==="logo"&&ni(!0),yt(),a?.settingsDialog?.open&&(N(),requestAnimationFrame(N))}function oi(e,t,i=!0){return w?i?Ii(e.optimistic,t.normal)>100?{level:"critical",label:"RED \xB7 prepare HANDOFF",color:"#ef4444"}:Ii(e.pessimistic,t.normal)>100?{level:"caution",label:"YELLOW \xB7 caution",color:"#ca8a04"}:{level:"ok",label:"OK \xB7 within budget",color:"var(--cw-accent)"}:{level:"pending",label:"WAIT \xB7 first message",color:"#64748b"}:{level:"pending",label:"WAIT \xB7 chat UUID",color:"#64748b"}}function Ii(e,t){return t?Math.round(e*100/t):0}function pa(e){let t=e/1e3;return t<10?t.toFixed(1).replace(/\.0$/,""):t<100?t.toFixed(0):Math.round(t).toString()}function ma(e,t,i,n,o){let s=Math.ceil(n.tokens*(o.imageOptimisticPct/100)),r=Math.ceil(n.tokens*(o.imagePessimisticPct/100)),d=t+i.fileOptimistic+s+o.hiddenOptimistic,l=t+i.filePessimistic+r+o.hiddenPessimistic;return{optimistic:Math.max(t,Math.ceil(d)),pessimistic:Math.max(t,Math.ceil(l)),fileOptimistic:i.fileOptimistic,filePessimistic:i.filePessimistic,imageOptimistic:s,imagePessimistic:r,knownTokens:i.knownTokens+n.tokens,knownFiles:i.fileCount+n.effective,knownFileTokens:i.knownTokens,knownFileCount:i.fileCount,parsedFiles:i.parsedFiles,metadataFiles:i.metadataFiles,reactMetadataFiles:i.reactMetadataFiles,unparsedFiles:i.unparsedFiles,unknownSizeFiles:i.unknownSizeFiles,autoPasteMinimumFiles:i.autoPasteMinimumFiles,autoPasteMinimumChars:i.autoPasteMinimumChars,sampledTextFiles:i.sampledTextFiles,fullyReadTextFiles:i.fullyReadTextFiles,totalFileBytes:i.totalBytes,knownImageTokens:n.tokens,knownImages:n.effective,capturedImages:n.captured,historicalImages:n.historical}}function rs(e,t,i=""){try{if(!t?.contains?.(e))return null;let n=[],o=j(i);e.getAttribute?.("title")&&n.push(e);for(let r of Array.from(e.querySelectorAll?.("[title]")||[]).slice(0,12))(!o||j(r.getAttribute("title"))===o)&&n.push(r);n.length||n.push(e);let s=new Set;for(let r of n){let d=r;for(let l=0;d&&l<10;l++,d=d.parentElement){let u=Object.keys(d).find(m=>m.startsWith("__reactFiber$")),p=u?d[u]:null;for(let m=0;p&&m<100&&!s.has(p);m++,p=p.return){s.add(p);let f=p.memoizedProps?.attachment;if(!f||typeof f!="object"||typeof f.name!="string")continue;let g=f.name.trim();if(!g||o&&j(g)!==o)continue;let b=String(e.getAttribute?.("title")||"")===g||String(e.textContent||"").length<=500&&String(e.textContent||"").includes(g);if(!o&&!b)continue;let h=Number(f.sizeBytes),S=Number(f.width),k=Number(f.height),I=Number(f.durationSeconds),z=f.fileId??f.id;return{name:g,size:Number.isSafeInteger(h)&&h>0?h:0,type:typeof f.mimeType=="string"?f.mimeType.slice(0,128):"",fileId:typeof z=="string"&&/^file_[a-z0-9_-]{8,100}$/i.test(z)?z:"",width:Number.isFinite(S)&&S>0?S:0,height:Number.isFinite(k)&&k>0?k:0,durationSeconds:Number.isFinite(I)&&I>0?I:0,metadataSource:"react-props"}}if(d===t)break}}}catch{}return null}function Rn(e,t){let i=[e.getAttribute?.("download"),e.getAttribute?.("title"),e.getAttribute?.("aria-label"),e.textContent],n="";for(let d of i)if(n=Uo(d),n)break;if(!n){for(let d of i)if(n=zo(d),n)break}let o=rs(e,t,n);if(!n&&!o||(!n&&o&&(n=o.name),Ei({name:n,type:o?.type||""})))return null;let s=o?.size||0,r=e;for(let d=0;!s&&r&&d<5;d++,r=r.parentElement){let l=r.textContent||"";if(l.length<=800&&(s=Wo(l),s)||r===t)break}return{name:n,size:s,...o?{type:o.type,fileId:o.fileId,durationSeconds:o.durationSeconds,metadataSource:o.metadataSource}:{}}}var fa=120*1e3;function me(e,t,i=Date.now()){return!e.used&&!!e.submittedAt&&i-e.submittedAt>=0&&i-e.submittedAt<=fa&&(e.chatKey===t||e.chatKey===null&&t===w)}function Fn(e,t){for(let{el:i,role:n,id:o}of e)n==="user"&&o&&t(i,o)}function Ni(e,t){if(!E.some(r=>me(r,t)&&!r.boundMessageId))return;let i=e.filter(({role:r,id:d})=>r==="user"&&d).at(-1);if(!i)return;let{el:n,id:o}=i,s=E.filter(r=>!r.boundMessageId&&me(r,t)&&!r.existingMessageIds.has(o));if(s.length)for(let r of n.querySelectorAll?.('a[download], a[href], button, [role="button"], [data-testid*="file"]')||[]){if(r.closest?.(`#${c}-root`))continue;let d=Rn(r,n);if(!d)continue;let l=s.find(u=>!u.boundMessageId&&j(u.file.name)===j(d.name)&&nt(u.file.size,d.size));l&&(l.boundMessageId=o,l.boundEpoch=F(t))}}function ga(e,t,i){return e.used||e.readingLaunchPending||!i?!1:e.boundMessageId?e.chatKey===t&&e.boundMessageId===i&&e.boundEpoch===F(t):me(e,t)&&!e.existingMessageIds.has(i)}function ha(e,t){let i=W();try{t.files=t.files||{},Ni(e,t.chatKey);let n=[],o=E.some(m=>!m.used&&(m.boundMessageId?m.chatKey===t.chatKey&&m.boundEpoch===F(t.chatKey):me(m,t.chatKey)));if(Fn(e,(m,f)=>{!o&&!Ne.has(m)&&qt.get(m)===`${t.chatKey}|${f}`||n.push({turn:m,messageId:f})}),!n.length)return{changed:!1,inspected:n,jobs:[]};let s=new Set,r=[],d=new Set,l=e.filter(m=>m.role==="user"&&m.id).at(-1)?.id||null,u=new Map;for(let[m,f]of Object.entries(t.files)){let g=j(f?.name);u.has(g)||u.set(g,[]),u.get(g).push([m,f])}let p=!1;for(let{turn:m,messageId:f}of n){let g=Array.from(m.querySelectorAll?.('a[download], a[href], button, [role="button"], [data-testid*="file"]')||[]);for(let b of g){if(b.closest?.(`#${c}-root`))continue;let h=Rn(b,m);if(!h)continue;let S=Xt(h.name),k=E.find(P=>ga(P,t.chatKey,f)&&f===l&&j(P.file.name)===j(h.name)&&nt(P.file.size,h.size));k&&t.chatKey&&!R.has(t.chatKey)&&!d.has(k)&&(d.add(k),r.push({staged:k,chatKey:t.chatKey,messageId:f,epoch:F(t.chatKey)}));let I=`${f}|${h.fileId||j(h.name)}|${h.size||0}`;if(s.has(I))continue;s.add(I);let z=j(h.name),O=(u.get(z)||[]).find(([,P])=>P.fileId&&h.fileId&&P.fileId!==h.fileId?!1:P.messageId===f?!(P.size&&h.size&&P.metadataSource==="react-props"&&h.metadataSource==="react-props"&&P.size!==h.size||!nt(P.size,h.size)):!P.messageId&&["file-input","drop","paste"].includes(P.source)&&nt(P.size,h.size))?.[0];if(O){let P=t.files[O];!P.size&&h.size&&(P.size=h.size,p=!0),!P.type&&h.type&&(P.type=h.type,p=!0),!P.fileId&&h.fileId&&(P.fileId=h.fileId,p=!0),!P.durationSeconds&&h.durationSeconds&&(P.durationSeconds=h.durationSeconds,p=!0),h.metadataSource&&P.metadataSource!==h.metadataSource&&(P.metadataSource=h.metadataSource,p=!0),P.messageId!==f&&(P.messageId=f,p=!0),S&&!P.autoPaste&&(P.autoPaste=!0,p=!0),P.historySeenAt||(P.historySeenAt=Date.now(),p=!0);continue}let ee=`dom-user-file:${ht(I)}`;t.files[ee]||(t.files[ee]={name:h.name,size:h.size||0,type:h.type||"",source:"dom-history",messageId:f,...h.fileId?{fileId:h.fileId}:{},...h.durationSeconds?{durationSeconds:h.durationSeconds}:{},...h.metadataSource?{metadataSource:h.metadataSource}:{},...S?{autoPaste:!0}:{},method:"metadata-size",metadataOnly:!0,status:"ready",tokens:0,addedAt:Date.now(),historySeenAt:Date.now()},u.has(z)||u.set(z,[]),u.get(z).push([ee,t.files[ee]]),p=!0)}}return{changed:p,inspected:n,jobs:r}}finally{U("files",i)}}function In(e,t){for(let i of e||[])queueMicrotask(()=>{let{staged:n,chatKey:o,messageId:s,epoch:r}=i;if(E.indexOf(n)<0||n.used||n.chatKey!==o||F(o)!==r||n.boundMessageId&&n.boundMessageId!==s||!ga(n,o,s)||R.has(o)||C()||!Object.values(y(o).files||{}).some(p=>p.messageId===s&&p.metadataOnly&&j(p.name)===j(n.file.name)&&nt(p.size,n.file.size)))return;n.readingLaunchPending=!0;let u=p=>{if(n.readingLaunchPending=!1,!p)return;n.used=!0;let m=E.indexOf(n);m>=0&&E.splice(m,1)};try{Promise.resolve(t(n.file,n.source,o,s,u)).catch(p=>{n.readingLaunchPending=!1,console.warn("[Context Watchdog] file reading launch failed")})}catch{n.readingLaunchPending=!1,console.warn("[Context Watchdog] file reading launch failed")}})}function ss(e){if(!(e instanceof HTMLImageElement)||e.closest(`#${c}-root`)||!(e.currentSrc||e.getAttribute("src")||""))return!1;let i=e.naturalWidth||e.clientWidth||Number(e.getAttribute("width"))||0,n=e.naturalHeight||e.clientHeight||Number(e.getAttribute("height"))||0;if(i&&n&&i<96&&n<96)return!1;let o=(e.getAttribute("alt")||"").toLowerCase();return!(/avatar|profile|logo|icon/.test(o)&&i<160&&n<160)}var cs='[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key="user"], [data-message-id][data-message-author-role="user"], [data-message-id][data-message-role="user"]';function ls(e){let t=e.currentTarget?.closest?.(cs);t&&(Se.add(t),wo())}function wa(e,t,i=[]){let n=W();try{t.domImages=t.domImages||{};let o=!1;return Fn(e,(s,r)=>{let d=F(t.chatKey),l=Kt.get(s);if(!Se.has(s)&&l?.chatKey===t.chatKey&&l.messageId===r&&l.epoch===d&&l.keys.every(g=>t.domImages[g])){let g=Date.now();for(let b of l.keys)t.domImages[b].lastSeenAt=g;return}let u=Array.from(s.querySelectorAll?.("img")||[]),p=[],m=!0,f=0;for(let g of u){if(g instanceof HTMLImageElement&&!on.has(g)&&(g.addEventListener?.("load",ls),on.add(g)),!ss(g))continue;(!g.naturalWidth||!g.naturalHeight)&&(m=!1);let b=g.naturalWidth||g.clientWidth||0,h=g.naturalHeight||g.clientHeight||0,S=`dom-user-image-slot:${ht(`${r}
${f++}`)}`;p.push(S),t.domImages[S]?(t.domImages[S].lastSeenAt=Date.now(),(!t.domImages[S].width||!t.domImages[S].height)&&b&&h&&(t.domImages[S].width=b,t.domImages[S].height=h,o=!0)):(t.domImages[S]={messageId:r,width:b,height:h,tokens:Math.max(1,Math.round(L.averageImageTokens)),firstSeenAt:Date.now(),lastSeenAt:Date.now()},o=!0)}m&&i.push({turn:s,messageId:r,chatKey:t.chatKey,epoch:d,keys:p})}),o}finally{U("images",n)}}function ba(e,t=null){let i=t?.byMessage||new Map,n=new Map,o=t?t.count:0,s=0;if(!t)for(let[d,l]of Object.entries(e.files||{})){if(l?.method!=="image-average")continue;o++;let u=l.messageId||`unbound-file:${d}`;i.set(u,(i.get(u)||0)+1)}for(let[d,l]of Object.entries(e.domImages||{})){if(!d.startsWith("dom-user-image-slot:")||!l)continue;s++;let u=l.messageId||`unbound-dom:${d}`;n.set(u,(n.get(u)||0)+1)}let r=0;for(let d of new Set([...i.keys(),...n.keys()]))r+=Math.max(i.get(d)||0,n.get(d)||0);return{captured:o,historical:s,effective:r,tokens:r*L.averageImageTokens}}function ds(e){if(!e||!e.autoPaste&&!(e.source==="dom-history"&&Xt(e.name))||(Number(e.tokens)||0)>0&&!e.metadataOnly)return null;let t=L.pastedMinChars,i=Math.ceil(t/L.pastedEnglishCharsPerToken),n=Math.ceil(t/L.pastedCyrillicCharsPerToken),o=Math.ceil(i*(L.fileOptimisticPct/100));return{chars:t,optimistic:o,pessimistic:Math.max(o,Math.ceil(n*(L.filePessimisticPct/100)))}}function us(e,t=null){let i=0,n=0,o=0,s=0,r=0,d=0,l=0,u=0,p=0,m=0,f=0,g=0,b=0,h=0;for(let S in e||{}){let k=e[S];if(!k)continue;if(k.method==="image-average"){if(t&&Object.hasOwn(e,S)){t.count++;let ee=k.messageId||`unbound-file:${S}`,P=t.byMessage;P.set(ee,(P.get(ee)||0)+1)}continue}let I=Number(k.tokens)||0,z=Number(k.size)||0;if(s++,k.metadataSource==="react-props"&&l++,k.method==="text-extrapolated"&&g++,k.method==="text"&&b++,z>0?h+=z:p++,(I>0||k.method==="text")&&!k.metadataOnly){o+=I,r++,i+=I*(L.fileOptimisticPct/100),n+=I*(L.filePessimisticPct/100);continue}k.metadataOnly||k.method==="metadata-size"?d++:u++;let $=_o(k,L),O=ds(k);if(k.source==="dom-history"&&z<=0&&!O){let ee=L.historicalFileFallbackTokens;$.optimistic=Math.ceil(ee*(L.fileOptimisticPct/100)),$.pessimistic=Math.ceil(ee*(L.filePessimisticPct/100))}O&&(m++,f+=O.chars),i+=Math.max($.optimistic,O?.optimistic||0),n+=Math.max($.pessimistic,O?.pessimistic||0)}return{fileOptimistic:Math.ceil(i),filePessimistic:Math.ceil(n),knownTokens:o,fileCount:s,parsedFiles:r,metadataFiles:d,reactMetadataFiles:l,unparsedFiles:u,unknownSizeFiles:p,autoPasteMinimumFiles:m,autoPasteMinimumChars:f,sampledTextFiles:g,fullyReadTextFiles:b,totalBytes:h}}function La(e,t){let i={count:0,byMessage:new Map},n=us(e.files||{},i);return ma(e,t,n,ba(e,i),L)}function X(e=y()){let t=W();try{let i=0,n=0,o=0,s=0,r=0,d=0,l=0;for(let p in e.messages||{}){let m=e.messages[p];i+=Number(m?.tokens)||0,n+=Number(m?.chars)||0,o++,m?.role==="user"?s++:m?.role==="assistant"?r++:d++,p.startsWith("msg:")&&l++}let u=La(e,i);return{tokens:i,chars:n,turns:o,userTurns:s,assistantTurns:r,otherTurns:d,uuidMessages:l,...u}}finally{U("stats",t)}}function ya(e,t){return e<1e3?String(Math.round(e)):e<1e6?`${(e/1e3).toFixed(t)}k`:`${(e/1e6).toFixed(2)}M`}function fe(e){return x.phase===e?!1:(x.phase=e,!0)}function It(e){x.work.completion=!!e}function ai(){x.work.initial=!0}function va(){let e=x.route?.gate;return{phase:x.phase,completion:x.work.completion,initial:x.work.initial,routePending:!!x.route,gate:e?{...e}:null}}function ne(){x.work.backfill=!0}function Bi(e,t,i){x.route=e?{...e,outgoingKnownIds:t,gate:null}:null,x.work.initial=!0,x.work.backfill=!1,x.work.completion=!!i,fe("switching",!1)}function zi(){x.route=null}function xa(e){e&&(x.work.initial=!1),x.work.backfill=!1}function ka(){return x.work.initial||x.work.backfill||x.work.completion||!!Qe||[..._.values()].some(e=>e.chatKey===w)||[...H].some(([e,t])=>D.get(e)===t)}var xt=["context","budget","details"],ps=`
    chip siteIcon average pausedLabel:paused-label chipStatus:chip-status pauseToggle:pause-toggle pauseControl:pause-control panelFrame:panel-frame panel panelMain:panel-main settingsScrim:settings-scrim contextTab:tab-context budgetTab:tab-budget detailsTab:tab-details
    contextView:view-context budgetView:view-budget detailsView:view-details budgetTabMark:budget-tab-status
    dataChars dataTokens dataFiles dataQuality dataQualityExtra dataImagesRow dataImages contextMessages:context-messages contextRange:context-range
    forecastHeading forecastCards budgetUnavailable forecastOpt forecastPess status percentOptC percentOptN percentOptO
    percentPessC percentPessN percentPessO progressOptC progressOptN progressOptO
    progressPessC progressPessN progressPessO detailsReport copyDetails
    storageWarning storageIndicator historyDetails:history-details diagnosticsDetails:diagnostics-tools
    diagnosticsLine recentErrorsList:recent-errors-list copyDiagnostics exportIds
    repairShort undoRepair history
    performanceDetails performanceLine performanceToggle performanceCopy performanceReset
    confirmDialog:confirm-dialog confirmDescription:confirm-description closeConfirm cancelConfirm confirmOk
    toast pinBtn:pin-panel detailHandoff:handoff-details endChat rescan
    settingsBtn settingsDialog:settings-dialog closeSettings aboutBtn aboutDialog:about-dialog closeAbout aboutGlossary:about-glossary limitDialog:limit-dialog closeLimit cancelLimit confirmLimit limitTokens limitOptimistic limitPessimistic limitReplacement budgetC budgetN budgetO saveBudget
    attachmentSettings:attachment-settings historicalFileFallback:historical-file-fallback imageAverage
    localFileLimit:local-file-limit limitWarning:limit-warning saveAttachments
    metadataOptBase:metadata-opt-base metadataOptSize:metadata-opt-size metadataOptMax:metadata-opt-max
    metadataPessBase:metadata-pess-base metadataPessSize:metadata-pess-size metadataPessMax:metadata-pess-max
    metadataSpreadsheet:metadata-spreadsheet metadataTextCode:metadata-text-code metadataPdf:metadata-pdf
    metadataDocument:metadata-document metadataPresentation:metadata-presentation metadataArchive:metadata-archive metadataOther:metadata-other
    advancedAttachments:advanced-attachments fileOpt:file-opt filePess:file-pess imageOpt:image-opt imagePess:image-pess
    pastedMinChars:pasted-min-chars pastedEnglishRatio:pasted-english-ratio pastedCyrillicRatio:pasted-cyrillic-ratio
    saveAttachmentCoefficients:save-attachment-coefficients resetAttachmentAdvanced:reset-attachment-advanced resetAttachments
    textSettingsDetails:text-settings-details proseCyrillicRatio:prose-cyrillic-ratio proseLatinRatio:prose-latin-ratio
    proseDigitsRatio:prose-digits-ratio prosePunctuationRatio:prose-punctuation-ratio
    proseOtherRatio:prose-other-ratio proseWordFloor:prose-word-floor codeRatio:code-ratio
    saveTextEstimation:save-text-estimation resetTextEstimation:reset-text-estimation resetBudget resetSettings clearWatchdogData
    messageOverhead hiddenOptimistic hiddenPessimistic
    historyPriorStrength saveSettings resetPosition resetChat dialogMessage:dialog-message
  `.trim().split(/\s+/);function Nn(e){return Object.fromEntries(ps.map(t=>{let[i,n]=t.split(":"),o=n||i.replace(/[A-Z]/g,r=>`-${r.toLowerCase()}`),s=i==="settingsDialog"?".cw-settings-dialog:not(.cw-about-dialog):not(.cw-limit-dialog):not(.cw-confirm-dialog)":`.cw-${o}`;return[i,e.querySelector(s)]}))}function Me(){a&&Object.assign(a,Nn(a.root))}var Sa=Object.freeze({"cw-tab-context":"Show text, files, images and their estimation settings.","cw-tab-budget":"Show budget forecasts, usage percentages, limits and calibration.","cw-tab-details":"Show and copy the detailed report for this chat.","cw-pin-panel":"Keep the main panel open while clicking in ChatGPT. Click again to unpin.","cw-mini-tab":"Open these settings without leaving the current view.","cw-budget-editor":"Change Conservative, Normal and Generous budget limits.","cw-copy-details":"Copy all figures from the detailed context report.","cw-close-settings":"Close Settings; unsaved HANDOFF edits remain in this session, other drafts are discarded.","cw-close-about":"Close the About window.","cw-close-limit":"Cancel without recording a chat limit.","cw-close-confirm":"Cancel this operation.","cw-cancel-confirm":"Cancel this operation without changing data.","cw-confirm-ok":"Confirm and carry out this operation.","cw-cancel-limit":"Close the dialog without saving calibration.","cw-confirm-limit":"Record this chat limit and recalibrate token budgets.","cw-save-text-estimation":"Save the current text token estimation parameters.","cw-reset-text-estimation":"Restore default text token coefficients and Message overhead.","cw-save-attachments":"Save all Files & images settings, including metadata-only estimation.","cw-reset-attachments":"Restore defaults for all Files & images settings.","cw-save-attachment-coefficients":"Save file, image and pasted-text forecast weights.","cw-reset-attachment-advanced":"Restore default attachment contribution coefficients.","cw-save-budget":"Save Conservative, Normal and Generous budgets.","cw-reset-budget":"Restore default token budgets; recorded samples remain for future calibration.","cw-save-settings":"Save hidden-context allowances and strength for future calibration.","cw-save-handoff":"Apply and save the edited HANDOFF prompt globally.","cw-restore-handoff":"Restore the built-in HANDOFF text in the editor, without applying it until Save.","cw-reset-settings":"Restore default technical parameters without clearing calibration history.","cw-reset-position":"Restore the default mini-badge position.","cw-reset-chat":"Reset Watchdog records for this chat only. Confirmation required.","cw-clear-watchdog-data":"Delete every local Watchdog record and preference. Confirmation required.","cw-rescan":"Read-only audit of messages currently visible in the chat.","cw-copy-diagnostics":"Copy the latest diagnostics text to the clipboard.","cw-export-ids":"Export known message UUIDs as a local TSV file.","cw-repair-short":"Repair only confirmed incomplete ledger entries; requires confirmation.","cw-undo-repair":"Undo the latest confirmed repair, if its records are unchanged.","cw-performance-toggle":"Start or pause in-memory performance measurements.","cw-performance-copy":"Copy the current in-memory performance metrics to the clipboard.","cw-performance-reset":"Clear in-memory profiling counters, without modifying the ledger."}),ms=new Set(["cw-reset-chat","cw-clear-watchdog-data","cw-repair-short"]),fs=new Set(["cw-save-text-estimation","cw-reset-text-estimation","cw-save-attachments","cw-reset-attachments","cw-save-attachment-coefficients","cw-reset-attachment-advanced","cw-save-budget","cw-reset-budget","cw-save-settings","cw-reset-settings","cw-reset-position","cw-copy-details","cw-rescan","cw-copy-diagnostics","cw-export-ids","cw-undo-repair","cw-performance-toggle","cw-performance-copy","cw-performance-reset"]);function Nt(e,t){e&&(e.dataset.cwTip!==t&&(e.dataset.cwTip=t),e.removeAttribute("title"))}function gs(e){for(let t of e.querySelectorAll("button, input, summary, .cw-field-caption")){if(t.classList.contains("cw-tool-button")||t.classList.contains("cw-chip"))continue;let i=[...t.classList].find(o=>Sa[o]),n=t.getAttribute("title")||t.dataset.cwTip||(i?Sa[i]:null);if(t.classList.contains("cw-mini-tab")){let o=t.textContent.trim();o==="Text estimation"?n="Estimate tokens in newly captured text and code.":o==="Files & images"?n="Configure file fallback, image size and parsing limits.":o==="Attachment weights"?n="Configure how files, images and pasted text affect forecasts.":o==="Appearance"?n="Change Watchdog style and theme immediately; preferences save automatically.":o==="Technical"?n="Edit hidden-context allowances, calibration strength and the global HANDOFF prompt.":o==="Diagnostics"?n="Audit, export and explicitly repair local Watchdog records.":o==="Performance"?n="View and control in-memory performance profiling.":o==="Token budget & limits"?n="View optimistic and pessimistic usage across all three budgets.":o==="History & calibration"&&(n="View recorded chat-limit samples and calibration summary.")}if(t.tagName==="INPUT"&&!n){let o=t.closest("label"),s=o?.querySelector(".cw-field-caption");n=s?.getAttribute("title")||s?.dataset.cwTip||(o?`Edit ${o.textContent.trim().replace(/\s+/g," ")}.`:"Edit this numeric setting.")}t.tagName==="SUMMARY"&&!n&&(n=t.closest(".cw-handoff-editor")?"Expand or collapse the global HANDOFF editor; unsaved text remains in this session.":`Expand or collapse ${t.textContent.trim()}.`),n&&Nt(t,n)}}function hs(e){for(let t of e.querySelectorAll("button")){let i=[...t.classList].some(o=>ms.has(o)),n=!i&&[...t.classList].some(o=>fs.has(o));t.classList.toggle("cw-danger-action",i),t.classList.toggle("cw-text-action",n)}}function Q(e){hs(e),gs(e)}function Ca(e){let t=document.createElement("div");t.className="cw-floating-tip",t.setAttribute("role","tooltip"),t.hidden=!0,e.appendChild(t);let i=null,n=0,o=!1,s=()=>{n&&clearTimeout(n),n=0,i=null,t.hidden=!0},r=d=>{if(!d?.isConnected||!d.getClientRects().length||d===a?.chip&&!a.panel.hidden)return;if(t.replaceChildren(),d===a?.chip&&!a.chip.style.borderColor){t.append("Click on ");let g=a.siteIcon.cloneNode(!0);g.classList.add("cw-tip-logo"),t.append(g," to open or close the panel")}else t.textContent=d.dataset.cwTip;t.hidden=!1;let l=d.getBoundingClientRect(),u=t.getBoundingClientRect().width,p=t.getBoundingClientRect().height,m=J(l.left+l.width/2-u/2,8,Math.max(8,window.innerWidth-u-8)),f=l.bottom+7+p<=window.innerHeight-8?l.bottom+7:Math.max(8,l.top-p-7);t.style.left=`${m}px`,t.style.top=`${f}px`};e.addEventListener("cw-badge-dragstart",()=>{o=!0,s()}),e.addEventListener("mouseover",d=>{let l=d.target.closest?.("[data-cw-tip]");!l||l===i||l===a?.chip&&o||(s(),i=l,n=setTimeout(()=>{n=0,i===l&&r(l)},500))}),e.addEventListener("mouseout",d=>{o&&a?.chip?.contains(d.target)&&!a.chip.contains(d.relatedTarget)&&(o=!1),i&&!i.contains(d.relatedTarget)&&s()}),e.addEventListener("focusin",d=>{let l=d.target.closest?.("[data-cw-tip]");l?.matches(":focus-visible")&&(s(),i=l,r(l))}),e.addEventListener("focusout",d=>{i&&i.contains(d.target)&&s()}),e.addEventListener("click",s,!0)}var ws=new Set(["Wipe","Export IDs","UI"]),bs=new Set(["Error","TypeError","RangeError","ReferenceError","SyntaxError","QuotaExceededError","NotAllowedError","SecurityError","InvalidStateError","AbortError","NotFoundError"]),Ls=Object.freeze({Wipe:"Watchdog data could not be fully cleared","Export IDs":"Local UUID report could not be exported",UI:"Watchdog interface action could not be completed"}),ri=[],ys=0,Bn=0;function Ta(e,t){let i=ws.has(e)?e:"UI",n=t&&typeof t.name=="string"?t.name:"",o=bs.has(n)?n:"UnknownError",s=Object.freeze({id:`E${String(++ys).padStart(2,"0")}`,at:Date.now(),source:i,type:o,description:Ls[i]});return ri.push(s),ri.length>15&&ri.shift(),Bn++,s.id}function Aa(){return ri.slice()}function $a(){return Bn}function Pa(){ri.length=0,Bn++}function B(e,t){let i=String(t);e.textContent!==i&&(e.textContent=i)}function zt(){if(!a||a.performanceDetails?.hidden!==!1||!a.performanceLine||a.panel.hidden)return;let e=i=>{let n=T.timings[i];if(!n)return"no samples";let o=[...n.recent||[]].sort((r,d)=>r-d),s=o[Math.max(0,Math.ceil(o.length*.95)-1)]||0;return`${n.count} calls \xB7 avg ${(n.total/n.count).toFixed(2)} ms \xB7 p95(last ${o.length}) ${s.toFixed(2)} ms \xB7 max ${n.max.toFixed(2)} ms`},t=[`Profiling: ${T.enabled?"enabled":"paused"} \xB7 RAM only`,`Mutation batches: ${T.mutationBatches} \xB7 DOM records: ${T.mutations}`,`Repeated text records coalesced: ${T.duplicateTextMutations}`,`Observer callbacks: ${e("observerCallback")}`,`Stats calculations: ${e("stats")}`,`Queued events: ${T.queuedEvents} \xB7 processed: ${T.processedEvents}`,`Scans without changes: ${T.noChangeScans}`,`Conversation scans: ${e("conversation")}`,`DOM collections: ${e("collect")}`,`File scans: ${e("files")}`,`Image scans: ${e("images")}`,`localStorage reads: ${e("storageRead")}`,`Ledger loads: ${e("ledgerLoad")}`,`Ledger JSON.parse: ${e("ledgerParse")}`,`JSON.stringify: ${e("storageEncode")}`,`Storage setItem: ${e("storageCommit")}`,`JSON saves (total): ${e("storageWrite")}`];B(a.performanceLine,t.join(`
`)),B(a.performanceToggle,T.enabled?"Pause profiling":"Enable profiling"),Nt(a.performanceToggle,T.enabled?"Pause in-memory performance measurements.":"Start in-memory performance measurements.")}function A(e=y(),t=null,i=null){Vt();let n=t||X(e),o=i||bt(),s=!a.panel.hidden&&!a.settingsDialog?.open&&!a.aboutDialog?.open&&!a.limitDialog?.open&&!a.confirmDialog?.open,d=!C()||s?(()=>{let u=Ke(e);return{confirmed:u,status:oi(n,o,u)}})():null;vs(n,o,e,d),kt();let l=pn();if(a.storageWarning.hidden=!l,a.storageIndicator.hidden=!l,a.chip.style.borderColor=l?"#dc2626":"",l&&B(a.storageWarning,l),Nt(a.chip,l||"Click the Watchdog logo to open or close the panel"),!a.panel.hidden){if(a.settingsDialog?.open||a.aboutDialog?.open||a.limitDialog?.open||a.confirmDialog?.open){a.settingsDialog?.open&&a.diagnosticsDetails?.hidden===!1&&a.diagnosticsDetails.dataset.mounted==="true"&&St(n,e);return}Ss(n,o,e,d),pe==="context"&&ks(n,e,d),pe==="budget"&&(Cs(n,o,e,d),Ps(n,o,e,d),a.historyDetails?.hidden===!1&&a.historyDetails.dataset.mounted==="true"&&Un(o)),pe==="details"&&Ts(n,o,e,d)}}function kt(){if(!a)return;let e=!Ti(),t=C(),i=e?"Available in chats only":t?"Resume Watchdog":"Pause Watchdog";a.pauseToggle.disabled=e,a.pauseToggle.dataset.cwPlaying=String(!t),a.pauseToggle.setAttribute("aria-label",i),Nt(a.pauseToggle,i),Nt(a.pauseControl,i);for(let n of[a.rescan,a.endChat])n&&(n.disabled=t);for(let n of[a.repairShort,a.undoRepair])n&&(n.disabled=t||n.hidden);t?(a.average.hidden=!0,a.chipStatus.hidden=!0,a.pausedLabel.hidden=!1,a.chip.dataset.cwBadgeMode="paused"):a.chip.dataset.cwBadgeMode==="paused"&&(a.average.hidden=!0,a.chipStatus.hidden=!0,a.pausedLabel.hidden=!0,a.chip.dataset.cwBadgeMode="minimal")}function Ke(e){return!e||!w||e.chatKey!==w||x.route?!1:Object.keys(e.messages||{}).length>0||Object.values(e.files||{}).some(t=>!!t?.messageId)?!0:Object.values(e.domImages||{}).some(t=>!!t?.messageId)}function vs(e,t,i=null,n=null){if(!a)return;if(C()){kt();return}let o=n?n.confirmed:Ke(i);if(a.pausedLabel.hidden=!0,a.average.hidden=!o,a.chipStatus.hidden=!o,a.chip.dataset.cwBadgeMode=o?"normal":"minimal",!o)return;let s=(e.optimistic+e.pessimistic)/2;B(a.average,`\u2248 ${pa(s)}k`);let r=(n?n.status:oi(e,t)).level;a.chipStatus.dataset.level!==r&&(a.chipStatus.dataset.level=r)}function qe(e){return ya(e,1)}function Bt(e){return Math.round(Number(e)||0).toLocaleString("en-US")}function xs(e){let t=e.knownFileCount||0,i=e.totalFileBytes||0,n=e.unknownSizeFiles||0,o=i>0?Ho(i):"size unknown",s=i>0&&n?` \xB7 +${n} unknown size`:"",r=[`${e.parsedFiles||0} parsed`,`${e.unparsedFiles||0} unparsed`,`${e.autoPasteMinimumFiles||0} auto-paste`,`${e.reactMetadataFiles||0} React metadata`,`${e.metadataFiles||0} metadata-only`];return{files:t?`${t} \xB7 ${o}${s}`:"none",coverage:r.slice(0,3).join(" \xB7 "),coverageExtra:r.slice(3).join(" \xB7 ")}}function ks(e,t,i=null){B(a.dataChars,Bt(e.chars)),B(a.dataTokens,`\u2248 ${qe(e.tokens)}`),B(a.contextMessages,`${Bt(e.turns)} \xB7 user ${Bt(e.userTurns)} / AI ${Bt(e.assistantTurns)}`),B(a.contextRange,(i?i.confirmed:Ke(t))?`\u2248 ${qe((e.optimistic+e.pessimistic)/2)} tokens`:"None");let n=xs(e);B(a.dataFiles,n.files),B(a.dataQuality,n.coverage),B(a.dataQualityExtra,n.coverageExtra);let o=e.knownImages||0;B(a.dataImages,o?`${o} \xB7 \u2248 ${qe(e.knownImageTokens||0)} tokens`:"none")}function Ss(e,t,i=y(),n=null){let o=n?n.status:oi(e,t,Ke(i));a.budgetTabMark.dataset.level!==o.level&&(a.budgetTabMark.dataset.level=o.level);let s=`Budget forecast: ${o.label}`;a.budgetTab.getAttribute("aria-label")!==s&&a.budgetTab.setAttribute("aria-label",s)}function Cs(e,t,i=y(),n=null){let o=n?n.confirmed:Ke(i);a.budgetUnavailable.hidden=o,a.forecastHeading.hidden=!o,a.forecastCards.hidden=!o;for(let d of a.budgetView.querySelectorAll(".cw-forecast-group"))d.hidden=!o;if(!o)return;B(a.forecastOpt,`\u2248 ${qe(e.optimistic)}`),B(a.forecastPess,`\u2248 ${qe(e.pessimistic)}`);let s=[["Opt",e.optimistic],["Pess",e.pessimistic]],r=[["C",t.conservative],["N",t.normal],["O",t.optimistic]];for(let[d,l]of s)for(let[u,p]of r){let m=Ii(l,p),f=a[`percent${d}${u}`];B(f,`${m}%`);let g=a[`progress${d}${u}`],b=Math.max(0,Math.min(100,m)),h=`${b}%`,S=m>100?"rgb(239, 68, 68)":"";g.style.width!==h&&(g.style.width=h),g.style.backgroundColor!==S&&(g.style.backgroundColor=S);let k=b>=35,I=k?"0%":h,z=`${k?b:100-b}%`;f.style.left!==I&&(f.style.left=I),f.style.width!==z&&(f.style.width=z);let $=String(k);f.dataset.cwOnFill!==$&&(f.dataset.cwOnFill=$)}}function zn(e,t,i=!0){let n=l=>Number.isFinite(l)?Bt(l):"none",o=l=>Number.isFinite(l)?`\u2248 ${n(l)} tokens`:"none",s=(l,u)=>Number.isFinite(l)&&Number.isFinite(u)?l===u?n(l):`${n(l)}\u2013${n(u)}`:"none",r=(l,u)=>{let p=s(l,u);return p==="none"?p:`${p} tokens`},d=l=>i&&Number.isFinite(l)&&l>0&&Number.isFinite(e.optimistic)&&Number.isFinite(e.pessimistic)?`${s(e.optimistic,e.pessimistic)} / ${n(l)} tokens`:"none";return[[`Messages: ${n(e.turns)} total`,`Roles: ${n(e.userTurns)} user \xB7 ${n(e.assistantTurns)} assistant \xB7 ${n(e.otherTurns)} other`,`Message length: ${n(e.chars)} characters`,`Messages with UUID: ${n(e.uuidMessages)}`],[`Files: ${n(e.knownFileCount)}`,`Known size: ${e.totalFileBytes>0?`${n(e.totalFileBytes)} bytes`:"none"}`,`Unknown size: ${n(e.unknownSizeFiles)} files`,`Parsed: ${n(e.parsedFiles)} \xB7 Metadata-only: ${n(e.metadataFiles)} \xB7 Unparsed: ${n(e.unparsedFiles)}`,`React metadata: ${n(e.reactMetadataFiles)} files`,`Auto-paste minimum: ${n(e.autoPasteMinimumFiles)} files`,`Auto-paste assumed text: ${n(e.autoPasteMinimumChars)} characters`,`Fully read: ${n(e.fullyReadTextFiles)} files`,`Sampled: ${n(e.sampledTextFiles)} files`,`Parsed file estimate: ${o(e.knownFileTokens)}`,"Parsed file estimate is weighted in the forecast; no age-based reduction."],[`Effective images: ${n(e.knownImages)}`,`Locally captured: ${n(e.capturedImages)} images`,`Found in history: ${n(e.historicalImages)} images`,`Raw image estimate: ${o(e.knownImageTokens)}`,"Effective count is deduplicated. Tokens before weighting."],[`Message text: ${o(e.tokens)}`,`Files: ${r(e.fileOptimistic,e.filePessimistic)}`,`Images: ${r(e.imageOptimistic,e.imagePessimistic)}`,`Hidden context: ${r(L.hiddenOptimistic,L.hiddenPessimistic)}`,`Total context: ${i?r(e.optimistic,e.pessimistic):"none"}`,i?"Ranges: optimistic\u2013pessimistic.":"No context estimate yet."],[`Conservative: ${d(t.conservative)}`,`Normal: ${d(t.normal)}`,`Generous: ${d(t.optimistic)}`,i?"Estimated usage / context budget.":"No context estimate yet."]]}function Ma(e,t,i){return e>0&&t===i-1}function Ea(e){return e.map((t,i)=>t.filter((n,o)=>!Ma(i,o,t.length)).join(`
`)).join(`

`)}function Ts(e,t,i,n=null){let o=zn(e,t,n?n.confirmed:Ke(i));for(;a.detailsReport.children.length<o.length;){let s=document.createElement("div");s.className="cw-detail-group",a.detailsReport.appendChild(s)}for(;a.detailsReport.children.length>o.length;)a.detailsReport.lastElementChild.remove();for(let[s,r]of o.entries()){let d=a.detailsReport.children[s];for(;d.children.length<r.length;)d.appendChild(document.createElement("div"));for(;d.children.length>r.length;)d.lastElementChild.remove();for(let[l,u]of r.entries()){let p=d.children[l];p.classList.toggle("cw-detail-legend",Ma(s,l,r.length)),B(p,u)}}}function As(e){let t=e,i=t.reasons?.length?` [reason ${t.reasons.join("+")}; chars \u0394${(t.domChars??0)-(t.storedChars??0)}; tokens ${t.storedTokens??"-"}\u2192${t.domTokens??"-"} (\u0394${(t.domTokens??0)-(t.storedTokens??0)}); hash ${t.fingerprintStatus}; DOM prose/code ${t.proseChars??"-"}/${t.codeChars??"-"}]`:"",n=t.scope?` [${t.scope}\xD7${t.roots}]`:"";return`${t.kind} ${t.idSuffix} ${t.storedChars??"-"}\u2192${t.domChars??"-"}${i}${n}`}function $s(e){if(!e)return"AUDIT not run (click Audit; only rendered messages checked)";let t=e.scopeCounts,i=[`AUDIT ${new Date(e.at).toLocaleTimeString()} (${e.visible} unique / ${e.raw} raw DOM, read-only${e.routeUnverified?", ROUTE UNVERIFIED":""}): ${e.verified} verified, ${e.missing} missing, ${e.storedShort} short stored, ${e.domShort} short DOM, ${e.different} different, ${e.roleChanged} role mismatch, ${e.noStableId} no ID, ${e.ambiguous} ambiguous, ${e.collapsed} merged views, ${e.unhydrated} unhydrated, ${e.duplicateIds} duplicate after merge`,`Audit repair: ${e.eligibleRepairs?.length||0} confirmed, ${e.repairRepeatNeeded||0} need a repeat Audit; manual confirmation only`,`Audit units: user ${e.unitRoles?.user||0}, assistant ${e.unitRoles?.assistant||0}, real UUIDs ${e.unitRoles?.realIds||0}`,`Audit text scopes: unit-user ${t["unit-user"]}, unit-user-text ${t["unit-user-text"]}, unit-markdown ${t["unit-markdown"]}, unit-assistant ${t["unit-assistant"]}; fallback ${t.fallback} \xB7 content roots ${e.contentRoots}`];return e.different&&i.push(`Audit different reasons: chars ${e.differenceReasons.chars}, tokens ${e.differenceReasons.tokens}, fingerprint ${e.differenceReasons.fingerprint} (hash-only ${e.differenceReasons.hashOnly}); categories can overlap`),e.examples.length&&i.push(`Audit samples: ${e.examples.map(As).join("; ")}`),i.join(`
`)}function Oa(){if(!a?.recentErrorsList)return;let e=a.recentErrorsList,t=String($a());if(e.dataset.cwErrorRevision===t)return;let i=Aa();if(!i.length)e.textContent="No errors recorded. All good.";else{let n=i.slice().reverse().map(o=>{let s=document.createElement("div");s.className="cw-recent-error-entry";let r=new Date(o.at).toLocaleTimeString();return s.textContent=`${o.id} \xB7 ${o.source} \xB7 ${o.type} \xB7 ${r} \xB7 ${o.description}`,s});e.replaceChildren(...n)}e.dataset.cwErrorRevision=t}function St(e,t,i=Xe){Oa();let n=f=>f===null?"?":f?"yes":"no",o=pn(),s=ke?`last commit ${new Date(ke.at).toLocaleTimeString()}: +${ke.added} new, ${ke.changed} changed, ${ke.unchanged} unchanged (counted user ${ke.user}, AI ${ke.assistant}, other ${ke.other}) \xB7 ${nn}`:"last commit: none",r=$s(De),d=De?.eligibleRepairs?.length||0;a.repairShort.hidden=d===0,a.repairShort.disabled=d===0||C(),d&&B(a.repairShort,`Repair confirmed (${d})`);let l=t.repairHistory?.at(-1),u=!!(l?.id&&l.before&&l.after&&JSON.stringify(t.messages?.[l.id])===JSON.stringify(l.after));a.undoRepair.hidden=!u,a.undoRepair.disabled=!u||C();let p=va(),m=p.gate;B(a.diagnosticsLine,`${e.turns} stored (user ${e.userTurns}, AI ${e.assistantTurns}, other ${e.otherTurns}) \xB7 ${ie.visible} visible / ${ie.raw} raw
Collector: ${ie.collapsed} merged, ${ie.ambiguous} ambiguous IDs, ${ie.noLayout} no-layout skipped
${ie.name} \xB7 ${p.phase} \xB7 pending ${n(p.completion)} \xB7 initial ${n(p.initial)}
Stop ${n(i.stop)} \xB7 Send ${n(i.send)} \xB7 actions ${n(i.actions)}
IDs: UUID ${e.uuidMessages}, unambiguous-only; unsupported IDs skipped
Auto-paste: ${e.autoPasteMinimumFiles||0} inferred minimums (\u2265${e.autoPasteMinimumChars||0} chars total; text not read)
User-only attachments: ${e.knownFileCount||0} files`+(o?`
STORAGE ERROR: ${o}`:"")+(p.routePending&&m?`
Route gate: ${m.reason}; UUIDs ${m.visible}, destination-known ${m.destinationKnown}, outgoing-only ${m.outgoingOnly}, old nodes ${m.outgoingMounted}, shared ${m.shared}`:"")+`
${s} \xB7 first-seen backfill, write-once, revision targets ${D.size}, deferred ${lt}, hydration pending ${Y.size}
${r}
${w||"awaiting chat UUID"}`)}function Ps(e,t,i=y(),n=null){let o=n?n.status:oi(e,t,Ke(i));B(a.status,o.label),a.status.style.color=o.color}function Un(e){let t=Go(),i=o=>t.n&&Number.isFinite(o)?`${Bt(o)} tokens`:"none",n=Number.isFinite(e.historyWeight)?e.historyWeight.toFixed(2):"none";B(a.history,[`Recorded limit samples: ${t.n}`,`Average message text: ${i(t.avgSeen)}`,`Average optimistic context: ${i(t.avgOptimistic)}`,`Average pessimistic context: ${i(t.avgPessimistic)}`,`Calibration weight: ${n}`].join(`
`)),a.history.removeAttribute("title")}function Ms(){clearTimeout(v._timer),v._timer=null,a&&(a.toast&&(a.toast.hidden=!0),a.dialogMessage&&(a.dialogMessage.hidden=!0,a.dialogMessage.removeAttribute("title")))}function v(e,t=4500,i=null){Vt(),clearTimeout(v._timer);let n=a;if(n.toast.textContent=e,n.toast.dataset.cwNoticeLevel=i||(/\b(error|failed|failure|unavailable|corrupt|refused|cannot|incomplete)\b|could not/i.test(e)?"error":"info"),n.toast.hidden=!1,n.dialogMessage)if(!!n.settingsDialog?.open&&!n.confirmDialog?.open){let s=/^Audit: (\d+) verified, no detected issues in rendered messages\.$/.exec(e);B(n.dialogMessage,s?`Audit OK \xB7 ${s[1]} verified`:e),n.dialogMessage.title=e,n.dialogMessage.hidden=!1}else n.dialogMessage.hidden=!0,n.dialogMessage.removeAttribute("title");v._timer=setTimeout(()=>{a===n&&Ms()},t)}function Ui(e,t,i="Operation failed"){let n=Ta(e,t);return Oa(),v(`${i} \xB7 ${n}`,4500,"error"),n}function Da(e){let t=document.querySelector("textarea#prompt-textarea")||document.querySelector('textarea[data-testid="prompt-textarea"]');if(t){if(t.value.length>0)return"occupied";let n=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")?.set;return n?n.call(t,e):t.value=e,t.dispatchEvent(new Event("input",{bubbles:!0})),t.dispatchEvent(new Event("change",{bubbles:!0})),t.focus(),"inserted"}let i=document.querySelector('#prompt-textarea[contenteditable="true"]')||document.querySelector('[contenteditable="true"][data-testid="prompt-textarea"]')||document.querySelector('form [contenteditable="true"]');if(i){if(i.textContent?.length||i.querySelector('img, video, audio, canvas, [contenteditable="false"], [data-type="image"], [data-type="file"], [data-testid*="attachment"]'))return"occupied";i.focus();let n=document.createRange();return n.selectNodeContents(i),n.deleteContents(),e.split(`
`).forEach((s,r)=>{r&&i.appendChild(document.createElement("br")),i.appendChild(document.createTextNode(s))}),i.dispatchEvent(new InputEvent("input",{bubbles:!0,inputType:"insertText",data:e})),"inserted"}return"missing"}async function Ra(e,t="missing"){let i=t==="occupied";try{await navigator.clipboard.writeText(e),v(i?"Your draft was left untouched. HANDOFF prompt copied to clipboard.":"Composer not detected. HANDOFF prompt copied to clipboard instead.")}catch{v(i?"Draft left untouched; clipboard write failed. Allow clipboard access and try again.":"Composer not detected and clipboard write failed. Open the panel after the composer appears.")}}async function Es(e,t=()=>!0){let i=Jt(e.name);if(Ei(e))return{tokens:Math.max(1,Math.round(L.averageImageTokens)),method:"image-average",detail:`${Math.round(e.size/1024)} KiB`};if(bn(i)||(e.type||"").startsWith("text/")){let n=Math.min(Li,Math.max(0,Number(L.localFileParsingLimitMiB??Xi)));if(n===0||e.size>n*1024*1024)return{tokens:0,method:"too-large",metadataOnly:!0,detail:`>${n} MiB local limit`};let o=10*1024*1024;if(e.size<=o){let p=await e.text();return t()?{tokens:Mi(p),method:"text"}:null}let s=await e.slice(0,o).arrayBuffer();if(!t())return null;let r=new TextDecoder("utf-8").decode(s,{stream:!0}),d=s.byteLength;if(!d)return{tokens:0,method:"text-extrapolated",detail:"Empty text sample"};let l=Mi(r);return{tokens:Math.max(0,Math.round(l*e.size/d)),method:"text-extrapolated",detail:`First 10 MiB sampled; ${Math.round(e.size/(1024*1024))} MiB total (estimated)`}}return{tokens:0,metadataOnly:!0,method:"metadata-size",detail:`${Math.round(e.size/1024)} KiB`}}var Os=900*1e3,Ge=new Map;function Ut(e=null){for(let[t,i]of Ge)(e===null||i.chatKey===e)&&Ge.delete(t)}function Ia(){if(!C())for(let[e,t]of Ge){if(F(t.chatKey)!==t.epoch||R.has(t.chatKey)){Ge.delete(e);continue}let i=y(t.chatKey).files[t.fileKey];if(!i||i.status!=="reading"||i.messageId!==t.messageId||i.name!==t.file.name||i.size!==t.file.size){Ge.delete(e);continue}Promise.resolve(Wi(t.file,t.source,t.chatKey,t.messageId,n=>{n&&Ge.get(e)===t&&Ge.delete(e)},t.result)).catch(()=>{console.warn("[Context Watchdog] deferred file resumption failed")})}}function Fa(e,t,i=null){for(let n of e.querySelectorAll('[title], [aria-label], [data-testid*="attachment"], [data-testid*="file"]')){if(!Ae(n)||n.closest?.('[contenteditable="true"], textarea')||i&&n.closest?.("form")&&n.closest("form")!==i)continue;if([n.getAttribute("title"),n.getAttribute("aria-label"),n.textContent?.length<=180?n.textContent:""].some(s=>j(s)===t))return!0}return!1}function Ds(e,t){let i=j(t);if(!i||!Ae(e))return!1;if(Fa(e,i))return!0;let n=e.closest("#composer-background");return!!n&&Ae(n)&&Fa(n,i,e)}function Wn(e){if(C())return;let t=Date.now();for(let i=E.length-1;i>=0;i--){let n=E[i];if(n.used||n.chatKey!==w||t-n.selectedAt>Os||t-n.selectedAt<0){E.splice(i,1);continue}if(!Ds(e,n.file.name)){E.splice(i,1);continue}n.submittedAt=t}}function Rs(e,t){if(C()||!e?.name)return;let i=w,n=`${wn(e)}|${i||"new-chat"}`;if(E.some(s=>s.identity===n&&!s.used))return;let o=new Set(Object.keys(y(i).messages));for(let s of jo(q().nodes))o.add(s);for(E.push({file:e,source:t,chatKey:i,identity:n,used:!1,existingMessageIds:o,selectedAt:Date.now(),submittedAt:0,boundMessageId:null,boundEpoch:null});E.length>16;)E.shift()}function Na(e){if(!C())for(let[t,i]of _){if(i.chatKey!==e)continue;if(F(e)!==i.epoch||R.has(e)){_.delete(t);continue}let n=y(e),o=n.files[i.fileKey];if(!o||o.status!=="reading"||o.messageId!==i.messageId||o.name!==i.name||o.size!==i.size){_.delete(t);continue}n.files[i.fileKey]={...o,...i.result},ae(n)&&(_.delete(t),[..._.values()].some(s=>s.chatKey===e)||(K.delete(e),de(!1)),w===e&&A(n))}}async function Wi(e,t,i,n,o=()=>{},s=null){if(C()){o(!1);return}if(!e?.name||!i||!n){o(!1);return}let r=`sent-file:${ht(`${n}|${wn(e)}`)}`,d=y(i);if(R.has(i)){o(!1);return}let l=Object.keys(d.files).filter(b=>{let h=d.files[b];return h?.messageId===n&&h?.metadataOnly&&j(h.name)===j(e.name)&&nt(h.size,e.size)}),u=l.length===1?l[0]:null,m={...u&&u!==r?d.files[u]:{},...d.files[r]||{}};if(m.status==="ready"&&!m.metadataOnly){o(!0);return}if(u&&u!==r&&delete d.files[u],d.files[r]={...m,name:e.name,size:e.size,type:e.type||"",lastModified:e.lastModified||0,source:t,messageId:n,metadataOnly:!1,method:"",status:"reading",tokens:m.tokens||0,addedAt:m.addedAt||Date.now(),lastSeenAt:Date.now()},!ae(d)){o(!1),w===i&&A(y());return}o(!0),w===i&&A(d);let f=F(i);Le.set(i,f);let g=b=>F(i)===f&&b.files[r]?.status==="reading";try{let b=s||await Es(e,()=>!C()&&F(i)===f);if(F(i)!==f)return;if(C()||b===null){Ge.set(`${i}|${r}`,{file:e,fileKey:r,source:t,chatKey:i,messageId:n,epoch:f,result:b});return}let h=y(i);if(R.has(i)||!g(h))return;h.files[r]={...h.files[r]||d.files[r],tokens:Number(b.tokens)||0,method:b.method||"unknown",detail:b.detail||"",metadataOnly:!!b.metadataOnly,status:b.method==="error"?"error":"ready",lastSeenAt:Date.now()};let S={...h.files[r]};ae(h)?w===i&&A(h):F(i)===f&&_.set(`${i}|${r}`,{chatKey:i,fileKey:r,messageId:n,name:e.name,size:e.size,epoch:f,result:S})}catch{if(F(i)!==f)return;if(C()){Ge.set(`${i}|${r}`,{file:e,fileKey:r,source:t,chatKey:i,messageId:n,epoch:f,result:{tokens:0,method:"error",detail:"Local file estimation failed",metadataOnly:!1}});return}let h=y(i);if(R.has(i)||!g(h))return;h.files[r]={...h.files[r]||d.files[r],status:"error",method:"error",detail:"Local file estimation failed",lastSeenAt:Date.now()};let S={...h.files[r]};ae(h)?w===i&&A(h):F(i)===f&&_.set(`${i}|${r}`,{chatKey:i,fileKey:r,messageId:n,name:e.name,size:e.size,epoch:f,result:S}),console.warn("[Context Watchdog] local file estimate failed")}}function Hn(e,t){for(let i of Array.from(e||[]))Rs(i,t)}function Ba(){let e=Co;document.addEventListener("click",t=>{let i=t.target?.closest?.(Rt.send);if(i&&!i.disabled){let n=e(i);n&&Wn(n)}},!0),document.addEventListener("submit",t=>{let i=e(t.target);i&&Wn(i)},!0),document.addEventListener("keydown",t=>{if(t.key!=="Enter"||t.shiftKey||t.isComposing||t.repeat)return;let i=t.target;if(!i?.closest?.('#prompt-textarea, [contenteditable="true"]'))return;let n=e(i);n&&Wn(n)},!0),document.addEventListener("change",t=>{let i=t.target;i instanceof HTMLInputElement&&i.type==="file"&&i.files?.length&&Hn(i.files,"file-input")},!0),document.addEventListener("drop",t=>{t.dataTransfer?.files?.length&&Hn(t.dataTransfer.files,"drop")},!0),document.addEventListener("paste",t=>{t.clipboardData?.files?.length&&Hn(t.clipboardData.files,"paste")},!0)}function za(e){if(C())return;let t=e.target?.closest?.('button, [role="button"]');if(!t||t.closest?.(`#${c}-root`))return;let i=(t.getAttribute("aria-label")||t.getAttribute("title")||t.textContent||"").trim();if(/^(?:cancel|отмена)(?:\s|$)/i.test(i)){D.clear(),H.clear();return}if(!/^(?:edit(?:\s+message)?|редактировать(?:\s+сообщение)?|regenerate(?:\s+(?:response|answer))?|сгенерировать\s+ответ\s+заново)(?:\s|$)/i.test(i))return;let n=[...ye(q().nodes)],o=t.closest?.('[data-message-id], [data-turn-key], [data-testid^="conversation-turn-"]'),s=o&&n.find(({el:u})=>o.contains(u)||u.contains(o)),r=n.findLast(({role:u})=>u==="assistant"),d=new Set([s?.id,r?.id].filter(Boolean));if(!d.size)return;let l=uo(tn+1);for(let u of d)D.set(u,l),H.delete(u)}function Ua(e,t){if(!t||!(["messages","files","domImages"].some(o=>Object.keys(t[o]||{}).length)||(t.repairHistory||[]).length))return!0;let n=y(e);for(let o of["messages","files","domImages"])n[o]={...t[o],...n[o]};return n.repairHistory=[...t.repairHistory||[],...n.repairHistory||[]],ae(n)}function at(){xi(null),$t.clear()}function _n(e=w){let t=oe.get(e);return t?t.epoch!==(Le.get(e)||0)?(oe.delete(e),!1):Ua(e,t.draft)?(oe.delete(e),!0):!1:!0}function Hi(e=G()){if(e===w)return!1;if(te&&(cancelAnimationFrame(te),Ce(0)),e&&!w&&ct){let t=ct;oe.set(e,{draft:t,epoch:Le.get(e)||0}),_n(e)}if(e&&!w)for(let t of E)t.chatKey===null&&(t.chatKey=e);return w&&(E.length=0),Fe(null),lo(e),et({stop:!1,send:!1,actions:null}),Ie(null),at(),D.clear(),H.clear(),le(null),Y.clear(),ue&&clearTimeout(ue),Ue(0),pt(new WeakMap),Te(new WeakMap),we(0),x.route=null,x.work.backfill=!1,be("navigation"),!0}function Fs(){let e=new Set,t=new WeakMap;for(let{el:i,id:n}of ye(q().nodes))t.set(i,n||null),n&&e.add(n);return{beforeIds:e,beforeNodes:t}}function si(e=null){if(!x.route)return!0;let{beforeIds:t,beforeNodes:i,outgoingKnownIds:n}=x.route,o=(e||q()).nodes,s=new Set,r=0;for(let{el:f,id:g}of ye(o))g&&s.add(g),i.has(f)&&i.get(f)===(g||null)&&r++;let d=y().messages,l=0,u=0,p=0;for(let f of s){let g=!!d[f],b=!!n?.has(f);g&&l++,b&&g?p++:b&&u++}let m=f=>(x.route.gate={reason:f,visible:s.size,destinationKnown:l,outgoingOnly:u,outgoingMounted:r,shared:p},f==="confirmed");return s.size?u?m("outgoing-only IDs still visible"):r?m("outgoing DOM nodes still mounted"):l||[...s].some(f=>!t.has(f)&&!n?.has(f))?m("confirmed"):m("waiting for fresh destination UUIDs"):m("awaiting DOM UUIDs")}function Ve(){let e=G();if(e===w)return!1;let t=!w&&!!e,i=t&&x.work.completion,n=t?null:Fs(),o=!t&&w?new Set(Object.keys(y(w).messages||{})):null;return Hi(e)?(Bi(n,o,i),A(y()),!0):!1}function ci(e=null){return x.route&&!si(e)?(fe(x.route.gate?.visible?"switching":"awaiting-uuid")&&A(y()),!1):!0}function Wa(e){let t=new Array(e.length).fill(!1),i=!1,n=-1;for(let o=e.length-1;o>=0;o--)t[o]=i,e[o].role==="user"&&(i=!0),n<0&&e[o].role==="assistant"&&(n=o);return{laterUser:t,lastAssistantIndex:n}}function Is(e){return!!e.closest?.('[data-turn-key], [data-testid^="conversation-turn-"]')?.querySelector?.(Ft)}function Ha(e=420){if(ue)return;let t=w;Ue(setTimeout(()=>{Ue(0),!(document.hidden||w!==t||!Y.size)&&(ne(),C()||se())},e))}function _a(e,t){let i=Y.get(e),n=`${t.chars}:${t.fingerprint}`;if(!i||i.snapshot!==n)return Y.set(e,{snapshot:n,seenAt:Date.now()}),Ha(),!1;let o=Date.now()-i.seenAt;return o<400&&Ha(Math.max(30,410-o)),o>=400}function _i(e,t=!1){return!!(e.hidden||e.closest?.('[hidden], [inert], [aria-busy="true"]')||e.querySelector?.(t?'[aria-busy="true"], [data-state="loading"], [data-testid*="skeleton"]':'[aria-busy="true"], [data-state="loading"]'))}function ja(e,t,i,n,o){if(t!=="user"&&t!=="assistant"||!Qt(e,t)?.startsWith("msg:")||n.parts.source==="fallback"||_i(e,!0))return!1;let r=n.parts.prose+`
`+n.parts.code;if(!Dt(r)||/^(?:loading|загрузка|загружаем|подождите|please wait)[.…! ]*$/i.test(r.trim()))return!1;if(t==="user")return n.chars>=24?(Y.delete(i),!0):_a(i,n);let d=Is(e);return!d&&!o?!1:n.chars<64||!d?_a(i,n):(Y.delete(i),!0)}function qa(e,t,i,n,o){let s=e.messages[t];return s&&!D.has(t)||s&&s.fingerprint===n.fingerprint&&s.chars===n.chars&&s.role===i?(o.unchanged++,!1):(e.messages[t]={role:i,tokens:n.tokens,chars:n.chars,fingerprint:n.fingerprint},Y.delete(t),s?o.changed++:o.added++,i==="user"?o.user++:i==="assistant"?o.assistant++:o.other++,!0)}function Ka(e,t,i,n,o,s,r=new Map){let d=!1,{laterUser:l,lastAssistantIndex:u}=Wa(e);for(let{index:p,el:m,role:f,id:g}of e){if(!_e(g,t)){g||we(lt+1)-1;continue}if(g&&i.messages[g]&&!D.has(g)){s.unchanged++;continue}let b=D.get(g),h=b!==void 0&&n==="ready"&&(o||H.get(g)===b);if(b!==void 0&&!h){we(lt+1)-1;continue}let S=Yt(m,f);if(!S.chars)continue;let k=g;if(!(n==="ready"&&o&&(f==="user"||f==="assistant"&&p===u))&&!D.has(k)&&!ja(m,f,k,S,l[p])){we(lt+1)-1;continue}qa(i,k,f,S,s)&&(d=!0,h&&r.set(k,b))}return d}function li({commitCompleted:e=!1,backfill:t=!1,reason:i="inspection",collected:n=null,inspectedMode:o=null}={}){if(C())return{status:"paused"};let s=W();try{if(Ve())return{status:"deferred"};if(!ci(n))return{status:"deferred"};if(zi(),!w)return fe("awaiting-uuid",!1),A(y()),{status:"deferred"};let r=o||je(n?()=>n:q);if(fe(r,!1),r==="generating")return A(y()),{status:"deferred"};if(Na(w),Qe){let $=Qe;if($.chatKey!==w||$.epoch!==F(w)){for(let[O,ee]of $.revisions)D.get(O)===ee&&(D.delete(O),H.delete(O));le(null)}else if(ae($.state)){for(let[O,ee]of $.revisions)D.get(O)===ee&&(D.delete(O),H.delete(O));In($.fileJobs,Wi),le(null)}else return Ie({...$.commit,added:0,changed:0,failed:!0}),be("retry \xB7 STORAGE WRITE FAILED"),A(y()),{status:"failed"}}let d=n||q(),l=d.nodes;Di(d),xa(l.length>0);let u={added:0,changed:0,unchanged:0,user:0,assistant:0,other:0,at:Date.now()};if(!e&&!t||r!=="ready"&&r!=="unknown")return be(i),Ie(u),A(y()),{status:"unchanged"};let p=y();if(e&&r==="ready")for(let[$,O]of D)H.set($,O);we(0);let m=ei(d),f=m.filter($=>_e($.id,d)),g=!1,b=[];wa(f,p,b)&&(g=!0);let h=ha(f,p);h.changed&&(g=!0);let S=new Map;Ka(m,d,p,r,e,u,S)&&(g=!0);let k=!g||ae(p);if(T.enabled&&k&&!g&&T.noChangeScans++,k){for(let $ of b)Kt.set($.turn,$),Se.delete($.turn);for(let{turn:$,messageId:O}of h.inspected)qt.set($,`${p.chatKey}|${O}`),Ne.delete($)}if(!k)return le({chatKey:p.chatKey,state:p,epoch:F(p.chatKey),revisions:[...S],fileJobs:h.jobs,commit:{...u}}),Ie({...u,added:0,changed:0,failed:!0}),be(`${i} \xB7 STORAGE WRITE FAILED`),A(y()),{status:"failed"};for(let[$,O]of S)D.get($)===O&&(D.delete($),H.delete($));In(h.jobs,Wi),Ie(u),be(i);let I=X(p),z=bt();return A(p,I,z),{status:g?"persisted":"unchanged"}}finally{U("conversation",s)}}function ji(e){fe(e)&&A(y())}function Ns(){if(C())return;if(T.enabled&&T.processedEvents++,w&&_n(w),document.hidden){if(!E.some(o=>me(o,w)&&!o.boundMessageId)||Ve()||!w)return;let n=q();if(!ci(n))return;Ni(ei(n).filter(o=>_e(o.id,n)),w);return}if(Ve())return;if(!w){let n=je();n==="generating"&&It(!0),ji(n);return}let e=null,t=()=>e||(e=q());if(!ci(x.route?t():null))return;x.route&&zi();let i=je(t);if(i==="generating"){if(It(!0),ji("generating"),E.some(n=>me(n,w)&&!n.boundMessageId)){let n=t();Ni(ei(n).filter(o=>_e(o.id,n)),w)}return}if(i==="ready"&&ka()){let n=x.work.completion;if(n){let s=yn(t());if(Xe.actions=s,!s){ji("finishing");return}}let o=x.work.backfill;It(!1),fe("ready",!1),li({commitCompleted:n,backfill:!0,reason:n?"response finished + unseen history":o?"DOM mount/scroll backfill":"initial/navigation backfill",collected:e,inspectedMode:i});return}if(i==="unknown"&&(x.work.initial||x.work.backfill)){fe("unknown",!1),li({commitCompleted:!1,backfill:!0,reason:"DOM backfill (composer unknown; per-message finality)",collected:e,inspectedMode:i});return}ji(i)}function se(e="urgent"){if(!C()){if(e==="background"&&!x.work.completion&&!x.route&&!x.work.initial&&!ki){te||Ce(requestAnimationFrame(()=>{Ce(0),se()}));return}te&&(cancelAnimationFrame(te),Ce(0)),!ki&&(rn(!0),T.enabled&&T.queuedEvents++,queueMicrotask(()=>{rn(!1),C()||Ns()}))}}function Ga(){if(C())return{status:"paused"};if(!w)return{status:"missing-chat"};let e=y();if(R.has(w))return{status:"corrupt-ledger"};let t=X(e),i=[...wt()];if(dt)return{status:"corrupt-history"};let n=w,o={chatKey:n,savedAt:Date.now(),seen:Math.round(t.tokens),optimistic:Math.round(t.optimistic),pessimistic:Math.round(t.pessimistic),knownAttachmentTokens:Math.round(t.knownTokens||0),knownImages:Math.round(t.knownImages||0),turns:Math.round(t.turns||0)},s=i.findIndex(f=>f.chatKey===n);s>=0?i[s]=o:i.push(o);let r=L.budgetCalibrationBase||Vo(),d=i.filter(f=>Number.isFinite(Number(f.seen))&&Number.isFinite(Number(f.pessimistic))),l=kn(d),u=Zo(r,l),p=[...wt()],m={...L};return xn(i)?(Object.assign(L,{budgetCalibrationBase:r,conservativeBudget:u.conservativeBudget,normalBudget:u.normalBudget,optimisticBudget:u.optimisticBudget,budgetCalibrationWeight:u.weight}),V()?{status:"saved",state:e,count:l.n}:(Re(m),xn(p),{status:"storage-failed"})):{status:"storage-failed"}}function Za(e){let t=L.badgePosition;if(!t||!Number.isFinite(t.left)||!Number.isFinite(t.top))return;let i=e.querySelector(".cw-chip").getBoundingClientRect(),n=Math.max(0,window.innerWidth-i.width),o=Math.max(0,window.innerHeight-i.height),s=J(t.left,0,n),r=J(t.top,0,o);e.style.left=`${s}px`,e.style.top=`${r}px`,e.style.right="auto",e.style.bottom="auto"}function qi(e,t){let i=["left","top","right","bottom"],n=i.map(r=>e.style[r]),o=e.dataset.cwPanelOpen==="true";for(let r of i)e.style[r]="";o&&delete e.dataset.cwPanelOpen;let s=e.querySelector(".cw-chip").getBoundingClientRect();o&&(e.dataset.cwPanelOpen="true");for(let r=0;r<i.length;r++)e.style[i[r]]=n[r];if(t)e.style.left=`${s.left}px`,e.style.top=`${s.top}px`,e.style.right="auto",e.style.bottom="auto";else for(let r of i)e.style[r]=""}var jn=new WeakMap;function Ze(){if(!a||a.panel.hidden)return;let e=4,t=8,i=document.documentElement.clientWidth||window.innerWidth,n=document.documentElement.clientHeight||window.innerHeight,o=a.chip.getBoundingClientRect(),s=a.root.getBoundingClientRect();a.panel.style.maxHeight="";let r=a.panel.getBoundingClientRect(),d=J(o.left,t,Math.max(t,i-r.width-t)),l=Math.max(0,n-t-o.bottom-e),u=Math.max(0,o.top-t-e),p=o.left-e-t;if(r.height>l&&r.height>u&&p>=r.width){a.panelFrame.style.left=`${o.left-e-r.width-s.left}px`,a.panelFrame.style.top=`${J(o.top+14,t,Math.max(t,n-r.height-t))-s.top}px`,jn.set(a.panel,"left"),Va();return}let m=r.height<=l||r.height>u&&l>=u,f=m?l:u;r.height>f&&(a.panel.style.maxHeight=`${f}px`);let g=a.panel.getBoundingClientRect().height;a.panelFrame.style.left=`${d-s.left}px`,a.panelFrame.style.top=`${(m?o.bottom+e:o.top-e-g)-s.top}px`,jn.set(a.panel,m?"below":"above"),Va()}function Va(){if(!a||a.panel.hidden)return;let e=jn.get(a.panel);if(!e)return;let t=8,i=4,n=document.documentElement.clientHeight||window.innerHeight,o=a.panel.getBoundingClientRect().top,s=e==="above"?Math.min(n-t,a.chip.getBoundingClientRect().top-i):n-t;a.panel.style.maxHeight=`${Math.max(1,s-o)}px`}var qn=null,Ya=null,Ja=null;function Xa(e,t){qn=e,Ya=t}function di(e){if(!qn)throw new Error("Watchdog dialog factory was not initialized");qn(e)}function Qa(){Ya?.()}function er(e){Ja=e}function tr(){Ja?.()}var Ct=null;function ir(){if(di("settings"),!(a.settingsDialog.open||a.aboutDialog?.open||a.limitDialog?.open||a.confirmDialog?.open)){if(ii(),a.panelMain.inert=!0,a.panel.classList.add("cw-settings-open"),a.settingsScrim.hidden=!1,a.settingsDialog.show(),N(),a.diagnosticsDetails?.hidden===!1){let e=y();St(X(e),e),N()}a.closeSettings.focus(),requestAnimationFrame(N)}}function Gi(e,t){if(!e.open)return;e.close(),a.settingsScrim.hidden=!0,a.panelMain.inert=!1,a.panel.classList.remove("cw-settings-open");let i=ti;if(Tn(null),a.panel.style.height=i?.inlineHeight??"",!a.panel.hidden){A(y());let n=document.documentElement.clientWidth||window.innerWidth,o=document.documentElement.clientHeight||window.innerHeight;i&&(i.viewportWidth!==n||i.viewportHeight!==o)&&Ze(),t.isConnected&&t.focus()}}function Wt(){a.settingsDialog?.open&&(a.confirmDialog?.open&&Ye(!1),Qa(),Gi(a.settingsDialog,a.settingsBtn))}function nr(){di("about"),!(a.aboutDialog.open||a.settingsDialog?.open||a.limitDialog?.open||a.confirmDialog?.open)&&(ii(),a.panelMain.inert=!0,a.panel.classList.add("cw-settings-open"),a.settingsScrim.hidden=!1,a.aboutDialog.show(),N(),a.closeAbout.focus(),requestAnimationFrame(N))}function ui(){Gi(a.aboutDialog,a.aboutBtn)}function or(){if(a.settingsDialog?.open||a.aboutDialog?.open||a.limitDialog?.open||a.confirmDialog?.open)return;if(!w||G()!==w){v("Cannot record a chat limit until the current chat UUID is ready.");return}di("limit"),Ct=w;let e=X(y());B(a.limitTokens,`\u2248 ${qe(e.tokens)}`),B(a.limitOptimistic,`\u2248 ${qe(e.optimistic)}`),B(a.limitPessimistic,`\u2248 ${qe(e.pessimistic)}`),a.limitReplacement.hidden=!wt().some(t=>t.chatKey===Ct),ii(),a.panelMain.inert=!0,a.panel.classList.add("cw-settings-open"),a.settingsScrim.hidden=!1,a.limitDialog.show(),N(),a.cancelLimit.focus(),requestAnimationFrame(N)}function rt(){a.limitDialog?.open&&(Gi(a.limitDialog,a.endChat),Ct=null)}function ar(){if(!a.limitDialog?.open||!Ct)return;if(w!==Ct||G()!==Ct){rt(),v("Chat changed. No limit was recorded; reopen Record Chat Limit.");return}rt();let e=Ga();e.status==="saved"?(tr(),A(e.state),v(`Chat limit #${e.count} saved; budgets updated.`)):e.status==="missing-chat"?v("Cannot save a chat sample before its UUID appears in the URL."):e.status==="corrupt-history"?v("Calibration history is corrupt. Back up raw data before resetting."):e.status==="corrupt-ledger"?v("Chat ledger is corrupt. Back up raw data before resetting."):A(y())}var Ki=null;function Ee(e,t){if(!a||a.panel.hidden||a.confirmDialog?.open||a.aboutDialog?.open||a.limitDialog?.open||a.settingsDialog?.inert||typeof t!="function")return!1;di("confirm");let i=a.settingsDialog?.open?a.settingsDialog:null;return Ki={onOk:t,parent:i,origin:document.activeElement,chatKey:w,routeKey:G()},a.confirmDescription.textContent=e,i?i.inert=!0:(ii(),a.panelMain.inert=!0,a.panel.classList.add("cw-settings-open"),a.settingsScrim.hidden=!1),a.confirmDialog.show(),N(),a.cancelConfirm.focus(),requestAnimationFrame(N),!0}function Ye(e=!1){let t=Ki;if(t&&(Ki=null,t.parent?.isConnected&&t.parent.open?(a.confirmDialog?.open&&a.confirmDialog.close(),t.parent.inert=!1,N(),t.origin?.isConnected&&t.origin.focus()):a.confirmDialog?.open&&Gi(a.confirmDialog,t.origin||a.settingsBtn),!!e)){if(w!==t.chatKey||G()!==t.routeKey){v("Chat changed. Action canceled.");return}t.onOk()}}function rr(){Ki=null,Ct=null,Tn(null)}function Bs(e,t,i){if(e.key==="Escape")e.preventDefault(),e.stopPropagation(),i();else if(e.key==="Tab"){let n=[...t.querySelectorAll('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]):not([tabindex="-1"]), summary, [tabindex]:not([tabindex="-1"])')].filter(s=>s.getClientRects().length&&!s.closest("[inert]"));if(!n.length){e.preventDefault();return}let o=n.indexOf(document.activeElement);e.shiftKey&&o<=0?(e.preventDefault(),n[n.length-1].focus()):!e.shiftKey&&(o<0||o===n.length-1)&&(e.preventDefault(),n[0].focus())}}function pi(e,t){e.addEventListener("keydown",i=>Bs(i,e,t)),e.addEventListener("cancel",i=>{i.preventDefault(),t()})}var Je=Object.freeze({text:{label:"Text token estimation",fields:[["messageOverhead","messageOverhead"],["proseCyrillicRatio","proseCyrillicCharsPerToken"],["proseLatinRatio","proseLatinCharsPerToken"],["proseDigitsRatio","proseDigitsCharsPerToken"],["prosePunctuationRatio","prosePunctuationCharsPerToken"],["proseOtherRatio","proseOtherCharsPerToken"],["proseWordFloor","proseMinTokensPerWord"],["codeRatio","codeCharsPerToken"]],save:"saveTextEstimation",reset:"resetTextEstimation"},attachment:{label:"Files & images",fields:[["historicalFileFallback","historicalFileFallbackTokens"],["imageAverage","averageImageTokens"],["localFileLimit","localFileParsingLimitMiB"],...xe.map(e=>[e.field,e.key])],save:"saveAttachments",reset:"resetAttachments"},coefficients:{label:"Attachment estimation coefficients",fields:[["fileOpt","fileOptimisticPct"],["filePess","filePessimisticPct"],["imageOpt","imageOptimisticPct"],["imagePess","imagePessimisticPct"],["pastedMinChars","pastedMinChars"],["pastedEnglishRatio","pastedEnglishCharsPerToken"],["pastedCyrillicRatio","pastedCyrillicCharsPerToken"]],save:"saveAttachmentCoefficients",reset:"resetAttachmentAdvanced"},budget:{label:"Budget settings",fields:[["budgetC","conservativeBudget"],["budgetN","normalBudget"],["budgetO","optimisticBudget"]],save:"saveBudget",reset:"resetBudget"},technical:{label:"Technical settings",fields:[["hiddenOptimistic","hiddenOptimistic"],["hiddenPessimistic","hiddenPessimistic"],["historyPriorStrength","historyPriorStrength"]],save:"saveSettings",reset:"resetSettings"}});function zs(e,t){return e==="attachment"?t.metadataOnlyOptimisticBase<=t.metadataOnlyPessimisticBase&&t.metadataOnlyOptimisticSizeFactor<=t.metadataOnlyPessimisticSizeFactor&&t.metadataOnlyOptimisticMax<=t.metadataOnlyPessimisticMax:e==="budget"?t.conservativeBudget<=t.normalBudget&&t.normalBudget<=t.optimisticBudget:e==="technical"?t.hiddenOptimistic<=t.hiddenPessimistic:e==="coefficients"?t.fileOptimisticPct<=t.filePessimisticPct&&t.imageOptimisticPct<=t.imagePessimisticPct:!0}function ce(e,t=!1){if(a){for(let[i,n]of Je[e].fields){let o=a[i];o&&(!t&&(o.dataset.dirty==="1"||o===document.activeElement)||(o.value=String(L[n]),t&&delete o.dataset.dirty))}e==="attachment"&&a.localFileLimit&&Kn()}}function Ht(){for(let e of Object.keys(Je))ce(e,!0)}function Kn(){if(!a?.localFileLimit)return;let e=Number(a.localFileLimit.value);if(a.limitWarning.hidden=!a.localFileLimit.value.trim()||!Number.isFinite(e)||e<=80,a.limitWarning.hidden)a.localFileLimit.dataset.cwTip="Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB.";else{let t="Above recommended range (70\u201380 MiB): local parsing may use more memory";a.limitWarning.title=t,a.limitWarning.setAttribute("aria-label",t),a.localFileLimit.dataset.cwTip=t}}function mi(e){let t=Je[e];if(t.fields.map(([n])=>a[n]).some(n=>!n))throw new Error(`Missing ${e} setting input`);for(let[n,o]of t.fields){let s=a[n],r=Ot[o];if(!r)throw new Error(`Missing numeric specification: ${o}`);s.min=String(r.min),s.max=String(r.max),s.step=String(gn(o)),s.addEventListener("input",()=>{s.dataset.dirty="1",e==="attachment"&&s===a.localFileLimit&&Kn()}),s.addEventListener("blur",()=>{if(s.dataset.dirty!=="1")return;let d=s.value.trim();if(!d)return;let l=hn(o,Number(d));l!==null&&(s.value=String(l)),e==="attachment"&&s===a.localFileLimit&&Kn()})}a[t.save].addEventListener("click",()=>{let n={};for(let[o,s]of t.fields){let r=a[o];if(r.dataset.dirty!=="1"){n[s]=L[s];continue}let d=r.value.trim(),l=d?hn(s,Number(d)):null;if(l===null){v(`${t.label}: invalid value or range.`);return}n[s]=l}if(!zs(e,n)){v(`${t.label}: values must be in the correct order.`);return}e==="budget"&&Object.assign(n,{budgetCalibrationBase:{conservativeBudget:n.conservativeBudget,normalBudget:n.normalBudget,optimisticBudget:n.optimisticBudget},budgetCalibrationWeight:0}),sr(n,`${t.label} saved.`)&&ce(e,!0)}),a[t.reset].addEventListener("click",()=>{Ee(`Restore defaults for ${t.label}? Only this group will be reset.`,()=>{let n=Object.fromEntries(t.fields.map(([,o])=>[o,M[o]]));e==="budget"&&(n.budgetCalibrationBase={conservativeBudget:M.conservativeBudget,normalBudget:M.normalBudget,optimisticBudget:M.optimisticBudget},n.budgetCalibrationWeight=0),sr(n,`${t.label}: defaults restored.`)&&ce(e,!0)})}),ce(e,!0)}function sr(e,t){return Object.assign(L,e),V()?(A(y()),v(t),!0):(Re(it()),A(y()),!1)}var fi=null;function cr(){let e=Gn();fi=e?.field?.dataset.dirty==="true"?e.field.value:null}function Gn(){let e=a?.settingsDialog;return e&&{field:e.querySelector(".cw-handoff-prompt"),counter:e.querySelector(".cw-handoff-counter"),warning:e.querySelector(".cw-handoff-unsaved")}}function Oe(e=!1){let t=Gn();if(!t?.field)return;e&&(fi=null);let i=L.handoffPrompt||At;(e||t.field.dataset.initialized!=="true"||t.field.dataset.dirty!=="true")&&(t.field.value=i,t.field.dataset.initialized="true");let n=t.field.value!==i;t.field.dataset.dirty=String(n),t.counter.textContent=`${t.field.value.length} / ${st}`,t.warning.hidden=!n}function lr(){let e=a?.settingsDialog,t=Gn();!t?.field||t.field.dataset.bound==="true"||(t.field.dataset.bound="true",t.field.addEventListener("input",()=>{t.field.dataset.dirty="true",Oe()}),e.querySelector(".cw-save-handoff").addEventListener("click",()=>{let i=t.field.value;if(!vi(i)){v(`HANDOFF prompt: enter 1\u2013${st} characters.`);return}let n=L.handoffPrompt;if(L.handoffPrompt=i,!V()){L.handoffPrompt=n,Oe(),v("HANDOFF prompt was not saved.");return}Oe(),v("HANDOFF saved.")}),e.querySelector(".cw-restore-handoff").addEventListener("click",()=>{Ee("Restore the original HANDOFF prompt in the editor? The active prompt will not change until Save.",()=>{t.field.value=At,t.field.dataset.dirty="true",Oe()})}),fi!==null?(t.field.value=fi,t.field.dataset.initialized="true",t.field.dataset.dirty="true",fi=null,Oe()):Oe(!0))}var dr=Object.freeze({text:`<div class="cw-config-form">
              <div class="cw-advanced-hint" title="Only newly captured text and newly parsed files are estimated with these ratios; saved UUID counts are unchanged">New captures only \xB7 write-once</div>
              <label><span class="cw-field-caption" title="Added to newly recorded message token counts; previous UUID counts stay unchanged">Message overhead (tokens)</span> <input class="cw-message-overhead" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated Cyrillic characters per token for newly captured text">Cyrillic chars/token</span> <input class="cw-prose-cyrillic-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated Latin characters per token for newly captured text">Latin chars/token</span> <input class="cw-prose-latin-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated digits per token for newly captured text">Digit chars/token</span> <input class="cw-prose-digits-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated punctuation characters per token">Punctuation chars/token</span> <input class="cw-prose-punctuation-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated remaining characters per token">Other chars/token</span> <input class="cw-prose-other-ratio" type="number"></label>
              <label><span class="cw-field-caption" title="Minimum word-count-based token estimate multiplier">Word-count floor</span> <input class="cw-prose-word-floor" type="number"></label>
              <label><span class="cw-field-caption" title="Estimated characters per token for code snippets">Code chars/token</span> <input class="cw-code-ratio" type="number"></label>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-text-estimation">Save</button>
                <button type="button" class="cw-reset-text-estimation">Restore defaults</button>
              </div>
            </div>`,attachment:`<div class="cw-config-form">
              <details class="cw-disclosure cw-attachment-core" open><summary>Main file &amp; image settings</summary>
              <label><span class="cw-field-caption" title="Assumed token cost for one image, not its byte size">Image estimate (tokens)</span> <input class="cw-image-average" type="number"></label>
              <label class="cw-local-limit-label"><span class="cw-field-caption" title="Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB.">Local file parsing limit (MiB)</span>
                <span class="cw-input-with-indicator"><input class="cw-local-file-limit" type="number" title="Maximum file size for local parsing. Larger files use metadata only. Recommended: 75 MiB."><span class="cw-limit-warning" role="img" aria-label="Outside recommended range" title="Outside recommended range (70\u201380 MiB)" hidden><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg></span></span>
              </label>
              <label><span class="cw-field-caption" title="Used for historical attachments with unknown size">History fallback (tokens)</span><input class="cw-historical-file-fallback" type="number"></label>
              </details>
              <div class="cw-metadata-section"></div>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-attachments">Save</button>
                <button type="button" class="cw-reset-attachments">Restore defaults</button>
              </div>
            </div>`,coefficients:`<div class="cw-config-form">

                <div class="cw-advanced-caption">File context contribution (%)</div>
                <label><span class="cw-field-caption" title="Estimated share of locally parsed file content included in the optimistic scenario; also used for historical fallback and auto-paste minimum">Files \xB7 Optimistic (%)</span> <input class="cw-file-opt" type="number"></label>
                <label><span class="cw-field-caption" title="Estimated share of locally parsed file content included in the pessimistic scenario; also used for historical fallback and auto-paste minimum">Files \xB7 Pessimistic (%)</span> <input class="cw-file-pess" type="number"></label>
                <div class="cw-advanced-caption">Image context contribution (%)</div>
                <label><span class="cw-field-caption" title="Share of image estimate counted in optimistic scenario">Images \xB7 Optimistic (%)</span> <input class="cw-image-opt" type="number"></label>
                <label><span class="cw-field-caption" title="Share of image estimate counted in pessimistic scenario">Images \xB7 Pessimistic (%)</span> <input class="cw-image-pess" type="number"></label>
                <div class="cw-advanced-caption">Automatic pasted-text minimum</div>
                <label><span class="cw-field-caption" title="Minimum inferred characters for an unread automatically pasted document">Pasted minimum (chars)</span> <input class="cw-pasted-min-chars" type="number"></label>
                <label><span class="cw-field-caption" title="Assumed Latin characters per token for unread pasted text">Pasted Latin chars/token</span> <input class="cw-pasted-english-ratio" type="number"></label>
                <label><span class="cw-field-caption" title="Assumed Cyrillic characters per token for unread pasted text">Pasted Cyrillic chars/token</span> <input class="cw-pasted-cyrillic-ratio" type="number"></label>
                <div class="cw-settings-actions cw-unified-actions">
                  <button type="button" class="cw-save-attachment-coefficients">Save</button>
                  <button type="button" class="cw-reset-attachment-advanced">Restore defaults</button>
                </div>
            </div>`});function ur(e){let t=i=>`<label><span class="cw-field-caption" title="${i.hint}">${i.label}</span> <input class="cw-${i.field.replace(/[A-Z]/g,n=>"-"+n.toLowerCase())}" type="number"></label>`;return`<details class="cw-disclosure cw-metadata-only"><summary>Metadata-only estimation</summary>
      <div class="cw-advanced-hint">Calibration for unread files of known size. Original formula and default outcomes are retained.</div>
      <div class="cw-advanced-caption">Formula</div>
      ${e.slice(0,6).map(t).join("")}
      <div class="cw-advanced-caption">File types</div>
      ${e.slice(6).map(t).join("")}
    </details>`}var pr=Object.freeze({context:`
          <div class="cw-context-summary" aria-label="Total context estimate">
            <div class="cw-context-primary-row"><span class="cw-context-primary-label">Total context estimate</span><strong class="cw-context-range">--</strong></div>
            <div class="cw-context-note"><span>Heuristic midpoint of optimistic</span> <span>and pessimistic estimates</span></div>
            <div class="cw-data-row"><span>Messages</span><strong class="cw-context-messages">--</strong></div>
          </div>
          <div class="cw-context-text-only">
            <span class="cw-card-caption">Text only</span>
            <strong class="cw-data-tokens">--</strong>
            <div class="cw-context-characters"><strong class="cw-data-chars">--</strong> characters</div>
          </div>
          <div class="cw-data-attachment">
            <div class="cw-data-row"><span>Files attached</span><strong class="cw-data-files">--</strong></div>
            <div class="cw-data-row cw-file-accounting-row"><span>File accounting</span><strong class="cw-data-quality">--</strong></div>
            <div class="cw-data-row cw-file-accounting-continuation"><strong class="cw-data-quality-extra">--</strong></div>
            <div class="cw-data-row cw-data-images-row"><span>Images attached</span><strong class="cw-data-images">none</strong></div>
          </div>
          <div class="cw-estimation-settings">
            <div class="cw-mini-nav" role="group" aria-label="Context estimation settings">
              <button type="button" class="cw-mini-tab" data-cw-mini="text" aria-expanded="false" aria-controls="cw-mini-text">Text estimation</button>
              <button type="button" class="cw-mini-tab" data-cw-mini="attachment" aria-expanded="false" aria-controls="cw-mini-attachment">Files &amp; images</button>
              <button type="button" class="cw-mini-tab" data-cw-mini="coefficients" aria-expanded="false" aria-controls="cw-mini-coefficients">Attachment weights</button>
            </div>
            <div id="cw-mini-text" class="cw-text-settings-details cw-mini-pane" hidden></div>
            <div id="cw-mini-attachment" class="cw-attachment-settings cw-mini-pane" hidden></div>
            <div id="cw-mini-coefficients" class="cw-advanced-attachments cw-mini-pane" hidden></div>
          </div>
        `,budget:`
          <div class="cw-budget-unavailable cw-context-note" hidden>No context estimate yet</div>
          <div class="cw-forecast-heading"><strong>Budget status</strong><span class="cw-forecast-status cw-status">--</span></div>
          <div class="cw-forecast-cards">
            <div><strong class="cw-card-value cw-forecast-opt">--</strong><div class="cw-context-note">Optimistic</div></div>
            <div><strong class="cw-card-value cw-forecast-pess">--</strong><div class="cw-context-note">Pessimistic</div></div>
          </div>
          <div class="cw-budget-navigation">
            <div class="cw-mini-nav cw-budget-mini-nav" aria-label="Budget sections" role="tablist">
              <button type="button" id="cw-budget-limits-tab" role="tab" class="cw-mini-tab cw-mini-active" data-cw-budget="limits" aria-selected="true" tabindex="0" aria-controls="cw-budget-limits">Token budget &amp; limits</button>
              <button type="button" id="cw-budget-history-tab" role="tab" class="cw-mini-tab" data-cw-budget="history" aria-selected="false" tabindex="-1" aria-controls="cw-budget-history">History &amp; calibration</button>
            </div>
            <div id="cw-budget-limits" class="cw-budget-limits cw-mini-pane" role="tabpanel" aria-labelledby="cw-budget-limits-tab">
              <div class="cw-forecast-group">
                <div class="cw-forecast-group-title">Optimistic use</div>
                <div class="cw-progress-grid">
                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-opt-c"></div><strong class="cw-progress-percent cw-percent-opt-c" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Conservative</div></div>
                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-opt-n"></div><strong class="cw-progress-percent cw-percent-opt-n" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Normal</div></div>
                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-opt-o"></div><strong class="cw-progress-percent cw-percent-opt-o" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Generous</div></div>
                </div>
              </div>
              <div class="cw-forecast-group">
                <div class="cw-forecast-group-title">Pessimistic use</div>
                <div class="cw-progress-grid">
                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-pess-c"></div><strong class="cw-progress-percent cw-percent-pess-c" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Conservative</div></div>
                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-pess-n"></div><strong class="cw-progress-percent cw-percent-pess-n" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Normal</div></div>
                  <div><div class="cw-progress-track"><div class="cw-progress-fill cw-progress-pess-o"></div><strong class="cw-progress-percent cw-percent-pess-o" data-cw-on-fill="false">--</strong></div><div class="cw-context-note">Generous</div></div>
                </div>
              </div>
              <details class="cw-disclosure cw-budget-editor"><summary>Edit token budgets</summary>
                <div id="cw-budget-options" class="cw-budget-settings"></div>
              </details>
            </div>
            <div id="cw-budget-history" class="cw-history-details cw-mini-pane" role="tabpanel" aria-labelledby="cw-budget-history-tab" hidden></div>
          </div>
        `,details:`
          <div class="cw-details-header"><span>Details</span><button type="button" class="cw-copy-details" title="Copy Details figures as plain text">Copy</button></div>
          <div class="cw-details-report">
            <div class="cw-detail-group"></div>
            <div class="cw-detail-group"></div>
            <div class="cw-detail-group"></div>
            <div class="cw-detail-group"></div>
            <div class="cw-detail-group"></div>
          </div>
        `}),Tt=Object.freeze({historyBody:`
          <div class="cw-history-line">
            <div class="cw-history"></div>
            <div class="cw-history-note">Averages across recorded samples.</div>
          </div>
        `,budgetForm:`
            <div class="cw-config-form">
              <label>Conservative budget <input class="cw-budget-c" type="number"></label>
              <label>Normal budget <input class="cw-budget-n" type="number"></label>
              <label>Generous budget <input class="cw-budget-o" type="number"></label>
              <div class="cw-threshold-info">Current token budgets; recording a chat limit recalibrates and saves these numbers.</div>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-budget">Save</button>
                <button type="button" class="cw-reset-budget">Restore defaults</button>
              </div>
            </div>
          `,technicalForm:`
          <details class="cw-disclosure cw-handoff-editor">
            <summary class="cw-handoff-summary">HANDOFF prompt <span class="cw-handoff-unsaved" role="status" hidden>Unsaved changes</span></summary>
            <div class="cw-handoff-content">
              <textarea id="cw-handoff-prompt-input" class="cw-handoff-prompt" aria-label="Global HANDOFF prompt" maxlength="${st}" rows="8" spellcheck="false"></textarea>
              <div class="cw-handoff-count">Characters: <span class="cw-handoff-counter">0 / ${st}</span></div>
              <div class="cw-settings-actions cw-unified-actions">
                <button type="button" class="cw-save-handoff">Save</button>
                <button type="button" class="cw-restore-handoff">Restore default</button>
              </div>
            </div>
          </details>
          <label>Hidden context \xB7 optimistic <input class="cw-hidden-optimistic" type="number"></label>
          <label>Hidden context \xB7 pessimistic <input class="cw-hidden-pessimistic" type="number"></label>
          <label>History prior strength <input class="cw-history-prior-strength" type="number"></label>
          <div class="cw-settings-actions cw-unified-actions"><button type="button" class="cw-save-settings">Save</button><button type="button" class="cw-reset-settings">Restore defaults</button></div>
        `,diagnostics:`
            <details class="cw-disclosure cw-recent-errors"><summary>Recent errors</summary><div class="cw-recent-errors-list">No errors recorded. All good.</div></details>
            <div class="cw-diagnostics-line">Expand to load current diagnostics.</div>
            <div class="cw-settings-actions">
              <button type="button" class="cw-rescan" title="Read-only audit of rendered messages">Run Audit</button>
              <button type="button" class="cw-copy-diagnostics">Copy diagnostics</button>
              <button type="button" class="cw-export-ids" title="Read-only TSV file with known UUIDs">Export IDs (.tsv)</button>
              <button type="button" class="cw-repair-short" title="Repair only twice-confirmed short records" disabled hidden>Repair confirmed (0)</button>
              <button type="button" class="cw-undo-repair" title="Undo last explicit repair" disabled hidden>Undo repair</button>
            </div>
          `,performance:`
            <div class="cw-performance-line">Profiling is disabled.</div>
            <div class="cw-settings-actions">
              <button type="button" class="cw-performance-toggle">Enable profiling</button>
              <button type="button" class="cw-performance-copy">Copy metrics</button>
              <button type="button" class="cw-performance-reset">Reset counters</button>
            </div>
          `,aboutHelp:`
            <details class="cw-disclosure cw-about-section" open><summary>Main window</summary>
              <dl>
                <dt>Mini badge and open panel</dt><dd>After a confirmed estimate, the closed badge shows an approximate midpoint and budget status; empty chats show no estimate. Drag the badge to move it. When the panel opens, the badge shows only its icon. The panel opens below, then above, then left\u2014never right\u2014and shifts left near the viewport edge. Click the badge to close, even when pinned; Pin prevents outside-click closing. Yellow: pessimistic Normal use exceeds 100%. Red: optimistic use exceeds 100% and takes priority.</dd>
                <dt>Context / Budget forecast / Details</dt><dd>Context shows local text and attachment estimates; Budget compares both estimates with three editable budgets and calibration history; Details lists per-chat estimates and counts and offers a copyable report.</dd>
                <dt>Optimistic / Pessimistic</dt><dd>Lower and upper heuristic context estimates; their midpoint is not a measured model token count.</dd>
                <dt>Conservative / Normal / Generous \xB7 Budget use</dt><dd>Three adjustable token budgets. Usage (%) is the estimate divided by each budget; above 100% means that threshold is exceeded.</dd>
              </dl>
            </details>
            <details class="cw-disclosure cw-about-section"><summary>Context \xB7 estimation</summary>
              <dl>
                <dt>Text estimation</dt><dd>Character/token ratios, word-count floor and Message overhead affect new captures or local text parsing. Existing message UUID estimates are write-once.</dd>
                <dt>Files &amp; images</dt><dd>Parsed files use locally read content; metadata-only files use file details; unread content may use a size-based estimate.</dd>
                <dt>History fallback (tokens)</dt><dd>Used for historical files with neither readable content nor known size. Pasted text has a separate minimum.</dd>
                <dt>Image estimate (tokens)</dt><dd>Assumed token cost per image, not its physical size or resolution.</dd>
                <dt>Local file parsing limit (MiB)</dt><dd>0 disables local reading of new text files and uses metadata-only; 1\u2013256 MiB enable reading (75 default).</dd>
                <dt>Automatically pasted text</dt><dd>Unread automatically pasted text can receive a minimum estimate.</dd>
                <dt>Attachment weights</dt><dd>Single optimistic/pessimistic contribution pair for locally parsed files, historical fallback and auto-paste minimum; independent metadata-only size estimation, image and pasted-text settings. Metadata-only parameters are editable in Stable and Dev and share Save / Restore defaults with Files & images.</dd>
              </dl>
            </details>
            <details class="cw-disclosure cw-about-section"><summary>Budget forecast</summary>
              <dl>
                <dt>History &amp; calibration</dt><dd>Shows recorded limit samples, average message text, optimistic/pessimistic context estimates (tokens), and calibration weight. Recording a chat limit updates editable budgets; missing averages show none.</dd>
                <dt>Token budget &amp; limits</dt><dd>Shows both estimates against Conservative, Normal and Generous budgets. Percentages may exceed 100%; Edit token budgets changes thresholds. Bars show estimated use, not ChatGPT-reported limits.</dd>
              </dl>
            </details>
            <details class="cw-disclosure cw-about-section"><summary>Appearance</summary>
              <dl>
                <dt>Style \xB7 Sharp / Soft</dt><dd>Angular or rounded Watchdog styling, including Settings.</dd>
                <dt>Theme \xB7 Light / Dark / System / ChatGPT</dt><dd>Choose Light/Dark, follow the OS (System) or ChatGPT theme (fallback: System). Default: Soft + ChatGPT. Choices save immediately.</dd>
                <dt>Logo \xB7 ChatGPT / Watchdog</dt><dd>ChatGPT (default) uses a same-origin cache-only favicon with no network fallback. Missing or invalid artwork silently switches the saved choice to Watchdog. Selecting ChatGPT makes one new cache-only attempt. Watchdog avoids cache lookup and appears beside the panel title; its SVG data is never saved. Service Worker details: see Privacy & limitations.</dd>
              </dl>
            </details>
            <details class="cw-disclosure cw-about-section"><summary>Settings &amp; tools</summary>
              <dl>
                <dt>Technical \xB7 Hidden context</dt><dd>Optional optimistic and pessimistic allowances for context the page cannot reveal.</dd>
                <dt>History prior strength</dt><dd>Higher values reduce the influence of samples when the next calibration is recorded.</dd>
                <dt>HANDOFF</dt><dd>Inserts the saved next-chat prompt when the composer is empty; otherwise copies it without changing the draft. Never sends automatically. Edit in Technical; only Save applies changes.</dd>
                <dt>Record chat limit</dt><dd>At a practical limit, records this chat\u2019s estimate and updates editable budgets. Repeating replaces its sample; the chat stays open.</dd>
                <dt>Performance</dt><dd>Optional in-memory counters and timings, off by default. Resetting them does not affect the ledger.</dd>
              </dl>
            </details>
            <details class="cw-disclosure cw-about-section"><summary>Diagnostics &amp; reset</summary>
              <dl>
                <dt>Run Audit</dt><dd>Read-only comparison of currently rendered messages with saved UUID records.</dd>
                <dt>Repair confirmed / Undo repair</dt><dd>Repair requires two consistent audits, a final recheck and confirmation. Undo restores the latest repair if unchanged. Both affect Watchdog records only.</dd>
                <dt>Copy diagnostics / Export IDs (.tsv)</dt><dd>Copies diagnostics or downloads UUID data; the export contains no message text.</dd>
                <dt>Reset position</dt><dd>Restores the badge\u2019s default position without changing estimates or budgets.</dd>
                <dt>Reset this chat</dt><dd>After confirmation, clears this chat\u2019s ledger. Visible messages can be recaptured; unseen history may be missing.</dd>
                <dt>Clear Watchdog data</dt><dd>After confirmation, clears Watchdog settings, chat ledgers and calibration without reloading. The badge stays in place; its position is saved with fresh defaults. Visible finished messages may be collected again. ChatGPT conversations and unrelated site data are untouched.</dd>
              </dl>
            </details>`}),mr=`
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Style</span>
      <div class="cw-view-options" role="group" aria-label="Watchdog style">
        <button type="button" data-cw-view-style="sharp" data-cw-label="Sharp" aria-pressed="false" data-cw-tip="Angular edges and a left-beveled badge."><span>Sharp</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-style="soft" data-cw-label="Soft" aria-pressed="false" data-cw-tip="Rounded edges and a rounded badge."><span>Soft</span></button>
      </div>
    </div>
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Theme</span>
      <div class="cw-view-options" role="group" aria-label="Watchdog colors">
        <button type="button" data-cw-view-theme="light" data-cw-label="Light" aria-pressed="false" data-cw-tip="Light Watchdog colors."><span>Light</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-theme="dark" data-cw-label="Dark" aria-pressed="false" data-cw-tip="Dark Watchdog colors."><span>Dark</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-theme="system" data-cw-label="System" aria-pressed="false" data-cw-tip="Follow your device's color theme."><span>System</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-theme="chatgpt" data-cw-label="ChatGPT" aria-pressed="false" data-cw-tip="Follow ChatGPT's page theme; use System when unavailable."><span>ChatGPT</span></button>
      </div>
    </div>
    <div class="cw-view-setting-row">
      <span class="cw-view-label">Logo</span>
      <div class="cw-view-options" role="group" aria-label="Badge logo source">
        <button type="button" data-cw-view-logo="openai" data-cw-label="ChatGPT" aria-pressed="false" data-cw-tip="ChatGPT logo uses cached favicon only. Switches to Watchdog if unavailable."><span>ChatGPT</span></button>
        <span class="cw-view-separator" aria-hidden="true">\xB7</span>
        <button type="button" data-cw-view-logo="watchdog" data-cw-label="Watchdog" aria-pressed="false" data-cw-tip="Use the original Watchdog logo; no cache lookup."><span>Watchdog</span></button>
      </div>
    </div>
  `,fr=Object.freeze({confirm:`<dialog class="cw-settings-dialog cw-confirm-dialog" aria-labelledby="cw-confirm-heading" aria-describedby="cw-confirm-description">
          <div class="cw-dialog-header">
            <strong id="cw-confirm-heading">Confirm action</strong>
            <button type="button" class="cw-close-confirm" aria-label="Close confirmation">\u2715</button>
          </div>
          <div class="cw-limit-content">
            <p id="cw-confirm-description" class="cw-confirm-description"></p>
            <div class="cw-limit-actions">
              <button type="button" class="cw-cancel-confirm">Cancel</button>
              <button type="button" class="cw-confirm-ok">OK</button>
            </div>
          </div>
        </dialog>`,settings:`        <dialog class="cw-settings-dialog" aria-labelledby="cw-settings-heading">
        <div class="cw-dialog-header">
          <strong id="cw-settings-heading">Settings &amp; tools</strong>
          <div class="cw-dialog-message" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          <button type="button" class="cw-close-settings" aria-label="Close settings">\u2715</button>
        </div>
        <div class="cw-dialog-content">
          <div class="cw-maintenance cw-reset-line">
            <button type="button" class="cw-reset-position">Reset badge</button>
            <button type="button" class="cw-reset-chat">Reset chat</button>
            <button type="button" class="cw-clear-watchdog-data">Wipe Watchdog data</button>
          </div>
          <div class="cw-mini-nav cw-tools-nav" aria-label="Settings and tools categories" role="tablist">
            <button type="button" id="cw-tools-view-tab" role="tab" class="cw-mini-tab" data-cw-tools="view" aria-selected="true" tabindex="0" aria-controls="cw-tools-view">Appearance</button>
            <button type="button" id="cw-tools-technical-tab" role="tab" class="cw-mini-tab" data-cw-tools="technical" aria-selected="false" tabindex="-1" aria-controls="cw-tools-technical">Technical</button>
            <button type="button" id="cw-tools-diagnostics-tab" role="tab" class="cw-mini-tab" data-cw-tools="diagnostics" aria-selected="false" tabindex="-1" aria-controls="cw-tools-diagnostics">Diagnostics</button>
            <button type="button" id="cw-tools-performance-tab" role="tab" class="cw-mini-tab" data-cw-tools="performance" aria-selected="false" tabindex="-1" aria-controls="cw-tools-performance">Performance</button>
          </div>
          <div id="cw-tools-view" class="cw-view-preferences cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-view-tab" hidden></div>
          <div id="cw-tools-technical" class="cw-settings cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-technical-tab" hidden></div>
          <div id="cw-tools-diagnostics" class="cw-diagnostics-tools cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-diagnostics-tab" hidden></div>
          <div id="cw-tools-performance" class="cw-performance-details cw-mini-pane" role="tabpanel" aria-labelledby="cw-tools-performance-tab" hidden></div>
        </div>
        </dialog>`,limit:`<dialog class="cw-settings-dialog cw-limit-dialog" aria-labelledby="cw-limit-heading" aria-describedby="cw-limit-description">
          <div class="cw-dialog-header">
            <strong id="cw-limit-heading">Record Chat Limit</strong>
            <button type="button" class="cw-close-limit" aria-label="Close Record Chat Limit">\u2715</button>
          </div>
          <div class="cw-limit-content">
            <p id="cw-limit-description">Record this chat only when it has reached a practical context or length limit.</p>
            <div class="cw-limit-estimates" aria-label="Current local context estimates">
              <div><span>Seen text</span><strong class="cw-limit-tokens">\u2014</strong></div>
              <div><span>Optimistic context</span><strong class="cw-limit-optimistic">\u2014</strong></div>
              <div><span>Pessimistic context</span><strong class="cw-limit-pessimistic">\u2014</strong></div>
            </div>
            <p class="cw-limit-consequence">This saves a calibration sample and recalibrates Conservative, Normal and Generous token budgets. It does not close or change your ChatGPT conversation.</p>
            <p class="cw-limit-replacement" hidden>A sample for this chat already exists. Recording again will replace it.</p>
            <div class="cw-limit-actions">
              <button type="button" class="cw-cancel-limit">Cancel</button>
              <button type="button" class="cw-confirm-limit">Record limit</button>
            </div>
          </div>
        </dialog>`,about:`        <dialog class="cw-settings-dialog cw-about-dialog" aria-labelledby="cw-about-heading">
          <div class="cw-dialog-header">
            <strong id="cw-about-heading">About Context Watchdog</strong>
            <button type="button" class="cw-close-about" aria-label="Close About">\u2715</button>
          </div>
          <div class="cw-about-product">ChatGPT Context Watchdog (Local)</div>
          <div class="cw-about-version">Version 1.0.0 \xB7 Designed &amp; maintained by f0rset1 \xB7 Developed with ChatGPT</div>
          <p>Estimates captured chat text and attachments against editable token budgets.</p>
          <details class="cw-disclosure cw-about-section"><summary>Privacy &amp; limitations</summary>
            <p><strong>Local-only.</strong> Reads accessible page content and stores numeric estimates, message identifiers, settings and limited attachment metadata in site-local browser storage. Full message text and attachment contents are not saved in the ledger; a customized HANDOFF template is stored when saved. No chat data is sent over the network. The ChatGPT logo may request a same-origin favicon using <code>fetch</code> with <code>cache: &quot;only-if-cached&quot;</code>; a cache miss never triggers a network retry and switches to Watchdog. A controlling Service Worker blocks this lookup and also switches to Watchdog. DevTools may show a disk-cache hit in Network (0 transferred bytes).</p>
            <p><strong>Estimates, not measurements.</strong> Hidden instructions, retrieval, compaction and actual remaining context are inaccessible.</p>
          </details>
          <details class="cw-disclosure cw-about-terms"><summary>Terms &amp; actions explained</summary>
            <div class="cw-about-glossary" aria-label="Terms and actions explained"></div>
          </details>
          <details class="cw-disclosure cw-about-section cw-about-credit-section" open><summary>Credits</summary>
            <div class="cw-about-credit">Tampermonkey userscript \xB7 Inspired by ideas from Pushpak1203&#39;s ChatGPT-Token_Counter.</div>
          </details>
        </dialog>`}),gr=`
      <button class="cw-chip" type="button" title="Estimated context" aria-label="Open Watchdog panel" aria-controls="${c}-panel" aria-expanded="false">
        <span class="cw-logo-hit"><span class="cw-site-icon cw-brand-mark" aria-hidden="true"></span></span>
        <span class="cw-storage-indicator" hidden aria-label="Storage error">!</span>
        <span class="cw-range"><span class="cw-average cw-metric">\u2248 --k</span><span class="cw-paused-label" hidden>paused</span><span class="cw-budget-tab-mark cw-chip-status" data-level="pending" aria-hidden="true">
            <span class="cw-status-pending">\xB7</span>
            <svg class="cw-status-ok" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.5"/></svg>
            <svg class="cw-status-caution" viewBox="0 0 24 24" focusable="false"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg>
            <svg class="cw-status-critical" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 17.2h.01"/></svg>
          </span></span>
      </button>
      <div class="cw-panel-frame">
      <div id="${c}-panel" class="cw-panel" hidden>
        <div class="cw-panel-main">
        <div class="cw-title">
          <div class="cw-title-info">
            <strong>Context Watchdog<span class="cw-brand-mark" aria-hidden="true" hidden></span></strong>
            <span class="cw-local-row">
              <span class="cw-pause-control" title="Pause Watchdog">
                <button type="button" class="cw-pause-toggle" aria-label="Pause Watchdog" title="Pause Watchdog" data-cw-playing="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <circle cx="12" cy="12" r="9"/>
                    <path class="cw-pause-bars" d="M9.5 8.5v7m5-7v7"/>
                    <path class="cw-play-triangle" d="m10 8 6 4-6 4z"/>
                  </svg>
                </button>
              </span>
              <span class="cw-local-separator" aria-hidden="true"></span>
              <span class="cw-local" data-cw-tip="No chat-data traffic. ChatGPT logo uses a same-origin cache-only favicon lookup; see About.">LOCAL \xB7 NO NETWORK</span>
            </span>
          </div>
          <div class="cw-toolbar" role="group" aria-label="Watchdog actions">
            <button type="button" class="cw-tool-button cw-pin-panel" aria-label="Pin panel" aria-pressed="false" aria-describedby="cw-tip-pin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 3h8l-1 2v4l3 3v2H6v-2l3-3V5L8 3z"/><path d="M12 14v8"/></svg>
              <span class="cw-tool-tip" id="cw-tip-pin" role="tooltip">Pin panel \xB7 Keep open when clicking outside</span>
            </button>
            <button type="button" class="cw-tool-button cw-handoff-details" aria-label="HANDOFF" aria-describedby="cw-tip-handoff">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8m-4-4 4 4-4 4"/></svg>
              <span class="cw-tool-tip" id="cw-tip-handoff" role="tooltip">HANDOFF \xB7 Prepare next-chat prompt</span>
            </button>
            <button type="button" class="cw-tool-button cw-end-chat" aria-label="Record chat limit" aria-describedby="cw-tip-limit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v18l-7-5-7 5z"/><path d="m9 10 2 2 4-4"/></svg>
              <span class="cw-tool-tip" id="cw-tip-limit" role="tooltip">Record chat limit \xB7 Save calibration sample</span>
            </button>
            <button type="button" class="cw-tool-button cw-settings-btn" aria-label="Settings" aria-describedby="cw-tip-settings">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12.00,3.85 L13.95,2.19 L15.83,2.76 L16.53,5.22 L17.76,6.24 L20.31,6.44 L21.24,8.17 L19.99,10.41 L20.15,12.00 L21.81,13.95 L21.24,15.83 L18.78,16.53 L17.76,17.76 L17.56,20.31 L15.83,21.24 L13.59,19.99 L12.00,20.15 L10.05,21.81 L8.17,21.24 L7.47,18.78 L6.24,17.76 L3.69,17.56 L2.76,15.83 L4.01,13.59 L3.85,12.00 L2.19,10.05 L2.76,8.17 L5.22,7.47 L6.24,6.24 L6.44,3.69 L8.17,2.76 L10.41,4.01 Z"/><circle cx="12" cy="12" r="3"/></svg>
              <span class="cw-tool-tip" id="cw-tip-settings" role="tooltip">Settings \xB7 Technical controls and diagnostics</span>
            </button>
            <button type="button" class="cw-tool-button cw-about-btn" aria-label="About Context Watchdog" aria-describedby="cw-tip-about">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.3h.01"/></svg>
              <span class="cw-tool-tip" id="cw-tip-about" role="tooltip">About \xB7 Version, limitations and help</span>
            </button>
          </div>
          <div class="cw-notice-lane" aria-label="Watchdog notifications">
            <div class="cw-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
          </div>
        </div>
        <div class="cw-tabs" role="tablist" aria-label="Watchdog view">
          <button type="button" role="tab" class="cw-tab-context" aria-controls="cw-context-view" aria-selected="true">Context</button>
          <button type="button" role="tab" class="cw-tab-budget" aria-controls="cw-budget-view" aria-selected="false"><span>Budget forecast</span><span class="cw-budget-tab-mark cw-budget-tab-status" data-level="pending" aria-hidden="true">
            <span class="cw-status-pending">\xB7</span>
            <svg class="cw-status-ok" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9.5"/></svg>
            <svg class="cw-status-caution" viewBox="0 0 24 24" focusable="false"><path d="M10.3 4.4a2 2 0 0 1 3.4 0l8 13.8a2 2 0 0 1-1.7 3H4a2 2 0 0 1-1.7-3z"/><path d="M12 9v5M12 17.5h.01"/></svg>
            <svg class="cw-status-critical" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v6M12 17.2h.01"/></svg>
          </span></button>
          <button type="button" role="tab" class="cw-tab-details" aria-controls="cw-details-view" aria-selected="false">Details</button>
        </div>
        <div class="cw-storage-warning" role="alert" hidden></div>

        <section id="cw-context-view" class="cw-view-context" role="tabpanel" aria-label="Context">
</section>

        <section id="cw-budget-view" class="cw-view-budget" role="tabpanel" aria-label="Budget forecast" hidden>
</section>

        <section id="cw-details-view" class="cw-view-details" role="tabpanel" aria-label="Details" hidden>
</section>


        </div>
      </div>
      <div class="cw-settings-scrim" aria-hidden="true" hidden></div>
      </div>
    `;var hr=`
      #${c}-root {
        position: fixed; right: 18px; bottom: 155px;
        z-index: 2147483000; font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #e5e7eb;
      }
      #${c}-root * { box-sizing: border-box; }
      #${c}-root button, #${c}-root input { font: inherit; }
      .cw-chip {
        display: flex; align-items: center; gap: 4px;
        height: 34px; border: 1px solid var(--cw-chip-border); border-radius: calc(999px * var(--cw-radius-scale)); padding: 6px 8px;
        background: rgba(255,255,255,.88); color: #111827; box-shadow: 0 3px 12px rgba(0,0,0,.10);
        cursor: grab; user-select: none; touch-action: none;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        transition: background .15s ease, border-color .15s ease; opacity: 1;
      }
      .cw-metric {
        font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.015em;
        opacity: 1; color: #111827; -webkit-text-fill-color: currentColor !important;
        -webkit-text-stroke: 0 transparent !important;
        text-shadow: none !important;
      }
      /* The mark keeps the original 32px circular hit area in both
         styles. Clipping controls hover; no visible background halo is drawn. */
      .cw-logo-hit {
        display: grid; place-items: center; position: relative;
        width: 18px; height: 18px; flex: 0 0 18px; cursor: pointer;
      }
      .cw-logo-hit::before {
        content: ''; position: absolute; width: 32px;
        height: 32px; left: 50%; top: 50%;
        transform: translate(-50%,-50%); border-radius: 50%;
        clip-path: circle(50%); background: transparent; cursor: pointer;
      }
      .cw-chip.cw-dragging .cw-logo-hit::before { cursor: grabbing; }
      .cw-site-icon {
        width: 18px; height: 18px; display: block;
        flex: 0 0 18px; opacity: .92;
        position: relative; pointer-events: none;
        transition: color .12s ease;
      }
      /* One hover/focus color trigger for both marks; the Watchdog white details stay white. */
      #${c}-root .cw-chip .cw-logo-hit:hover .cw-brand-mark,
      #${c}-root .cw-chip:focus-visible .cw-brand-mark {
        color: var(--cw-accent);
        --cw-watchdog-ink: currentColor;
        --cw-watchdog-gray: currentColor;
      }
      /* Only Dark Watchdog gets a colored outer contour; Light has no added rim. */
      #${c}-root[data-cw-palette="dark"] .cw-chip .cw-logo-hit:hover .cw-brand-mark,
      #${c}-root[data-cw-palette="dark"] .cw-chip:focus-visible .cw-brand-mark {
        --cw-watchdog-outline: currentColor;
      }
      #${c}-root .cw-chip:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
      .cw-chip.cw-dragging { cursor: grabbing; }
      .cw-range { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
      .cw-chip .cw-chip-status { width: 13px; height: 13px; flex: 0 0 13px; }
      .cw-chip .cw-chip-status svg { width: 13px; height: 13px; }
      .cw-chip .cw-metric { display: inline-block; transform: translateY(-1px); }
      /* Empty, unconfirmed chats use the same icon-only badge as an open panel. */
      #${c}-root .cw-chip[data-cw-badge-mode="minimal"] .cw-range { display: none !important; }
      /* With the panel open, the full badge contracts to its original mark and padding. */
      #${c}-root[data-cw-panel-open="true"] .cw-chip .cw-range,
      #${c}-root[data-cw-panel-open="true"] .cw-chip .cw-storage-indicator { display: none !important; }
      .cw-panel-frame { position: absolute; left: 0; top: 0; }
      .cw-panel {
        position: relative; width: 350px; max-height: calc(100vh - 16px);
        overflow: auto; margin: 0; border: 1px solid rgba(17,24,39,.16);
        border-radius: calc(14px * var(--cw-radius-scale)); padding: 12px 14px 12px; background: rgba(255,255,255,.80);
        color: #111827; box-shadow: 0 12px 40px rgba(0,0,0,.16); backdrop-filter: blur(10px);
      }
      /* Two compact header rows: actions + local status. Notifications are
         absolutely overlaid on the status text and cannot grow the header. */
      .cw-title {
        position: relative; z-index: 2; /* Header tooltips must paint above the tabs. */
        display: grid; grid-template-columns: minmax(0,1fr) 133px;
        grid-template-rows: auto auto; align-items: center;
        column-gap: 6px; row-gap: 0; margin-bottom: 5px;
      }
      .cw-title-info { display: contents; }
      .cw-title-info strong { grid-column: 1; grid-row: 1; min-width: 0; justify-self: start; white-space: nowrap; }
      .cw-local-row { grid-column: 1; grid-row: 2; display: flex; align-items: center; gap: 6px; min-height: 14px; align-self: start; transform: translateY(-2px); }
      .cw-pause-control { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; flex: 0 0 15px; }
      #${c}-root .cw-pause-toggle {
        width: 15px; height: 15px; padding: 0; margin: 0; border: 0;
        background: transparent; color: var(--cw-accent); display: inline-flex;
        align-items: center; justify-content: center; cursor: pointer;
      }
      #${c}-root .cw-pause-toggle svg { width: 14px; height: 14px; display: block; }
      #${c}-root .cw-pause-toggle[data-cw-playing="true"] .cw-play-triangle { display: none; }
      #${c}-root .cw-pause-toggle[data-cw-playing="false"] .cw-pause-bars { display: none; }
      #${c}-root .cw-pause-toggle:disabled { opacity: .30; cursor: default; }
      #${c}-root .cw-pause-toggle:focus-visible { outline: 1px solid var(--cw-accent); outline-offset: 2px; border-radius: 50%; }
      .cw-local-separator { height: 11px; width: 1px; background: currentColor; opacity: .3; flex: 0 0 1px; }
      #${c}-root .cw-paused-label { font-size: 11px; font-weight: 400; color: #808995; letter-spacing: .01em; }
      #${c}-root .cw-average[hidden], #${c}-root .cw-chip-status[hidden],
      #${c}-root .cw-paused-label[hidden] { display: none !important; }
      #${c}-root .cw-title-info strong { position: relative; align-self: flex-start; }
      #${c}-root .cw-brand-mark {
        position: absolute; left: calc(100% + 5px); top: 50%;
        transform: translateY(-50%); display: block; width: 24px; height: 24px;
        opacity: 1; pointer-events: none;
      }
      /* One SVG geometry is cloned into three sizes; palette affects only its paths. */
      #${c}-root .cw-brand-mark > .cw-watchdog-svg {
        display: block; width: 100%; height: 100%; overflow: visible;
      }
      #${c}-root .cw-brand-mark > .cw-watchdog-svg > path {
        transition: fill .12s ease, stroke .12s ease;
      }
      #${c}-root .cw-chip .cw-site-icon.cw-brand-mark {
        position: relative; left: auto; top: auto; transform: translate(-1px, -1px);
        width: 21px; height: 21px; display: block;
      }
      /* The site logo is a sanitized inline SVG copied from the host DOM. */
      #${c}-root .cw-chip .cw-site-icon.cw-has-site-logo,
      #${c}-root[data-cw-palette="dark"] .cw-chip .cw-site-icon.cw-has-site-logo {
        background: none;
        opacity: .92;
      }
      #${c}-root .cw-site-icon > svg { display: block; width: 100%; height: 100%; }
      #${c}-root .cw-site-icon.cw-has-site-logo > svg { fill: currentColor; }
      .cw-local { font-size: 10px; letter-spacing: .05em; color: var(--cw-accent); white-space: nowrap; }
      /* Always-visible header actions: no external icons, no native title tooltip. */
      .cw-toolbar { grid-column: 2; grid-row: 1; display: flex; align-items: center; flex: 0 0 auto; transform: translateY(-3px); }
      .cw-tool-button {
        position: relative; display: grid; place-items: center;
        padding: 0; border: 1px solid rgba(100,116,139,.28); border-radius: calc(8px * var(--cw-radius-scale));
        background: transparent; color: inherit; cursor: pointer;
      }
      .cw-tool-button:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
       .cw-tool-button svg { display: block; width: 17px; height: 17px; pointer-events: none; }
      /* The Settings gear is a symmetrical 24x24 SVG; never allow flex or font scaling to flatten it. */
      .cw-settings-btn svg { width: 16px; height: 16px; min-width: 16px; min-height: 16px; flex: none; aspect-ratio: 1 / 1; }
      .cw-tool-tip {
        position: absolute; z-index: 3; top: calc(100% + 7px); right: 0;
        max-width: min(205px, calc(100vw - 48px)); border: 1px solid rgba(100,116,139,.35);
        box-shadow: 0 4px 14px rgba(0,0,0,.16);
        font: 500 11px/1.4 system-ui, sans-serif; text-align: left;
        opacity: 0; visibility: hidden;
      }
      /* Shared visual tooltip surface, geometry and typography remain independent. */
      .cw-tool-tip, #${c}-root .cw-floating-tip {
        pointer-events: none; width: max-content; white-space: normal;
        padding: 6px 9px; border-radius: calc(7px * var(--cw-radius-scale));
        background: rgba(17,24,39,.88); color: #f9fafb;
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      }
      /* A hover tooltip appears after exactly 500 ms; mouse-out cancels it immediately. */
      @media (hover: hover) {
        .cw-tool-button:hover .cw-tool-tip {
          visibility: visible; opacity: 1;
          transition: opacity .12s ease .5s, visibility 0s linear .5s;
        }
      }
      .cw-tool-button:focus-visible .cw-tool-tip { visibility: visible; opacity: 1; transition: none; }
      @media (hover: none) { .cw-tool-tip { display: none; } }
      /* Match the other detail rows: one line, same 13px font for label
         and value. Compact captions fit without title/ellipsis tooltips. */
      .cw-context-note { margin: 5px 0 8px; font-size: 11px; line-height: 1.45; }
      .cw-settings-actions { display: flex; gap: 7px; flex-wrap: wrap; margin-top: 5px; }
      .cw-config-form { margin-top: 7px; }
      .cw-config-form label, .cw-settings label {
        display: grid; grid-template-columns: minmax(0, 1fr) 113px;
        gap: 9px; align-items: center; margin-top: 6px;
      }
      .cw-config-form input, .cw-settings input {
        width: 100%; border: 0; border-bottom: 1px solid rgba(100,116,139,.30); border-radius: 0 0 4px 4px;
        padding: 5px 7px; color: inherit;
        background: linear-gradient(to bottom, rgba(100,116,139,.01), rgba(100,116,139,0));
        box-shadow: inset 0 2px 4px -3px rgba(17,24,39,.16);
        font-variant-numeric: normal;
      }
      .cw-config-form input:focus-visible, .cw-settings input:focus-visible {
        outline: 0; border-bottom-color: var(--cw-accent);
      }
      .cw-input-with-indicator { position: relative; display: block; width: 100%; min-width: 0; }
      /* Consistent spin-button-free number inputs, scoped to the Watchdog only.
         Native keyboard ArrowUp/ArrowDown behavior and validation are retained. */
      #${c}-root input[type="number"] { appearance: textfield; -moz-appearance: textfield; }
      #${c}-root input[type="number"]::-webkit-outer-spin-button,
      #${c}-root input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
      .cw-input-with-indicator input { width: 100%; min-width: 0; padding-right: 28px; }
      .cw-limit-warning { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); display: grid; place-items: center; width: 15px; height: 15px; color: #ca8a04; pointer-events: none; }
      .cw-config-form button, .cw-settings button {
        border: 1px solid rgba(255,255,255,.15); border-radius: calc(9px * var(--cw-radius-scale)); padding: 6px 8px;
        background: rgba(17,24,39,.06); color: #111827; cursor: pointer;
      }
      .cw-config-form button:hover, .cw-settings button:hover { background: rgba(17,24,39,.11); }
      .cw-budget-settings, .cw-attachment-settings { margin-top: 8px; }
      .cw-estimation-settings { border-top: 1px solid rgba(100,116,139,.22); margin-top: 12px; padding-top: 9px; }
      /* Labels do not wrap even at 300px; shortened labels have full title help. */
      .cw-estimation-settings .cw-config-form label {
        grid-template-columns: minmax(0,1fr) 85px; gap: 6px; font: 400 10.5px/1.5 system-ui, sans-serif;
      }
      .cw-estimation-settings .cw-field-caption {
        display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
      }
      .cw-estimation-settings .cw-config-form input { min-width: 0; }
      .cw-estimation-settings .cw-advanced-caption { font-size: 10.5px; }
      .cw-estimation-settings .cw-settings-actions button { white-space: normal; }
      /* Manual destructive action, separate from per-chat reset. */
      /* Shared unobtrusive Save / Restore defaults actions for five groups. */
      #${c}-root .cw-unified-actions { display: flex; align-items: center; flex-wrap: nowrap; gap: 13px; margin-top: 7px; }
      #${c}-root .cw-unified-actions button {
        padding: 2px 0; border: 0; border-radius: 0; box-shadow: none;
        background: transparent; color: var(--cw-accent); font: 550 11px/1.35 system-ui, sans-serif;
        cursor: pointer; white-space: nowrap; min-width: 0;
      }
      #${c}-root .cw-unified-actions button:hover { background: transparent; text-decoration: underline; }
      #${c}-root .cw-unified-actions button:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
            .cw-advanced-caption { font-weight: 600; color: var(--cw-muted); margin: 9px 0 4px; }
      .cw-advanced-hint { font-size: 10px; line-height: 1.5; color: var(--cw-muted); margin-top: 8px; }
            /* Independent Watchdog-only overlays. The main panel keeps its size,
         coordinates and content; only the panel-sized scrim is lightly blurred. */
      .cw-settings-scrim {
        position: absolute; inset: 0; z-index: 8;
        background: rgba(15,23,42,.08);
        backdrop-filter: blur(1.5px); -webkit-backdrop-filter: blur(1.5px);
      }
      .cw-settings-dialog {
        position: absolute; z-index: 9; top: 8px; left: 8px;
        transform: none; width: min(332px, calc(100vw - 16px));
        max-height: calc(100vh - 16px); overflow: auto; margin: 0;
        padding: 12px 14px; border-radius: calc(13px * var(--cw-radius-scale));
        border: 1px solid rgba(100,116,139,.30); background: #fff; color: #111827;
        box-shadow: 0 12px 35px rgba(0,0,0,.28);
        font: 400 11px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .cw-dialog-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 9px; position: sticky; top: -12px; z-index: 1; background: inherit; }
      .cw-dialog-header strong { font-weight: var(--cw-weight-dialog-heading); flex: 0 0 auto; }
      /* Operation feedback belongs to the header row, not the scrollable body.
         The status itself never resizes the dialog; real Diagnostics rows may. */
      .cw-dialog-header .cw-dialog-message {
        flex: 1 1 0; min-width: 0; margin: 0; padding: 0; border: 0;
        background: transparent; color: #475569; text-align: right;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        font: 500 10px/1.4 system-ui, sans-serif;
      }
      .cw-dialog-header .cw-dialog-message[hidden] { display: none; }
      /* Compact local confirmation: same non-modal layer as About/Settings. */
      .cw-limit-dialog .cw-limit-content { font-size: 11px; line-height: 1.5; }
      .cw-limit-dialog p { margin: 0 0 10px; }
      .cw-confirm-description { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 10px; }
      .cw-limit-estimates { border-top: 1px solid rgba(100,116,139,.22); border-bottom: 1px solid rgba(100,116,139,.22); padding: 7px 0; margin-bottom: 11px; }
      .cw-limit-estimates > div { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 3px 0; }
      .cw-limit-estimates span { color: var(--cw-muted); }
      .cw-limit-estimates strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .cw-limit-consequence { color: #4b5563; }
      .cw-limit-replacement { color: #b45309; font-weight: 550; }
      .cw-limit-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 13px; }
      #${c}-root .cw-limit-actions button { cursor: pointer; padding: 7px 10px; border: 1px solid rgba(100,116,139,.30); border-radius: calc(7px * var(--cw-radius-scale)); font: 600 11px/1.3 system-ui,sans-serif; background: transparent; color: inherit; }
      #${c}-root .cw-limit-actions .cw-confirm-limit,
      #${c}-root .cw-limit-actions .cw-confirm-ok { background: var(--cw-accent); border-color: var(--cw-accent); color: #fff; }
      #${c}-root .cw-limit-actions .cw-confirm-limit:hover,
      #${c}-root .cw-limit-actions .cw-confirm-ok:hover { box-shadow: inset 0 0 0 1px rgba(0,0,0,.22); }
      /* Confirmations only: actions are text, with original button semantics. */
      #${c}-root .cw-confirm-dialog .cw-limit-actions button {
        appearance: none; border: 0; border-radius: 0; padding: 7px 5px;
        background: transparent; box-shadow: none;
      }
      #${c}-root .cw-confirm-dialog .cw-cancel-confirm { color: var(--cw-accent); }
      #${c}-root .cw-confirm-dialog .cw-confirm-ok { color: #b91c1c; }
      #${c}-root .cw-confirm-dialog .cw-limit-actions button:hover {
        background: transparent; text-decoration: underline;
      }
      #${c}-root[data-cw-palette="dark"] .cw-confirm-dialog .cw-confirm-ok { color: #fca5a5; }
      #${c}-root[data-cw-palette="dark"] .cw-limit-consequence { color: var(--cw-muted); }
      #${c}-root[data-cw-palette="dark"] .cw-limit-replacement { color: #fbbf24; }
      /* About shares the panel-scoped window, but not Settings controls. */
      .cw-about-dialog { font-size: 11px; line-height: 1.5; }
      .cw-about-product { font-weight: 650; font-size: 12px; }
      .cw-about-version { color: var(--cw-muted); font-size: var(--cw-type-caption); margin: 1px 0 10px; }
      .cw-about-dialog p { margin: 0 0 9px; }
      .cw-about-dialog p strong { font-weight: var(--cw-weight-dialog-heading); }
      /* Native disclosures share the same interaction and focus treatment.
         Specialized classes control only section-specific spacing and typography. */
      .cw-disclosure > summary { cursor: pointer; user-select: none; line-height: 1.55; color: var(--cw-muted); }
      .cw-disclosure > summary:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; border-radius: 3px; }
      .cw-about-section, .cw-about-terms { border-top: 1px solid rgba(100,116,139,.22); padding: 7px 0 5px; }
      .cw-about-section > summary, .cw-about-terms > summary { font-weight: 600; }
      .cw-about-glossary { margin-top: 6px; padding-left: 6px; }
      .cw-about-section > dl, .cw-about-section > p, .cw-about-section > .cw-about-credit { margin-top: 8px; }
      .cw-about-section > dl { margin-bottom: 2px; }
      .cw-about-section dt { font-weight: 600; color: inherit; margin: 7px 0 1px; }
      .cw-about-section dd { margin: 0; color: #4b5563; overflow-wrap: anywhere; }
      .cw-about-credit { color: var(--cw-muted); font-size: var(--cw-type-caption); line-height: 1.45; }
      .cw-about-credit-section { padding-bottom: 3px; }
      #${c}-root .cw-close-settings, #${c}-root .cw-close-about, #${c}-root .cw-close-limit, #${c}-root .cw-close-confirm {
        appearance: none; width: 27px; height: 27px; flex: 0 0 auto;
        display: grid; place-items: center; border: 0;
        border-radius: calc(7px * var(--cw-radius-scale)); background: transparent; color: inherit; cursor: pointer;
        font: 500 14px/1 system-ui, sans-serif;
      }
      #${c}-root .cw-close-settings:hover, #${c}-root .cw-close-about:hover, #${c}-root .cw-close-limit:hover, #${c}-root .cw-close-confirm:hover { background: rgba(100,116,139,.10); }
      .cw-settings-dialog .cw-settings { margin: 0; padding: 0; border: 0; }
      .cw-maintenance { border-bottom: 1px solid rgba(100,116,139,.22); padding-bottom: 8px; margin-bottom: 9px; }
      .cw-settings-dialog .cw-settings-actions { margin-top: 8px; }

      .cw-handoff-editor, .cw-attachment-core, .cw-metadata-only { margin-top: 11px; padding-top: 8px; border-top: 1px solid rgba(100,116,139,.22); }
      /* HANDOFF is the first Technical block: its separator belongs below it. */
      .cw-settings-dialog .cw-handoff-editor:first-child {
        margin-top: 0; padding-top: 0; border-top: 0;
        margin-bottom: 11px; padding-bottom: 8px; border-bottom: 1px solid rgba(100,116,139,.22);
      }
      .cw-handoff-editor > summary, .cw-attachment-core > summary, .cw-metadata-only > summary { font-size: 12px; font-weight: 600; }
      .cw-handoff-unsaved { margin-left: 8px; font-size: 10px; font-weight: 400; color: #b45309; }
      #${c}-root[data-cw-palette="dark"] .cw-handoff-unsaved { color: #fbbf24; }
      .cw-handoff-content { margin-top: 7px; }
      #${c}-root .cw-handoff-prompt {
        display: block; width: 100%; min-height: 116px; max-height: 290px;
        padding: 7px; font: 400 11px/1.4 system-ui,sans-serif; color: inherit;
        background: rgba(100,116,139,.04); border: 1px solid rgba(100,116,139,.30);
        border-radius: calc(4px * var(--cw-radius-scale)); resize: vertical;
      }
      #${c}-root[data-cw-palette="dark"] .cw-handoff-prompt {
        background: rgba(0,0,0,.11); border-color: rgba(161,161,170,.40);
      }
      #${c}-root .cw-handoff-prompt:focus-visible { outline: 1px solid var(--cw-accent); outline-offset: 1px; }
      #${c}-root .cw-handoff-count { margin-top: 4px; font: 400 10px/1.4 system-ui,sans-serif; color: var(--cw-muted); }

      .cw-settings-dialog .cw-settings-actions button { min-width: 0; }
      .cw-dialog-message { margin-bottom: 7px; padding: 7px 9px; border-radius: calc(7px * var(--cw-radius-scale)); background: rgba(100,116,139,.12); }
      .cw-settings-dialog .cw-settings-actions button { font-size: 11px; }
      .cw-threshold-info { color: var(--cw-muted); font-size: var(--cw-type-diagnostic); }
      .cw-threshold-info { margin-top: 7px; }
      /* Diagnostics actions are blue text links, not filled or outlined buttons.
         Keep <button> semantics for keyboard activation and focus. */
      #${c}-root .cw-diagnostics-tools .cw-settings-actions button {
        appearance: none; border: 0; border-radius: 0;
        background: transparent; padding: 3px 1px; color: var(--cw-accent);
        font: 550 11px/1.5 system-ui, sans-serif; cursor: pointer; text-align: left;
      }
      #${c}-root .cw-diagnostics-tools .cw-settings-actions button:hover,
      #${c}-root .cw-diagnostics-tools .cw-settings-actions button:focus-visible {
        background: transparent; text-decoration: underline;
      }
      #${c}-root .cw-diagnostics-tools .cw-settings-actions button:focus-visible {
        outline: 2px solid var(--cw-accent); outline-offset: 2px; border-radius: calc(2px * var(--cw-radius-scale));
      }
      .cw-diagnostics-line, .cw-history-line {
        margin-top: 5px; font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere; line-height: 1.6;
      }
      .cw-diagnostics-line { white-space: pre-line; }
      .cw-history-line { white-space: normal; }
      .cw-history { white-space: pre-line; }
      .cw-history-note { color: var(--cw-muted); font-size: var(--cw-type-caption); font-weight: var(--cw-weight-body); }
      .cw-history-line > div + div { margin-top: 5px; }
      .cw-performance-details { border-top: 1px solid rgba(100,116,139,.22); margin-top: 9px; padding-top: 7px; }
      .cw-performance-line { margin-top: 5px; white-space: pre-line; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; line-height: 1.6; }
      .cw-reset-chat { color: #b91c1c !important; }
      /* Right-anchored, no reserved height. A short notice leaves the local
         status readable; longer notices may cover its TEXT, never Pause/Start. */
      .cw-notice-lane {
        position: absolute; left: 21px; right: 0; bottom: 0;
        min-width: 0; height: 19px; display: flex;
        justify-content: flex-end; align-items: center; pointer-events: none;
        z-index: 1;
      }
      .cw-toast {
        min-width: 0; max-width: 100%; width: max-content;
        padding: 1px 7px; margin: 0;
        border: 1px solid var(--cw-toast-border);
        border-radius: calc(6px * var(--cw-radius-scale));
        background: var(--cw-toast-bg); color: var(--cw-toast-ink);
        box-shadow: none; font: 500 var(--cw-type-caption)/1.3 system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: clip;
        text-align: right; pointer-events: none;
      }
      #${c}-root .cw-toast[data-cw-notice-level="error"] {
        border-color: var(--cw-toast-error-border);
        background: var(--cw-toast-error-bg); color: var(--cw-toast-error-ink);
      }
      .cw-recent-errors { margin: 4px 0 8px; }
      .cw-recent-errors-list {
        font-size: var(--cw-type-diagnostic); color: var(--cw-muted);
        line-height: 1.55; padding: 3px 0 2px;
        user-select: text; -webkit-user-select: text; cursor: text;
      }
      .cw-recent-error-entry + .cw-recent-error-entry { margin-top: 4px; }
      #${c}-root[data-cw-palette="dark"] .cw-config-form button, #${c}-root[data-cw-palette="dark"] .cw-settings button { background: rgba(255,255,255,.08); color: #f3f4f6; }
      #${c}-root[data-cw-palette="dark"] .cw-config-form button:hover, #${c}-root[data-cw-palette="dark"] .cw-settings button:hover, #${c}-root[data-cw-palette="dark"] .cw-tool-button:hover { background: rgba(255,255,255,.13); }
      /* Keep Save / Restore defaults as text actions in dark mode too. */
      #${c}-root[data-cw-palette="dark"] .cw-unified-actions button,
      #${c}-root[data-cw-palette="dark"] .cw-unified-actions button:hover {
        background: transparent; color: var(--cw-accent);
      }
      #${c}-root[data-cw-palette="dark"] .cw-config-form input, #${c}-root[data-cw-palette="dark"] .cw-settings input {
        background: linear-gradient(to bottom, rgba(0,0,0,.06), rgba(0,0,0,0));
        box-shadow: inset 0 2px 4px -3px rgba(0,0,0,.17);
        border-bottom-color: rgba(161,161,170,.40);
      }
      #${c}-root[data-cw-palette="dark"] .cw-config-form input:focus-visible,
      #${c}-root[data-cw-palette="dark"] .cw-settings input:focus-visible { border-bottom-color: var(--cw-accent); }
      #${c}-root[data-cw-palette="dark"] .cw-dialog-header .cw-dialog-message { color: #cbd5e1; }
      #${c}-root[data-cw-palette="dark"] .cw-about-section dd { color: var(--cw-muted); }
      #${c}-root[data-cw-palette="dark"] .cw-diagnostics-tools .cw-settings-actions button { color: var(--cw-accent); }
      #${c}-root [hidden] { display: none !important; }
      .cw-storage-indicator {
        display: inline-grid; place-items: center; background: #dc2626;
        color: white; border-radius: 50%; width: 15px;
        height: 15px; font-size: 11px; font-weight: 800;
      }
      .cw-tabs button {
        cursor: pointer; min-width: 0;
        display: inline-flex; align-items: center; justify-content: center; gap: 4px;
        white-space: nowrap;
      }
      /* Small outlined status pictograms to the right of the unbroken tab title. */
      .cw-budget-tab-mark {
        display: inline-flex; width: 14px; height: 14px; flex: 0 0 14px;
        align-items: center; justify-content: center; line-height: 1;
      }
      .cw-budget-tab-mark svg { display: none; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .cw-budget-tab-mark .cw-status-pending { display: none; font-weight: 700; }
      .cw-budget-tab-mark[data-level="pending"] { color: #64748b; }
      .cw-budget-tab-mark[data-level="ok"] { color: var(--cw-accent); }
      .cw-budget-tab-mark[data-level="caution"] { color: #ca8a04; }
      .cw-budget-tab-mark[data-level="critical"] { color: #ef4444; }
      .cw-budget-tab-mark[data-level="pending"] .cw-status-pending,
      .cw-budget-tab-mark[data-level="ok"] .cw-status-ok,
      .cw-budget-tab-mark[data-level="caution"] .cw-status-caution,
      .cw-budget-tab-mark[data-level="critical"] .cw-status-critical { display: block; }
      /* Context: the detected data and locally estimated visible text. */
      .cw-forecast-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .cw-forecast-cards > div { min-width: 0; }
      .cw-card-caption { display: block; font-size: var(--cw-type-diagnostic); color: var(--cw-muted); margin-bottom: 3px; }
      .cw-card-value { display: block; font: 600 13px/1.45 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
      .cw-context-summary { border-top: 1px solid rgba(100,116,139,.22); margin-top: 10px; padding-top: 7px; }
      .cw-context-note { margin-top: 5px; color: var(--cw-muted); font: 400 11px/1.45 system-ui,sans-serif; }
      /* Semantic hierarchy: total context is primary, text only secondary. */
      #${c}-root .cw-context-summary {
        border-top: 0; margin-top: 0; padding-top: 0;
        padding-bottom: 5px; border-bottom: 1px solid rgba(100,116,139,.22);
      }
      #${c}-root .cw-context-primary-row {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 8px; min-width: 0; white-space: nowrap;
      }
      #${c}-root .cw-context-primary-label {
        color: var(--cw-muted); white-space: nowrap;
      }
      #${c}-root .cw-context-range {
        font: 600 13px/1.45 system-ui,sans-serif;
        white-space: nowrap;
      }
      #${c}-root .cw-context-summary .cw-data-row { margin-top: 3px; }
      #${c}-root .cw-context-text-only {
        display: flex; justify-content: space-between; align-items: baseline;
        flex-wrap: wrap; gap: 2px 8px; font-size: 12px;
      }
      #${c}-root .cw-context-text-only .cw-card-caption { margin: 0; }
      #${c}-root .cw-context-characters { flex: 1 0 100%; text-align: right; color: var(--cw-muted); }
      .cw-data-attachment { border-top: 1px solid rgba(100,116,139,.22); margin-top: var(--cw-space-block); padding-top: var(--cw-space-block); }
      .cw-data-row { display: flex; justify-content: space-between; align-items: baseline; gap: 7px; font-size: 11px; margin: 4px 0; }
      .cw-data-row > span { color: var(--cw-muted); flex: 0 0 auto; }
      .cw-data-row > strong { text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      /* Stable two-line file accounting; all five counters remain visible. */
      .cw-file-accounting-row, .cw-file-accounting-continuation { white-space: nowrap; }
      #${c}-root .cw-data-row.cw-file-accounting-row > strong,
      #${c}-root .cw-data-row.cw-file-accounting-continuation > strong { font-size: 10px; overflow-wrap: normal; }
      .cw-file-accounting-continuation { justify-content: flex-end; margin-top: 0; }
      /* Budget: only the status signal is colored on the tab itself. */
      .cw-forecast-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 7px; margin-bottom: var(--cw-space-block); }
            .cw-forecast-status { text-align: right; }
      .cw-forecast-cards { margin-bottom: var(--cw-space-block); }
      /* Budget value legends use the same Context typography. */
      .cw-forecast-group { margin: var(--cw-space-row) 0; }
      .cw-forecast-group-title { margin-bottom: 3px; }
      .cw-progress-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
      /* Budget track legends use the same Context typography. */
      .cw-progress-track {
        position: relative; background: rgba(100,116,139,.17); height: 9px;
        border-radius: calc(99px * var(--cw-radius-scale)); overflow: hidden;
        /* A softer outside shadow than the primary tabs; no inner bevel. */
        box-shadow: 3px -1px 6px -5px rgba(15,23,42,.16),
                    0 1px 4px -3px rgba(15,23,42,.08);
      }
      #${c}-root[data-cw-palette="dark"] .cw-progress-track {
        box-shadow: 3px -1px 6px -5px rgba(0,0,0,.32),
                    0 1px 4px -3px rgba(0,0,0,.18);
      }
      .cw-progress-fill { position: absolute; inset: 0 auto 0 0; background: var(--cw-accent); width: 0; height: 100%; border-radius: inherit; opacity: .8; }
      /* One legible percentage inside either the filled or unfilled segment. */
      #${c}-root .cw-progress-percent {
        position: absolute; z-index: 1; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        padding: 0; font: 600 9px/1 system-ui,sans-serif;
        font-variant-numeric: tabular-nums; white-space: nowrap;
        color: #111827; pointer-events: none;
      }
      #${c}-root .cw-progress-percent[data-cw-on-fill="true"] { color: #fff; }
      #${c}-root[data-cw-palette="dark"] .cw-progress-percent[data-cw-on-fill="false"] { color: #f4f4f5; }
      /* Details: diagnostics typography, plain lines without section headings. */
      .cw-details-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--cw-space-row); font-size: 11px; font-weight: 600; }
      /* Match the primary Context label, not the compact Copy action. */
      #${c}-root .cw-details-header > span {
        font-size: var(--cw-type-label); font-weight: var(--cw-weight-label);
        line-height: 1.4; color: var(--cw-muted);
      }
      .cw-copy-details { appearance: none; border: 0; background: transparent; color: var(--cw-accent); padding: 2px 1px; font: 550 11px/1.5 system-ui, sans-serif; cursor: pointer; }
      .cw-copy-details:hover, .cw-copy-details:focus-visible { text-decoration: underline; }
      .cw-copy-details:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
      .cw-details-report { font: 400 11px/1.6 system-ui, sans-serif; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .cw-detail-group { border-top: 1px solid rgba(100,116,139,.22); padding: var(--cw-space-row) 0; }
      .cw-detail-group > div { margin: 0; }
      .cw-detail-group > .cw-detail-legend { color: var(--cw-muted); font-weight: var(--cw-weight-body); font-size: var(--cw-type-caption); }
      .cw-storage-warning {
        border: 1px solid #dc2626; color: #b91c1c; background: rgba(220,38,38,.08);
        padding: 8px; border-radius: calc(9px * var(--cw-radius-scale)); margin: 7px 0;
        font-size: 11px; overflow-wrap: anywhere;
      }
      #${c}-root[data-cw-palette="dark"] .cw-storage-warning { color: #fca5a5; }

      /* Primary tabs use a lightweight browser-inspired contour. */
      #${c}-root .cw-tabs {
        display: grid; grid-template-columns: .84fr 1.62fr .78fr; margin: 1px 0 6px;
      }
      #${c}-root .cw-tabs button { padding: 7px 5px 6px;
        font: 500 11px/1.2 system-ui, sans-serif;
      }
      #${c}-root .cw-tabs button[aria-selected="true"] { font-weight: 650; }
      #${c}-root .cw-tabs button:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: -3px; }
      /* Mini tabs: no headings or secondary expansion arrows; no blue nav links. */
      #${c}-root .cw-estimation-settings { margin-top: 7px; padding-top: 6px; }
      #${c}-root .cw-mini-nav { display: flex; gap: 7px; align-items: center; flex-wrap: nowrap; white-space: nowrap; }
      #${c}-root .cw-estimation-settings .cw-mini-nav { gap: 7px; justify-content: flex-start; }
      #${c}-root .cw-mini-nav .cw-mini-tab {
        appearance: none; border: 0; background: transparent; color: var(--cw-muted);
        padding: 4px 1px 5px; margin: 0;
        font: 500 10.2px/1.35 system-ui, sans-serif; white-space: nowrap;
        cursor: pointer; min-width: 0;
      }
      #${c}-root .cw-mini-nav .cw-mini-tab:hover { color: inherit; background: transparent; }
      #${c}-root .cw-mini-nav .cw-mini-tab.cw-mini-active {
        color: inherit; font-weight: 650; border-bottom-color: currentColor;
      }
      #${c}-root .cw-mini-tab:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 1px; }
      #${c}-root .cw-mini-pane { border-top: 1px solid rgba(100,116,139,.20); margin-top: 6px; padding-top: 6px; }
      /* Context estimation tabs already separate the content above them.
         Do not draw a second separator before the first item inside a pane. */
      #${c}-root .cw-estimation-settings .cw-mini-pane { border-top: 0; padding-top: 0; }
      #${c}-root .cw-attachment-settings .cw-config-form > .cw-attachment-core:first-child {
        margin-top: 0; padding-top: 0; border-top: 0;
      }
      #${c}-root .cw-estimation-settings .cw-mini-pane .cw-config-form { margin-top: 0; }
      #${c}-root .cw-budget-navigation { border-top: 1px solid rgba(100,116,139,.22); margin-top: var(--cw-space-section); padding-top: var(--cw-space-block); }
      #${c}-root .cw-budget-navigation .cw-mini-pane { margin-top: var(--cw-space-block); }
      #${c}-root .cw-budget-mini-nav { gap: 6px; }
      #${c}-root .cw-budget-mini-nav .cw-mini-tab { padding-left: 3px; padding-right: 3px; }
      #${c}-root .cw-budget-editor { border-top: 1px solid rgba(100,116,139,.17); margin: var(--cw-space-block) 0 0; padding-top: var(--cw-space-block); }
      #${c}-root .cw-budget-editor > summary { font: 600 11px/1.5 system-ui,sans-serif; }
      #${c}-root .cw-budget-editor .cw-config-form { margin-top: var(--cw-space-block); }
      #${c}-root .cw-budget-navigation .cw-forecast-group:last-of-type { margin-bottom: var(--cw-space-section); }
      #${c}-root .cw-tools-nav { margin-bottom: 1px; }
      #${c}-root .cw-settings-dialog .cw-mini-pane .cw-settings-actions { margin-top: 6px; }
      /* Destructive and safe actions look like text, never pill buttons. */
      #${c}-root button.cw-text-action,
      #${c}-root button.cw-danger-action {
        appearance: none; border: 0; border-radius: 0; background: transparent;
        padding: 2px 0; box-shadow: none; font: 550 11px/1.4 system-ui, sans-serif;
        cursor: pointer; white-space: nowrap; text-align: left;
      }
      #${c}-root button.cw-text-action { color: var(--cw-accent) !important; }
      #${c}-root button.cw-danger-action { color: #b91c1c !important; }
      #${c}-root button.cw-text-action:hover,
      #${c}-root button.cw-danger-action:hover { background: transparent; text-decoration: underline; }
      #${c}-root button.cw-text-action:focus-visible,
      #${c}-root button.cw-danger-action:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
      #${c}-root button.cw-text-action:disabled,
      #${c}-root button.cw-danger-action:disabled { opacity: .45; cursor: not-allowed; }
      #${c}-root .cw-reset-line {
        display: flex; flex-wrap: nowrap; align-items: baseline; gap: 8px;
        white-space: nowrap;
      }
      /* Watchdog-local dialogs size independently; scroll only at viewport limit. */
      #${c}-root .cw-settings-dialog { transform: none; }
      #${c}-root .cw-floating-tip {
        position: fixed; z-index: 20;
        max-width: min(245px, calc(100vw - 16px));
        border: 1px solid rgba(100,116,139,.38); box-shadow: 0 4px 14px rgba(0,0,0,.2);
        font: 500 11px/1.35 system-ui,sans-serif;
      }
      #${c}-root .cw-floating-tip .cw-tip-logo {
        display: inline-block; width: 18px; height: 18px; vertical-align: -5px;
        position: relative; left: auto; top: auto; transform: none;
        filter: none;
      }
      /* Tooltip is dark in both palettes; static Watchdog mark keeps a white rim. */
      #${c}-root .cw-floating-tip .cw-tip-logo.cw-brand-mark:not(.cw-has-site-logo) {
        --cw-watchdog-outline: #fff;
      }
      #${c}-root .cw-floating-tip .cw-tip-logo.cw-has-site-logo,
      #${c}-root[data-cw-palette="dark"] .cw-floating-tip .cw-tip-logo.cw-has-site-logo {
        background: none;
        color: inherit; opacity: 1;
      }
      #${c}-root[data-cw-palette="dark"] .cw-mini-nav .cw-mini-tab { color: var(--cw-muted); }
      #${c}-root[data-cw-palette="dark"] button.cw-danger-action { color: #fca5a5 !important; }


      /* One set of component styles for both modes. Palette owns colors;
         Soft/Sharp differ only in corner treatment and Sharp's bevel shape. */
      #${c}-root {
        --cw-ink: #111827;
        --cw-muted: #6b7280;
        --cw-accent: #2563eb;
        --cw-watchdog-ink: #080808;
        --cw-watchdog-gray: #3f3e3e;
        --cw-watchdog-outline: transparent;
        --cw-panel-surface: rgba(255,255,255,.80);
        --cw-panel-border: rgba(17,24,39,.16);
        --cw-panel-shadow: 0 12px 40px rgba(0,0,0,.16);
        --cw-dialog-surface: #fff;
        --cw-dialog-border: rgba(100,116,139,.30);
        --cw-dialog-shadow: 0 12px 35px rgba(0,0,0,.28);
        --cw-chip-surface: rgba(255,255,255,.88);
        --cw-chip-border: rgba(100,116,139,.16);
        --cw-scrim: rgba(15,23,42,.08);
        --cw-radius-scale: 1;
        --cw-toast-bg: #eaf3ff;
        --cw-toast-border: #b6d6ff;
        --cw-toast-ink: #2159a4;
        --cw-toast-error-bg: #fce8e8;
        --cw-toast-error-border: #e5aaaa;
        --cw-toast-error-ink: #922b2b;
        /* Shared vertical rhythm across Context, Budget forecast and Details. */
        --cw-space-row: 5px;
        --cw-space-block: 6px;
        --cw-space-section: 8px;
        color-scheme: light;
      }
      #${c}-root[data-cw-palette="dark"] {
        --cw-ink: #f3f4f6;
        --cw-muted: #a1a1aa;
        --cw-accent: #4f93e6;
        --cw-watchdog-outline: #fff;
        --cw-panel-surface: rgba(18,18,18,.80);
        --cw-panel-border: rgba(255,255,255,.16);
        --cw-panel-shadow: 0 12px 40px rgba(0,0,0,.35);
        --cw-dialog-surface: #18181b;
        --cw-dialog-border: rgba(255,255,255,.18);
        --cw-dialog-shadow: 0 12px 35px rgba(0,0,0,.35);
        --cw-chip-surface: rgba(17,24,39,.90);
        --cw-chip-border: rgba(161,161,170,.22);
        --cw-scrim: rgba(0,0,0,.10);
        --cw-toast-bg: #173452;
        --cw-toast-border: #376492;
        --cw-toast-ink: #c8e4ff;
        --cw-toast-error-bg: #512929;
        --cw-toast-error-border: #8d4949;
        --cw-toast-error-ink: #ffe1e1;
        color-scheme: dark;
      }
      #${c}-root[data-cw-style="sharp"] { --cw-radius-scale: 0; }
      #${c}-root .cw-panel {
        background: var(--cw-panel-surface); color: var(--cw-ink);
        border-color: var(--cw-panel-border); box-shadow: var(--cw-panel-shadow);
      }
      #${c}-root .cw-settings-dialog {
        background: var(--cw-dialog-surface); color: var(--cw-ink);
        border-color: var(--cw-dialog-border); box-shadow: var(--cw-dialog-shadow);
      }
      #${c}-root .cw-settings-scrim { background: var(--cw-scrim); }
      #${c}-root .cw-chip { background: var(--cw-chip-surface); color: var(--cw-ink); }
      #${c}-root .cw-chip .cw-metric { color: var(--cw-ink); }
      /* Appearance choices are borderless and separated by middle dots.
         The hidden bold text grid layer reserves each option's maximum width,
         so changing which word is bold never shifts the other controls. */
      #${c}-root .cw-view-preferences { margin-top: 9px; }
      #${c}-root .cw-view-setting-row {
        display: grid; grid-template-columns: 62px minmax(0,1fr);
        align-items: center; column-gap: 4px; margin: 10px 0;
      }
      #${c}-root .cw-view-label {
        font: 400 11px/1.4 system-ui,sans-serif; color: var(--cw-muted);
      }
      #${c}-root .cw-view-options {
        display: flex; align-items: center; gap: 5px; min-width: 0;
      }
      #${c}-root .cw-view-options button {
        appearance: none; display: inline-grid; align-items: center;
        flex: 0 0 auto; margin: 0; padding: 3px 0;
        border: 0; border-radius: 0; background: transparent;
        color: var(--cw-muted); font: 400 12px/1.4 system-ui,sans-serif;
        cursor: pointer; white-space: nowrap;
      }
      #${c}-root .cw-view-options button::before,
      #${c}-root .cw-view-options button > span { grid-area: 1 / 1; }
      #${c}-root .cw-view-options button::before {
        content: attr(data-cw-label); font-weight: 700; visibility: hidden;
      }
      #${c}-root .cw-view-options button:hover { background: transparent; color: var(--cw-ink); }
      #${c}-root .cw-view-options button[aria-pressed="true"] {
        background: transparent; color: var(--cw-ink);
      }
      #${c}-root .cw-view-options button[aria-pressed="true"] > span { font-weight: 700; }
      #${c}-root .cw-view-options button:focus-visible {
        outline: 1px solid var(--cw-muted); outline-offset: 2px;
      }
      #${c}-root .cw-view-separator {
        flex: 0 0 auto; color: var(--cw-ink);
        font: 500 12px/1.4 system-ui,sans-serif; user-select: none;
      }
      #${c}-root .cw-tools-nav { gap: 9px; }

      /* Shared component geometry: Soft rounds corners via --cw-radius-scale. */
      #${c}-root .cw-toolbar .cw-tool-button {
        color: #111827; border: 1px solid transparent; border-radius: calc(10px * var(--cw-radius-scale));
        background: transparent; box-shadow: none;
      }
      #${c}-root .cw-toolbar .cw-tool-button:hover {
        background: rgba(100,116,139,.095); border-color: transparent;
      }
      /* Browser-inspired, softly rounded top-level tabs, never isolated pills. */
      #${c}-root .cw-tabs {
        gap: 2px; padding: 0 1px;
        border-bottom: 1px solid rgba(100,116,139,.23);
      }
      #${c}-root .cw-tabs button {
        clip-path: none; margin-bottom: 0; min-height: 33px;
        border: 1px solid rgba(100,116,139,.10);
        border-radius: calc(12px * var(--cw-radius-scale)) calc(12px * var(--cw-radius-scale)) calc(3px * var(--cw-radius-scale)) calc(3px * var(--cw-radius-scale));
        background: rgba(100,116,139,.04); color: #8a929f;
        box-shadow: none;
      }
      #${c}-root .cw-tabs button[aria-selected="true"] {
        position: relative; z-index: 1; margin-bottom: -1px;
        padding-bottom: 7px; border-radius: calc(12px * var(--cw-radius-scale)) calc(12px * var(--cw-radius-scale)) 0 0;
        border: 1px solid rgba(100,116,139,.19); border-bottom-color: transparent;
        background: rgba(255,255,255,.75); color: #111827;
        box-shadow: 4px -1px 8px -6px rgba(15,23,42,.24),
                    0 -2px 5px -5px rgba(15,23,42,.12);
      }
      #${c}-root .cw-tabs button:hover:not([aria-selected="true"]) {
        color: #4b5563; background: rgba(100,116,139,.075);
      }
      /* Always-visible mini-tab underlines: small rounded end curls. */
      #${c}-root .cw-mini-nav .cw-mini-tab {
        position: relative; padding-bottom: 2px;
        border-bottom: 0; border-radius: 0;
      }
      #${c}-root .cw-mini-nav .cw-mini-tab::after {
        content: ''; position: absolute; left: -2px; right: -2px; bottom: 0;
        height: 4px; border: 1.5px solid rgba(100,116,139,.29);
        border-top: 0; border-radius: 0 0 calc(5px * var(--cw-radius-scale)) calc(5px * var(--cw-radius-scale));
        pointer-events: none;
      }
      #${c}-root .cw-mini-nav .cw-mini-tab.cw-mini-active::after {
        border-color: rgba(17,24,39,.80); border-top: 0;
      }
      #${c}-root[data-cw-palette="dark"] .cw-toolbar .cw-tool-button { color: #f3f4f6; }
      #${c}-root[data-cw-palette="dark"] .cw-tabs button {
          color: #96969f; background: rgba(255,255,255,.035);
          border-color: rgba(255,255,255,.065);
        }
      #${c}-root[data-cw-palette="dark"] .cw-tabs button[aria-selected="true"] {
          color: #f3f4f6; background: rgba(255,255,255,.14);
          border: 1px solid rgba(255,255,255,.16); border-bottom-color: transparent;
          box-shadow: 4px -1px 9px -6px rgba(0,0,0,.50),
                      0 -2px 5px -5px rgba(0,0,0,.30);
        }
      #${c}-root[data-cw-palette="dark"] .cw-tabs button:hover:not([aria-selected="true"]) {
          color: #d4d4d8; background: rgba(255,255,255,.075);
        }
      #${c}-root[data-cw-palette="dark"] .cw-mini-nav .cw-mini-tab::after {
          border-color: rgba(161,161,170,.45); border-top: 0;
        }
      #${c}-root[data-cw-palette="dark"] .cw-mini-nav .cw-mini-tab.cw-mini-active::after {
          border-color: rgba(244,244,245,.9); border-top: 0;
        }
      /* Sharp changes shape, not dimensions, palette, typography, hit areas,
         padding or hover. Every other component inherits the shared rules. */
      #${c}-root[data-cw-style="sharp"], #${c}-root[data-cw-style="sharp"] *,
      #${c}-root[data-cw-style="sharp"] *::before, #${c}-root[data-cw-style="sharp"] *::after {
        border-radius: 0 !important;
      }
      #${c}-root[data-cw-style="sharp"] .cw-tabs button {
        clip-path: polygon(7px 0, 100% 0, 100% 100%, 0 100%);
      }
      /* The beveled surface is decorative. Keep the native rectangular
         button hit area and the shared focus outline. */
      #${c}-root[data-cw-style="sharp"] .cw-chip {
        position: relative; isolation: isolate;
        border-color: transparent; background: transparent;
        box-shadow: none; backdrop-filter: none; -webkit-backdrop-filter: none;
      }
      #${c}-root[data-cw-style="sharp"] .cw-chip::before,
      #${c}-root[data-cw-style="sharp"] .cw-chip::after {
        content: ''; position: absolute; pointer-events: none;
      }
      #${c}-root[data-cw-style="sharp"] .cw-chip::before {
        inset: 0; z-index: -2; background: var(--cw-chip-border);
        clip-path: polygon(7px 0, 100% 0, 100% 100%, 0 100%);
      }
      #${c}-root[data-cw-style="sharp"] .cw-chip::after {
        inset: 1px; z-index: -1; background: var(--cw-chip-surface);
        clip-path: polygon(6px 0, 100% 0, 100% 100%, 0 100%);
      }
      /* Semantic typography shared by Stable and Dev. Dev responsive rules
         are injected separately by the Dev build only. */
      #${c}-root {
        --cw-type-title: 16px;
        --cw-type-key: 15px;
        --cw-type-badge: 14px;
        --cw-type-value: 12px;
        --cw-type-label: 13px;
        --cw-type-body: 12px;
        --cw-type-caption: 10px;
        --cw-type-nav: 11px;
        --cw-type-tab: 12px;
        --cw-type-diagnostic: 11px;
        --cw-weight-key: 700;
        --cw-weight-heading: 600;
        --cw-weight-value: 600;
        --cw-weight-label: 500;
        --cw-weight-body: 400;
        --cw-weight-dialog-heading: 650;
      }
      /* Context and Budget share a key-value role; badge keeps a separate compact role. */
      #${c}-root .cw-chip .cw-metric,
      #${c}-root .cw-context-range,
      #${c}-root .cw-forecast-cards .cw-forecast-opt,
      #${c}-root .cw-forecast-cards .cw-forecast-pess {
        font-family: inherit;
        font-size: var(--cw-type-key);
        font-weight: var(--cw-weight-key);
        line-height: 1.35;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
      }
      /* Compact spacing keeps five header actions aligned. */
      #${c}-root .cw-toolbar { gap: 1px; }
      #${c}-root .cw-toolbar .cw-tool-button { width: 26px; height: 30px; }
      #${c}-root .cw-toolbar .cw-pin-panel[aria-pressed="true"] { color: var(--cw-accent); background: transparent; }
      #${c}-root .cw-toolbar .cw-pin-panel svg { transform: rotate(-32deg); transform-origin: center; transition: transform .15s ease; }
      #${c}-root .cw-toolbar .cw-pin-panel[aria-pressed="true"] svg { transform: none; }
      /* Badge typography is independent of key context estimates. */
      #${c}-root .cw-chip .cw-metric { font-size: var(--cw-type-badge); font-weight: var(--cw-weight-body); }
      /* Secondary values use the same 13px size as labels; labels retain
         their muted color, while values use regular weight to keep the three
         context estimates and badge as the only strong numeric accents. */
      #${c}-root .cw-context-text-only .cw-data-tokens,
      #${c}-root .cw-data-row > strong,
      #${c}-root .cw-limit-estimates strong {
        font-family: inherit;
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-body);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0;
      }
      #${c}-root .cw-context-characters strong {
        font-family: inherit;
        font-size: var(--cw-type-caption);
        font-weight: var(--cw-weight-body);
        font-variant-numeric: tabular-nums;
      }
      /* Common primary labels and section headings. */
      #${c}-root .cw-context-primary-label,
      #${c}-root .cw-context-text-only .cw-card-caption,
      #${c}-root .cw-data-row > span,
      #${c}-root .cw-limit-estimates span {
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-label);
        line-height: 1.4;
      }
      #${c}-root .cw-advanced-caption,
      #${c}-root .cw-about-section dt,
      #${c}-root .cw-forecast-heading > strong,
      #${c}-root .cw-forecast-group-title,
      #${c}-root .cw-about-product,
      #${c}-root .cw-about-section > summary,
      #${c}-root .cw-about-terms > summary {
        font-family: inherit;
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-heading);
        line-height: 1.4;
      }
      #${c}-root .cw-forecast-status {
        font-size: var(--cw-type-label);
        font-weight: var(--cw-weight-value);
      }
      /* Budget labels follow the Context panel's muted hierarchy. Only ink changes
         for Edit token budgets; its original 11px type and disclosure remain. */
      #${c}-root .cw-forecast-heading > strong,
      #${c}-root .cw-forecast-group-title,
      #${c}-root .cw-budget-editor > summary { color: var(--cw-muted); }
      #${c}-root .cw-forecast-heading { flex-wrap: wrap; row-gap: 2px; }
      /* Captions are close to their numbers, never a separate visual block. */
      #${c}-root .cw-context-summary .cw-context-note,
      #${c}-root .cw-forecast-cards .cw-context-note,
      #${c}-root .cw-progress-grid .cw-context-note {
        font-family: inherit;
        font-size: var(--cw-type-caption);
        font-weight: var(--cw-weight-body);
        line-height: 1.35;
        margin: 2px 0 3px;
      }
      #${c}-root .cw-context-summary .cw-context-note > span { display: block; }
      #${c}-root .cw-context-characters,
      #${c}-root .cw-about-version,
      #${c}-root .cw-about-credit,
      #${c}-root .cw-advanced-hint,
      #${c}-root .cw-dialog-header .cw-dialog-message {
        font-family: inherit;
        font-size: var(--cw-type-caption);
        font-weight: var(--cw-weight-body);
        line-height: 1.4;
      }
      #${c}-root .cw-context-text-only { margin-top: 5px; }
      /* Primary UI labels: 13px; numeric settings: 12px; supporting body: 12px.
         Navigation tabs: 12px (11px narrow); action links and dense reports: 11px. */
      #${c}-root .cw-about-dialog,
      #${c}-root .cw-limit-dialog .cw-limit-content,
      #${c}-root .cw-settings-dialog {
        font-size: var(--cw-type-body);
        line-height: 1.5;
      }
      #${c}-root .cw-config-form label,
      #${c}-root .cw-settings label { font-size: var(--cw-type-body); }
      #${c}-root .cw-config-form input[type="number"],
      #${c}-root .cw-settings input[type="number"] {
        font-family: inherit;
        font-size: var(--cw-type-value);
        padding-top: 3px; padding-bottom: 3px;
        font-weight: var(--cw-weight-body);
        font-variant-numeric: normal;
      }
      #${c}-root .cw-tools-nav .cw-mini-tab,
      #${c}-root .cw-budget-mini-nav .cw-mini-tab,
      #${c}-root .cw-copy-details,
      #${c}-root .cw-settings-dialog .cw-settings-actions button,
      #${c}-root .cw-limit-actions button {
        font-family: inherit;
        font-size: var(--cw-type-nav);
      }
      /* Primary/mini tabs have their own 12px role; links stay at 11px. */
      #${c}-root .cw-tabs button,
      #${c}-root .cw-mini-nav .cw-mini-tab {
        font-size: var(--cw-type-tab);
        font-family: inherit;
      }
      #${c}-root .cw-details-report,
      #${c}-root .cw-diagnostics-line,
      #${c}-root .cw-history-line,
      #${c}-root .cw-performance-line {
        font-family: inherit;
        font-size: var(--cw-type-diagnostic);
        line-height: 1.55;
        font-variant-numeric: tabular-nums;
      }
      #${c}-root .cw-title-info strong { font-size: var(--cw-type-title); font-weight: var(--cw-weight-key); }
    `;function Vn(e,t){for(let[i,n]of e.entries())n.addEventListener("keydown",o=>{let s=o.key==="ArrowRight"?1:o.key==="ArrowLeft"?-1:0,r=o.key==="Home"?0:o.key==="End"?e.length-1:s?(i+s+e.length)%e.length:-1;r<0||(o.preventDefault(),t(e[r]),e[r].focus())})}function gi(e,t,i,n=!1,o=null,s={}){let r=[...e.querySelectorAll("button")],d=s.mode==="tabs",l=u=>{let p=u.getAttribute(t),m=i[p].pane;if(n&&!m.hidden)return;let f=d||m.hidden;for(let g of Object.values(i))g.pane.hidden=!0;for(let g of r){let b=f&&g===u;g.classList.toggle("cw-mini-active",b),d?(g.setAttribute("aria-selected",String(b)),g.tabIndex=b?0:-1):g.setAttribute("aria-expanded",String(b))}f&&(m.hidden=!1,i[p].mount(),o?.(p)),n&&(N(),requestAnimationFrame(N))};for(let u of r)u.addEventListener("click",()=>l(u));if(d){for(let u of r)u.tabIndex=u.getAttribute("aria-selected")==="true"?0:-1;Vn(r,l)}Q(e)}function Zn(e,t){t.dataset.mounted!=="true"&&(t.insertAdjacentHTML("beforeend",dr[e]),t.dataset.mounted="true",e==="attachment"&&(t.querySelector(".cw-metadata-section").innerHTML=ur(xe)),Me(),mi(e),Q(t))}function hi(e,t=!0){if(a){Po(xt.includes(e)?e:"context"),a.panel.hidden||Yn(pe);for(let i of xt){let n=i===pe;a[`${i}View`].hidden=!n,a[`${i}Tab`].setAttribute("aria-selected",String(n)),a[`${i}Tab`].tabIndex=n?0:-1}t&&A(y())}}function Yn(e){let t=a[`${e}View`];if(!(!t||t.dataset.mounted==="true")){if(t.insertAdjacentHTML("beforeend",pr[e]),t.dataset.mounted="true",Me(),e==="context")gi(t.querySelector(".cw-mini-nav"),"data-cw-mini",{text:{pane:a.textSettingsDetails,mount:()=>Zn("text",a.textSettingsDetails)},attachment:{pane:a.attachmentSettings,mount:()=>Zn("attachment",a.attachmentSettings)},coefficients:{pane:a.advancedAttachments,mount:()=>Zn("coefficients",a.advancedAttachments)}},!1,i=>{Je[i]&&ce(i)});else if(e==="budget"){let i=t.querySelector(".cw-budget-mini-nav"),n=t.querySelector(".cw-budget-limits"),o=t.querySelector(".cw-history-details"),s=t.querySelector(".cw-budget-editor");gi(i,"data-cw-budget",{limits:{pane:n,mount:()=>{}},history:{pane:o,mount:()=>{o.dataset.mounted!=="true"&&(o.insertAdjacentHTML("beforeend",Tt.historyBody),o.dataset.mounted="true",Me())}}},!1,r=>{r==="history"&&Un(bt())},{mode:"tabs"}),s.addEventListener("toggle",()=>{s.open&&s.dataset.mounted!=="true"&&(s.querySelector(".cw-budget-settings").insertAdjacentHTML("beforeend",Tt.budgetForm),s.dataset.mounted="true",Me(),mi("budget"),Q(s)),s.open&&ce("budget")}),Q(t)}else e==="details"&&a.copyDetails.addEventListener("click",async()=>{let i=y(),n=Ea(zn(X(i),bt(),Ke(i)));try{await navigator.clipboard.writeText(n),v("Details copied.")}catch{v("Clipboard unavailable. Select Details text to copy.")}});Q(t)}}function Us(e){let t=e.querySelector(".cw-chip").getBoundingClientRect();L.badgePosition={left:Math.round(t.left),top:Math.round(t.top)},V()}var Jn=null;function wr(e,t){Jn&&window.removeEventListener("resize",Jn);let i=null,n=0,o=0,s=0,r=0,d=!1,l=!1,u=4;t.addEventListener("pointerdown",f=>{if(f.button!==0||!f.isPrimary)return;let g=t.getBoundingClientRect();i=f.pointerId,n=f.clientX,o=f.clientY,s=g.left,r=g.top,d=!1,t.setPointerCapture?.(i)}),t.addEventListener("pointermove",f=>{if(i===null||f.pointerId!==i)return;let g=f.clientX-n,b=f.clientY-o;if(!d&&Math.hypot(g,b)<u)return;d||(d=!0,t.classList.add("cw-dragging"),t.dispatchEvent(new Event("cw-badge-dragstart",{bubbles:!0}))),f.preventDefault();let h=t.getBoundingClientRect(),S=Math.max(0,window.innerWidth-h.width),k=Math.max(0,window.innerHeight-h.height),I=J(s+g,0,S),z=J(r+b,0,k);e.style.left=`${I}px`,e.style.top=`${z}px`,e.style.right="auto",e.style.bottom="auto"});let p=f=>{i===null||f.pointerId!==i||(d&&(l=!0,Us(e),Ze(),(a?.confirmDialog?.open||a?.settingsDialog?.open||a?.aboutDialog?.open||a?.limitDialog?.open)&&N()),t.classList.remove("cw-dragging"),t.releasePointerCapture?.(i),i=null,d=!1)};t.addEventListener("pointerup",p),t.addEventListener("pointercancel",p),t.addEventListener("click",f=>{l&&(l=!1,f.preventDefault(),f.stopImmediatePropagation())},!0);let m=()=>{if(!L.badgePosition){qi(e,!a?.panel?.hidden),Ze(),(a?.confirmDialog?.open||a?.settingsDialog?.open||a?.aboutDialog?.open||a?.limitDialog?.open)&&N();return}let f=t.getBoundingClientRect(),g=Math.max(0,window.innerWidth-f.width),b=Math.max(0,window.innerHeight-f.height),h=J(f.left,0,g),S=J(f.top,0,b);e.style.left=`${h}px`,e.style.top=`${S}px`,e.style.right="auto",e.style.bottom="auto",Ze(),(a?.confirmDialog?.open||a?.settingsDialog?.open||a?.aboutDialog?.open||a?.limitDialog?.open)&&N()};Jn=m,window.addEventListener("resize",m)}function br(){Vt();let e=a.panel.hidden;if(e){let i=a.chip.getBoundingClientRect();a.root.style.left=`${i.left}px`,a.root.style.top=`${i.top}px`,a.root.style.right="auto",a.root.style.bottom="auto",a.root.dataset.cwPanelOpen="true",a.chip.setAttribute("aria-label","Close Watchdog panel"),a.chip.setAttribute("aria-expanded","true")}a.panel.hidden=!1;let t=a.root.querySelector(".cw-floating-tip");t&&(t.hidden=!0),Yn(pe),A(y()),e&&Ze()}function yr(){a&&(a.confirmDialog?.open?Ye(!1):a.settingsDialog?.open?Wt():a.aboutDialog?.open?ui():a.limitDialog?.open&&rt())}function Xn(){if(!a||a.panel.hidden)return;yr(),a.settingsDialog?.open&&Wt(),Ht(),a.panel.hidden=!0,delete a.root.dataset.cwPanelOpen,a.chip.setAttribute("aria-label","Open Watchdog panel"),a.chip.setAttribute("aria-expanded","false");let e=a.chip.getBoundingClientRect(),t=Math.max(0,window.innerWidth-e.width);e.left>t&&(a.root.style.left=`${t}px`)}function Ws(e){if(e.detail===0)return!0;let t=a.siteIcon.getBoundingClientRect(),i=parseFloat(getComputedStyle(a.siteIcon.parentElement,"::before").width),n=e.clientX-(t.left+t.width/2),o=e.clientY-(t.top+t.height/2);return Math.hypot(n,o)<=i/2}function Lr(){a.pinBtn.setAttribute("aria-pressed",String(ft)),a.pinBtn.setAttribute("aria-label",ft?"Unpin panel":"Pin panel"),a.pinBtn.querySelector(".cw-tool-tip").textContent=ft?"Unpin panel \xB7 Close when clicking outside":"Pin panel \xB7 Keep open when clicking outside"}function vr(e){oa(e,a.siteIcon),wr(e,a.chip);let t=xt.map(i=>a[`${i}Tab`]);for(let[i,n]of t.entries())n.addEventListener("click",()=>hi(xt[i]));Vn(t,i=>hi(xt[t.indexOf(i)])),a.chip.addEventListener("click",i=>{if(Ws(i)){if(!a.panel.hidden){Xn();return}br(),se()}}),a.pauseToggle.addEventListener("click",()=>{if(!Ti())return;let i=L.watchdogPaused===!0;if(L.watchdogPaused=!i,!V()){L.watchdogPaused=i,v("Could not save Watchdog pause preference.");return}Ai()}),Lr(),a.pinBtn.addEventListener("click",()=>{Eo(!ft),Lr()}),a.aboutBtn.addEventListener("click",nr),a.settingsScrim.addEventListener("click",yr),dn||(Oo(!0),document.addEventListener("pointerdown",i=>{!a||a.panel.hidden||a.root.contains(i.target)||ft||Xn()},!0),document.addEventListener("keydown",i=>{i.key!=="Escape"||!a||a.panel.hidden||a.settingsDialog?.open||a.aboutDialog?.open||a.limitDialog?.open||(i.preventDefault(),Xn(),a.chip.focus())})),a.settingsBtn.addEventListener("click",ir),a.endChat.addEventListener("click",or),a.detailHandoff.addEventListener("click",()=>{let i=L.handoffPrompt||At,n=Da(i);n==="inserted"?v("HANDOFF inserted. Review before sending."):Ra(i,n)})}function xr(e,t,i,n){if(!t||t.role!==n||!["user","assistant"].includes(n)||!String(i.fingerprint).startsWith("v3:")||!["unit-markdown","unit-user-text","unit-user"].includes(i.parts.source))return null;let o=Number(t.chars)||0;return o>64||i.chars<Math.max(160,o*3)?null:{id:e,role:n,oldChars:o,oldTokens:Number(t.tokens)||0,oldFingerprint:t.fingerprint||"",newChars:i.chars,newTokens:i.tokens,newFingerprint:i.fingerprint,source:i.parts.source}}function Vi(e){return JSON.stringify([e.id,e.role,e.oldChars,e.oldTokens,e.oldFingerprint,e.newChars,e.newTokens,e.newFingerprint,e.source])}function kr(){let e=De?.eligibleRepairs||[];if(!e.length||De.routeUnverified||G()!==w||je()!=="ready"||x.route&&!si())return{status:"not-ready"};let t=e.map(i=>`${i.role} \u2026${i.id.slice(-10)}: ${i.oldChars} \u2192 ${i.newChars} chars, ${i.oldTokens} \u2192 ${i.newTokens} tokens`).join(`
`);return{status:"ready",candidates:e,chatKey:w,message:`Repair ${e.length} confirmed incomplete stored message(s)?

${t}

Only these saved records will be changed. Their old values will be retained for Undo. Audit is otherwise read-only.`}}function Sr(e){let t=e?.candidates;if(!t?.length||e.chatKey!==w||De?.eligibleRepairs!==t||De.routeUnverified||G()!==w||je()!=="ready"||x.route&&!si())return{status:"stale"};let i=y(),n=q(),o=new Map,s=new Set(t.map(l=>l.id));for(let{el:l,role:u,id:p}of ye(n.nodes))_e(p,n)&&s.has(p)&&!o.has(p)&&o.set(p,{node:l,role:u});let r=[];for(let l of t){let u=o.get(l.id),p=i.messages[l.id];if(!u||!p||u.role!==l.role)continue;let m=Yt(u.node,u.role),f=xr(l.id,p,m,u.role);!f||Vi(f)!==Vi(l)||_i(u.node)||r.push({candidate:f,old:{...p}})}if(!r.length)return{status:"changed"};let d=Date.now();for(let{candidate:l,old:u}of r){let p={...u,role:l.role,chars:l.newChars,tokens:l.newTokens,fingerprint:l.newFingerprint};i.messages[l.id]=p,i.repairHistory.push({id:l.id,at:d,before:u,after:p}),i.repairHistory.length>20&&i.repairHistory.shift()}return ae(i)?(at(),{status:"repaired",count:r.length,state:i}):{status:"storage-failed"}}function Cr(){if(G()!==w||!w)return{status:"stale"};let e=y(),t=e.repairHistory.at(-1);return t?JSON.stringify(e.messages[t.id])!==JSON.stringify(t.after)?{status:"changed"}:{status:"ready",item:t,chatKey:w,message:`Undo last repair for \u2026${t.id.slice(-10)}? Restore ${t.before.chars} characters?`}:{status:"none"}}function Tr(e){if(!e||e.chatKey!==w||G()!==w||!w)return{status:"stale"};let t=y(),i=t.repairHistory.at(-1);return!i||JSON.stringify(i)!==JSON.stringify(e.item)||JSON.stringify(t.messages[i.id])!==JSON.stringify(i.after)?{status:"changed"}:(t.messages[i.id]=i.before,t.repairHistory.pop(),ae(t)?(at(),{status:"undone",state:t}):{status:"storage-failed"})}function Ar(){let e=G();if(!e)return null;let t=y(e),i=new Map,n=0,o=0,s=oo;for(let[b,h]of Object.entries(t.messages||{})){let S=s.exec(b);if(!S){o++;continue}n++;let k=S[1].toLowerCase();i.set(`msg:${k}`,{uuid:k,role:h?.role||"unknown",chars:Number(h?.chars)||0,tokens:Number(h?.tokens)||0,fingerprint:String(h?.fingerprint||""),stored:!0,storedOrder:n,visible:!1,domOrder:"",ambiguous:!1})}let r=!!x.route||e!==w,d=0,l=0,u=0;if(!r){let b=q();d=b.nodes.length;for(let{index:h,role:S,id:k}of ye(b.nodes)){if(!k){l++;continue}let I=s.exec(k);if(!I){l++;continue}let z=`msg:${I[1].toLowerCase()}`,$=b.ambiguousIds.has(z);$&&u++;let O=i.get(z);O||(O={uuid:I[1].toLowerCase(),role:S||"unknown",chars:"",tokens:"",fingerprint:"",stored:!1,storedOrder:"",visible:!1,domOrder:"",ambiguous:!1},i.set(z,O)),O.visible=!0,O.domOrder=h+1,O.ambiguous=O.ambiguous||$}}let p=[...i.values()],m=p.filter(b=>b.visible).length,f=p.filter(b=>b.visible&&!b.stored).length,g=["# Watchdog UUID diagnostic (read-only; state:v2)",`# Chat: ${e}`,`# Exported: ${new Date().toISOString()}`,`# Saved UUIDs: ${n}; visible UUIDs: ${m}; visible but not saved: ${f}`,`# Current DOM: ${r?"NOT VERIFIED (visible flags omitted)":"verified against current route"}; DOM units: ${d}; no UUID: ${l}; ambiguous: ${u}`,`# Invalid saved keys: ${o}`,"# Stored order is insertion order, NOT chronological chat order. DOM order applies only to currently rendered units.","# The export includes no message text or file contents.","stored_order	uuid	role	chars	tokens	fingerprint	in_dom	dom_order	status"];for(let b of p){let h=b.ambiguous?"ambiguous-visible":b.stored&&b.visible?"saved+visible":b.stored?"saved":"visible-only";g.push([b.storedOrder,b.uuid,b.role,b.chars,b.tokens,b.fingerprint,b.visible?"yes":"no",b.domOrder,h].join("	"))}return{chatKey:e,storedCount:n,visibleCount:m,visibleOnlyCount:f,routeUnverified:r,tsv:g.join(`
`)+`
`}}function Hs(e,t){let i=Number(e.chars)||0,n=Number(e.tokens)||0,o=String(e.fingerprint||""),s=o?o===t.fingerprint?"same":"changed":"unavailable",r=i!==t.chars,d=n!==t.tokens,l=s==="changed";return{oldChars:i,oldTokens:n,charsChanged:r,tokensChanged:d,hashChanged:l,fingerprintStatus:s,different:r||d||l}}function $r(){if(Ve(),!w)return null;let e=!!x.route&&!si();e||fe(je(),!1);let t=y(),i=q();Di(i);let n={at:Date.now(),visible:i.nodes.length,routeUnverified:e,raw:i.rawCount,collapsed:i.collapsed,verified:0,missing:0,storedShort:0,domShort:0,different:0,roleChanged:0,noStableId:0,duplicateIds:0,ambiguous:0,unhydrated:0,scopeCounts:{"unit-user-text":0,"unit-user":0,"unit-markdown":0,"unit-assistant":0,fallback:0},contentRoots:0,examples:[],eligibleRepairs:[],repairCandidates:0,repairRepeatNeeded:0,differenceReasons:{chars:0,tokens:0,fingerprint:0,hashOnly:0}},o=new Set,s=new Map;n.unitRoles={user:0,assistant:0,realIds:0};let r=(d,l,u,p,m=null)=>{n.examples.length>=6||n.examples.push({kind:d,idSuffix:String(l).slice(-10),storedChars:u?Number(u.chars)||0:null,domChars:p?.chars??null,storedTokens:u?Number(u.tokens)||0:null,domTokens:p?.tokens??null,fingerprintStatus:m?.fingerprintStatus||"n/a",reasons:m?[...m.charsChanged?["chars"]:[],...m.tokensChanged?["tokens"]:[],...m.hashChanged?["fingerprint"]:[]]:[],proseChars:p?.parts?.prose?.length??null,codeChars:p?.parts?.code?.length??null,scope:p?.parts?.source||null,roots:p?.parts?.roots??null})};for(let{el:d,role:l,id:u}of ye(i.nodes)){if(We(d)&&(n.unitRoles[l]=(n.unitRoles[l]||0)+1,u?.startsWith("msg:")&&n.unitRoles.realIds++),!u){n.noStableId++,r("no-id",l);continue}if(o.has(u)){n.duplicateIds++,r("duplicate-id",u);continue}if(o.add(u),i.ambiguousIds.has(u)){n.ambiguous++,r("ambiguous-dom",u);continue}let p=t.messages[u],m=Yt(d,l);if(n.contentRoots+=m.parts.roots,n.scopeCounts[m.parts.source]=(n.scopeCounts[m.parts.source]||0)+1,!m.chars||p&&Number(p.chars)>=80&&m.chars<40){n.unhydrated++,r("unhydrated",u,p,m);continue}if(!p){n.missing++,r("missing",u,null,m);continue}let f=Hs(p,m),{oldChars:g}=f;if(["user","assistant"].includes(p.role)&&["user","assistant"].includes(l)&&p.role!==l&&(n.roleChanged++,r("role",u,p,m)),g<=64&&m.chars>=Math.max(160,g*3)){n.storedShort++,r("stored-short",u,p,m,f);let b=!e&&x.phase==="ready"&&!_i(d)&&xr(u,p,m,l);b&&(s.set(u,b),$t.has(u)&&Vi($t.get(u))===Vi(b)?n.eligibleRepairs.push(b):n.repairRepeatNeeded++)}else g>=80&&m.chars<=Math.max(24,g*.35)?(n.domShort++,r("dom-short",u,p,m,f)):f.different?(n.different++,f.charsChanged&&n.differenceReasons.chars++,f.tokensChanged&&n.differenceReasons.tokens++,f.hashChanged&&n.differenceReasons.fingerprint++,f.hashChanged&&!f.charsChanged&&!f.tokensChanged&&n.differenceReasons.hashOnly++,r("different",u,p,m,f)):n.verified++}return n.repairCandidates=s.size,po(s),xi(n),be("manual Audit (read-only)"),n}function Pr(){if(C())return v("Resume Watchdog before repairing records."),0;let e=kr();return e.status!=="ready"?(v("Run Audit twice on a ready chat to confirm incomplete stored records."),0):(Ee(e.message,()=>{if(C()){v("Resume Watchdog before repairing records.");return}let t=Sr(e);t.status==="repaired"?(A(t.state),v(`Repaired ${t.count} confirmed message(s); Undo is available.`)):t.status==="stale"?v("Chat or audit changed. Run Audit again before repairing."):t.status==="changed"?v("Nothing repaired: DOM or stored values changed. Run Audit again."):A(y())}),0)}function Mr(){if(C())return v("Resume Watchdog before Undo repair."),!1;let e=Cr();return e.status!=="ready"?(e.status==="none"?v("No Audit repair to undo."):e.status==="changed"&&v("Undo refused: the saved message changed after the repair."),!1):(Ee(e.message,()=>{if(C()){v("Resume Watchdog before Undo repair.");return}let t=Tr(e);t.status==="undone"?(A(t.state),v("Last repair undone.")):t.status==="changed"||t.status==="stale"?v("Undo refused: saved records changed."):A(y())}),!1)}function Er(){let e=Ar();if(!e){v("Open a chat with a UUID before exporting message IDs.");return}let t=new Blob(["\uFEFF",e.tsv],{type:"text/tab-separated-values;charset=utf-8"}),i=null,n=null;try{i=URL.createObjectURL(t),n=document.createElement("a"),n.href=i,n.download=`watchdog-ids-${e.chatKey.slice(5)}.tsv`,n.style.display="none",document.body.appendChild(n),n.click(),v(`Exported ${e.storedCount} saved UUIDs; ${e.visibleCount} visible, ${e.visibleOnlyCount} visible-only.${e.routeUnverified?" DOM unverified.":""}`)}catch(o){Ui("Export IDs",o)}finally{n?.remove(),i&&setTimeout(()=>URL.revokeObjectURL(i),1e3)}}function Or(){if(C())return v("Resume Watchdog before Audit."),null;let e=$r();return e?A(y()):v("Audit requires an open chat with a UUID."),e}function Rr(e){e==="settings"?(a.closeSettings.addEventListener("click",Wt),pi(a.settingsDialog,Wt),gi(a.settingsDialog.querySelector(".cw-tools-nav"),"data-cw-tools",{view:{pane:a.settingsDialog.querySelector("#cw-tools-view"),mount:()=>{let t=a.settingsDialog.querySelector("#cw-tools-view");if(t.dataset.mounted!=="true"){t.innerHTML=mr,t.dataset.mounted="true";for(let i of t.querySelectorAll("[data-cw-view-style], [data-cw-view-theme], [data-cw-view-logo]"))i.addEventListener("click",()=>ua(i.hasAttribute("data-cw-view-style")?"style":i.hasAttribute("data-cw-view-logo")?"logo":"theme",i.dataset.cwViewStyle||i.dataset.cwViewTheme||i.dataset.cwViewLogo));yt(),Q(t)}}},technical:{pane:a.settingsDialog.querySelector("#cw-tools-technical"),mount:()=>{let t=a.settingsDialog.querySelector("#cw-tools-technical");t.dataset.mounted!=="true"&&(t.insertAdjacentHTML("beforeend",Tt.technicalForm),t.dataset.mounted="true",Me(),mi("technical"),lr(),Q(t))}},diagnostics:{pane:a.diagnosticsDetails,mount:()=>{Dr("diagnostics");let t=y();St(X(t),t),kt()}},performance:{pane:a.performanceDetails,mount:()=>{Dr("performance"),zt()}}},!0,t=>{Je[t]&&ce(t)},{mode:"tabs"}),a.settingsDialog.querySelector('[data-cw-tools="view"]').click(),a.resetPosition.addEventListener("click",()=>{if(L.badgePosition=null,!V()){Re(it());return}qi(a.root,!a.panel.hidden),a.panel.hidden||(Ze(),N()),v("Badge position reset.")}),a.resetChat.addEventListener("click",()=>{Ee("Reset local counts for this chat? The Watchdog will then collect already finished messages as they reappear in the DOM (including on scroll). Unseen messages cannot be recovered.",()=>{if(w)try{localStorage.removeItem($e()),oe.delete(w),Mt(w),Ut(w),le(null),D.clear(),H.clear(),R.delete(w),K.delete(w),de(!1)}catch(t){Z(w,"RESET FAILED: localStorage could not remove this entry.",t),A(y());return}else Fe(Pe(null));E.length=0,at(),Y.clear(),pt(new WeakMap),Te(new WeakMap),we(0),ai(),ne(),C()||li({backfill:!0,reason:"state reset / visible-message backfill"}),v("Chat reset. Finished messages are collected again when visible.")})}),a.clearWatchdogData.addEventListener("click",()=>{Ee(`Permanently delete ALL Context Watchdog local data on this site?
This includes every chat ledger, calibration history, settings and panel position.
ChatGPT conversations and unrelated site data will not be deleted.
Visible finished messages may be indexed again without reloading ChatGPT.`,()=>{let t=a.chip.getBoundingClientRect(),i={left:Math.round(t.left),top:Math.round(t.top)};try{let s=[];for(let r=0;r<localStorage.length;r++){let d=localStorage.key(r);d&&d.startsWith(`${c}:`)&&s.push(d)}for(let r of s)localStorage.removeItem(r);for(let r=0;r<localStorage.length;r++)if(localStorage.key(r)?.startsWith(`${c}:`))throw new Error("Watchdog storage still contains owned keys")}catch(s){Ui("Wipe",s,"Wipe incomplete");return}Pa();let n=new Set([...Le.keys(),w,...oe.keys(),...[..._.values()].map(s=>s.chatKey)]);for(let s of n)Mt(s);_.clear(),Ut(),Si(),oe.clear(),E.length=0,D.clear(),H.clear(),le(null),Fe(Pe(null)),Ie(null),et({stop:!1,send:!1,actions:null}),be("Watchdog data wiped"),we(0),Y.clear(),ue&&clearTimeout(ue),Ue(0),te&&cancelAnimationFrame(te),Ce(0),pt(new WeakMap),Te(new WeakMap),fo(new WeakSet),go(new WeakSet),at(),R.clear(),K.clear(),de(!1),ze(null),Be(null),ut(!1),Re(it()),L.badgePosition=i;let o=V();Ai(),un(),T.enabled=!1,ai(),ne(),It(!1),vt(),ni(!0,o),yt(),Ht(),Oe(!0),zt(),A(y()),v(o?"Watchdog data cleared.":"Watchdog data cleared; could not save the current badge position.")})})):e==="about"?(a.closeAbout.addEventListener("click",ui),pi(a.aboutDialog,ui),a.aboutGlossary.insertAdjacentHTML("beforeend",Tt.aboutHelp),a.aboutGlossary.dataset.mounted="true"):e==="confirm"?(a.closeConfirm.addEventListener("click",()=>Ye(!1)),a.cancelConfirm.addEventListener("click",()=>Ye(!1)),a.confirmOk.addEventListener("click",()=>Ye(!0)),pi(a.confirmDialog,()=>Ye(!1)),a.confirmDialog.addEventListener("close",()=>Ye(!1))):(a.closeLimit.addEventListener("click",rt),a.cancelLimit.addEventListener("click",rt),pi(a.limitDialog,rt),a.confirmLimit.addEventListener("click",ar))}function Dr(e){let t=e==="diagnostics"?a.diagnosticsDetails:a.performanceDetails;t.dataset.mounted!=="true"&&(t.insertAdjacentHTML("beforeend",Tt[e]),t.dataset.mounted="true",Me(),e==="diagnostics"?(a.copyDiagnostics.addEventListener("click",async()=>{let i=y(),n=Ko();St(X(i),i,{...Xe,...n,actions:n.stop||n.send?null:Xe.actions});try{await navigator.clipboard.writeText(a.diagnosticsLine.textContent||""),v("Diagnostics copied.")}catch{v("Clipboard unavailable. Select diagnostics text to copy.")}}),a.exportIds.addEventListener("click",Er),a.repairShort.addEventListener("click",Pr),a.undoRepair.addEventListener("click",Mr),a.rescan.addEventListener("click",()=>{let i=Or();if(!i)return;let n=y();if(St(X(n),n),i.routeUnverified){v("Audit completed read-only: chat DOM still switching; results are provisional.");return}let o=i.missing+i.storedShort+i.domShort+i.different+i.roleChanged+i.noStableId+i.duplicateIds+i.ambiguous+i.unhydrated;v(o?`Audit: ${o} possible issues, ${i.verified} verified. See Diagnostics.`:`Audit: ${i.verified} verified, no detected issues in rendered messages.`)})):(a.performanceToggle.addEventListener("click",()=>{T.enabled=!T.enabled,zt(),N(),v(T.enabled?"Profiling enabled.":"Profiling paused.")}),a.performanceCopy.addEventListener("click",async()=>{zt();try{await navigator.clipboard.writeText(a.performanceLine.textContent||""),v("Metrics copied.")}catch{v("Clipboard unavailable. Select Performance text to copy.")}}),a.performanceReset.addEventListener("click",()=>{un(),zt(),v("Counters reset.")})),Q(t))}function Fr(e){let t=e==="settings"?"settingsDialog":e==="about"?"aboutDialog":e==="limit"?"limitDialog":"confirmDialog";a[t]||(a.panelFrame.insertAdjacentHTML("beforeend",fr[e]),Me(),Xo(a[t]),Rr(e),Q(a[t]))}function Zi(){if(a&&document.documentElement.contains(a.root))return a;a&&(cr(),Jo(a.root),rr());let e=document.createElement("div");if(e.id=`${c}-root`,e.dataset.cwStyle=L.viewStyle,e.dataset.cwPalette=Dn(),e.innerHTML=gr,e.querySelector(".cw-title-info .cw-brand-mark").replaceChildren(Ri(e.ownerDocument)),!document.getElementById(`${c}-style`)){let t=document.createElement("style");t.id=`${c}-style`,t.textContent=hr,document.documentElement.appendChild(t)}return document.body.appendChild(e),Za(e),Mo({root:e,...Nn(e)}),Xa(Fr,Ht),er(()=>ce("budget",!0)),vr(e),Ca(e),Q(e),hi(pe,!1),a}var ge='[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key="user"], [data-message-id][data-message-author-role="user"], [data-message-id][data-message-role="user"]';function _s(e,t=null){let i=e.target.nodeType===Node.TEXT_NODE?e.target.parentElement:e.target;if(!(i instanceof Element))return;let n=t?.get(i);if(!n){let o=!!i.closest('[data-chatgpt-search-unit-key$=":assistant"], [data-chatgpt-search-unit-key="assistant"]');n={assistant:o,user:o?null:i.closest(ge)},t?.set(i,n)}if(!n.assistant&&(n.user&&(Ne.add(n.user),e.type!=="characterData"&&Se.add(n.user)),e.type==="childList")){for(let o of e.addedNodes)if(o instanceof Element){if(o.matches(ge))Ne.add(o),Se.add(o);else if(o.querySelector(ge))for(let s of o.querySelectorAll(ge))Ne.add(s),Se.add(s)}}}function js(e,t=null){let i=document.getElementById(`${c}-root`),n=e.target;if(n?.nodeType===Node.TEXT_NODE&&(n=n.parentElement),i&&n instanceof Element&&i.contains(n))return!1;if(e.type==="attributes"&&["aria-busy","aria-hidden","inert"].includes(e.attributeName)&&n instanceof Element&&(n.matches("main")||n.closest("main")||n.querySelector("main [data-chatgpt-search-unit-key], main [data-message-id]")))return x.phase!=="generating"&&ne(),t&&(t.value=!0),!0;if(n instanceof Element&&n.closest("form[data-chatgpt-composer], #composer-background, #prompt-textarea"))return t&&(t.value=!0),!0;if(x.phase==="generating"&&e.type==="characterData")return!1;if(n instanceof Element&&Ln(n))return x.phase!=="generating"&&ne(),t&&(t.value=!0),!0;for(let l of e.addedNodes||[])if(l instanceof Element&&!(i&&i.contains(l))){if(Ln(l))return x.phase!=="generating"&&ne(),t&&(t.value=!0),!0;if(l.matches?.("form[data-chatgpt-composer], #composer-background")||l.querySelector?.("form[data-chatgpt-composer], #composer-background"))return t&&(t.value=!0),!0}if(x.phase==="generating"){if(!E.some(l=>me(l,w)&&!l.boundMessageId))return!1;if(n instanceof Element&&(n.matches(ge)||n.closest(ge)))return!0;for(let l of e.addedNodes||[])if(l instanceof Element&&(l.matches(ge)||l.querySelector(ge)))return!0;return!1}let o=x.work.initial||x.work.completion&&x.phase!=="generating",r=n instanceof Element&&(!!n.closest?.("main [data-chatgpt-search-unit-key], main [data-turn-key], main [data-message-id], main [data-message-author-role]")||n.matches?.("main")),d=!1;for(let l of e.addedNodes||[])if(l instanceof Element&&(l.matches?.("main, [data-chatgpt-search-unit-key], [data-turn-key], [data-message-id]")||l.querySelector?.("[data-chatgpt-search-unit-key], [data-turn-key], [data-message-id]"))){d=!0;break}return r||d?(ne(),!0):!!(o&&n instanceof Element&&n.closest?.("main"))}function qs(){C()||(Et&&Et.disconnect(),Do(new MutationObserver(e=>{if(C())return;let t=W();try{let i=!1,n=!1,o=0,s={value:!1},r=e.length>1?new WeakSet:null,d=e.length>1?new WeakMap:null;for(let l of e)if(!(a?.root&&(l.target===a.root||a.root.contains(l.target)))){if(o++,r&&l.type==="characterData"){if(r.has(l.target)){T.enabled&&T.duplicateTextMutations++;continue}r.add(l.target)}if(_s(l,d),!document.hidden&&!n)s.value=!1,js(l,s)&&(i=!0),s.value&&(n=!0);else if(document.hidden&&l.type!=="characterData"&&E.some(u=>me(u,w)&&!u.boundMessageId)){let u=l.target;u?.nodeType===Node.TEXT_NODE&&(u=u.parentElement),u instanceof Element&&(u.matches(ge)||u.closest(ge))&&(i=!0);for(let p of l.addedNodes||[])p instanceof Element&&(p.matches(ge)||p.querySelector(ge))&&(i=!0)}}T.enabled&&o&&(T.mutationBatches++,T.mutations+=o),i&&se(n?"urgent":"background")}finally{U("observerCallback",t)}})),Et.observe(document.body||document.documentElement,{childList:!0,subtree:!0,characterData:!0,attributes:!0,attributeFilter:["data-testid","aria-label","aria-busy","aria-hidden","inert","hidden","disabled","class","style","data-state","aria-disabled","data-chatgpt-search-unit-key","data-chatgpt-search-message-ids","data-message-id","data-message-author-role","data-message-role","title","download","href","src","srcset","sizes","width","height","alt","media","type"]}))}var eo=null,Yi=!1,to="",Ji=null,Qn=0;function Ks(){Ji&&Ji.disconnect(),Ji=new MutationObserver(e=>{a&&!a.root.isConnected&&(Zi(),kt());let t=e.length>1?new WeakMap:null;e.some(i=>{let n=i.target;return a?.root&&(n===a.root||a.root.contains(n))?!1:Ao(i,eo,t)})&&wi()}),Ji.observe(document.body||document.documentElement,{childList:!0,subtree:!0,attributes:!0,attributeFilter:["hidden","aria-hidden","inert","class","style"]})}function wi(){eo=To(),cn(!!eo)&&bi()}function bi(){if(C())Yi&&(Et?.disconnect(),Yi=!1),te&&(cancelAnimationFrame(te),Ce(0)),ue&&(clearTimeout(ue),Ue(0));else if(!Yi){let e=G();if(e!==w){let t=w?new Set(Object.keys(y(w).messages||{})):new Set;Hi(e),e&&t.size&&Bi({beforeIds:t,beforeNodes:new WeakMap},t,!1)}Te(new WeakMap),qs(),Yi=!0,ai(),ne(),Ia(),se()}kt()}function Gs(){let e=()=>{let t=location.pathname!==to;to=location.pathname,t&&(C()||Ve(),cn(!1)&&bi(),Qn||(Qn=requestAnimationFrame(()=>{Qn=0,wi()})))};for(let t of["pushState","replaceState"]){let i=history[t];typeof i=="function"&&(history[t]=function(...n){let o=location.pathname,s=i.apply(this,n);return location.pathname!==o&&e(),s})}window.addEventListener("popstate",e),window.addEventListener("hashchange",e),window.navigation?.addEventListener?.("currententrychange",e)}function Ir(){if(an)return;bo(!0),yo(v),co(it(),G()),Zi(),ko(bi),ho(()=>{!C()&&!document.hidden&&(ne(),se("background"))}),to=location.pathname,Ks(),wi(),bi(),Ba(),document.addEventListener("click",za,!0),Gs(),C()||se(),da(),window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change",vt),window.addEventListener("pageshow",()=>{Te(new WeakMap),wi(),C()||se()}),document.addEventListener("visibilitychange",()=>{document.hidden||(Te(new WeakMap),wi(),C()||(ne(),se()))}),console.info("[Context Watchdog 1.0.0] first-seen backfill, role-qualified IDs, write-once; no polling/network APIs.")}var Nr=!1;function Br(){Nr||(Nr=!0,$o(Zi),window.addEventListener("storage",e=>{if(e.key===null){Si();for(let t of new Set([...Le.keys(),...R,...oe.keys(),...[..._.values()].map(i=>i.chatKey),w]))Mt(t);_.clear(),R.clear(),K.clear(),de(!1),oe.clear(),E.length=0,Ut(),le(null),D.clear(),H.clear()}else if(e.key.startsWith(_t))try{let t=decodeURIComponent(e.key.slice(_t.length));if(t&&$e(t)===e.key&&(e.newValue===null||R.has(t))){let i=!1,n=null;try{let o=localStorage.getItem(e.key);if(o==="")throw new Error("Empty ledger bytes");gt(t,o),i=!0}catch(o){n=o}(e.newValue===null||i)&&(oe.delete(t),Qe?.chatKey===t&&le(null),t===w&&(D.clear(),H.clear(),E.length=0),Mt(t),Ut(t)),i?(R.delete(t),K.delete(t),!R.size&&!K.size&&de(!1)):e.newValue===null&&(R.add(t),Z(t,"CORRUPT LEDGER: writes blocked. Back up the original storage entry.",n))}}catch{}if((e.key===null||w&&e.key===$e(w))&&(pt(new WeakMap),Te(new WeakMap),C()||(ne(),document.hidden||se())),(e.key===jt||e.key===null)&&(ze(null),Be(null),ut(!1),!document.hidden&&!C()&&A(y())),(e.key===he||e.key===null)&&(Re(it()),bi(),vt(),yt(),a)){for(let t of Object.keys(Je))ce(t);Oe(),!document.hidden&&!C()&&A(y())}}),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ir,{once:!0}):Ir())}Br();})();
