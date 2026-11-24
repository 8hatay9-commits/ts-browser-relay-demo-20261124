import http from 'node:http';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const base = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 18091);
const HOST = process.env.HOST || '0.0.0.0';
const origin = new URL(process.env.IPTV_SERVER_URL || 'http://fx.mertnet.in');
if (!['http:', 'https:'].includes(origin.protocol)) throw Error('Unsupported provider protocol');
const html = readFileSync(path.join(base, 'index.html'));
const playerJS = readFileSync(path.join(base, 'node_modules/mpegts.js/dist/mpegts.js'));
const sessions = new Map();
const logins = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const reqTimeoutMs = 15000;

function reply(res, status, data, type='application/json; charset=utf-8') {
  if (res.headersSent) return;
  const payload = type.startsWith('application/json') ? JSON.stringify(data) : data;
  res.writeHead(status,{
    'content-type':type,
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'
  });
  res.end(payload);
}
function json(res, code, data) { reply(res,code,data); }
function cookie(req, name) {
  const found = String(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  return found ? found.slice(name.length+1) : '';
}
function session(req) {
  const sid = cookie(req,'ibo_sid');
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(sid); return null; }
  return {sid,...s};
}
async function getBody(req) {
  const buffers = [];
  let total=0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total>4096) throw Error('request_too_large');
    buffers.push(chunk);
  }
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}
function providerAPI(u,p,action='', category='') {
  const url = new URL('/player_api.php', origin);
  url.searchParams.set('username',u);
  url.searchParams.set('password',p);
  if (action) url.searchParams.set('action',action);
  if (category) url.searchParams.set('category_id',category);
  return url;
}
async function upstream(url,ms=reqTimeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(),ms);
  const allowed = new Set([origin.hostname.toLowerCase(),
    ...String(process.env.IPTV_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)]);
  try {
    let current = new URL(url);
    for(let hop=0;hop<4;hop++){
      const response = await fetch(current,{
        method:'GET',redirect:'manual',signal:ctl.signal,
        headers:{'user-agent':'IBO-TV/1.0','accept':'*/*'}
      });
      if(![301,302,303,307,308].includes(response.status)){
        clearTimeout(timer);
        return {response,stop:()=>ctl.abort()};
      }
      const loc=response.headers.get('location');
      await response.body?.cancel();
      if(!loc || hop===3)throw Error('provider_redirect_unavailable');
      const next=new URL(loc,current);
      if(!['http:','https:'].includes(next.protocol) || !allowed.has(next.hostname.toLowerCase()))
        throw Error('provider_redirect_not_allowed');
      current=next;
    }
  } catch(e) { clearTimeout(timer);ctl.abort();throw e; }
}
function setSessionCookie(req,res,sid) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto']==='https';
  res.setHeader('set-cookie','ibo_sid='+sid+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200'+(secure?'; Secure':''));
}
function isValidOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {return new URL(o).host===req.headers.host;}catch{return false;}
}
function janitor() {
  const now=Date.now();
  for(const [k,v] of sessions) if(v.expires<now) sessions.delete(k);
  for(const [k,v] of logins) if(v.expires<now) logins.delete(k);
}
const app=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  try {
    if(req.method==='GET' && pathname==='/api/health') return json(res,200,{ok:true,mode:'one-user-low-cpu-relay'});
    if(req.method==='GET' && pathname==='/') return reply(res,200,html,'text/html; charset=utf-8');
    if(req.method==='GET' && pathname==='/assets/mpegts.min.js')
      return reply(res,200,playerJS,'text/javascript; charset=utf-8');
    if(req.method==='POST' && !isValidOrigin(req)) return json(res,403,{error:'invalid_origin'});
    if(req.method==='POST' && pathname==='/api/login') {
      janitor();
      const ip=req.socket.remoteAddress||'unknown', hit=logins.get(ip)||{n:0,expires:Date.now()+600000};
      if(hit.n>=5&&hit.expires>Date.now()) return json(res,429,{error:'too_many_attempts'});
      hit.n++;logins.set(ip,hit);
      let body;
      try{body=await getBody(req)}catch{return json(res,400,{error:'invalid_body'});}
      const u=String(body.username||'').trim(),p=String(body.password||'');
      if(!u||!p||u.length>100||p.length>200) return json(res,400,{error:'invalid_login'});
      const {response,stop}=await upstream(providerAPI(u,p),15000);
      let info;try{ info=await response.json(); }catch{ stop();return json(res,502,{error:'provider_invalid_response'}); }
      stop();
      if(!response.ok||String(info?.user_info?.auth)!=='1') return json(res,401,{error:'account_not_authorized'});
      const sid=crypto.randomBytes(32).toString('hex');
      sessions.set(sid,{u,p,expires:Date.now()+SESSION_MS});
      setSessionCookie(req,res,sid);
      return json(res,200,{ok:true});
    }
    if(req.method==='POST' && pathname==='/api/logout') {
      sessions.delete(cookie(req,'ibo_sid'));
      res.setHeader('set-cookie','ibo_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return json(res,200,{ok:true});
    }
    const s=session(req);
    if(!s) return json(res,401,{error:'login_required'});
    if(req.method==='GET' && pathname==='/api/session') return json(res,200,{ok:true});
    if(req.method==='GET' && pathname==='/api/channels') {
      const {response,stop}=await upstream(providerAPI(s.u,s.p,'get_live_streams'),15000);
      if(!response.ok){stop();return json(res,502,{error:'provider_channels_rejected',status:response.status});}
      let rows;try{rows=await response.json();}catch{stop();return json(res,502,{error:'invalid_channel_list'});}
      stop();
      if(!Array.isArray(rows)) return json(res,502,{error:'invalid_channels'});
      return json(res,200,rows.filter(x=>Number.isSafeInteger(Number(x.stream_id))&&Number(x.stream_id)>0)
        .map(x=>({id:Number(x.stream_id),name:String(x.name||'Kanal').slice(0,150)})));
    }
    const probe=pathname.match(/^\/api\/probe\/([0-9]{1,16})$/);
    if(req.method==='GET' && probe) {
      const id=Number(probe[1]);
      if(!Number.isSafeInteger(id)||id<1)return json(res,400,{error:'invalid_id'});
      const report=[];
      for(const ext of ['ts','m3u8']){
        const start=Date.now();
        let stop=()=>{};
        try {
          const source=new URL('/live/'+encodeURIComponent(s.u)+'/'+encodeURIComponent(s.p)+'/'+id+'.'+ext,origin);
          const up=await upstream(source,9000);stop=up.stop;
          const mime=(up.response.headers.get('content-type')||'').split(';')[0];
          const sample={format:ext,status:up.response.status,mime,ms:Date.now()-start,firstBytes:0,signature:'none'};
          if(up.response.ok&&up.response.body){
            const reader=up.response.body.getReader();
            const t=setTimeout(()=>stop(),6500);
            try {
              const first=await reader.read();
              const bytes=first.value||new Uint8Array();
              sample.firstBytes=bytes.length;
              const text=Buffer.from(bytes.subarray(0,100)).toString('utf8').trimStart();
              sample.signature=bytes[0]===71?'MPEG_TS':text.startsWith('#EXTM3U')?'HLS':text.startsWith('<')?'HTML':text.startsWith('{')?'JSON':'unknown';
              await reader.cancel().catch(()=>{});
            }finally{clearTimeout(t);}
          }
          report.push(sample);
        }catch(e){report.push({format:ext,error:e?.name||'error',ms:Date.now()-start});}
        finally{stop();}
      }
      return json(res,200,{probe:report});
    }
    const match=pathname.match(/^\/api\/stream\/([0-9]{1,16})\.ts$/);
    if(req.method==='GET' && match) {
      const id=Number(match[1]);
      console.log('PLAY_REQUEST id='+id);
      if(!Number.isSafeInteger(id)||id<1) return json(res,400,{error:'invalid_id'});
      const source=new URL('/live/'+encodeURIComponent(s.u)+'/'+encodeURIComponent(s.p)+'/'+id+'.ts',origin);
      const {response,stop}=await upstream(source,20000);
      console.log('PLAY_UPSTREAM id='+id+' http='+response.status+' mime='+(response.headers.get('content-type')||'unknown').split(';')[0]);
      if(!response.ok||!response.body){
        const status=response.status;stop();return json(res,502,{error:'provider_stream_unavailable',status});
      }
      const type=response.headers.get('content-type')||'';
      if(/text\/(html|plain)|application\/json/i.test(type)){
        stop();return json(res,502,{error:'provider_did_not_return_video'});
      }
      res.writeHead(200,{'content-type':'video/mp2t','cache-control':'no-store','x-content-type-options':'nosniff'});
      res.on('close',stop);
      try { await pipeline(Readable.fromWeb(response.body),res); } catch {}
      finally {stop();}
      return;
    }
    return json(res,404,{error:'not_found'});
  } catch(e) {
    if(!res.headersSent) json(res,502,{error:e?.name==='AbortError'?'provider_timeout':'upstream_unreachable'});
    else res.destroy();
  }
});
app.listen(PORT,HOST,()=>console.log('EDGE_STAGING_READY '+PORT));
