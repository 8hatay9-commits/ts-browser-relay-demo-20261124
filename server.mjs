import http from 'node:http';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const base = path.dirname(fileURLToPath(import.meta.url));
const portArg=process.argv.indexOf('--port');
const PORT = Number(portArg>=0?process.argv[portArg+1]:(process.env.PORT || 18091));
const HOST = process.env.HOST || '0.0.0.0';
const origin = new URL(process.env.IPTV_SERVER_URL || 'http://fx.mertnet.in');
if (!['http:', 'https:'].includes(origin.protocol)) throw Error('Unsupported provider protocol');
const html = readFileSync(path.join(base, 'index.html'));
const personalHome=readFileSync(path.join(base,'home.html'));
const cinemaCss=readFileSync(path.join(base,'cinema.css'));
const cinemaLight=readFileSync(path.join(base,'cinema-light.css'));
const cinemaV3=readFileSync(path.join(base,'cinema-v3.css'));
const cinemaV5=readFileSync(path.join(base,'cinema-v5.css'));
const stageJs=readFileSync(path.join(base,'stage.js'));
const cinemaV4=readFileSync(path.join(base,'cinema-v4.css'));
const cinemaJs=readFileSync(path.join(base,'cinema.js'));
const cinemaCatalog=readFileSync(path.join(base,'catalog.json'));
const playerJS = readFileSync(path.join(base, 'node_modules/mpegts.js/dist/mpegts.js'));
const TV_TUNNELS=[process.env.IPTV_TUNNEL_PRIMARY||'https://postings-kingdom-download-road.trycloudflare.com',process.env.IPTV_TUNNEL_SECONDARY||'https://suzuki-scanners-gym-dennis.trycloudflare.com',process.env.IPTV_TUNNEL_TERTIARY||'https://learned-phpbb-rental-contests.trycloudflare.com'].filter(x=>/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(x));
let healthCache={at:0,body:{bridge:'offline',configured:false,viewerUrl:null}};
async function guestHealth(){
 const now=Date.now();if(now-healthCache.at<7000)return healthCache.body;
 healthCache.at=now;
 const checks=await Promise.all(TV_TUNNELS.map(async host=>{
  try{const r=await fetch(host+'/gateway-health',{signal:AbortSignal.timeout(4400),cache:'no-store'});if(!r.ok)throw Error('OFFLINE');const j=await r.json();if(!j.gateway||!j.ownerConfigured||!j.shared)throw Error('NOT_CONFIGURED');return host}
  catch{return null}
 }));
 const active=checks.find(Boolean);
 healthCache.body={bridge:active?'online':'offline',configured:!!active,viewerUrl:active?active+'/tv-guest':null};
 return healthCache.body;
}

const sessions = new Map();
const logins = new Map();
const SESSION_MS = 12 * 60 * 60 * 1000;
const reqTimeoutMs = 15000;

function reply(res, status, data, type='application/json; charset=utf-8') {
  if (res.headersSent) return;
  const payload = type.startsWith('application/json') && !Buffer.isBuffer(data) && typeof data !== 'string' ? JSON.stringify(data) : data;
  res.writeHead(status,{
    'content-type':type,
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    'x-robots-tag':'noindex, nofollow'
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
const mediaPlaylists=new Map();
async function authorizedMediaURL(s,id){
  const cached=mediaPlaylists.get(s.sid);
  if(cached && cached.expires>Date.now()){
    return new URL(cached.prefix+id+cached.suffix);
  }
  const m3u=new URL('/get.php',origin);
  m3u.searchParams.set('username',s.u);
  m3u.searchParams.set('password',s.p);
  m3u.searchParams.set('type','m3u_plus');
  m3u.searchParams.set('output','ts');
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),12000);
  try{
    const r=await fetch(m3u,{method:'GET',redirect:'manual',signal:ctl.signal,headers:{'user-agent':'IBO-TV/1.0','accept':'*/*'}});
    if(!r.ok||!r.body)throw Error('playlist_not_available');
    const reader=r.body.getReader();
    const part=await reader.read();
    const data=Buffer.from(part.value||new Uint8Array()).toString('utf8');
    if(!data.trimStart().startsWith('#EXTM3U'))throw Error('playlist_invalid');
    let chosen=null;
    for(const line of data.split(/\r?\n/)){
      if(!/^https?:\/\//i.test(line.trim()))continue;
      try{
        const media=new URL(line.trim());
        if(!['http:','https:'].includes(media.protocol)||media.hostname.toLowerCase()!==origin.hostname.toLowerCase())continue;
        const decoded=decodeURIComponent(media.pathname);
        if(!decoded.includes('/'+s.u+'/'+s.p+'/'))continue;
        const match=media.pathname.match(/^(.*\/)(\d+)(\.(?:ts|m3u8))?$/i);
        if(!match)continue;
        chosen={prefix:media.origin+match[1],suffix:match[3]||''};
        break;
      }catch{}
    }
    void reader.cancel().catch(()=>{});
    if(!chosen)throw Error('playlist_media_template_missing');
    mediaPlaylists.set(s.sid,{...chosen,expires:Date.now()+900000});
    console.log('M3U_MEDIA_TEMPLATE_OK host='+origin.hostname);
    return new URL(chosen.prefix+id+chosen.suffix);
  }finally{clearTimeout(timer);ctl.abort();}
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
    if(req.method==='GET' && pathname==='/cinema-v5.css') return reply(res,200,cinemaV5,'text/css; charset=utf-8');
    if(req.method==='GET' && pathname==='/stage.js') return reply(res,200,stageJs,'text/javascript; charset=utf-8');
    if(req.method==='GET' && /^\/live-media\/(?:health|live\.m3u8|s\d{8}\.ts|hls\.min\.js)$/.test(pathname)) {
      const state=await guestHealth();
      if(!state.viewerUrl)return json(res,503,{error:'LIVE_UNAVAILABLE'});
      const suffix=pathname.slice('/live-media/'.length);
      const target=new URL('/shared/'+suffix,state.viewerUrl);
      const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),16000);
      res.on('close',()=>ctl.abort());
      try {
        const r=await fetch(target,{signal:ctl.signal,redirect:'error'});
        if(!r.ok||!r.body)return json(res,502,{error:'LIVE_SOURCE_UNAVAILABLE'});
        if(suffix==='live.m3u8') {
          const raw=await r.text();
          if(!raw.trimStart().startsWith('#EXTM3U'))return json(res,502,{error:'INVALID_MEDIA'});
          const safe=raw.split('\n').map(line=>{const v=line.trim();if(!v||v.startsWith('#'))return line;const name=v.split('?')[0].split('/').pop();if(!/^s\d{8}\.ts$/.test(name))throw Error('INVALID_SEGMENT');return '/live-media/'+name;}).join('\n');
          return reply(res,200,safe,'application/vnd.apple.mpegurl');
        }
        res.writeHead(200,{'content-type':suffix.endsWith('.js')?'text/javascript; charset=utf-8':suffix.endsWith('.ts')?'video/mp2t':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
        await pipeline(Readable.fromWeb(r.body),res);
      }finally{clearTimeout(timer);ctl.abort()}
      return;
    }
    if(req.method==='GET' && pathname==='/api/health') return json(res,200,{ok:true,mode:'one-user-low-cpu-relay'});
    if(req.method==='GET' && pathname==='/api/tv-status') return json(res,200,await guestHealth());
    if(req.method==='GET' && pathname==='/') return reply(res,200,personalHome,'text/html; charset=utf-8');
    if(req.method==='GET' && pathname==='/cinema.css') return reply(res,200,cinemaCss,'text/css; charset=utf-8');
    if(req.method==='GET' && pathname==='/cinema-light.css') return reply(res,200,cinemaLight,'text/css; charset=utf-8');
    if(req.method==='GET' && pathname==='/cinema-v3.css') return reply(res,200,cinemaV3,'text/css; charset=utf-8');
    if(req.method==='GET' && pathname==='/cinema-v4.css') return reply(res,200,cinemaV4,'text/css; charset=utf-8');
    if(req.method==='GET' && pathname==='/cinema.js') return reply(res,200,cinemaJs,'text/javascript; charset=utf-8');
    if(req.method==='GET' && pathname==='/catalog.json') return reply(res,200,cinemaCatalog,'application/json; charset=utf-8');
    if(req.method==='GET' && pathname==='/iptv-login') {res.writeHead(302,{'location':'/','cache-control':'no-store'});return res.end();}
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
    if(req.method==='GET' && pathname==='/api/playlist-probe') {
      const u=new URL('/get.php',origin);
      u.searchParams.set('username',s.u);
      u.searchParams.set('password',s.p);
      u.searchParams.set('type','m3u_plus');
      u.searchParams.set('output','ts');
      const ctl=new AbortController();
      const timer=setTimeout(()=>ctl.abort(),10000);
      try {
        const upstreamResponse=await fetch(u,{signal:ctl.signal,redirect:'manual',headers:{'user-agent':'IBO-TV/1.0','accept':'*/*'}});
        const detail={http:upstreamResponse.status,mime:(upstreamResponse.headers.get('content-type')||'').split(';')[0]};
        if(upstreamResponse.status>=300 && upstreamResponse.status<400) {
          const loc=upstreamResponse.headers.get('location');
          if(loc) {try{detail.redirectHost=new URL(loc,u).hostname}catch{}}
        }
        else if(upstreamResponse.ok && upstreamResponse.body) {
          const reader=upstreamResponse.body.getReader();
          try {
            const part=await reader.read();
            const data=Buffer.from(part.value||new Uint8Array()).toString('utf8');
            detail.isM3U=data.trimStart().startsWith('#EXTM3U');
            const hostnames=new Set(),formats=new Set();
            let firstMediaFormat=null;
            for(const line of data.split(/\r?\n/)) {
              if(!/^https?:\/\//i.test(line.trim())) continue;
              try {
                const media=new URL(line.trim());
                hostnames.add(media.hostname);
                const decoded=decodeURIComponent(media.pathname);
                const format={
                  protocol:media.protocol.replace(':',''),
                  port:media.port||(media.protocol==='https:'?'443':'80'),
                  extension:media.pathname.match(/\.(ts|m3u8|mp4)$/i)?.[1]||'none',
                  pathKind:decoded.includes('/live/'+s.u+'/'+s.p+'/')?'xtream_live'
                    :decoded.includes('/'+s.u+'/'+s.p+'/')?'xtream_other'
                    :media.searchParams.has('username')?'query_auth':'other',
                  queryParameters:media.searchParams.size>0
                };
                formats.add(JSON.stringify(format));
                if(firstMediaFormat===null)firstMediaFormat=format;
              }catch{}
              if(hostnames.size>=5&&formats.size>=3)break;
            }
            detail.streamHosts=[...hostnames];
            detail.firstMediaFormat=firstMediaFormat;
            detail.uniqueMediaFormats=[...formats].slice(0,3).map(v=>JSON.parse(v));
          } finally {await reader.cancel().catch(()=>{});}
        }
        else { await upstreamResponse.body?.cancel().catch(()=>{}); }
        return json(res,200,detail);
      }catch(e){return json(res,200,{error:e?.name==='AbortError'?'timeout':e.name||'error'});}
      finally{clearTimeout(timer);ctl.abort();}
    }
    if(req.method==='GET' && pathname==='/api/official-format-probe') {
      const format=new URL(req.url,'http://localhost').searchParams.get('format');
      if(!['ts','m3u8'].includes(format))return json(res,400,{error:'invalid_format'});
      const u=new URL('/get.php',origin);
      u.searchParams.set('username',s.u);u.searchParams.set('password',s.p);
      u.searchParams.set('type','m3u_plus');u.searchParams.set('output',format);
      const ctl=new AbortController();
      const timer=setTimeout(()=>ctl.abort(),12000);
      let report={format,playlistStatus:null,streamStatus:null};
      try{
        const list=await fetch(u,{signal:ctl.signal,redirect:'manual',headers:{'user-agent':'IBO-TV/1.0','accept':'*/*'}});
        report.playlistStatus=list.status;
        if(!list.ok||!list.body)return json(res,200,report);
        const reader=list.body.getReader();
        const b=await reader.read();
        const text=Buffer.from(b.value||new Uint8Array()).toString('utf8');
        void reader.cancel().catch(()=>{});
        const line=text.split(/\r?\n/).find(x=>/^https?:\/\//i.test(x.trim()));
        if(!line){report.error='no_media_in_first_chunk';return json(res,200,report)}
        const media=new URL(line.trim());
        if(media.hostname.toLowerCase()!==origin.hostname.toLowerCase()){report.error='different_host';return json(res,200,report)}
        report.sourceProtocol=media.protocol.replace(':','');
        report.sourcePort=media.port||(media.protocol==='https:'?'443':'80');
        report.sourceSuffix=media.pathname.match(/\.(m3u8|ts)$/i)?.[1]||'none';
        const st=await fetch(media,{method:'GET',redirect:'manual',signal:ctl.signal,headers:{'user-agent':'IBO-TV/1.0','accept':'*/*'}});
        report.streamStatus=st.status;report.mime=(st.headers.get('content-type')||'').split(';')[0];
        if(st.ok && st.body){
          const rd=st.body.getReader();const part=await rd.read();
          const bytes=part.value||new Uint8Array();
          const value=Buffer.from(bytes.subarray(0,40)).toString('utf8').trimStart();
          report.signature=bytes[0]===71?'MPEG_TS':value.startsWith('#EXTM3U')?'HLS':value.startsWith('<')?'HTML':'unknown';
          report.firstBytes=bytes.length;
          void rd.cancel().catch(()=>{});
        }
        else {void st.body?.cancel().catch(()=>{});}
        console.log('OFFICIAL_FORMAT_PROBE format='+format+' playlist='+list.status+' media='+st.status);
        return json(res,200,report);
      }catch(e){report.error=e.name||'error';return json(res,200,report)}
      finally{clearTimeout(timer);ctl.abort();}
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
          if(!up.response.ok) {
            const txt=(await up.response.text().catch(()=>'')).slice(0,240);
            sample.errorClass=/IP\s*BANNED/i.test(txt)?'IP_BANNED'
              :/ACCOUNT|EXPIRED|SUBSCRIB/i.test(txt)?'ACCOUNT_REJECTED'
              :/CONNECTION|LIMIT/i.test(txt)?'CONNECTION_LIMIT'
              :/ACCESS DENIED|FORBIDDEN/i.test(txt)?'ACCESS_DENIED'
              :/CLOUDFLARE|ERROR\s*(CODE|1015|1003)/i.test(txt)?'CLOUDFLARE_BLOCK'
              :/<!doctype|<html|<body/i.test(txt)?'HTML_ERROR'
              :txt.trim()===''?'EMPTY_ERROR':'OTHER_ERROR';
          }
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
      const source=await authorizedMediaURL(s,id);
      if(!source)return json(res,404,{error:'channel_not_in_authorized_playlist'});
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
