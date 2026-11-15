/*PSD-START*/
// ---------- 최소 PSD 파서 (8비트 RGB, PSD/PSB, Raw·RLE·ZIP) ----------
async function parsePSD(buf){
  const dv = new DataView(buf); let p = 0;
  const u8=()=>dv.getUint8(p++);
  const u16=()=>{const v=dv.getUint16(p);p+=2;return v};
  const i16=()=>{const v=dv.getInt16(p);p+=2;return v};
  const u32=()=>{const v=dv.getUint32(p);p+=4;return v};
  const i32=()=>{const v=dv.getInt32(p);p+=4;return v};
  const u64=()=>{const hi=u32(),lo=u32();return hi*4294967296+lo};
  const str=n=>{let s='';for(let i=0;i<n;i++)s+=String.fromCharCode(u8());return s};

  if(str(4)!=='8BPS') throw new Error('PSD 파일이 아니에요.');
  const version=u16(); const psb=version===2; p+=6;
  u16(); const height=u32(), width=u32(), depth=u16(), mode=u16();
  if(depth!==8) throw new Error(`${depth}비트 파일이에요. 8비트로 바꿔서 저장해 주세요.`);
  if(mode!==3) throw new Error('RGB 모드 파일만 열 수 있어요. (CMYK·그레이스케일 X)');
  const lenL=()=>psb?u64():u32();
  {const n=u32(); p+=n;} // color mode data
  {const n=u32(); p+=n;} // image resources
  const lmLen=lenL();
  if(lmLen===0) return {width,height,root:{type:'group',name:'root',children:[]}};
  const liLen=lenL(); const liStart=p;
  if(liLen===0) return {width,height,root:{type:'group',name:'root',children:[]}};
  const count=Math.abs(i16());
  const BIGKEYS=['LMsk','Lr16','Lr32','Layr','Mt16','Mt32','Mtrn','Alph','FMsk','lnk2','FEid','FXid','PxSD'];
  const recs=[];
  for(let i=0;i<count;i++){
    const r={top:i32(),left:i32(),bottom:i32(),right:i32()};
    const nch=u16(); r.channels=[];
    for(let c=0;c<nch;c++) r.channels.push({id:i16(),len:lenL()});
    str(4); r.blend=str(4); r.opacity=u8()/255; r.clipping=u8()===1; r.flags=u8(); p++;
    r.hidden=!!(r.flags&2); r.fill=1;
    const exLen=u32(); const exEnd=p+exLen;
    const mLen=u32(); const mEnd=p+mLen;
    if(mLen>=20){
      r.mask={top:i32(),left:i32(),bottom:i32(),right:i32(),def:u8(),flags:u8()};
      r.mask.disabled=!!(r.mask.flags&2);
    }
    p=mEnd;
    {const n=u32(); p+=n;} // blending ranges
    const nStart=p; const nl=u8();
    const nb=new Uint8Array(buf,p,nl); p+=nl;
    try{ r.name=new TextDecoder('utf-8',{fatal:true}).decode(nb); }catch(e){ r.name=String.fromCharCode(...nb); }
    p=nStart+Math.ceil((1+nl)/4)*4;
    while(p+12<=exEnd){
      const sig=str(4); if(sig!=='8BIM'&&sig!=='8B64') break;
      const key=str(4);
      const len=(psb&&BIGKEYS.includes(key))?u64():u32(); const s=p;
      if(key==='luni'){ const n=u32(); let t=''; for(let k=0;k<n;k++) t+=String.fromCharCode(u16()); r.name=t.replace(/\0+$/,''); }
      else if(key==='lsct'||key==='lsdk'){ r.section=u32(); }
      else if(key==='iOpa'){ r.fill=u8()/255; }
      p=s+len;
    }
    p=exEnd; recs.push(r);
  }

  async function inflate(bytes){
    const ds=new DecompressionStream('deflate');
    const out=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }
  async function readChannel(end,w,h){
    const comp=u16(); const n=w*h; const out=new Uint8Array(n);
    if(comp===0){ out.set(new Uint8Array(buf,p,Math.min(n,end-p))); }
    else if(comp===1){
      let total=0; for(let y=0;y<h;y++) total+=psb?u32():u16();
      const src=new Uint8Array(buf,p,Math.min(total,end-p)); let si=0, oi=0;
      while(si<src.length && oi<n){
        let c=src[si++]; if(c>127) c-=256;
        if(c>=0){ for(let k=0;k<=c && oi<n;k++) out[oi++]=src[si++]; }
        else if(c!==-128){ const v=src[si++]; for(let k=0;k<1-c && oi<n;k++) out[oi++]=v; }
      }
    } else if(comp===2||comp===3){
      const raw=await inflate(new Uint8Array(buf,p,end-p));
      out.set(raw.subarray(0,n));
      if(comp===3) for(let y=0;y<h;y++){ const o=y*w; for(let x=1;x<w;x++) out[o+x]=(out[o+x]+out[o+x-1])&255; }
    }
    return out;
  }

  for(const r of recs){
    const w=r.right-r.left, h=r.bottom-r.top;
    let rgba=null, maskData=null;
    if(w>0&&h>0){ rgba=new Uint8ClampedArray(w*h*4); for(let k=3;k<rgba.length;k+=4) rgba[k]=255; }
    for(const ch of r.channels){
      const end=p+ch.len;
      if(ch.len>=2){
        if(rgba && ch.id>=-1 && ch.id<=2){
          const d=await readChannel(end,w,h); const off=ch.id===-1?3:ch.id;
          for(let k=0;k<d.length;k++) rgba[k*4+off]=d[k];
        } else if(ch.id===-2 && r.mask){
          const mw=r.mask.right-r.mask.left, mh=r.mask.bottom-r.mask.top;
          if(mw>0&&mh>0) maskData={w:mw,h:mh,d:await readChannel(end,mw,mh)};
        }
      }
      p=end;
    }
    if(rgba && r.mask && !r.mask.disabled){
      const m=r.mask;
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){
        const mx=r.left+x-m.left, my=r.top+y-m.top;
        const mv=(maskData && mx>=0&&my>=0&&mx<maskData.w&&my<maskData.h)?maskData.d[my*maskData.w+mx]:m.def;
        const k=(y*w+x)*4+3; rgba[k]=rgba[k]*mv/255;
      }
    }
    r.pixels=rgba; r.w=w; r.h=h;
  }

  // 레이어 레코드(아래→위)를 트리로
  const root={type:'group',name:'root',children:[]}; const stack=[root];
  for(const r of recs){
    if(r.section===3){ const g={type:'group',name:'',children:[]}; stack[stack.length-1].children.push(g); stack.push(g); }
    else if(r.section===1||r.section===2){
      const g=stack.length>1?stack.pop():{type:'group',children:[]};
      Object.assign(g,{name:r.name,blend:r.blend,opacity:r.opacity*r.fill,hidden:r.hidden,clipping:r.clipping});
    } else {
      stack[stack.length-1].children.push({type:'layer',name:r.name,left:r.left,top:r.top,w:r.w,h:r.h,pixels:r.pixels,
        blend:r.blend,opacity:r.opacity*r.fill,hidden:r.hidden,clipping:r.clipping});
    }
  }
  return {width,height,root};
}
/*PSD-END*/

// ---------- 합성 ----------
// PSD 혼합 모드 키는 4글자(공백 포함). 캔버스가 직접 지원하는 모드
const BLEND={'norm':'source-over','pass':'source-over','mul ':'multiply','scrn':'screen','over':'overlay','dark':'darken','lite':'lighten',
  'hLit':'hard-light','sLit':'soft-light','diff':'difference','smud':'exclusion','div ':'color-dodge','idiv':'color-burn',
  'hue ':'hue','sat ':'saturation','colr':'color','lum ':'luminosity','diss':'source-over'};
// 캔버스가 지원하지 않는 모드는 픽셀 단위로 직접 계산 (값 범위 0~1)
const cl01=v=>v<0?0:v>1?1:v;
const MANUAL={
  'fdiv':(b,s)=>s<=0?(b>0?1:0):cl01(b/s),                         // 나누기
  'fsub':(b,s)=>cl01(b-s),                                          // 빼기
  'lbrn':(b,s)=>cl01(b+s-1),                                        // 선형 번(감산)
  'lddg':(b,s)=>cl01(b+s),                                          // 선형 닷지(더하기)
  'vLit':(b,s)=>s<=.5?(s<=0?0:1-cl01((1-b)/(2*s))):(s>=1?1:cl01(b/(2*(1-s)))), // 선명한 라이트 (클립스튜디오 기준: 순흑=0, 순백=1)
  'lLit':(b,s)=>cl01(b+2*s-1),                                      // 선형 라이트
  'pLit':(b,s)=>s<=.5?Math.min(b,2*s):Math.max(b,2*s-1),             // 핀 라이트
  'hMix':(b,s)=>b+s>1?1:0,                                          // 하드 혼합 (클립스튜디오 기준: 합이 1을 넘을 때만)
};
const PIXEL_PICK={'dkCl':-1,'lgCl':1};
// 클립스튜디오 '발광' 계열: 반투명 부분도 알파로 섞지 않고, (색×알파)를 그대로 효과에 씀
const GLOW={
  'gdg ':(b,s,a)=>{ const v=s*a; return v>=1?(b>0?1:0):cl01(b/(1-v)); },   // 발광 닷지
  'gadd':(b,s,a)=>cl01(b+s*a),                                               // 더하기(발광)
};                                // 어두운 색상 / 밝은 색상 (픽셀 전체 선택)
function drawManual(ctx,src,x,y,blend,op){
  const W=ctx.canvas.width,H=ctx.canvas.height;
  const x0=Math.max(0,Math.round(x)),y0=Math.max(0,Math.round(y)),x1=Math.min(W,Math.round(x)+src.width),y1=Math.min(H,Math.round(y)+src.height);
  if(x1<=x0||y1<=y0) return;
  const w=x1-x0,h=y1-y0;
  const bd=ctx.getImageData(x0,y0,w,h), b=bd.data;
  const s=src.getContext('2d').getImageData(x0-Math.round(x),y0-Math.round(y),w,h).data;
  const f=MANUAL[blend], pick=PIXEL_PICK[blend], gl=GLOW[blend];
  for(let i=0;i<b.length;i+=4){
    const as=s[i+3]/255*op; if(as<=0) continue;
    const ab=b[i+3]/255, ao=as+ab*(1-as);
    if(gl){ for(let k=0;k<3;k++){ const cb=b[i+k]/255, cs=s[i+k]/255; const g=gl(cb,cs,as); b[i+k]=Math.round(((1-ab)*cs*as+ab*g)/ (ab+(1-ab)*as) *255); } b[i+3]=Math.round(ao*255); continue; }
    let cs=[s[i]/255,s[i+1]/255,s[i+2]/255], cb=[b[i]/255,b[i+1]/255,b[i+2]/255], mix;
    if(f) mix=cs.map((v,k)=>f(cb[k],v));
    else { const L=c=>.3*c[0]+.59*c[1]+.11*c[2]; mix=(pick<0?L(cs)<L(cb):L(cs)>L(cb))?cs:cb; }
    for(let k=0;k<3;k++){
      const m=(1-ab)*cs[k]+ab*mix[k];
      b[i+k]=Math.round((as*m+ab*cb[k]*(1-as))/ao*255);
    }
    b[i+3]=Math.round(ao*255);
  }
  ctx.putImageData(bd,x0,y0);
}
const mkCanvas=(w,h)=>{const c=document.createElement('canvas');c.width=Math.max(1,w);c.height=Math.max(1,h);return c};
const visible=n=>n && (!n.hidden || n._force);

// 색조 보정 레이어: 아래에 쌓인 그림(ctx)을 읽어 변환한 뒤 그 혼합 모드로 얹는다
function applyAdjust(ctx,n,ox,oy,blend,op){
  const W=ctx.canvas.width,H=ctx.canvas.height; if(!W||!H) return;
  const bd=ctx.getImageData(0,0,W,H).data, out=new ImageData(W,H), o=out.data, lut=n.adjust.lut, m=n.mask;
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const i=(y*W+x)*4, a=bd[i+3]; if(!a) continue;
    let mv=255; if(m){ const mx=x-ox-m.left, my=y-oy-m.top; mv=(mx>=0&&my>=0&&mx<m.w&&my<m.h)?m.rgba[my*m.w+mx]:0; if(!mv) continue; }
    const l=Math.round(.299*bd[i]+.587*bd[i+1]+.114*bd[i+2])*4;
    o[i]=lut[l]; o[i+1]=lut[l+1]; o[i+2]=lut[l+2]; o[i+3]=a*mv/255*lut[l+3]/255;
  }
  const c=mkCanvas(W,H); c.getContext('2d').putImageData(out,0,0);
  draw(ctx,c,0,0,blend,op);
}
function adjustSwatch(n){
  const c=mkCanvas(256,256), x=c.getContext('2d'), g=x.createLinearGradient(0,0,256,0);
  n.adjust.stops.forEach(s=>g.addColorStop(s.pos,`rgba(${s.c[0]},${s.c[1]},${s.c[2]},${s.a})`));
  x.fillStyle=g; x.fillRect(0,64,256,128); return c;
}
function nodeImage(n){
  if(n._img!==undefined) return n._img;
  if(n.adjust){ n._img={canvas:adjustSwatch(n),left:0,top:0,swatch:true}; return n._img; }
  if(n.type==='layer'){
    if(!n.pixels){ n._img=null; return null; }
    const c=mkCanvas(n.w,n.h); c.getContext('2d').putImageData(new ImageData(n.pixels,n.w,n.h),0,0);
    n.pixels=null; n._img={canvas:c,left:n.left,top:n.top}; return n._img;
  }
  // 그룹: 보이는 자식들의 영역만큼 캔버스를 만들어 합성
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const ch of n.children){ if(!visible(ch)||ch.adjust) continue; const im=nodeImage(ch); if(!im) continue;
    x0=Math.min(x0,im.left); y0=Math.min(y0,im.top); x1=Math.max(x1,im.left+im.canvas.width); y1=Math.max(y1,im.top+im.canvas.height); }
  if(x0===Infinity){ n._img=null; return null; }
  const c=mkCanvas(x1-x0,y1-y0); compositeList(n.children,c.getContext('2d'),-x0,-y0);
  n._img={canvas:c,left:x0,top:y0}; return n._img;
}
function draw(ctx,canvas,x,y,blend,op){
  if(MANUAL[blend]||PIXEL_PICK[blend]||GLOW[blend]){
    try{ drawManual(ctx,canvas,x,y,blend,op??1); return; }catch(e){ /* 읽기 실패 시 일반 합성 */ }
  }
  ctx.save(); ctx.globalAlpha=op??1; ctx.globalCompositeOperation=BLEND[blend]||'source-over';
  ctx.drawImage(canvas,x,y); ctx.restore();
}
// nodes: 아래→위 순서. 클리핑 레이어는 바로 아래 기준 레이어에 붙여서 합성
function compositeList(nodes,ctx,ox,oy){
  let i=0;
  while(i<nodes.length){
    const base=nodes[i++]; const clips=[];
    if(base&&base.adjust){ if(visible(base)) applyAdjust(ctx,base,ox,oy,base.blend,base.opacity); continue; }
    while(i<nodes.length && nodes[i] && nodes[i].clipping){ clips.push(nodes[i]); i++; }
    if(!visible(base)) continue;
    const bi=nodeImage(base); if(!bi) continue;
    const vc=clips.filter(visible);
    if(!vc.length){ draw(ctx,bi.canvas,bi.left+ox,bi.top+oy,base.blend,base.opacity); continue; }
    const t=mkCanvas(bi.canvas.width,bi.canvas.height), tc=t.getContext('2d'); tc.drawImage(bi.canvas,0,0);
    for(const cl of vc){
      const ci=nodeImage(cl); if(!ci) continue;
      const c2=mkCanvas(t.width,t.height), c2c=c2.getContext('2d');
      c2c.drawImage(ci.canvas,ci.left-bi.left,ci.top-bi.top);
      c2c.globalCompositeOperation='destination-in'; c2c.drawImage(bi.canvas,0,0);
      draw(tc,c2,0,0,cl.blend,cl.opacity);
    }
    draw(ctx,t,bi.left+ox,bi.top+oy,base.blend,base.opacity);
  }
}

/*CLIP-START*/
// ---------- CLIP STUDIO .clip 읽기 (외부 라이브러리 없음) ----------
// .clip = "CSFCHUNK" 컨테이너 안에 SQLite DB(레이어 정보) + 외부 청크(256×256 타일 픽셀, zlib 압축)

// 읽기 전용 최소 SQLite 리더: 테이블 전체를 행 객체 배열로 돌려준다
function sqliteReader(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  if(String.fromCharCode(...u8.subarray(0,15))!=='SQLite format 3') throw new Error('클립 파일 안의 데이터베이스를 찾지 못했어요.');
  let ps=dv.getUint16(16); if(ps===1) ps=65536;
  const usable=ps-u8[20];
  const page=n=>(n-1)*ps;
  function varint(p){ let v=0n; for(let i=0;i<9;i++){ const b=u8[p+i]; if(i===8){ v=(v<<8n)|BigInt(b); return [v,p+9]; } v=(v<<7n)|BigInt(b&0x7f); if(!(b&0x80)) return [v,p+i+1]; } }
  function payloadOf(p,P){
    const X=usable-35;
    if(P<=X) return u8.subarray(p,p+P);
    const M=Math.floor((usable-12)*32/255)-23, K=M+((P-M)%(usable-4)), local=K<=X?K:M;
    const out=new Uint8Array(P); out.set(u8.subarray(p,p+local)); let got=local, ov=dv.getUint32(p+local);
    while(ov && got<P){ const o=page(ov); const n=Math.min(usable-4,P-got); out.set(u8.subarray(o+4,o+4+n),got); got+=n; ov=dv.getUint32(o); }
    return out;
  }
  function record(buf){
    const bdv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength); let p=0;
    const rv=q=>{ let v=0; for(let i=0;i<9;i++){ const b=buf[q+i]; if(i===8){ return [v*256+b,q+9]; } v=v*128+(b&0x7f); if(!(b&0x80)) return [v,q+i+1]; } };
    let [hs,q]=rv(0); const types=[]; while(q<hs){ let t; [t,q]=rv(q); types.push(t); }
    p=hs; const vals=[];
    for(const t of types){
      if(t===0){ vals.push(null); }
      else if(t>=1&&t<=6){ const n=[0,1,2,3,4,6,8][t]; let v=BigInt(buf[p]&0x80?-1:0); for(let i=0;i<n;i++) v=(v<<8n)|BigInt(buf[p+i]); v=BigInt.asIntN(n*8,v); vals.push(Number(v)); p+=n; }
      else if(t===7){ vals.push(bdv.getFloat64(p)); p+=8; }
      else if(t===8){ vals.push(0); } else if(t===9){ vals.push(1); }
      else if(t>=12&&t%2===0){ const n=(t-12)/2; vals.push(buf.slice(p,p+n)); p+=n; }
      else if(t>=13){ const n=(t-13)/2; vals.push(new TextDecoder().decode(buf.subarray(p,p+n))); p+=n; }
      else vals.push(null);
    }
    return vals;
  }
  function scan(root){
    const rows=[]; const stack=[root];
    while(stack.length){
      const pg=stack.pop(); let h=page(pg); const hdr=pg===1?h+100:h; const type=u8[hdr];
      const cells=dv.getUint16(hdr+3), cellStart=hdr+(type===0x05?12:8);
      if(type===0x05){
        stack.push(dv.getUint32(hdr+8));
        for(let i=cells-1;i>=0;i--) stack.push(dv.getUint32(h+dv.getUint16(cellStart+i*2)));
      } else if(type===0x0d){
        for(let i=0;i<cells;i++){
          let c=h+dv.getUint16(cellStart+i*2), P, rowid; [P,c]=varint(c); [rowid,c]=varint(c);
          rows.push({rowid:Number(rowid),vals:record(payloadOf(c,Number(P)))});
        }
      }
    }
    return rows.sort((a,b)=>a.rowid-b.rowid);
  }
  const master=scan(1).map(r=>({type:r.vals[0],name:r.vals[1],root:r.vals[3],sql:r.vals[4]}));
  const tables={};
  for(const m of master) if(m.type==='table') tables[m.name]=m;
  function cols(sql){
    const body=sql.slice(sql.indexOf('(')+1,sql.lastIndexOf(')'));
    return body.split(',').map(s=>s.trim().split(/\s+/)[0].replace(/["`\[\]]/g,'')).filter(Boolean)
      .map((n,i,all)=>({n,pk:/INTEGER\s+PRIMARY\s+KEY/i.test(body.split(',')[i]||'')}));
  }
  return {
    has:name=>!!tables[name],
    rows(name){
      const t=tables[name]; if(!t) return [];
      const cs=cols(t.sql);
      return scan(t.root).map(r=>{ const o={}; cs.forEach((c,i)=>{ o[c.n]=(c.pk&&r.vals[i]==null)?r.rowid:r.vals[i]; }); return o; });
    }
  };
}

// CSP 혼합 모드 번호 → PSD 키
const CLIP_BLEND={0:'norm',1:'dark',2:'mul ',3:'idiv',4:'lbrn',5:'fsub',6:'dkCl',7:'lite',8:'scrn',9:'div ',10:'gdg ',11:'lddg',12:'gadd',
  13:'lgCl',14:'over',15:'sLit',16:'hLit',17:'vLit',18:'lLit',19:'pLit',20:'hMix',21:'diff',22:'smud',23:'hue ',24:'sat ',25:'colr',26:'lum ',36:'fdiv',30:'pass'};

// 색조 보정 레이어 설정 읽기 (현재: 그라데이션 맵)
function parseFilter(b){
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(b.length<28||v.getUint32(0)!==9) return null;          // 9 = 그라데이션 맵
  const n=v.getUint32(20); const stops=[];
  const start=28+Math.max(0,v.getUint32(12)-16);           // 버전에 따라 머리말 길이가 다름(0x10 / 0x18)
  for(let i=0,p=start;i<n&&p+28<=b.length;i++,p+=28)
    stops.push({c:[v.getUint32(p)>>>24,v.getUint32(p+4)>>>24,v.getUint32(p+8)>>>24],a:(v.getUint32(p+12)>>>24)/255,pos:Math.min(1,v.getUint32(p+20)/32768)});
  if(!stops.length) return null;
  stops.sort((a,b)=>a.pos-b.pos);
  const lut=new Uint8ClampedArray(256*4);
  for(let t=0;t<256;t++){
    const x=t/255; let s0=stops[0], s1=stops[stops.length-1];
    if(x<=s0.pos) s1=s0; else if(x>=s1.pos) s0=s1;
    else for(let k=0;k<stops.length-1;k++) if(x>=stops[k].pos&&x<=stops[k+1].pos){ s0=stops[k]; s1=stops[k+1]; break; }
    const f=s1.pos>s0.pos?(x-s0.pos)/(s1.pos-s0.pos):0;
    for(let k=0;k<3;k++) lut[t*4+k]=s0.c[k]+(s1.c[k]-s0.c[k])*f;
    lut[t*4+3]=255*(s0.a+(s1.a-s0.a)*f);
  }
  return {kind:'gradmap',lut,stops};
}
async function parseCLIP(buf){
  const u8=new Uint8Array(buf), dv=new DataView(buf);
  const tag=p=>String.fromCharCode(...u8.subarray(p,p+8));
  if(tag(0)!=='CSFCHUNK') throw new Error('클립스튜디오 파일이 아니에요.');
  const u64=p=>dv.getUint32(p)*4294967296+dv.getUint32(p+4);
  // 청크 훑기
  let p=24, sqlite=null; const ext={};
  while(p+16<=u8.length){
    const t=tag(p), len=u64(p+8), body=p+16;
    if(t==='CHNKSQLi') sqlite=u8.subarray(body,body+len);
    else if(t==='CHNKExta'){ const idl=u64(body); const id=new TextDecoder().decode(u8.subarray(body+8,body+8+idl)); ext[id]={start:body+8+idl+8,size:u64(body+8+idl)}; }
    else if(t==='CHNKFoot') break;
    p=body+len;
  }
  if(!sqlite) throw new Error('클립 파일 안의 레이어 정보를 찾지 못했어요.');
  const db=sqliteReader(sqlite);
  const canvas=db.rows('Canvas')[0]; if(!canvas) throw new Error('캔버스 정보를 찾지 못했어요.');
  const width=Math.round(canvas.CanvasWidth), height=Math.round(canvas.CanvasHeight);
  const byId=(name,key='MainId')=>{ const m=new Map(); for(const r of db.rows(name)) m.set(r[key],r); return m; };
  const layers=byId('Layer'), mipmaps=byId('Mipmap'), infos=byId('MipmapInfo'), offs=byId('Offscreen');
  const vectorLayers=new Set(db.rows('VectorObjectList').map(r=>r.LayerId));

  const inflate=async bytes=>new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const str=v=>v instanceof Uint8Array?new TextDecoder().decode(v):v;
  // Offscreen.Attribute에서 크기·타일 격자 읽기
  function attrInfo(a){
    const adv=new DataView(a.buffer,a.byteOffset,a.byteLength); let q=16;
    const n=adv.getUint32(q); q+=4+n*2;
    return {W:adv.getUint32(q),H:adv.getUint32(q+4),gx:adv.getUint32(q+8),gy:adv.getUint32(q+12)};
  }
  // 오프스크린 → {rgba,w,h,left,top} (빈 타일은 건너뛰고, 그림 있는 범위만)
  async function readOffscreen(offId,ox,oy,channels){
    const o=offs.get(offId); if(!o) return null;
    const id=str(o.BlockData); const e=ext[id]; if(!e) return null;
    const {W,H,gx,gy}=attrInfo(o.Attribute);
    let q=e.start; const end=e.start+e.size; const tiles=[];
    for(let k=0;k<gx*gy && q<end;k++){
      const blen=dv.getUint32(q); let r=q+4; const n=dv.getUint32(r); r+=4+n*2;
      const idx=dv.getUint32(r), w=dv.getUint32(r+8), h=dv.getUint32(r+12), exists=dv.getUint32(r+16); r+=20;
      if(exists){ const dlen=dv.getUint32(r+4,true); tiles.push({idx,w,h,data:await inflate(u8.subarray(r+8,r+8+dlen))}); }
      q+=blen;
    }
    if(!tiles.length) return null;
    let tx0=Infinity,ty0=Infinity,tx1=-1,ty1=-1;
    for(const t of tiles){ const bx=t.idx%gx, by=Math.floor(t.idx/gx); tx0=Math.min(tx0,bx); ty0=Math.min(ty0,by); tx1=Math.max(tx1,bx); ty1=Math.max(ty1,by); }
    const w=(tx1-tx0+1)*256, h=(ty1-ty0+1)*256, out=new Uint8ClampedArray(w*h*(channels===1?1:4));
    for(const t of tiles){
      const bx=(t.idx%gx-tx0)*256, by=(Math.floor(t.idx/gx)-ty0)*256, n=t.w*t.h, d=t.data;
      for(let y=0;y<t.h;y++) for(let x=0;x<t.w;x++){
        const i=y*t.w+x, o=(by+y)*w+(bx+x);
        if(channels===1){ out[o]=d[i]; continue; }
        const s=n+i*4; out[o*4]=d[s+2]; out[o*4+1]=d[s+1]; out[o*4+2]=d[s]; out[o*4+3]=d[i];
      }
    }
    return {rgba:out,w,h,left:ox+tx0*256,top:oy+ty0*256};
  }
  const baseOffscreen=mm=>{ const m=mipmaps.get(mm); if(!m) return null; const inf=infos.get(m.BaseMipmapInfo); return inf?inf.Offscreen:null; };
  // 그림 있는 범위로 잘라내기
  function crop(img){
    const {rgba,w,h}=img; let x0=w,y0=h,x1=-1,y1=-1;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(rgba[(y*w+x)*4+3]){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    if(x1<0) return null;
    const cw=x1-x0+1,ch=y1-y0+1,out=new Uint8ClampedArray(cw*ch*4);
    for(let y=0;y<ch;y++) out.set(rgba.subarray(((y0+y)*w+x0)*4,((y0+y)*w+x1+1)*4),y*cw*4);
    return {rgba:out,w:cw,h:ch,left:img.left+x0,top:img.top+y0};
  }
  let skippedVector=0, skippedFilter=0;
  async function build(id){
    const L=layers.get(id); if(!L) return null;
    const common={name:L.LayerName||'',blend:CLIP_BLEND[L.LayerComposite]||'norm',opacity:(L.LayerOpacity??256)/256,
      hidden:!((L.LayerVisibility??1)&1),clipping:!!L.LayerClip};
    if(L.LayerUsePaletteColor) common.labelColor=[L.LayerPaletteRed,L.LayerPaletteGreen,L.LayerPaletteBlue].map(v=>(v>>>24)&255);
    if(L.LayerFolder&1){
      const g={type:'group',...common,children:[]};   // CSP 폴더: 0=표준(격리), 30=통과
      let c=L.LayerFirstChildIndex, guard=0;
      while(c && guard++<10000){ const n=await build(c); if(n) g.children.push(n); c=layers.get(c)?.LayerNextIndex; }
      return g;
    }
    // 용지 등 단색 채우기 레이어
    if(L.DrawColorEnable){
      const rgb=[L.DrawColorMainRed,L.DrawColorMainGreen,L.DrawColorMainBlue].map(v=>((v??0)>>>24)&255);
      const px=new Uint8ClampedArray(width*height*4); for(let i=0;i<px.length;i+=4){ px[i]=rgb[0]; px[i+1]=rgb[1]; px[i+2]=rgb[2]; px[i+3]=255; }
      return {type:'layer',...common,left:0,top:0,w:width,h:height,pixels:px};
    }
    const ox=(L.LayerOffsetX||0)+(L.LayerRenderOffscrOffsetX||0), oy=(L.LayerOffsetY||0)+(L.LayerRenderOffscrOffsetY||0);
    const maskOn=L.LayerLayerMaskMipmap && ((L.LayerVisibility??1)&2);
    const readMask=async()=>{
      const mx=(L.LayerOffsetX||0)+(L.LayerMaskOffsetX||0)+(L.LayerMaskOffscrOffsetX||0), my=(L.LayerOffsetY||0)+(L.LayerMaskOffsetY||0)+(L.LayerMaskOffscrOffsetY||0);
      return await readOffscreen(baseOffscreen(L.LayerLayerMaskMipmap),mx,my,1);
    };
    // 색조 보정 레이어
    if(L.FilterLayerInfo instanceof Uint8Array){
      const adj=parseFilter(L.FilterLayerInfo);
      if(!adj){ skippedFilter++; return null; }
      let mask=null; if(maskOn){ try{ mask=await readMask(); }catch(e){} if(!mask) mask={rgba:new Uint8ClampedArray(1),w:1,h:1,left:-9,top:-9}; }
      return {type:'layer',...common,adjust:adj,mask};
    }
    let img=await readOffscreen(baseOffscreen(L.LayerRenderMipmap),ox,oy,4);
    if(!img){ if(vectorLayers.has(id)) skippedVector++; return null; }
    // 레이어 마스크
    if(maskOn){
      try{
        const m=await readMask();
        if(m){ for(let y=0;y<img.h;y++) for(let x=0;x<img.w;x++){ const gx=img.left+x-m.left, gy=img.top+y-m.top;
          const v=(gx>=0&&gy>=0&&gx<m.w&&gy<m.h)?m.rgba[gy*m.w+gx]:0; const k=(y*img.w+x)*4+3; img.rgba[k]=img.rgba[k]*v/255; } }
      }catch(e){}
    }
    img=crop(img); if(!img) return null;
    return {type:'layer',...common,left:img.left,top:img.top,w:img.w,h:img.h,pixels:img.rgba};
  }
  const root=await build(canvas.CanvasRootFolder);
  if(!root) throw new Error('레이어를 읽지 못했어요.');
  return {width,height,root:{type:'group',name:'root',children:root.children},skippedVector,skippedFilter};
}
/*CLIP-END*/

// ================= 상태 =================
const $=id=>document.getElementById(id);
const comp=$('comp'), zoomC=$('zoom'), frame=$('frame'), selEl=$('sel');
let doc=null;              // {width,height,name}
let blocks=[];             // 화면 순서(위→아래): {id,type:'folder'|'loose',name,multi,randomOn,layers:[L]}
const MOBILE_Q='(max-width:560px) and (hover:none) and (pointer:coarse)';   // 휴대폰 배치는 좁은 터치 화면에서만 (PC는 창을 넓히면 되므로)
let uid=0, viewMode='small', ratioKey='1:1', scope='full';
let region={x:0,y:0,w:1,h:1};
const RATIOS={'1:1':1,'2:3':2/3,'3:4':3/4,'9:16':9/16,'free':null};

const cleanName=n=>(n||'').replace(/^\s*[*#]|\*\s*$/g,'').trim();
function mkL(node,name,on){ node._force=true; return {id:++uid,node,name:name||'레이어',on,def:on,clipTo:null,clipOn:false,thumb:null}; }

function buildBlocks(root){
  blocks=[];
  for(const ch of root.children.slice().reverse()){           // PSD 패널 순서(위→아래)
    const raw=ch.name||'';
    if(ch.type==='group' && !/^\s*#/.test(raw)){
      const layers=ch.children.slice().reverse().filter(o=>nodeImage(o)).map(o=>mkL(o,o.name,!o.hidden));
      const onCount=layers.filter(l=>l.on).length;
      blocks.push({id:++uid,type:'folder',srcName:raw,name:cleanName(raw)||'폴더',multi:onCount>1,randomOn:true,layers,clipTo:null,clipOn:false,srcClip:!!ch.clipping,
        hidden:!!ch.hidden, defHidden:!!ch.hidden, gblend:ch.blend||'pass', gop:ch.opacity??1,
        color:ch.labelColor?paleOf('#'+ch.labelColor.map(v=>v.toString(16).padStart(2,'0')).join('')):null});
    } else {
      if(!nodeImage(ch)) continue;
      const L=mkL(ch,cleanName(raw),ch.type==='group'?true:!ch.hidden);
      let last=blocks[blocks.length-1];
      if(!last||last.type!=='loose'){ last={id:++uid,type:'loose',layers:[]}; blocks.push(last); }
      L.srcClip=!!ch.clipping; last.layers.push(L);
    }
  }
  importClips();
}
// PSD의 클리핑 표시를 '대상이 정해진 클리핑'으로 바꿔 둔다
function importClips(){
  for(const B of blocks) if(B.type==='folder') B.layers.forEach((L,i)=>{
    if(!L.node.clipping) return;
    const t=B.layers.slice(i+1).find(x=>!x.node.clipping); if(t){ L.clipTo={kind:'layer',id:t.id}; L.clipOn=true; }
  });
  const z=[]; for(const B of blocks){ if(B.type==='folder') z.push({obj:B,ref:{kind:'folder',id:B.id},clip:B.srcClip}); else B.layers.forEach(L=>z.push({obj:L,ref:{kind:'layer',id:L.id},clip:L.srcClip})); }
  z.forEach((it,k)=>{ if(!it.clip) return; const t=z.slice(k+1).find(x=>!x.clip); if(t){ it.obj.clipTo=t.ref; it.obj.clipOn=true; } });
}
function normalize(){
  blocks=blocks.filter(b=>b.type!=='loose'||b.layers.length);
  for(let i=blocks.length-1;i>0;i--) if(blocks[i].type==='loose'&&blocks[i-1].type==='loose'){ blocks[i-1].layers.push(...blocks[i].layers); blocks.splice(i,1); }
  validateClips();
}
// 옮기기·해제 뒤에 더는 성립하지 않는 클리핑 연결(자기 폴더·순환 등)은 지움
function validateClips(){
  let n=0;
  const check=(obj,src)=>{ if(!obj.clipTo) return; if(!resolveRef(obj.clipTo)||clipInvalid(src,obj.clipTo)){ obj.clipTo=null; obj.clipOn=false; n++; } };
  for(const B of blocks){ if(B.type==='folder') check(B,{kind:'folder',id:B.id}); B.layers.forEach(L=>check(L,{kind:'layer',id:L.id})); }
  if(n&&doc) setTimeout(()=>toast(`옮긴 위치에서 성립하지 않는 클리핑 연결 ${n}개를 지웠어요`,2200),0);
}
const isOn=L=>L.on;   // 분장실과 스튜디오가 같은 켜짐 상태를 공유
function enforceSingle(B){ if(B.type!=='folder'||B.multi) return 0; let seen=false, n=0; for(const L of B.layers){ if(L.on){ if(seen){ L.on=false; n++; } seen=true; } } return n; }
// 파츠를 옮긴 뒤: 분장실은 여러 개 켜져 있어도 그대로(스튜디오로 갈 때 중복 허용으로 바뀜), 스튜디오는 하나만 고르는 폴더면 끄고 알림
function afterMoveInto(T){
  if(mode==='org'||T.type!=='folder') return;
  const n=enforceSingle(T); if(n) setTimeout(()=>toast(`'${T.name}'은(는) 하나만 고르는 폴더라 파츠 ${n}개를 껐어요`,2200),0);
}

// ================= 렌더 =================
// ---- 혼합 모드 ----
const BLEND_MODES=[[   // 클립스튜디오 메뉴와 같은 이름·순서
  ['norm','표준'],['dark','비교(어두움)'],['mul ','곱하기'],['idiv','색상 번'],['lbrn','선형 번'],['fsub','감산'],
  ['lite','비교(밝음)'],['scrn','스크린'],['div ','색상 닷지'],['gdg ','발광 닷지'],['lddg','더하기'],['gadd','더하기(발광)'],
  ['over','오버레이'],['sLit','소프트 라이트'],['hLit','하드 라이트'],['diff','차이'],['vLit','선명한 라이트'],['lLit','선형 라이트'],
  ['pLit','핀 라이트'],['hMix','하드 혼합'],['smud','제외'],['dkCl','컬러 비교(어두움)'],['lgCl','컬러 비교(밝음)'],['fdiv','나누기'],
  ['hue ','색조'],['sat ','채도'],['colr','컬러'],['lum ','휘도']
]];
const BLEND_NAME=Object.fromEntries(BLEND_MODES.flat());
const blendOf=L=>{ const b=L.node.blend||'norm'; return b==='pass'?'norm':b; };
// 폴더 혼합 모드: 통과 = 안의 레이어가 아래와 바로 섞임 / 그 외 = 폴더 안끼리 먼저 합친 뒤 그 모드로 얹음
const folderBlend=B=>B.gblend||'pass';
// 혼합 모드 표시(✦): 바꾸는 기능 없이 적용 여부만 보여 줌
function blendMark(name){
  const s=document.createElement('span'); s.className='bmark org-only'; s.textContent='✦';
  s.onpointerenter=()=>showTip(s,`${name} 효과 적용 중`); s.onpointerleave=hideTip;
  s.onclick=e=>{ if(!TOUCH.matches) return; e.stopPropagation(); showTip(s,`${name} 효과 적용 중`); clearTimeout(s._t); s._t=setTimeout(hideTip,1800); };   // 터치: 눌러서 보기
  return s;
}
// 기본 title보다 빨리 뜨는 말풍선
function showTip(el,text){
  let t=$('tip'); if(!t){ t=document.createElement('div'); t.id='tip'; document.body.appendChild(t); }
  t.textContent=text; t.classList.add('show');
  const r=el.getBoundingClientRect(), w=t.offsetWidth, h=t.offsetHeight;
  let top=r.top-h-6; if(top<6) top=r.bottom+6;
  t.style.top=top+'px'; t.style.left=Math.max(6,Math.min(r.left+r.width/2-w/2,innerWidth-w-6))+'px';
}
function hideTip(){ $('tip')?.classList.remove('show'); }
window.addEventListener('scroll',hideTip,true);

// ---- 연동 그룹 ----
// L.link={g:1~99, role:'main'|'sub'} · 중심 파츠 하나를 켜면 같은 그룹 중심 파츠가 모두 켜짐 · 보조 파츠는 같은 그룹 중심 파츠가 켜졌을 때만 또렷
const LINK_SVG='<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><circle cx="5.7" cy="5.2" r="2.5"/><path d="M1 14c0-3 2.1-5 4.7-5s4.7 2 4.7 5z"/><circle cx="11.3" cy="5.9" r="2.1"/><path d="M10.6 9.4c.3-.1.6-.1.9-.1 2.1 0 3.6 1.9 3.6 4.7h-3.5c0-1.9-.4-3.4-1-4.6z"/></svg>';
function linkHandle(L){
  const h=document.createElement('span'); h.className='linkH org-only';
  if(L.link){ h.classList.add('set',L.link.role); h.textContent=L.link.g; h.title=`연동 그룹 ${L.link.g} · ${L.link.role==='main'?'중심 파츠':'보조 파츠'}`; }
  else { h.innerHTML=LINK_SVG; h.title='연동 그룹 설정'; }
  h.draggable=false;
  if(mode!=='org'){ if(L.link) h.title+=' (분장실에서 수정)'; return h; }   // 스튜디오: 표시만
  h.onmousedown=e=>{ e.preventDefault(); e.stopPropagation(); };
  h.ondblclick=e=>e.stopPropagation();
  h.onclick=e=>{ e.stopPropagation(); openLinkPop(h,L); };
  return h;
}
let lastLinkG=1;   // 마지막으로 적용한 그룹 번호가 다음 기본값
function closeLinkPop(){ $('linkPop')?.remove(); }
function openLinkPop(anchor,L){
  closeLinkPop();
  const group=(picked.has(L.id)&&picked.size>1)?allLayers().filter(x=>picked.has(x.id)):[L];
  const m=document.createElement('div'); m.id='linkPop';
  m.innerHTML=`<div class="lp-head">연동 그룹${group.length>1?` · 파츠 ${group.length}개`:''}</div>
    <label class="lp-row">그룹 번호 <input type="number" min="1" max="99" step="1" class="lp-num"></label>
    <div class="lp-roles">
      <label><input type="radio" name="lpRole" value="main"> <b>중심 파츠</b><small>하나를 켜면 같은 그룹 중심 파츠가 모두 켜집니다.</small></label>
      <label><input type="radio" name="lpRole" value="sub"> <b>보조 파츠</b><small>중심 파츠가 켜졌을 때만 활성화됩니다.</small></label>
    </div>
    <div class="lp-btns"><button class="btn lp-clear">해제</button><button class="btn dark lp-ok">적용</button></div>`;
  const num=m.querySelector('.lp-num'); num.value=L.link?.g??lastLinkG;
  const role=L.link?.role||'main'; m.querySelector(`input[value=${role}]`).checked=true;
  const done=msg=>{ closeLinkPop(); renderPanel(); render(); if(msg) toast(msg,1600); };
  const apply=()=>{
    const g=+num.value;
    if(!Number.isInteger(g)||g<1||g>99){ toast('그룹 번호는 1~99 사이 정수로 입력해 주세요.'); num.focus(); return; }
    const r=m.querySelector('input[name=lpRole]:checked').value;
    group.forEach(x=>x.link={g,role:r}); lastLinkG=g;
    const conv=ensureMultiForLinks();
    done(`${group.length>1?`파츠 ${group.length}개를 `:''}그룹 ${g} ${r==='main'?'중심':'보조'} 파츠로 설정했어요`+(conv.length?` · ${conv.map(b=>`'${b.name}'`).join(', ')} 폴더를 중복 허용으로 바꿨어요`:''));
  };
  m.querySelector('.lp-ok').onclick=apply;
  m.querySelector('.lp-clear').onclick=()=>{ group.forEach(x=>delete x.link); done('연동 그룹을 해제했어요'); };
  m.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); apply(); } if(e.key==='Escape') closeLinkPop(); };
  m.onclick=e=>e.stopPropagation(); m.onmousedown=e=>e.stopPropagation(); m.onpointerdown=e=>e.stopPropagation();
  document.body.appendChild(m);
  const r=anchor.getBoundingClientRect(), mh=m.offsetHeight, mw=m.offsetWidth;
  let top=r.bottom+4; if(top+mh>innerHeight-8) top=Math.max(8,r.top-mh-4);
  m.style.top=top+'px'; m.style.left=Math.max(8,Math.min(r.left,innerWidth-mw-8))+'px';
  num.focus(); num.select();
}
document.addEventListener('click',closeLinkPop);
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeLinkPop(); });
window.addEventListener('scroll',e=>{ const m=$('linkPop'); if(m&&(e.target===m||m.contains(e.target))) return; closeLinkPop(); },true);
// 한 폴더(중복 불가)에 같은 그룹 중심 파츠가 둘 이상이면 그 폴더를 중복 허용으로 바꿈
function ensureMultiForLinks(){
  const conv=[];
  for(const B of blocks){
    if(B.type!=='folder'||B.multi) continue;
    const cnt={}; B.layers.forEach(L=>{ if(L.link?.role==='main') cnt[L.link.g]=(cnt[L.link.g]||0)+1; });
    if(Object.values(cnt).some(n=>n>1)){ B.multi=true; conv.push(B); }
  }
  return conv;
}
// 스탠딩 모드: 중심 파츠를 켜거나 끄면 같은 그룹 중심 파츠도 똑같이 (한 개만 고르는 폴더는 켤 때 나머지를 끔)
function linkSync(L,only,seen=new Set()){   // only: 이 폴더들 안에서만 맞춤 (랜덤에서 빠진 폴더는 건드리지 않음)
  if(L.link?.role!=='main') return;
  const g=L.link.g; if(seen.has(g)) return; seen.add(g);
  ensureMultiForLinks();
  const off=[];   // 한 개만 고르는 폴더라서 밀려 꺼진 다른 그룹의 중심 파츠
  for(const X of allLayers()){
    if(X===L||X.link?.role!=='main'||X.link.g!==g||X.on===L.on) continue;
    const XB=findL(X.id).B;
    if(only&&!only.has(XB)) continue;
    if(L.on&&XB.type==='folder'&&!XB.multi) XB.layers.forEach(y=>{ if(y.on&&y!==X&&y.link?.role==='main') off.push(y); y.on=false; });
    X.on=L.on;
  }
  off.forEach(y=>linkSync(y,only,seen));   // 그 그룹도 함께 꺼서 짝이 어긋나지 않게
}
// 보조 파츠 흐리게: 같은 그룹 중심 파츠가 하나도 안 켜졌을 때
function refreshLinkDim(){
  const live=new Set(); if(mode!=='org') for(const X of allLayers()) if(X.link?.role==='main'&&X.on) live.add(X.link.g);
  for(const B of blocks) for(const L of B.layers){ const it=itemEls.get(L.id); if(it) it.classList.toggle('ldim',mode!=='org'&&L.link?.role==='sub'&&!live.has(L.link.g)); }
}
function refOf(L,B){ if(L.clipTo&&L.clipOn) return L.clipTo; if(B.type==='folder'&&B.clipTo&&B.clipOn) return B.clipTo; return null; }
function resolveRef(r){ if(!r) return null; if(r.kind==='layer') return findL(r.id)?r:null; return blocks.some(b=>b.id===r.id&&b.type==='folder')?r:null; }
// 현재 켜진 레이어를 합성. 클리핑된 레이어는 대상 바로 위에 얹고 대상 모양으로 잘라 그린다
function composeInto(ctx){
  const on=[];
  for(let b=blocks.length-1;b>=0;b--){ const B=blocks[b]; if(B.hidden) continue; for(let i=B.layers.length-1;i>=0;i--){ const L=B.layers[i]; if(isOn(L)) on.push({L,B,ref:resolveRef(refOf(L,B))}); } }
  const unc=on.filter(e=>!e.ref), deps=new Map(), topOf=new Map();
  unc.forEach(e=>{ if(e.B.type==='folder') topOf.set(e.B.id,e); });
  on.filter(e=>e.ref).forEach(e=>{ const k=e.ref.kind+':'+e.ref.id; if(!deps.has(k)) deps.set(k,[]); deps.get(k).push(e); });
  const seq=[], seen=new Set();
  const place=e=>{ if(seen.has(e.L.id)) return; seen.add(e.L.id); seq.push(e);
    (deps.get('layer:'+e.L.id)||[]).forEach(place);
    if(!e.ref && topOf.get(e.B.id)===e) (deps.get('folder:'+e.B.id)||[]).forEach(place); };
  unc.forEach(place);
  const fmask=new Map();
  const maskFor=r=>{
    if(r.kind==='layer'){ const f=findL(r.id); const T=f&&f.B.layers[f.i]; return T&&isOn(T)?nodeImage(T.node):null; }
    if(fmask.has(r.id)) return fmask.get(r.id);
    const es=unc.filter(e=>e.B.id===r.id); let m=null;
    if(es.length){ const c=mkCanvas(doc.width,doc.height), x=c.getContext('2d'); es.forEach(e=>{ const im=nodeImage(e.L.node); if(im) x.drawImage(im.canvas,im.left,im.top); }); m={canvas:c,left:0,top:0}; }
    fmask.set(r.id,m); return m;
  };
  // '표준' 폴더(격리)는 안의 레이어끼리만 섞은 뒤 한 장으로 얹는다 (통과 폴더는 바로 섞음)
  const main=ctx; let isoB=null, isoC=null;
  const flush=()=>{ if(isoC){ const fb=folderBlend(isoB); draw(main,isoC,0,0,fb==='pass'?'norm':fb,isoB.gop??1); } isoB=null; isoC=null; };
  // 통과 폴더라도 불투명도가 100%가 아니면 한 장으로 모아 그 불투명도로 얹음 (포토샵·클립과 거의 같은 결과)
  const isolatedF=B=>B.type==='folder'&&(folderBlend(B)!=='pass'||(B.gop??1)<1);
  for(const e of seq){
    if(isolatedF(e.B)){ if(isoB!==e.B){ flush(); isoB=e.B; isoC=mkCanvas(doc.width,doc.height); } ctx=isoC.getContext('2d'); }
    else { flush(); ctx=main; }
    if(e.L.node.adjust&&!e.ref){ applyAdjust(ctx,e.L.node,0,0,blendOf(e.L),e.L.node.opacity); continue; }
    if(e.L.node.adjust&&e.ref){   // 클리핑된 색조 보정: 대상 모양 안에서만 보정
      const m=maskFor(e.ref); if(!m) continue;
      const cv=ctx.canvas, t=mkCanvas(cv.width,cv.height), tx=t.getContext('2d');
      tx.drawImage(cv,0,0); applyAdjust(tx,e.L.node,0,0,blendOf(e.L),e.L.node.opacity);
      tx.globalCompositeOperation='destination-in'; tx.drawImage(m.canvas,m.left,m.top);
      ctx.save(); ctx.globalCompositeOperation='destination-out'; ctx.drawImage(m.canvas,m.left,m.top);
      ctx.globalCompositeOperation='lighter'; ctx.drawImage(t,0,0); ctx.restore(); continue;
    }
    const im=nodeImage(e.L.node); if(!im) continue; const n=e.L.node, bl=blendOf(e.L);
    if(!e.ref){ draw(ctx,im.canvas,im.left,im.top,bl,n.opacity); continue; }
    const m=maskFor(e.ref); if(!m) continue;
    const c=mkCanvas(doc.width,doc.height), x=c.getContext('2d');
    x.drawImage(im.canvas,im.left,im.top); x.globalCompositeOperation='destination-in'; x.drawImage(m.canvas,m.left,m.top);
    draw(ctx,c,0,0,bl,n.opacity);
  }
  flush();
}
function render(){
  const ctx=comp.getContext('2d'); ctx.clearRect(0,0,comp.width,comp.height);
  composeInto(ctx); drawZoom();
}
function layoutPreview(){
  if(!doc) return;
  const fw=frame.clientWidth, fh=frame.clientHeight; const s=Math.min(fw/doc.width,fh/doc.height);
  comp.style.width=doc.width*s+'px'; comp.style.height=doc.height*s+'px';
  positionSel(); drawZoom();
}
function positionSel(){
  if(!doc) return;
  const s=comp.clientWidth/doc.width;
  selEl.style.left=comp.offsetLeft+region.x*s+'px'; selEl.style.top=comp.offsetTop+region.y*s+'px';
  selEl.style.width=region.w*s+'px'; selEl.style.height=region.h*s+'px';
}
// 확대 창: 선택한 비율 그대로의 높이. 남는 높이는 전체 미리보기가 차지
const MOBILE=matchMedia(MOBILE_Q);
MOBILE.addEventListener?.('change',()=>{ if(doc) requestAnimationFrame(layoutPreview); });
let prevChrome=90; const ZOOM_MIN=140, PREV_MIN=130;
function sizeZoomBox(){
  const box=$('zoomBox'), card=box.parentElement, left=document.querySelector('.left');
  const cs=getComputedStyle(card), ar=region.w/region.h, full=card.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  let h=full/ar;
  if(MOBILE.matches){   // 휴대폰: 떠 있는 미리보기 창 안에 맞춤
    const ch=card.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom); if(ch>0&&h>ch) h=ch;
  }
  else if(getComputedStyle(left).position!=='static'){
    const prev=document.querySelector('.prevcard'), wrap=$('frameWrap'), acts=document.querySelector('.savebar'), cr=document.querySelector('.left .credit');
    const G=parseFloat(getComputedStyle(left).rowGap)||8;
    const base=(card.offsetHeight-box.offsetHeight)+(acts?.offsetHeight?acts.offsetHeight+G:0)+(cr?.offsetHeight?cr.offsetHeight+G:0);
    const folded=left.classList.contains('pv-fold');
    if(!folded) prevChrome=prev.scrollHeight-wrap.offsetHeight+G;
    const room=left.clientHeight-base-prevChrome;
    // 창 높이가 낮아 확대 보기와 전체 미리보기를 다 둘 수 없으면 전체 미리보기를 접음 (저장 버튼 위로 넘치지 않게)
    const fold=room<(folded?ZOOM_MIN+PREV_MIN+24:ZOOM_MIN+PREV_MIN);
    if(fold!==folded){ left.classList.toggle('pv-fold',fold); requestAnimationFrame(()=>requestAnimationFrame(layoutPreview)); }
    if(!fold){
      const minPrev=Math.max(PREV_MIN,room*.38), maxH=room-minPrev;   // 미리보기도 넉넉히 남김
      if(maxH>80 && h>maxH) h=maxH;
    } else h=Math.min(h,Math.max(60,left.clientHeight-base));
  }
  const w=Math.min(full,h*ar);
  box.style.aspectRatio=''; box.style.width=w+'px'; box.style.height=h+'px';
  return {w,h};
}
let freezeZoom=false;   // 영역을 그리는 동안에는 창 크기를 고정하고, 손을 뗀 뒤 다시 맞춘다
function drawZoom(){
  if(!doc) return;
  updateMetaSize();
  const dpr=window.devicePixelRatio||1;
  if(freezeZoom){
    const z=zoomC.getContext('2d'); z.clearRect(0,0,zoomC.width,zoomC.height);
    const s=Math.min(zoomC.width/region.w,zoomC.height/region.h), dw=region.w*s, dh=region.h*s;
    z.imageSmoothingQuality='high'; z.drawImage(comp,region.x,region.y,region.w,region.h,(zoomC.width-dw)/2,(zoomC.height-dh)/2,dw,dh);
    return;
  }
  const {w,h}=sizeZoomBox();
  zoomC.width=Math.max(1,Math.round(w*dpr)); zoomC.height=Math.max(1,Math.round(h*dpr));
  const z=zoomC.getContext('2d'); z.imageSmoothingQuality='high'; z.clearRect(0,0,zoomC.width,zoomC.height);
  z.drawImage(comp,region.x,region.y,region.w,region.h,0,0,zoomC.width,zoomC.height);
}
function updateMetaSize(){
  if(!doc) return;
  const rw=Math.round(region.w), rh=Math.round(region.h);
  $('metaSize').textContent=`${doc.width}×${doc.height}px (${ratioText(doc.width,doc.height)}) 중 ${rw}×${rh}px (${ratioText(rw,rh)})`;
}
// 미리보기 프레임(2:3)을 남은 공간에 맞춤
function fitFrame(){
  const wrap=$('frameWrap'); const W=wrap.clientWidth, H=wrap.clientHeight; if(!W||!H) return;
  let fh=H, fw=fh*2/3; if(fw>W){ fw=W; fh=fw*1.5; }
  frame.style.width=fw+'px'; frame.style.height=fh+'px';
}
// 크기 감시 콜백은 다음 화면 그리기 때 한 번만 실행 (같은 프레임에서 크기를 또 바꿔 생기는 'ResizeObserver loop' 경고 방지)
const rafOnce=f=>{ let q=0; return ()=>{ if(q) return; q=requestAnimationFrame(()=>{ q=0; f(); }); }; };
new ResizeObserver(rafOnce(fitFrame)).observe($('frameWrap'));
new ResizeObserver(rafOnce(layoutPreview)).observe(frame);
new ResizeObserver(rafOnce(()=>{ if(doc) drawZoom(); })).observe(document.querySelector('.left'));
new ResizeObserver(rafOnce(()=>{ if(doc) drawZoom(); })).observe(document.querySelector('.zoomcard'));

// ---- 영역 드래그 ----
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function toDoc(e){ const r=comp.getBoundingClientRect(); return {x:clamp((e.clientX-r.left)*doc.width/r.width,0,doc.width), y:clamp((e.clientY-r.top)*doc.height/r.height,0,doc.height)}; }
let drag=null;
frame.addEventListener('pointerdown',e=>{
  if(!doc||mode!=='org') return;   // 스튜디오에서는 확대 영역을 바꿀 수 없음
  const p=toDoc(e); frame.setPointerCapture(e.pointerId);
  const inside=p.x>=region.x&&p.x<=region.x+region.w&&p.y>=region.y&&p.y<=region.y+region.h;
  drag=inside?{mode:'move',sx:p.x,sy:p.y,o:{...region}}:{mode:'new',sx:p.x,sy:p.y,moved:false}; freezeZoom=true;
});
frame.addEventListener('pointermove',e=>{
  if(!doc) return; if(mode!=='org'){ frame.style.cursor='default'; return; } const p=toDoc(e);
  if(!drag){ const inside=p.x>=region.x&&p.x<=region.x+region.w&&p.y>=region.y&&p.y<=region.y+region.h; frame.style.cursor=inside?'move':'crosshair'; return; }
  if(drag.mode==='move'){
    region.x=clamp(drag.o.x+p.x-drag.sx,0,doc.width-region.w); region.y=clamp(drag.o.y+p.y-drag.sy,0,doc.height-region.h);
  } else {
    const dx=p.x-drag.sx, dy=p.y-drag.sy; if(!drag.moved && Math.abs(dx)<4 && Math.abs(dy)<4) return; drag.moved=true;
    const R=RATIOS[ratioKey]; let w=Math.abs(dx), h=Math.abs(dy);
    const maxW=dx>=0?doc.width-drag.sx:drag.sx, maxH=dy>=0?doc.height-drag.sy:drag.sy;
    if(R){ if(w/Math.max(h,1e-6)>R) h=w/R; else w=h*R; if(w>maxW){w=maxW;h=w/R} if(h>maxH){h=maxH;w=h*R} }
    else { w=Math.min(w,maxW); h=Math.min(h,maxH); }
    w=Math.max(w,8); h=Math.max(h,8);
    region={x:dx>=0?drag.sx:drag.sx-w, y:dy>=0?drag.sy:drag.sy-h, w, h};
  }
  positionSel(); drawZoom();
});
frame.addEventListener('pointerup',e=>{
  if(drag && drag.mode==='new' && !drag.moved){   // 클릭만 했으면 그 위치로 영역 이동
    const p=toDoc(e); region.x=clamp(p.x-region.w/2,0,doc.width-region.w); region.y=clamp(p.y-region.h/2,0,doc.height-region.h);
  }
  drag=null; freezeZoom=false; positionSel(); drawZoom();
});
frame.addEventListener('pointercancel',()=>{ drag=null; freezeZoom=false; positionSel(); drawZoom(); });
function setRatio(k){
  ratioKey=k; document.querySelectorAll('#ratioSeg button').forEach(b=>b.classList.toggle('on',b.dataset.r===k));
  const R=RATIOS[k]; if(!R||!doc) return;
  const cx=region.x+region.w/2, cy=region.y+region.h/2, area=region.w*region.h;
  let w=Math.sqrt(area*R), h=w/R;
  if(w>doc.width){w=doc.width;h=w/R} if(h>doc.height){h=doc.height;w=h*R}
  region={w,h,x:clamp(cx-w/2,0,doc.width-w),y:clamp(cy-h/2,0,doc.height-h)};
  positionSel(); drawZoom();
}
document.querySelectorAll('#ratioSeg button').forEach(b=>b.onclick=()=>setRatio(b.dataset.r));
function defaultRegion(){
  const w=Math.min(doc.width*.5,doc.height); region={w,h:w,x:(doc.width-w)/2,y:Math.min(doc.height*.1,doc.height-w)};
  ratioKey='1:1'; setRatio('1:1');
}

// ================= 레이어 패널 =================
function thumbURL(node){
  const size=136, c=mkCanvas(size,size); const im=nodeImage(node); if(!im) return c.toDataURL();
  const W=im.canvas.width,H=im.canvas.height; let x0=W,y0=H,x1=-1,y1=-1;
  try{ const d=im.canvas.getContext('2d').getImageData(0,0,W,H).data; const st=W*H>4e6?3:1;
    for(let y=0;y<H;y+=st) for(let x=0;x<W;x+=st) if(d[(y*W+x)*4+3]>10){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }catch(e){}
  if(x1<0){x0=0;y0=0;x1=W-1;y1=H-1}
  const bw=x1-x0+1,bh=y1-y0+1, ctx=c.getContext('2d'); const s=Math.min(size/bw,size/bh)*.86;
  ctx.globalAlpha=Math.max(.35,node.opacity??1);
  ctx.drawImage(im.canvas,x0,y0,bw,bh,(size-bw*s)/2,(size-bh*s)/2,bw*s,bh*s);
  return c.toDataURL();
}
const itemEls=new Map();
let dragData=null, mode='org', picked=new Set(), lastPick=null;
function clearMarks(){ document.querySelectorAll('.drop-before,.drop-after,.drop-in,.dragging').forEach(el=>el.classList.remove('drop-before','drop-after','drop-in','dragging')); }
const clearDrops=()=>document.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach(x=>x.classList.remove('drop-before','drop-after','drop-in'));

// ---- 클리핑 참조 ----
const refName=r=>{ if(!r) return ''; if(r.kind==='layer'){ const f=findL(r.id); return f?f.B.layers[f.i].name:''; } const B=blocks.find(b=>b.id===r.id); return B?B.name:''; };
const HIDE_SVG='<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="8" cy="8" r="5.6"/><path d="M4 4 12 12" stroke-linecap="round"/></svg>';
const EYE_OPEN='<svg class="open" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.2 7.8C5 4.7 9.6 4.3 13.6 6.5"/><path d="M3 8.4C6 11 10 11.2 13 9.3"/><path d="M4.6 5.7 3.9 3.9M7.7 4.7 7.5 2.8"/><ellipse cx="11.2" cy="8" rx="1.5" ry="2" fill="currentColor" stroke="none"/></svg>';
const EYE_SHUT='<svg class="shut" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.4 7.2C5.5 10.6 10.4 10.8 13.6 7.4"/><path d="M5 9.6 4.3 11.6M8.2 10.4 8.1 12.5M11.3 9.6 12 11.4"/></svg>';
const CLIP_SVG='<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 12 4M6.5 4H12v5.5"/></svg>';
// 연결된 클리핑 화살표에 커서를 올리면 대상까지 반투명 화살표로 이어 보여 줌
let peekEl=null;
function showClipPeek(h,ref){
  hideClipPeek(); if(document.body.classList.contains('clip-dragging')) return;
  const r=resolveRef(ref); if(!r) return;
  const tgt=r.kind==='layer'?itemEls.get(r.id):document.querySelector(`#blocks .block[data-bid="${r.id}"]`); if(!tgt) return;
  const a=h.getBoundingClientRect(), t=tgt.getBoundingClientRect();
  const x0=a.left+a.width/2, y0=a.top+a.height/2;
  const x1=Math.min(Math.max(x0,t.left),t.right), y1=Math.min(Math.max(y0,t.top),t.bottom);
  const svg=$('clipSvg'), ang=Math.atan2(y1-y0,x1-x0), L=11, w=.5;
  svg.querySelectorAll('line').forEach(l=>l.remove());
  const g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('class','peek');
  g.innerHTML=`<path d="M${x0} ${y0}L${x1} ${y1}" stroke="#161616" stroke-width="3" stroke-linecap="round" fill="none"/>`+
    `<path d="M${x1-L*Math.cos(ang-w)} ${y1-L*Math.sin(ang-w)}L${x1} ${y1}L${x1-L*Math.cos(ang+w)} ${y1-L*Math.sin(ang+w)}" stroke="#161616" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  svg.appendChild(g); svg.classList.add('show','peeking'); tgt.classList.add('clip-peek'); peekEl=tgt;
}
function hideClipPeek(){
  const svg=$('clipSvg'); svg.querySelectorAll('g.peek').forEach(x=>x.remove());
  if(svg.classList.contains('peeking')){ svg.classList.remove('peeking'); if(!document.body.classList.contains('clip-dragging')) svg.classList.remove('show'); }
  peekEl?.classList.remove('clip-peek'); peekEl=null;
}
window.addEventListener('scroll',hideClipPeek,true);
function clipHandle(obj,src){
  const h=document.createElement('span'); h.className='clipH org-only';
  if(obj.clipTo && resolveRef(obj.clipTo)){
    h.classList.add('set',obj.clipOn?'on':'off');
    h.onpointerenter=()=>showClipPeek(h,obj.clipTo); h.onpointerleave=hideClipPeek;
    h.title=obj.clipOn?`클리핑: ${refName(obj.clipTo)} (클릭하면 해제, 끌면 다른 곳에 연결)`:`클리핑 해제됨: ${refName(obj.clipTo)} (클릭하면 다시 클리핑)`;
  } else h.title='끌어서 클리핑할 파츠나 폴더에 놓으세요';
  h.innerHTML=CLIP_SVG;
  h.draggable=false;
  h.onmousedown=e=>{ e.preventDefault(); e.stopPropagation(); };
  h.onclick=e=>e.stopPropagation(); h.ondblclick=e=>e.stopPropagation();
  h.onpointerdown=e=>{ if(e.button!==0) return; e.preventDefault(); e.stopPropagation(); startClipDrag(e,h,obj,src); };
  return h;
}
function startClipDrag(e,h,obj,src){
  hideClipPeek();
  // 선택된 파츠 중 하나에서 시작하면 선택된 파츠 전부가 함께 클리핑된다
  const group=(src.kind==='layer'&&picked.has(src.id)&&picked.size>1)?allLayers().filter(L=>picked.has(L.id)).map(L=>L.id):null;
  const starts=(group||[null]).map(id=>{
    if(id==null||id===src.id){ const r=h.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; }
    const r=itemEls.get(id)?.getBoundingClientRect(); return r?{x:r.right-10,y:r.top+10}:null;
  }).filter(Boolean);
  const svg=$('clipSvg'), dot=svg.querySelector('circle');
  svg.querySelectorAll('line,path.dhead').forEach(l=>l.remove());
  const lines=starts.map(s=>{ const l=document.createElementNS('http://www.w3.org/2000/svg','line'); l.setAttribute('stroke','#161616'); l.setAttribute('stroke-width',starts.length>1?'3':'4'); l.setAttribute('stroke-linecap','round'); l.setAttribute('x1',s.x); l.setAttribute('y1',s.y); svg.insertBefore(l,dot); return l; });
  const heads=lines.map(()=>{ const p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('class','dhead'); p.setAttribute('fill','none'); p.setAttribute('stroke','#161616'); p.setAttribute('stroke-width',starts.length>1?'3':'4'); p.setAttribute('stroke-linecap','round'); p.setAttribute('stroke-linejoin','round'); svg.insertBefore(p,dot); return p; });
  const x0=starts[0]?.x??e.clientX, y0=starts[0]?.y??e.clientY;
  let moved=false, target=null, hl=null;
  const setHL=el=>{ if(hl===el) return; hl?.classList.remove('clip-target'); hl=el; hl?.classList.add('clip-target'); };
  const move=ev=>{
    if(!moved && Math.hypot(ev.clientX-e.clientX,ev.clientY-e.clientY)<5) return;
    if(!moved){ moved=true; svg.classList.add('show'); document.body.classList.add('clip-dragging'); }
    lines.forEach((l,k)=>{ l.setAttribute('x2',ev.clientX); l.setAttribute('y2',ev.clientY);
      const s=starts[k], ang=Math.atan2(ev.clientY-s.y,ev.clientX-s.x), Lh=starts.length>1?10:12, w=.5, x=ev.clientX, y=ev.clientY;
      heads[k].setAttribute('d',`M${x-Lh*Math.cos(ang-w)} ${y-Lh*Math.sin(ang-w)}L${x} ${y}L${x-Lh*Math.cos(ang+w)} ${y-Lh*Math.sin(ang+w)}`); });
    dot.setAttribute('cx',ev.clientX); dot.setAttribute('cy',ev.clientY);
    const el=document.elementFromPoint(ev.clientX,ev.clientY);
    const it=el?.closest?.('.item'), bl=el?.closest?.('.block.folder');
    if(it){ target={kind:'layer',id:+it.dataset.lid}; setHL(it); }
    else if(bl){ target={kind:'folder',id:+bl.dataset.bid}; setHL(bl); }
    else { target=null; setHL(null); }
  };
  const up=()=>{
    window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);
    svg.classList.remove('show'); document.body.classList.remove('clip-dragging'); setHL(null);
    lines.forEach(l=>l.remove()); heads.forEach(p=>p.remove());   // 끌기 선을 남기지 않음 (남으면 미리보기 때 좌상단에서 선이 그려짐)
    if(!moved){
      if(!(obj.clipTo && resolveRef(obj.clipTo))) return;
      const next=!obj.clipOn;
      if(group){  // 선택된 파츠 중 연결이 기억된 것 전부를 같은 상태로
        const targets=group.map(id=>{ const f=findL(id); return f.B.layers[f.i]; }).filter(L=>L.clipTo&&resolveRef(L.clipTo));
        targets.forEach(L=>L.clipOn=next); renderPanel(); render();
        toast(next?`파츠 ${targets.length}개를 다시 클리핑했어요`:`파츠 ${targets.length}개의 클리핑을 해제했어요 (연결은 기억해 둘게요)`);
        return;
      }
      obj.clipOn=next; renderPanel(); render(); toast(obj.clipOn?`다시 클리핑했어요 → ${refName(obj.clipTo)}`:'클리핑을 해제했어요 (연결은 기억해 둘게요)');
      return;
    }
    if(!target) return;
    const selfHit=group?(target.kind==='layer'&&group.includes(target.id)):(target.kind===src.kind&&target.id===src.id);
    if(selfHit){
      const objs=group?group.map(id=>{ const f=findL(id); return f.B.layers[f.i]; }):[obj];
      const n=objs.filter(o=>o.clipTo).length; objs.forEach(o=>{ o.clipTo=null; o.clipOn=false; });
      renderPanel(); render(); toast(n?(objs.length>1?`파츠 ${n}개의 클리핑 연결을 지웠어요`:'클리핑 연결을 지웠어요'):'지울 클리핑 연결이 없어요',1600); return;
    }
    if(group){
      let ok=0, why=null;
      for(const id of group){ const w=clipInvalid({kind:'layer',id},target); if(w){ why=why||w; continue; } const f=findL(id); const L=f.B.layers[f.i]; L.clipTo=target; L.clipOn=true; ok++; }
      renderPanel(); render();
      if(!ok){ toast(why); return; }
      toast(`파츠 ${ok}개를 '${refName(target)}'에 클리핑했어요`+(ok<group.length?` (${group.length-ok}개는 연결할 수 없어 제외)`:''),2600);
      return;
    }
    const why=clipInvalid(src,target); if(why){ toast(why); return; }
    obj.clipTo=target; obj.clipOn=true; renderPanel(); render();
    toast(`'${obj.name}' → '${refName(target)}'에 클리핑했어요`);
  };
  window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
}
function entityRef(r){ // 대상이 가진 클리핑 참조(켜진 것만)
  if(r.kind==='layer'){ const f=findL(r.id); if(!f) return null; return refOf(f.B.layers[f.i],f.B); }
  const B=blocks.find(b=>b.id===r.id); return B&&B.clipTo&&B.clipOn?B.clipTo:null;
}
function clipInvalid(src,t){
  const same=(a,b)=>a&&b&&a.kind===b.kind&&a.id===b.id;
  if(same(src,t)) return '자기 자신에게는 클리핑할 수 없어요.';
  if(src.kind==='layer'&&t.kind==='folder'&&findL(src.id).B.id===t.id) return '자기가 들어 있는 폴더에는 클리핑할 수 없어요.';
  if(src.kind==='folder'&&t.kind==='layer'&&findL(t.id).B.id===src.id) return '폴더 안의 파츠에는 폴더를 클리핑할 수 없어요.';
  let cur=t;
  for(let k=0;k<40&&cur;k++){
    if(same(cur,src)) return '서로를 클리핑하는 구조가 돼서 연결할 수 없어요.';
    if(src.kind==='folder'&&cur.kind==='layer'&&findL(cur.id)?.B.id===src.id) return '서로를 클리핑하는 구조가 돼서 연결할 수 없어요.';
    cur=entityRef(cur);
  }
  return null;
}

// ---- 패널 ----
// 가로세로 비율 표시: 딱 떨어지는 간단한 비율이면 그대로, 아니면 짧은 쪽을 1로 두고 소수 둘째 자리까지 올림
function ratioText(w,h){
  const g=(a,b)=>b?g(b,a%b):a, d=g(w,h), a=w/d, b=h/d;
  if(a<=20&&b<=20) return `${a}:${b}`;
  const up=v=>(Math.ceil(v*100-1e-9)/100).toFixed(2).replace(/\.?0+$/,'');
  return w<=h?`약 1:${up(h/w)}`:`약 ${up(w/h)}:1`;
}
const FOLDER_COLORS=[['빨강','#fbe3e1'],['노랑','#fbf3d3'],['파랑','#e1ecfb'],['보라','#eee5fa'],['검정','#e2e2e7'],['하양','#ffffff']];
const paleOf=hex=>{ const n=parseInt(hex.slice(1),16), mix=v=>Math.round(v+(255-v)*.8); return `rgb(${mix(n>>16&255)},${mix(n>>8&255)},${mix(n&255)})`; };
function renderPanel(){
  const box=$('blocks'); box.innerHTML=''; itemEls.clear();
  const org=mode==='org';
  for(const B of blocks){
    if(!org&&B.hideMake) continue;   // 숨긴 폴더·묶음은 스탠딩 만들기 모드에서 안 보임
    const el=document.createElement('div'); el.className='block '+B.type+(B.hideMake?' hidemake':''); el.dataset.bid=B.id;
    const head=document.createElement('div'); head.className='bhead';
    const grip=document.createElement('span'); grip.className='grip org-only'; grip.textContent='⋮⋮'; grip.title='눌러서 폴더 옮기기'; grip.draggable=false;
    if(org&&TOUCH.matches) grip.onclick=e=>{ e.stopPropagation(); touchMove=touchMove?.kind==='block'&&touchMove.id===B.id?null:{kind:'block',id:B.id}; picked.clear(); renderPanel(); };
    const nm=document.createElement('span'); nm.className='bname'; nm.textContent=B.type==='loose'?'폴더 미지정':B.name;
    const cnt=document.createElement('span'); cnt.className='bcount'; cnt.textContent=B.layers.length+'개';
    const top=document.createElement('div'); top.className='btop'; top.append(grip);
    if(B.type==='folder'&&B.hidden) el.classList.add('fhidden');
    if(B.type==='folder'){   // 분장실·스튜디오: 폴더의 빈 곳을 누르면 폴더 켜기/끄기
      head.title=B.hidden?'빈 곳을 눌러 폴더 켜기':'빈 곳을 눌러 폴더 끄기';
      el.addEventListener('click',e=>{
        // 세로 구분선 왼쪽(폴더 이름 칸)을 눌렀을 때만
        if(!e.target.closest('.bhead')&&!(e.target===el&&e.clientX<head.getBoundingClientRect().right)) return;
        if(suppressClick||touchMove) return;
        if(el._lp){ el._lp=false; return; }
        if(picked.size) return;   // 선택을 푸는 클릭이면 폴더는 그대로
        if(e.target.closest('.item,.icons-pop,button,input,label,.fchip,.clipH,.linkH,.bname,.rename,.bmark')) return;
        B.hidden=!B.hidden; renderPanel(); render(); toast(B.hidden?`'${B.name}' 폴더를 껐어요`:`'${B.name}' 폴더를 켰어요`,1000);
      });
    }
    top.append(nm); if(B.type==='folder'&&folderBlend(B)!=='norm') top.append(blendMark(folderBlend(B)==='pass'?'통과':(BLEND_NAME[folderBlend(B)]||folderBlend(B).trim()))); top.append(cnt);
    const ctrl=document.createElement('div'); ctrl.className='bctrl'; head.append(top,ctrl);
    if(B.type==='folder'){
      if(org){ nm.title='길게 눌러서 이름 변경'; longPress(nm,()=>{ el._lp=true; startRename(nm,B.name,v=>{B.name=v||B.name}); }); }
      const lab=document.createElement('label'); lab.className='chk make-only';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=B.multi;
      cb.onchange=()=>{ B.multi=cb.checked; B.multiSet=true; enforceSingle(B); renderPanel(); render(); };
      lab.append(cb,document.createTextNode('중복 허용')); lab.title='중복 체크 허용: 이 폴더에서 여러 파츠를 동시에 선택';
      ctrl.append(lab);
      // 폴더 색
      const chips=document.createElement('div'); chips.className='fcolors org-only';
      if(B.color==='#ffffff') B.color=null;   // 하양 = 색 없음(초기화)
      FOLDER_COLORS.forEach(([nm,col])=>{ const reset=col==='#ffffff';
        const c=document.createElement('span'); c.className='fchip'+((reset?!B.color:B.color===col)?' on':''); c.style.background=col; c.title=reset?'색 초기화':nm;
        c.onclick=e=>{ e.stopPropagation(); B.color=reset||B.color===col?null:col; renderPanel(); }; chips.appendChild(c); });
      const cc=document.createElement('label'); cc.className='fchip custom'+(B.color&&!FOLDER_COLORS.some(f=>f[1]===B.color)?' on':''); cc.title='컬러 지정';
      if(B.color&&viewMode!=='big'){ cc.style.background=B.color; cc.classList.add('on'); }
      const ci=document.createElement('input'); ci.type='color'; ci.value='#a0c4ff'; ci.oninput=()=>{ B.color=paleOf(ci.value); el.style.background=B.color; }; ci.onchange=()=>renderPanel(); ci.onclick=e=>e.stopPropagation();
      cc.appendChild(ci); chips.appendChild(cc);
      const inlineChips=viewMode!=='big'; if(!inlineChips) head.insertBefore(chips,ctrl);
      if(B.color) el.style.background=B.color;
      const fh=clipHandle(B,{kind:'folder',id:B.id});
      if(B.hidden){ const off=document.createElement('span'); off.className='foff'; off.innerHTML=EYE_SHUT; off.title='꺼진 폴더 (빈 곳을 누르면 켜기)'; ctrl.append(off); }
      if(inlineChips) ctrl.append(chips); ctrl.append(fh);
      if(B.clipTo&&B.clipOn&&resolveRef(B.clipTo)) el.classList.add('clipped');
    }
    const hb=document.createElement('button'); hb.className='hidebtn org-only'+(B.hideMake?' on':''); hb.innerHTML=HIDE_SVG;
    hb.title=B.hideMake?'숨김 해제':'스튜디오에서 숨기기';
    hb.onclick=e=>{ e.stopPropagation(); B.hideMake=!B.hideMake; renderPanel(); if(mode!=='org') render();
      const what=B.type==='folder'?'폴더가':'폴더 미지정 묶음이';
      toast(B.hideMake?`${what} 숨겨졌습니다. 스튜디오에서 보이지 않게 됩니다.`:`${what} 다시 보이게 됩니다.`,2200); };
    ctrl.appendChild(hb);
    if(B.type==='folder'){
      const x=document.createElement('button'); x.className='xbtn org-only'; x.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3.9 3.9l8.2 8.2M12.1 3.9l-8.2 8.2"/></svg>'; x.title='폴더 해제 (파츠는 폴더 미지정으로 이동)';
      x.onclick=async e=>{ e.stopPropagation(); if(!await ask(`'${B.name}' 폴더를 해제할까요?`)) return; if(B.hidden) B.layers.forEach(L=>L.on=false); const lostClip=!!B.clipTo; const i=blocks.indexOf(B); blocks.splice(i,1,{id:++uid,type:'loose',layers:B.layers}); normalize(); renderPanel(); render(); toast(`폴더 '${B.name}'를 해제했어요`+(lostClip?' · 폴더 클리핑은 지워졌어요':''),1800); };
      ctrl.appendChild(x);
    }
    if(org&&!TOUCH.matches){   // 세로선 왼쪽(머리 칸) 아무 곳이나 잡고 위아래로만 옮김
      head.classList.add('vgrab');
      head.addEventListener('pointerdown',e=>{
        if(e.button!==0||e.target.closest?.('button,input,label,.fchip,.clipH,.bmark,.rename')) return;
        const sy=e.pageY; let moving=false, target=null, before=true;
        try{ head.setPointerCapture(e.pointerId); }catch(_){}
        const others=[...document.querySelectorAll('#blocks .block')].filter(x=>x!==el);
        const mv=ev=>{
          const dy=ev.pageY-sy; if(!moving&&Math.abs(dy)<4) return;
          if(!moving){ moving=true; el.classList.add('vdrag'); document.body.classList.add('vdragging'); getSelection()?.removeAllRanges(); }
          el.style.transform=`translateY(${dy}px)`;
          if(ev.clientY<70) scrollBy(0,-12); else if(ev.clientY>innerHeight-40) scrollBy(0,12);
          clearDrops(); target=null;
          for(const o of others){ const r=o.getBoundingClientRect(); if(ev.clientY<r.top+r.height/2){ target=o; before=true; break; } }
          if(!target&&others.length){ target=others[others.length-1]; before=false; }
          target?.classList.add(before?'drop-before':'drop-after');
        };
        const up=ev=>{
          removeEventListener('pointermove',mv); removeEventListener('pointerup',up); removeEventListener('pointercancel',up);
          if(!moving) return;
          el.style.transform=''; el.classList.remove('vdrag'); document.body.classList.remove('vdragging'); clearDrops();
          suppressClick=true; setTimeout(()=>suppressClick=false,0);
          if(target&&ev.type==='pointerup') moveBlock(B.id,+target.dataset.bid,before);
        };
        addEventListener('pointermove',mv); addEventListener('pointerup',up); addEventListener('pointercancel',up);
      });
    }

    const items=document.createElement('div'); items.className='items '+viewMode;
    if(!B.layers.length){ const em=document.createElement('div'); em.className='empty'; em.textContent='여기로 파츠를 끌어다 놓으세요'; items.appendChild(em); }
    for(const L of B.layers){
      const it=document.createElement('div'); it.className='item'+(isOn(L)?' on':'')+(picked.has(L.id)?' picked':''); it.draggable=org&&!TOUCH.matches; it.title=L.name; it.dataset.lid=L.id;
      const mk=document.createElement('span'); mk.className='mark '+(org?'eye':(B.type==='folder'&&!B.multi?'radio':'box'));
      if(org){ mk.innerHTML=EYE_OPEN+EYE_SHUT; mk.title='켜기/끄기'; mk.onclick=e=>{ e.stopPropagation(); if(TOUCH.matches) return it.onclick(e); orgToggle(B,L); }; }
      else { mk.onclick=e=>{ e.stopPropagation(); if(picked.has(L.id)&&picked.size>1) makeBatchToggle(L); else toggle(B,L); }; }
      if(!org) it.appendChild(mk);   // 분장실: 꺼짐 표시(감은 눈) 없음 · 켜진 파츠만 진하게
      if(viewMode!=='name'){ if(!L.thumb) L.thumb=thumbURL(L.node); const img=new Image(); img.src=L.thumb; img.alt=''; img.draggable=false; it.appendChild(img); }
      const ln=document.createElement('span'); ln.className='lname'; ln.textContent=L.name;
      const lrow=document.createElement('span'); lrow.className='lrow'; lrow.appendChild(ln);
      if(blendOf(L)!=='norm') lrow.appendChild(blendMark(BLEND_NAME[blendOf(L)]||blendOf(L).trim()));
      it.appendChild(lrow);
      const lh=linkHandle(L), ch=clipHandle(L,{kind:'layer',id:L.id});
      if(viewMode==='big'){ it.append(lh,ch); }
      else {   // 이름만·작게: 설정된 아이콘은 이름 뒤에, 안 쓴 아이콘은 커서를 올렸을 때만 이름 위에 잠깐
        const set=document.createElement('span'); set.className='icons-set';
        const pop=document.createElement('span'); pop.className='icons-pop org-only';
        (ch.classList.contains('set')?set:pop).appendChild(ch);
        (lh.classList.contains('set')?set:pop).prepend(lh);
        if(lh.classList.contains('set')&&!ch.classList.contains('set')) pop.appendChild(ch);
        if(set.children.length) it.appendChild(set);
        if(pop.children.length) lrow.appendChild(pop);
      }
      if(L.link) it.classList.add('linked');
      if(L.clipTo&&L.clipOn&&resolveRef(L.clipTo)) it.classList.add('clipped');
      it.onclick=e=>{
        if(it.querySelector('input')) return;
        if(it._lp){ it._lp=false; return; }   // 길게 눌러 이름 편집을 연 직후의 클릭은 무시
        if(org&&viewMode!=='name'&&e.target.closest?.('.lname')) return;   // 분장실: 켜고 끄기는 그림을 눌러서 (이름 칸은 이름 편집용)
        if(org){
          if(TOUCH.matches){ picked.has(L.id)?picked.delete(L.id):picked.add(L.id); lastPick=L.id; refreshPicked(); }
          else if(e.ctrlKey||e.metaKey||e.shiftKey) pick(e,B,L);
          else orgToggle(B,L);   // 분장실: 파츠 아무 곳이나 누르면 켜기/끄기
        }
        else if(e.ctrlKey||e.metaKey||e.shiftKey){ if(canPick(L.id)) pick(e,B,L); else toast("여러 개 선택은 '중복 허용' 폴더에서만 돼요",1600); }
        else if(picked.has(L.id)&&picked.size>1) makeBatchToggle(L);   // 선택한 파츠 중 하나를 누르면 함께 켜고 끄기
        else { if(picked.size){ picked.clear(); refreshPicked(); } toggle(B,L); }
      };
      if(org) longPress(ln,()=>{ it._lp=true; startRename(ln,L.name,v=>{L.name=v||L.name}); });
      it.ondragstart=e=>{
        if(e.target.closest?.('.clipH,.linkH')){ e.preventDefault(); return; }
        if(!picked.has(L.id)){ picked=new Set([L.id]); lastPick=L.id; refreshPicked(); }
        const ids=allLayers().filter(x=>picked.has(x.id)).map(x=>x.id);
        dragData={kind:'layer',ids}; e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain','');
        if(ids.length>1){ const g=$('dragGhost'); g.textContent=`파츠 ${ids.length}개`; try{e.dataTransfer.setDragImage(g,10,10)}catch(_){} }
        ids.forEach(id=>itemEls.get(id)?.classList.add('dragging')); e.stopPropagation();
      };
      it.ondragend=()=>{ clearMarks(); dragData=null; };
      it.ondragover=e=>{ if(dragData?.kind!=='layer') return; e.preventDefault(); e.stopPropagation(); const r=it.getBoundingClientRect(); clearDrops(); if(!dragData.ids.includes(L.id)) it.classList.add(e.clientX<r.left+r.width/2?'drop-before':'drop-after'); };
      it.ondrop=e=>{ if(dragData?.kind!=='layer') return; e.preventDefault(); e.stopPropagation(); const r=it.getBoundingClientRect(); moveLayers(dragData.ids,B,L.id,e.clientX<r.left+r.width/2); };
      itemEls.set(L.id,it); items.appendChild(it);
    }
    items.ondragover=e=>{ if(dragData?.kind!=='layer') return; e.preventDefault(); e.stopPropagation(); clearDrops(); items.classList.add('drop-in'); };
    items.ondragleave=()=>items.classList.remove('drop-in');
    items.ondrop=e=>{ if(dragData?.kind!=='layer') return; e.preventDefault(); e.stopPropagation(); moveLayers(dragData.ids,B,null,false); };
    el.addEventListener('click',e=>{ if(!touchMove) return; e.stopPropagation(); e.preventDefault(); touchPlace(B,e.target.closest?.('.item')); },true);
    if(touchMove?.kind==='block'&&touchMove.id===B.id) el.classList.add('moving');
    el.append(head,items); box.appendChild(el);
  }
  const folders=blocks.filter(b=>b.type==='folder').length, layers=blocks.reduce((n,b)=>n+b.layers.length,0);
  $('metaCount').textContent=`폴더 ${folders} · 파츠 ${layers}`; updateMetaSize(); refreshLinkDim(); refreshPicked();
}
function refreshStates(){ for(const B of blocks) for(const L of B.layers){ const it=itemEls.get(L.id); if(it) it.classList.toggle('on',isOn(L)); } refreshLinkDim(); }
// 스탠딩 모드에서는 '중복 허용' 폴더(과 폴더 미지정)의 파츠만 여러 개 선택 가능
const canPick=id=>{ if(mode==='org') return true; const f=findL(id); return !!f&&(f.B.type!=='folder'||f.B.multi); };
function refreshPicked(){ for(const [id,it] of itemEls){ it.classList.toggle('picked',picked.has(id)); } updateTouchBar(); }
// ---- 터치 화면용 이동: 선택 → '옮기기' → 놓을 곳 누르기 ----
const TOUCH=matchMedia('(hover:none) and (pointer:coarse)');
let touchMove=null;   // {kind:'block',id} — 폴더를 ⋮⋮로 옮길 때
function touchPlace(B,itEl){
  const tm=touchMove; touchMove=null;
  {
    if(tm.id===B.id){ renderPanel(); return; }
    moveBlock(tm.id,B.id,true); toast('폴더를 옮겼어요',1200);
  }
}
// 선택한 파츠를 같은 폴더 안에서 한 칸씩 (여러 개면 각자 한 칸, 끝에 닿으면 그대로)
function nudgePicked(dir){
  let moved=false;
  for(const B of blocks){
    const Ls=B.layers, n=Ls.length;
    for(let k=0;k<n;k++){
      const i=dir<0?k:n-1-k, j=i+dir;
      if(j<0||j>=n||!picked.has(Ls[i].id)||picked.has(Ls[j].id)) continue;
      [Ls[i],Ls[j]]=[Ls[j],Ls[i]]; moved=true;
    }
  }
  if(!moved){ toast(dir<0?'이미 맨 앞이에요':'이미 맨 뒤예요',1000); return; }
  renderPanel(); render();
  const el=itemEls.get([...picked][0]); el?.scrollIntoView({block:'nearest',inline:'nearest'});
}
// 선택한 파츠를 바로 위/아래 묶음(폴더 또는 폴더 미지정)의 맨 뒤로
function hopPicked(dir){
  const plan=[];
  blocks.forEach((B,i)=>{ const ids=B.layers.filter(L=>picked.has(L.id)).map(L=>L.id); const T=blocks[i+dir]; if(ids.length&&T) plan.push([ids,T]); });
  if(!plan.length){ toast(dir<0?'이미 맨 위 묶음이에요':'이미 맨 아래 묶음이에요',1000); return; }
  for(const [ids,T] of plan){
    const moving=[]; for(const B of blocks) B.layers=B.layers.filter(L=>{ if(ids.includes(L.id)){ moving.push(L); return false; } return true; });
    T.layers.push(...moving); afterMoveInto(T);
  }
  normalize(); renderPanel(); render();
  const T=plan[0][1]; toast(`'${T.type==='folder'?T.name:'폴더 미지정'}' 맨 뒤로 옮겼어요`,1200);
  itemEls.get([...picked][0])?.scrollIntoView({block:'nearest'});
}
function updateTouchBar(){
  let bar=$('touchBar');
  const show=TOUCH.matches&&mode==='org'&&doc&&(touchMove||picked.size);
  document.body.classList.toggle('touch-moving',!!touchMove);
  document.body.classList.toggle('has-touchbar',!!(TOUCH.matches&&mode==='org'&&doc&&(touchMove||picked.size)));
  if(!show){ bar?.remove(); return; }
  if(!bar){ bar=document.createElement('div'); bar.id='touchBar'; document.body.appendChild(bar); }
  bar.innerHTML='';
  const txt=document.createElement('div'); txt.className='tb-txt';
  const btn=(label,cls,fn)=>{ const b=document.createElement('button'); b.className='btn '+cls; b.textContent=label; b.onclick=e=>{ e.stopPropagation(); fn(); }; return b; };
  if(!touchMove){
    txt.textContent=`파츠 ${picked.size}개 선택`;
    const ps=allLayers().filter(x=>picked.has(x.id)), allOn=ps.every(x=>x.on);
    const eb=btn('','nudge eyebtn',()=>{ const next=!allOn; ps.forEach(x=>x.on=next); refreshStates(); render(); updateTouchBar(); toast(`파츠 ${ps.length}개를 ${next?'켰어요':'껐어요'}`,1000); });
    eb.innerHTML=`<span class="dotk${allOn?'':' off'}"></span>`; eb.title=allOn?'끄기':'켜기';
    bar.append(txt,eb,btn('◀','nudge',()=>nudgePicked(-1)),btn('▶','nudge',()=>nudgePicked(1)),btn('▲','nudge',()=>hopPicked(-1)),btn('▼','nudge',()=>hopPicked(1)),btn('해제','',()=>{ picked.clear(); refreshPicked(); }));
  } else {
    const B=blocks.find(b=>b.id===touchMove.id);
    const bb=document.createElement('b'); bb.textContent=`'${B?.type==='folder'?B.name:'폴더 미지정'}' 옮기는 중`;
    txt.append(bb,document.createElement('br'),document.createTextNode('놓을 폴더를 누르면 그 위로 들어가요.'));
    bar.append(txt,btn('맨 아래로','',()=>{ const id=touchMove.id; touchMove=null; const i=blocks.findIndex(b=>b.id===id); const [X]=blocks.splice(i,1); blocks.push(X); normalize(); renderPanel(); render(); toast('맨 아래로 옮겼어요',1200); }),
      btn('취소','',()=>{ touchMove=null; renderPanel(); }));
  }
}
function pick(e,B,L){
  if(e.shiftKey){
    // Shift: 같은 폴더 안에서만 범위 선택. 다른 폴더의 파츠는 선택하지 않음
    const f=lastPick!=null?findL(lastPick):null;
    if(!f){ picked=new Set([L.id]); lastPick=L.id; refreshPicked(); return; }
    if(f.B!==B){ toast('Shift 범위 선택은 같은 폴더 안에서만 돼요',1600); return; }
    const a=f.i, b=B.layers.indexOf(L); const [s,t]=a<b?[a,b]:[b,a];
    for(let k=s;k<=t;k++) picked.add(B.layers[k].id);
    refreshPicked(); return;   // 기준점(lastPick)은 그대로 유지
  }
  if(e.metaKey||e.ctrlKey){ picked.has(L.id)?picked.delete(L.id):picked.add(L.id); }
  else picked=new Set([L.id]);
  lastPick=L.id; refreshPicked();
}
// ---- 빈 곳 드래그 → 네모 선택 ----
let marq=null, suppressClick=false;
const rightPane=document.querySelector('.right');
rightPane.addEventListener('pointerdown',e=>{
  if(e.button!==0||!doc||e.pointerType==='touch'||e.pointerType==='pen') return;
  if(e.target.closest('.item,.clipH,.grip,.bhead,button,input,label,.rename,.seg,.ph-row')) return;
  e.preventDefault();
  document.querySelectorAll('.marquee').forEach(x=>x.remove());   // 이전에 끝나지 못한 네모 정리
  getSelection()?.removeAllRanges();
  const add=e.ctrlKey||e.metaKey||e.shiftKey;
  const box=document.createElement('div'); box.className='marquee'; document.body.appendChild(box);
  marq={x0:e.pageX,y0:e.pageY,base:add?new Set(picked):new Set(),box,moved:false};
  const move=ev=>{
    const m=marq; if(!m) return;
    if(!m.moved && Math.hypot(ev.pageX-m.x0,ev.pageY-m.y0)<4) return;
    if(!m.moved){ try{ rightPane.setPointerCapture(ev.pointerId); }catch(_){} }   // 끌기 시작한 뒤에만 붙잡음 (그냥 클릭은 원래 자리로 가게)
    m.moved=true;
    if(ev.clientY>innerHeight-36) scrollBy(0,14); else if(ev.clientY<90) scrollBy(0,-14);
    const x1=Math.min(m.x0,ev.pageX), y1=Math.min(m.y0,ev.pageY), x2=Math.max(m.x0,ev.pageX), y2=Math.max(m.y0,ev.pageY);
    Object.assign(m.box.style,{left:x1+'px',top:y1+'px',width:(x2-x1)+'px',height:(y2-y1)+'px',display:'block'});
    const next=new Set(m.base);
    for(const [id,it] of itemEls){ const r=it.getBoundingClientRect(); const L=r.left+scrollX, T=r.top+scrollY;
      if(L<x2 && L+r.width>x1 && T<y2 && T+r.height>y1 && canPick(id)) next.add(id); }
    picked=next; refreshPicked();
  };
  const up=()=>{
    window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up);
    window.removeEventListener('pointercancel',up); rightPane.removeEventListener('lostpointercapture',up);
    if(marq){ marq.box.remove(); if(marq.moved){ suppressClick=true; setTimeout(()=>suppressClick=false,0); const ids=[...picked]; if(ids.length){ lastPick=ids[ids.length-1]; toast(`파츠 ${ids.length}개 선택`,1000);} } }
    marq=null;
  };
  window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',up); rightPane.addEventListener('lostpointercapture',up);
});
rightPane.addEventListener('mousedown',e=>{ if(marq) e.preventDefault(); });   // 영역 선택 중엔 글자 선택·끌기 막기
// 스탠딩 모드 일괄 켜고 끄기 (중복 허용 폴더만)
function makeBatchToggle(L){
  const next=!L.on; const ids=allLayers().filter(x=>picked.has(x.id)&&canPick(x.id));
  ids.forEach(x=>x.on=next); ids.forEach(x=>linkSync(x)); if(next) wakeFolders(ids); refreshStates(); render();
  toast(`파츠 ${ids.length}개를 ${next?'켰어요':'껐어요'}`,1400);
}
// 정리 모드: 좌상단 네모로 켜고 끄기. 선택된 파츠 중 하나면 선택 전체에 같은 상태 적용
// 꺼진 폴더 안의 파츠를 켜면 그 폴더도 같이 켬 (켜도 그림이 안 바뀌는 혼란 방지)
function wakeFolders(Ls){ const w=new Set(); for(const L of Ls){ const f=findL(L.id); if(L.on&&f?.B.type==='folder'&&f.B.hidden){ f.B.hidden=false; w.add(f.B); } } if(w.size){ renderPanel(); toast(`꺼져 있던 ${[...w].map(B=>`'${B.name}'`).join(', ')} 폴더를 켰어요`,1600); } }
function orgToggle(B,L){
  const next=!L.on;
  const batch=picked.has(L.id)&&picked.size>1;
  const ids=batch?allLayers().filter(x=>picked.has(x.id)).map(x=>x.id):[L.id];
  if(!batch&&picked.size){ picked.clear(); refreshPicked(); }
  for(const id of ids){
    const f=findL(id); const X=f.B.layers[f.i];
    X.on=next;   // 정리 모드에서는 한 폴더에 여러 개를 켜도 됨
  }
  if(next) wakeFolders(ids.map(id=>{ const f=findL(id); return f.B.layers[f.i]; }));
  refreshStates(); render();
  if(ids.length>1) toast(`파츠 ${ids.length}개를 ${next?'켰어요':'껐어요'}`,1400);
}
function toggle(B,L){
  if(B.type==='folder'&&!B.multi){
    const was=L.on, prev=B.layers.filter(x=>x.on&&x!==L);
    B.layers.forEach(x=>x.on=false); L.on=!was;
    prev.forEach(x=>linkSync(x));   // 다른 파츠를 골라 꺼진 중심 파츠도 같은 그룹을 함께 끔
  }
  else L.on=!L.on;
  linkSync(L);
  wakeFolders([L]);
  refreshStates(); render();
}
// 길게 누르기(약 0.5초): 움직이거나 일찍 떼면 취소
function longPress(el,fn){
  el.title=el.title||'길게 눌러서 이름 바꾸기';
  el.addEventListener('pointerdown',e=>{
    if(e.button>0) return;
    const x0=e.clientX,y0=e.clientY; let tm=setTimeout(()=>{ tm=0; cleanup(); fn(); },500);
    const mv=ev=>{ if(Math.hypot(ev.clientX-x0,ev.clientY-y0)>6) stop(); };
    const stop=()=>{ if(tm){ clearTimeout(tm); tm=0; } cleanup(); };
    const cleanup=()=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',stop); removeEventListener('pointercancel',stop); el.removeEventListener('dragstart',stop); };
    addEventListener('pointermove',mv); addEventListener('pointerup',stop); addEventListener('pointercancel',stop); el.addEventListener('dragstart',stop);
  });
  el.addEventListener('contextmenu',e=>e.preventDefault());
}
function startRename(span,cur,commit){
  const inp=document.createElement('input'); inp.className='rename'; inp.value=cur;
  span.textContent=''; span.appendChild(inp); inp.focus(); inp.select();
  let done=false; const fin=ok=>{ if(done) return; done=true; if(ok) commit(inp.value.trim()); renderPanel(); };
  inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); fin(true);} if(e.key==='Escape') fin(false); };
  inp.onblur=()=>fin(true); inp.onclick=e=>e.stopPropagation(); inp.ondblclick=e=>e.stopPropagation();
  inp.onmousedown=e=>e.stopPropagation(); inp.closest('.item')?.setAttribute('draggable','false');
}
function findL(id){ for(const B of blocks){ const i=B.layers.findIndex(l=>l.id===id); if(i>=0) return {B,i}; } }
function moveLayers(ids,T,targetId,before){
  clearMarks(); if(targetId!=null && ids.includes(targetId)) return;
  const moving=[];
  for(const B of blocks) B.layers=B.layers.filter(L=>{ if(ids.includes(L.id)){ moving.push(L); return false; } return true; });
  let idx=T.layers.length;
  if(targetId!=null){ const t=T.layers.findIndex(x=>x.id===targetId); if(t>=0) idx=before?t:t+1; }
  T.layers.splice(idx,0,...moving);
  afterMoveInto(T);
  normalize(); renderPanel(); render();
  if(moving.length>1) toast(`파츠 ${moving.length}개를 옮겼어요`,1400);
}
function moveBlock(bid,targetBid,before){
  clearMarks(); if(bid===targetBid) return;
  const i=blocks.findIndex(b=>b.id===bid); const [B]=blocks.splice(i,1);
  let t=blocks.findIndex(b=>b.id===targetBid); if(!before) t++;
  blocks.splice(t,0,B); normalize(); renderPanel(); render();
}
// 분장실 → 스튜디오: 폴더 안 켜진 파츠가 1개면 중복 허용 해제, 2개 이상이면 설정 (0개면 그대로)
function autoMulti(){
  for(const B of blocks){ if(B.type!=='folder'||B.multiSet) continue;   // 스튜디오에서 직접 정한 '중복 허용'은 그대로
    const n=B.layers.filter(L=>L.on).length; if(n===1) B.multi=false; else if(n>1) B.multi=true; }
  ensureMultiForLinks(); blocks.forEach(enforceSingle);
}
function setMode(m){
  if(m==='make'&&mode==='org') autoMulti();
  mode=m; document.body.classList.toggle('mode-org',m==='org'); document.body.classList.toggle('mode-make',m==='make');
  const mb=$('modeBtn'); mb.querySelector('.mb-name').textContent=m==='org'?'분장실':'스튜디오';
  $('modeDesc').textContent=m==='org'?'파츠를 정리하자':'사진을 찍어보자';
  if($('tip')?.classList.contains('show')&&mb.matches(':hover')) showTip(mb,m==='org'?'스튜디오로 이동':'분장실로 이동');
  picked.clear(); touchMove=null; if(doc){ renderPanel(); render(); requestAnimationFrame(layoutPreview); } updateTouchBar();
}
$('modeBtn').onclick=e=>{ e.currentTarget.blur(); hideTip(); setMode(mode==='org'?'make':'org'); };
$('modeBtn').onpointerenter=e=>{ if(e.pointerType!=='touch') showTip(e.currentTarget,mode==='org'?'스튜디오로 이동':'분장실로 이동'); };
$('modeBtn').onpointerleave=hideTip;
// 스페이스바: 커서를 올린 파츠를 누른 것과 같음 (Ctrl/⌘·Shift와 함께 누르면 선택/선택 해제)
let hoverLid=null;
$('blocks').addEventListener('pointerover',e=>{ const it=e.target.closest?.('.item'); hoverLid=it?+it.dataset.lid:null; });
$('blocks').addEventListener('pointerleave',()=>{ hoverLid=null; });
document.addEventListener('keydown',e=>{
  if(e.code!=='Space'||e.isComposing||!doc||hoverLid==null||anyModalOpen()) return;
  if(e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  const it=itemEls.get(hoverLid); if(!it||!it.isConnected) return;
  e.preventDefault(); if(e.repeat) return;
  it.onclick(e);
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&picked.size){ picked.clear(); refreshPicked(); } });
document.addEventListener('keydown',e=>{   // 분장실: Ctrl/⌘+A로 모든 레이어 선택
  if(!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='a'||!doc||anyModalOpen()) return;
  if(e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  e.preventDefault();
  picked=new Set(allLayers().filter(L=>mode==='org'||canPick(L.id)).map(L=>L.id)); refreshPicked();
  toast(picked.size?(mode==='org'?`파츠 ${picked.size}개를 모두 선택했어요`:`중복 허용 폴더의 파츠 ${picked.size}개를 선택했어요`):'선택할 수 있는 파츠가 없어요 (중복 허용 폴더만 가능)',1200);
});
// 일괄 선택 후 파츠가 아닌 아무 곳이나 누르면 선택 해제
document.addEventListener('click',e=>{
  if(!picked.size||suppressClick||e.metaKey||e.ctrlKey||e.shiftKey) return;
  if(e.target.closest?.('.item,#touchBar,#linkPop,.icons-pop,.overlay,.hmodal,#tip,#randPop')) return;
  picked.clear(); refreshPicked();
});
$('blocks').addEventListener('click',e=>{ if(suppressClick) return; if(!e.target.closest('.item') && !e.metaKey && !e.ctrlKey && !e.shiftKey && picked.size){ picked.clear(); refreshPicked(); } });

// ---- 레이어 이름 정리: 기본 이름만 폴더별로 1, 2, 3… ----
const DEFAULT_NAME=/^\s*(레이어|layer|レイヤー|图层|圖層|새 레이어|new layer)?\s*\d*(\s*(복사본?|copy|のコピー|副本|사본)\s*\d*)*\s*$/i;
const DEFAULT_FOLDER=/^\s*(새\s*)?(폴더|그룹|folder|group|new folder|new group|フォルダー?|グループ|组|組|文件夹|图层组|圖層組)\s*\d*(\s*(복사본?|copy|のコピー|副本|사본)\s*\d*)*\s*$/i;
const isDefaultName=n=>!n||!n.trim()||(/\D/.test(n.trim())&&(DEFAULT_NAME.test(n)||DEFAULT_FOLDER.test(n)));
$('btnTidyNames').onclick=e=>{
  e.currentTarget.blur(); let n=0;
  // 기본 이름('레이어 9')과 숫자뿐인 이름('7')은 놓인 순서(왼쪽부터) 그대로 1, 2, 3…으로 다시 매김
  const renum=s=>isDefaultName(s)||/^\s*\d+\s*$/.test(s||'');
  for(const B of blocks){
    let k=0;
    for(const L of B.layers){ if(!renum(L.name)) continue; const v=String(++k); if(L.name!==v){ L.name=v; n++; } }
  }
  if(!n){ toast('정리할 이름(레이어 0, 숫자 이름 등)이 없거나 이미 정리돼 있어요'); return; }
  renderPanel(); toast(`파츠 ${n}개의 이름을 정리했어요`);
};
$('btnNewFolder').onclick=()=>{
  const B={id:++uid,type:'folder',name:'새 폴더',multi:false,randomOn:true,layers:[],gblend:'norm',gop:1};   // 새 폴더는 표준
  blocks.unshift(B); renderPanel();
  const nm=document.querySelector('#blocks .block .bname'); startRename(nm,B.name,v=>{B.name=v||B.name});
};
let namesHidden=false;
$('chkNames').onchange=e=>{ namesHidden=!e.currentTarget.checked; document.body.classList.toggle('hide-names',namesHidden); };
document.body.dataset.view=viewMode;
document.querySelectorAll('#viewSeg button').forEach(x=>x.classList.toggle('on',x.dataset.mode===viewMode));
function syncNameBtn(){ const off=viewMode==='name'; $('chkNames').disabled=off; $('nameChkLab').classList.toggle('disabled',off); }
document.querySelectorAll('#viewSeg button').forEach(b=>b.onclick=()=>{
  viewMode=b.dataset.mode; document.body.dataset.view=viewMode; document.querySelectorAll('#viewSeg button').forEach(x=>x.classList.toggle('on',x===b)); syncNameBtn(); renderPanel();
});

// ================= 랜덤 =================
const pop=$('randPop');
function buildRandList(){
  const list=$('randList'); list.innerHTML='';
  const fs=blocks.filter(b=>b.type==='folder'&&b.layers.length&&!b.hideMake&&!b.hidden);
  if(!fs.length){ list.innerHTML='<div style="color:var(--sub);font-size:12.5px;padding:6px">선택된 폴더가 없습니다.</div>'; return; }
  for(const B of fs){
    const lab=document.createElement('label'); const cb=document.createElement('input'); cb.type='checkbox'; cb.checked=B.randomOn;
    cb.onchange=()=>B.randomOn=cb.checked;
    const c=document.createElement('span'); c.className='c'; c.textContent=(B.multi?'중복 · ':'')+B.layers.length+'개';
    lab.append(cb,document.createTextNode(B.name),c); list.appendChild(lab);
  }
}
function fitRandPop(){   // 화면 밖으로 나가지 않게 가로 위치 보정
  pop.style.transform=''; if(!pop.classList.contains('show')) return;
  const r=pop.getBoundingClientRect(), W=document.documentElement.clientWidth; let dx=0;
  if(r.left<8) dx=8-r.left; else if(r.right>W-8) dx=W-8-r.right;
  pop.style.maxWidth=(W-16)+'px'; if(dx) pop.style.transform=`translateX(${Math.round(dx)}px)`;
}
$('btnRandom').onclick=e=>{ e.stopPropagation(); e.currentTarget.blur(); if(pop.classList.toggle('show')){ buildRandList(); fitRandPop(); } };
addEventListener('resize',rafOnce(fitRandPop));
pop.onclick=e=>e.stopPropagation();
document.addEventListener('click',()=>pop.classList.remove('show'));
$('randAll').onclick=()=>{ blocks.forEach(b=>b.randomOn=true); buildRandList(); };
$('randNone').onclick=()=>{ blocks.forEach(b=>b.randomOn=false); buildRandList(); };
$('randGo').onclick=e=>{
  e.currentTarget.blur();
  const fs=blocks.filter(b=>b.type==='folder'&&b.layers.length&&b.randomOn&&!b.hideMake&&!b.hidden);
  if(!fs.length){ toast('랜덤에 포함할 폴더를 골라 주세요.'); return; }
  // 랜덤에서 빠진 폴더에 있는 중심 파츠가 그 그룹의 켜짐/꺼짐을 정함 → 포함된 폴더는 거기에 맞춰 고름
  const inc0=new Set(fs), fixed=new Map();
  for(const B of blocks) if(!inc0.has(B)) for(const L of B.layers) if(L.link?.role==='main'){
    const v=fixed.get(L.link.g); fixed.set(L.link.g, v===undefined?L.on:(v===L.on?v:null));
  }
  const fx=L=>L.link?.role==='main'?fixed.get(L.link.g):undefined;   // true/false: 정해짐, 그 밖: 자유
  // 꼭 켜야 하는 중심 파츠가 있는 '하나만 고르는 폴더'의 다른 그룹은 켤 수 없음 → 꺼짐으로 정함 (더 바뀌지 않을 때까지)
  for(let ch=true;ch;){ ch=false;
    for(const B of fs) if(!B.multi&&B.layers.some(L=>fx(L)===true))
      for(const L of B.layers) if(L.link?.role==='main'&&fx(L)===undefined){ fixed.set(L.link.g,false); ch=true; }
  }
  const pickOne=a=>a[Math.floor(Math.random()*a.length)];
  for(const B of fs){
    if(B.multi){
      B.layers.forEach(L=>{ const f=fx(L); L.on=f===true?true:f===false?false:Math.random()<.5; });
      if(!B.layers.some(L=>L.on)){ const ok=B.layers.filter(L=>fx(L)!==false); if(ok.length) pickOne(ok).on=true; }
    } else {
      const must=B.layers.filter(L=>fx(L)===true), ok=B.layers.filter(L=>fx(L)!==false);
      const k=must.length?pickOne(must):ok.length?pickOne(ok):null;   // 고를 수 있는 게 없으면 모두 끔
      B.layers.forEach(L=>L.on=L===k);
    }
  }
  const inc=new Set(fs); fs.flatMap(B=>B.layers).filter(L=>L.on).forEach(L=>linkSync(L,inc));
  refreshStates(); render();
};
$('btnReset').onclick=async e=>{ e.currentTarget.blur(); if(!await ask('처음 설정으로 돌아가겠습니까?')) return; blocks.forEach(B=>{ B.layers.forEach(L=>L.on=L.def); if(B.type==='folder') B.hidden=!!B.defHidden; enforceSingle(B); }); renderPanel(); render(); };

// ================= 저장 =================
let downloads=null, enterMode=false, saving=false;
(async()=>{ try{ if(window.claude?.use) downloads=await window.claude.use('downloads'); }catch(e){} })();
const baseName=()=>(doc?.name||'portrait').replace(/\.[^.]+$/,'');
function cropCanvas(src,r){ const c=mkCanvas(Math.round(r.w),Math.round(r.h)); c.getContext('2d').drawImage(src,r.x,r.y,r.w,r.h,0,0,c.width,c.height); return c; }
function exportCanvas(){ return scope==='zoom'?cropCanvas(comp,region):comp; }
const toBlob=c=>new Promise(r=>c.toBlob(r,'image/png'));
// 파일 저장: Claude 화면에서는 downloads, 그 밖에서는 일반 다운로드
async function saveFile(fname,blob){
  if(downloads){
    try{ await downloads.save({filename:fname,data:blob}); return 'saved'; }
    catch(e){
      if(e?.code==='declined'){ toast('저장을 취소했어요.'); return 'declined'; }
      if(e?.code==='rate_limited'){ toast('저장 확인 창이 열려 있어요. 잠시 후 다시 눌러 주세요.'); return 'busy'; }
    }
  }
  return 'fallback';
}
const regionOut=()=>doc&&(region.x<-0.5||region.y<-0.5||region.x+region.w>doc.width+0.5||region.y+region.h>doc.height+0.5);
const OUT_MSG='확대 영역이 그림 밖으로 나가 있어요. 바깥 부분은 투명하게 저장돼요.';
async function savePNG(){
  if(!doc||saving) return;
  if(isDemo()){ notice(DEMO_NOSAVE); return; }
  saving=true;
  if(scope!=='full'&&regionOut()) toast(OUT_MSG,2600);
  try{
    const jobs=scope==='both'?[['',comp],['_확대',cropCanvas(comp,region)]]:[[scope==='zoom'?'_확대':'',exportCanvas()]];
    for(const [suf,c] of jobs){
      const blob=await toBlob(c); if(!blob){ toast('이미지를 만들지 못했어요.'); return; }
      const r=await saveFile(`${baseName()}${suf}.png`,blob);
      if(r==='declined'||r==='busy') return;
      if(r==='fallback'){ downloadBlob(blob,`${baseName()}${suf}.png`); continue; }
    }
    toast(jobs.length>1?'전체 이미지와 확대 영역을 저장했어요':'저장했어요');
  } finally { saving=false; }
}
$('btnSave').onclick=e=>{ e.currentTarget.blur(); savePNG(); };
$('imgDlgClose').onclick=()=>closeOverlay('imgDlg');

// ================= Enter 연속 저장: 상태 기억 → 한 번에 확인 → zip =================
let snaps=[];            // {on:Set<layerId>, region:{...}, scope:'full'|'zoom'|'both', name:''}
function downloadBlob(blob,name){   // 대체 저장: 링크로 내려받고 잠시 뒤 메모리 해제
  const u=URL.createObjectURL(blob), l=document.createElement('a'); l.href=u; l.download=name; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(()=>URL.revokeObjectURL(u),30000);
}
function allLayers(){ return blocks.flatMap(B=>B.layers); }
// 기억한 조합은 찍은 순간의 그림 그대로 (나중에 폴더·클리핑 등을 바꿔도 변하지 않음)
async function snapImage(snap,cropped){
  await snap.ready; if(!snap.full) throw new Error('기억한 그림을 읽지 못했어요.');
  const bmp=await createImageBitmap(snap.full); const c=mkCanvas(bmp.width,bmp.height); c.getContext('2d').drawImage(bmp,0,0); bmp.close?.();
  return cropped?cropCanvas(c,snap.region):c;
}
// 기억한 그림이 차지하는 메모리가 많아지면 한 번 안내
let memWarnAt=0;
function snapBytes(){ return snaps.reduce((n,s)=>n+(s.bytes||0),0); }
function checkSnapMem(){
  const dm=navigator.deviceMemory||4;   // GB (모르는 브라우저는 4로 가정)
  const limit=Math.min(1.5*1024**3,dm*1024**3*.2);
  const used=snapBytes();
  if(used>limit&&used>memWarnAt){ memWarnAt=used*1.5; notice(`기억한 조합이 많아서 메모리가 부족해질 수 있어요. (약 ${(used/1024**2).toFixed(0)}MB)\n연속 저장을 한 번 끝내고 내보낸 뒤, 이어서 찍는 것을 추천해요.`); }
}
function capture(){
  const c=mkCanvas(doc.width,doc.height); c.getContext('2d').drawImage(comp,0,0);
  const snap={on:new Set(allLayers().filter(L=>L.on).map(L=>L.id)),hid:new Set(blocks.filter(B=>B.hidden).map(B=>B.id)),region:{...region},scope,name:'',full:null,bytes:0};
  snap.ready=toBlob(c).then(b=>{ snap.full=b; snap.bytes=b?b.size:0; checkSnapMem(); });
  snaps.push(snap);
  $('countNote').textContent=`기억한 조합 ${snaps.length}개`;
  toast(`${snaps.length}번째 조합을 기억했어요`+(regionOut()?' · '+OUT_MSG:''),regionOut()?2600:1200);
  frame.animate([{outline:'3px solid #161616'},{outline:'3px solid transparent'}],{duration:450});
}
// 키보드가 없는 화면(휴대폰 등): Enter 대신 오른쪽 아래 카메라 버튼
const NOKEY=()=>TOUCH.matches||MOBILE.matches;
function syncNoKey(){ document.body.classList.toggle('nokey',NOKEY()); if(!enterMode) $('btnEnter').textContent=NOKEY()?'PNG 연속 저장':'Enter 키로 PNG 연속 저장'; }
TOUCH.addEventListener?.('change',syncNoKey); MOBILE.addEventListener?.('change',syncNoKey); syncNoKey();
$('snapBtn').onclick=e=>{ e.currentTarget.blur(); if(enterMode) capture(); };
function setEnterMode(on){
  enterMode=on; const b=$('btnEnter');
  document.body.classList.toggle('enter-active',on);
  b.textContent=on?'연속 저장 모드 종료':(NOKEY()?'PNG 연속 저장':'Enter 키로 PNG 연속 저장');
  b.classList.toggle('on',on); b.classList.toggle('enter-on',on);
  $('enterBadge').classList.toggle('show',on);
  $('countNote').textContent=on?(snaps.length?`기억한 조합 ${snaps.length}개`:(NOKEY()?'카메라 버튼을 누를 때마다 지금 조합을 기억합니다.':'Enter를 누를 때마다 지금 조합을 기억합니다.')):'';
}
$('btnEnter').onclick=async e=>{
  e.currentTarget.blur();
  if(!enterMode){
    if(await ask((NOKEY()?'지금부터 오른쪽 아래 카메라 버튼을 누를 때마다 현재 조합을 기억합니다.':'지금부터 Enter 키를 누를 때마다 현재 조합을 기억합니다.')+'\n모드를 종료하면 기억한 조합을 한 번에 확인하고 .zip으로 내보낼 수 있습니다.')){ snaps=[]; setEnterMode(true); }
  } else await endEnterMode();
};
async function endEnterMode(){
  if(!enterMode||!await ask('연속 저장 모드를 종료하시겠습니까?')) return;
  setEnterMode(false);
  if(snaps.length) openResults(); else toast('기억한 조합이 없어요.');
}
// 우상단 '연속 저장 모드' 표시를 눌러도 종료
$('enterBadge').onclick=e=>{ e.currentTarget.blur(); endEnterMode(); };
$('enterBadge').onkeydown=e=>{ if(dlgResolve) return; if(e.key==='Enter'||e.key===' '){ e.preventDefault(); e.stopPropagation(); endEnterMode(); } };

// ---- 결과 보기 ----
let resCols=MOBILE.matches?3:5, resView='full', resThumbs=[], charName='';
// 10개 미만: 1,2,3 / 100개 미만: 01,02 / 그 이상: 001…
const numLabel=(i,total)=>{ const n=String(i+1); return total<10?n:n.padStart(String(total).length,'0'); };
const safeName=s=>(s||'').replace(/[\\/:*?"<>|]+/g,'').trim();
function openResults(){
  if(resView!=='full'&&resView!=='zoom') resView='full';
  setSeg('resScope',resView); $('resCols').value=resCols; $('resChar').value=charName;
  $('expFull').checked=resView==='full'; $('expZoom').checked=resView==='zoom';
  const dm=isDemo(); $('expFull').closest('label').classList.toggle('dis',dm); $('expZoom').closest('label').classList.toggle('dis',dm);
  if(dm){ $('expFull').checked=false; $('expZoom').checked=true; }
  $('resExport').textContent=dm?'모아보기 저장 (.png)':'내보내기 (.zip)';
  $('resGrid').innerHTML=''; openOverlay('resDlg'); buildThumbs().catch(e=>{ console.error(e); toast('기억한 그림을 불러오지 못했어요.'); });
}
function setSeg(id,v){ document.querySelectorAll(`#${id} button`).forEach(b=>b.classList.toggle('on',b.dataset.v===v)); }
async function buildThumbs(){
  const view=resView;
  const th=await Promise.all(snaps.map(async s=>{ const c=await snapImage(s,view==='zoom'); const k=Math.min(1,560/Math.max(c.width,c.height)); const t=mkCanvas(Math.max(1,Math.round(c.width*k)),Math.max(1,Math.round(c.height*k))); t.getContext('2d').drawImage(c,0,0,t.width,t.height); return t.toDataURL(); }));
  if(view!==resView) return; resThumbs=th; drawResGrid();
}
// 완전히 같은 조합 찾기 (확대 영역 보기라면 확대 영역까지 같아야 같은 것으로 봄)
function dupOf(view){
  const key=s=>[...s.on].sort((a,b)=>a-b).join(',')+'/'+[...(s.hid||[])].sort((a,b)=>a-b).join(',')+(view==='zoom'?'|'+['x','y','w','h'].map(k=>Math.round(s.region[k])).join(','):'');
  const first=new Map(); return snaps.map((s,i)=>{ const k=key(s); if(first.has(k)) return first.get(k); first.set(k,i); return -1; });
}
function drawResGrid(){
  const g=$('resGrid'); g.style.gridTemplateColumns=`repeat(${resCols},minmax(0,1fr))`; g.innerHTML='';
  const dups=dupOf(resView), total=snaps.length;
  snaps.forEach((s,i)=>{
    const cell=document.createElement('div'); cell.className='rcell';
    cell.innerHTML=`<div class="rimg"><img class="checker" alt="">${dups[i]>=0?`<span class="rdup">${numLabel(dups[i],total)}번과 중복</span>`:''}<button class="rdel" title="이 조합 빼기">✕</button></div><input class="rname" spellcheck="false" maxlength="80">`;
    cell.querySelector('img').src=resThumbs[i];
    const inp=cell.querySelector('.rname'); inp.value=s.name; inp.placeholder=numLabel(i,total); inp.title='눌러서 이름 붙이기';
    inp.oninput=()=>{ s.name=inp.value; };
    inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter'&&!e.isComposing) inp.blur(); };
    cell.querySelector('.rdel').onclick=()=>{ snaps.splice(i,1); resThumbs.splice(i,1); if(!snaps.length){ closeOverlay('resDlg'); toast('조합을 모두 뺐어요.'); return; } drawResGrid(); };
    cell.dataset.i=i; cell.querySelector('.rimg').addEventListener('pointerdown',e=>resDragStart(e,i));
    g.appendChild(cell);
  });
  $('resTitle').textContent=`조합 ${snaps.length}개`;
  const rows=Math.ceil(snaps.length/resCols); $('resInfo').textContent=`${resCols}열 × ${rows}행`;
}
// 결과 칸 잡아서 끌어 순서 바꾸기 (마우스는 바로, 터치는 꾹 누른 뒤)
let resDrag=null;
function resDragStart(e,i){
  if(e.button>0||e.target.closest('.rdel')) return;
  const cell=e.currentTarget.closest('.rcell'), touch=e.pointerType==='touch';
  const st={i,cell,x0:e.clientX,y0:e.clientY,on:false,ghost:null,to:null,id:e.pointerId,timer:0};
  const begin=()=>{
    st.on=true; resDrag=st; cell.classList.add('rdragging'); document.body.classList.add('res-dragging');
    const r=cell.getBoundingClientRect(), gh=cell.querySelector('img').cloneNode(); gh.className='rghost';
    Object.assign(gh.style,{width:r.width*.7+'px'}); document.body.appendChild(gh); st.ghost=gh; st.gw=r.width*.35; st.gh=gh.offsetHeight/2||r.width*.35;
    try{ cell.setPointerCapture(st.id); }catch(_){}
  };
  if(touch) st.timer=setTimeout(begin,280);
  const mv=ev=>{
    if(!st.on){
      if(Math.hypot(ev.clientX-st.x0,ev.clientY-st.y0)<6) return;
      if(touch){ clearTimeout(st.timer); end(); return; }   // 터치로 바로 움직이면 스크롤
      begin();
    }
    ev.preventDefault();
    st.ghost.style.transform=`translate(${ev.clientX-st.gw}px,${ev.clientY-st.gh}px)`;
    document.querySelectorAll('.rcell.rdrop-l,.rcell.rdrop-r').forEach(c=>c.classList.remove('rdrop-l','rdrop-r'));
    const over=document.elementFromPoint(ev.clientX,ev.clientY)?.closest?.('#resGrid .rcell'); st.to=null;
    if(over){ const r=over.getBoundingClientRect(), after=ev.clientX>r.left+r.width/2, j=+over.dataset.i;
      over.classList.add(after?'rdrop-r':'rdrop-l'); st.to=after?j+1:j; }
    const g=$('resGrid'), gr=g.getBoundingClientRect();   // 위·아래 끝에서 자동 스크롤
    if(ev.clientY>gr.bottom-30) g.scrollTop+=14; else if(ev.clientY<gr.top+30) g.scrollTop-=14;
  };
  const tm=ev=>{ if(st.on) ev.preventDefault(); };
  const end=()=>{
    clearTimeout(st.timer);
    removeEventListener('pointermove',mv); removeEventListener('pointerup',up); removeEventListener('pointercancel',end); removeEventListener('touchmove',tm);
    st.ghost?.remove(); document.body.classList.remove('res-dragging'); resDrag=null;
    document.querySelectorAll('.rcell.rdragging,.rcell.rdrop-l,.rcell.rdrop-r').forEach(c=>c.classList.remove('rdragging','rdrop-l','rdrop-r'));
  };
  const up=()=>{
    const from=st.i; let to=st.to; const was=st.on; end();
    if(!was||to==null) return;
    if(to>from) to--; if(to===from) return;
    const [s]=snaps.splice(from,1); snaps.splice(to,0,s); const [th]=resThumbs.splice(from,1); resThumbs.splice(to,0,th);
    drawResGrid(); toast(`${numLabel(from,snaps.length)}번 → ${numLabel(to,snaps.length)}번 자리로 옮겼어요`,1200);
  };
  addEventListener('pointermove',mv,{passive:false}); addEventListener('pointerup',up); addEventListener('pointercancel',end); addEventListener('touchmove',tm,{passive:false});
}
const BUSY_MSG='내보내는 도중에는 수정할 수 없어요.';
['pointerdown','click','keydown','input','dragstart'].forEach(ev=>$('resDlg').addEventListener(ev,e=>{
  if(!saving||!$('resDlg').classList.contains('show')) return;
  if(ev==='keydown'&&(e.key==='Tab'||e.key==='Shift')) return;
  e.preventDefault(); e.stopPropagation(); if(ev==='pointerdown'||ev==='keydown') toast(BUSY_MSG,1400);
},true));
$('resChar').oninput=e=>{ charName=e.currentTarget.value; };
$('resChar').onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter'&&!e.isComposing) e.currentTarget.blur(); };
document.querySelectorAll('#resScope button').forEach(b=>b.onclick=()=>{ resView=b.dataset.v; setSeg('resScope',resView); buildThumbs(); });
const setCols=v=>{ resCols=clamp(Math.round(+v||5),1,12); $('resCols').value=resCols; drawResGrid(); };
$('resCols').onchange=()=>setCols($('resCols').value);
$('resColMinus').onclick=()=>setCols(resCols-1);
$('resColPlus').onclick=()=>setCols(resCols+1);
$('resDiscard').onclick=async()=>{ if(await ask(`기억한 조합 ${snaps.length}개를 모두 지울까요?`)){ snaps=[]; closeOverlay('resDlg'); $('countNote').textContent=''; } };
$('resResume').onclick=()=>{ closeOverlay('resDlg'); setEnterMode(true); };
// 내보내기 옵션
$('resExport').onclick=async e=>{
  e.currentTarget.blur();
  if(isDemo()){ if(await exportDemoSheet()) offerBrag(); return; }   // 데모: 확대 영역 모아보기 1장만
  const views=[]; if($('expFull').checked) views.push('full'); if($('expZoom').checked) views.push('zoom');
  if(!views.length){ toast('위에서 전체 이미지·확대 영역 중 하나 이상 골라 주세요'); return; }
  if(await exportZip(views)) offerBrag();
};

// ---- 미리보기 시트 ----
// 번호·이름 글씨 = 시트 속 이미지 한 장 폭의 8%. 확대 영역은 한 장 360px로 리사이징, 전체 이미지는 원본 크기(캔버스 한계를 넘을 때만 자동 축소)
const FONT='"IBM Plex Sans KR", sans-serif', SHEET_W=360;
// 긴 이름: 칸 폭을 넘으면 2줄로 나누고, 2줄로도 넘치면 비율을 유지한 채 글씨를 줄임(최소 60%, 그래도 넘치면 …)
function fitName(x,name,w,fs0){
  const split=fs=>{
    x.font=`600 ${fs}px ${FONT}`;
    if(x.measureText(name).width<=w) return [name];
    const lines=[]; let cur='';
    for(const ch of name){
      if(cur&&x.measureText(cur+ch).width>w){
        const sp=cur.lastIndexOf(' ');
        if(sp>0&&cur.length-sp<=6){ lines.push(cur.slice(0,sp)); cur=cur.slice(sp+1)+ch; }   // 가까운 띄어쓰기에서 끊기
        else { lines.push(cur); cur=ch; }
      } else cur+=ch;
    }
    if(cur) lines.push(cur.trimStart());
    return lines;
  };
  let fs=fs0, lines=split(fs);
  while(lines.length>2&&fs>fs0*.6){ fs=Math.max(fs0*.6,fs*.92); lines=split(fs); }
  if(lines.length>2){
    let l2=lines.slice(1).join(''); x.font=`600 ${fs}px ${FONT}`;
    while(l2.length>1&&x.measureText(l2+'…').width>w) l2=l2.slice(0,-1);
    lines=[lines[0],l2+'…'];
  }
  return {lines,fs};
}
function makeSheet(sizes,cellW,title,names){
  const s=cellW/SHEET_W, fs=cellW*.08, pad=24*s, gapX=8*s, gapY=12*s, labelGap=3*s, lineH=1.25, tfs=cellW*.12, titleH=title?tfs*1.45:0;
  const mx=mkCanvas(1,1).getContext('2d');
  const items=sizes.map(([w,h],i)=>{ const nm=names?.[i]; return {w:cellW,h:h*cellW/w,lab:nm?fitName(mx,nm,cellW,fs):null}; });
  const labH=it=>it.lab?Math.max(fs*lineH,it.lab.lines.length*it.lab.fs*lineH):fs*lineH;
  const rows=[]; for(let i=0;i<items.length;i+=resCols) rows.push(items.slice(i,i+resCols));
  const W=pad*2+resCols*cellW+(resCols-1)*gapX;
  let y=pad+titleH; const pos=[];
  rows.forEach(r=>{ const rh=Math.max(...r.map(x=>x.h)), lh=Math.max(...r.map(labH)); r.forEach((it,ci)=>pos.push({x:pad+ci*(cellW+gapX),y,w:it.w,h:it.h,ly:y+it.h+labelGap,lab:it.lab})); y+=rh+labelGap+lh+gapY; });
  const H=y-gapY+pad;
  const k=Math.min(1,16000/W,16000/H,Math.sqrt(2.4e8/(W*H)));   // 브라우저 캔버스 한계를 넘을 때만 줄임
  const c=mkCanvas(Math.round(W*k),Math.round(H*k)), x=c.getContext('2d');
  x.scale(k,k); x.fillStyle='#fff'; x.fillRect(0,0,W,H); x.textBaseline='top'; x.textAlign='left';
  if(title){ x.fillStyle='#161616'; x.font=`700 ${tfs}px ${FONT}`; x.fillText(title,pad,pad); }
  return {c,x,pos,s,fs,W,H,pad};
}
function sheetDraw(sh,i,img,num,name){
  const p=sh.pos[i], x=sh.x, fs=sh.fs; x.drawImage(img,p.x,p.y,p.w,p.h);
  // 이름을 붙였으면 이름만, 아니면 번호만
  if(name){
    const lab=p.lab||fitName(x,name,p.w,fs);
    x.fillStyle='#161616'; x.font=`600 ${lab.fs}px ${FONT}`;
    lab.lines.forEach((ln,j)=>x.fillText(ln,p.x,p.ly+j*lab.fs*1.25));
  }
  else { x.fillStyle='#8b8b8b'; x.font=`500 ${fs}px ${FONT}`; x.fillText(num,p.x,p.ly); }
}
// ---- 모아보기 표기 · X에 자랑하기 ----
const SITE_URL='https://saturn97v.github.io/character-portrait-studio/';   // 배포 주소
const SHARE_TAG='#캐릭터_사진관_찰칵';
const siteURL=()=>SITE_URL||(/^https?:$/.test(location.protocol)&&!/(^|\.)claude(usercontent)?\.(ai|com)$/.test(location.hostname)?location.origin+location.pathname:'');
function brandFaint(sh){   // 모아보기 오른쪽 아래에 아주 연하고 작게 '캐릭터 사진관'
  const x=sh.x; x.save(); x.fillStyle='#d9d9d9'; x.font=`500 ${sh.fs*.6}px ${FONT}`; x.textAlign='right'; x.textBaseline='bottom'; x.fillText('캐릭터 사진관',sh.W-sh.pad,sh.H-sh.pad*.2); x.restore();
}
// X 자랑하기: 저장이 끝난 뒤 물어보고, 누르면 글쓰기 창
const BRAG_TEXT=()=>{ const u=siteURL(); return SHARE_TAG+'\n*저장된 모아보기를 첨부해서 자랑해봅시다.'+(u?'\n'+u:''); };
try{ $('expX').checked=localStorage.getItem('charStudio.brag')!=='0'; }catch(_){ $('expX').checked=true; }
$('expX').onchange=()=>{ try{ localStorage.setItem('charStudio.brag',$('expX').checked?'1':'0'); }catch(_){} };
const bragURL=()=>'https://twitter.com/intent/tweet?text='+encodeURIComponent(BRAG_TEXT());
function openBrag(){ const w=window.open(bragURL(),'_blank'); if(w) try{ w.opener=null; }catch(_){} return !!w; }
async function offerBrag(){
  if(!$('expX').checked) return;
  // 저장이 끝나면 바로 X 글쓰기 창 열기. 저장이 오래 걸려 브라우저가 새 창을 막으면 그때만 한 번 물어봄
  if(openBrag()){ toast('X 글쓰기 창을 열었어요. 저장된 모아보기를 첨부해 주세요.',3000); return; }
  const ok=$('dlgOk'), cn=$('dlgCancel'), o1=ok.textContent, o2=cn.textContent; ok.textContent='X 열기'; cn.textContent='닫기';
  const go=await ask('저장을 마쳤습니다! X에 자랑하러 가 볼까요?').finally(()=>{ ok.textContent=o1; cn.textContent=o2; });
  if(!go) return;
  if(!openBrag()){ try{ await navigator.clipboard.writeText(BRAG_TEXT()); toast('새 창이 막혀서 문구를 복사했어요. X에 붙여넣어 주세요.',3200); }catch(_){ toast('새 창이 막혔어요. 팝업을 허용해 주세요.',3000); } }
}
// ---- 데모 캐릭터: 확대 영역 모아보기 1장 + 아래 검은 띠 ----
const DEMO_BAND_MSG=['데모 캐릭터입니다.','내 캐릭터 파일을 불러와 직접 찍어 보세요!'];
function invertedLogo(){
  const im=document.querySelector('.logo-cam'); if(!im||!im.naturalWidth) return null;
  const c=mkCanvas(im.naturalWidth,im.naturalHeight), x=c.getContext('2d'); x.drawImage(im,0,0);
  try{ const d=x.getImageData(0,0,c.width,c.height); for(let i=0;i<d.data.length;i+=4){ d.data[i]=255-d.data[i]; d.data[i+1]=255-d.data[i+1]; d.data[i+2]=255-d.data[i+2]; } x.putImageData(d,0,0); }catch(_){ return null; }
  return c;
}
async function exportDemoSheet(){
  if(saving||!snaps.length) return false; saving=true; const btn=$('resExport'), old=btn.textContent;
  try{
    btn.textContent='만드는 중…';
    const sh=makeSheet(snaps.map(s=>[s.region.w,s.region.h]),SHEET_W,charName.trim(),snaps.map(s=>s.name.trim()));
    for(let i=0;i<snaps.length;i++){ const s=snaps[i]; await s.ready; const img=await snapImage(s,true); sheetDraw(sh,i,img,numLabel(i,snaps.length),s.name.trim()); img.close?.(); }
    const rowH=sh.pos[0].h+3*sh.s+sh.fs*1.25, band=rowH/2, k=sh.c.width/sh.W;
    const c=mkCanvas(sh.c.width,Math.round((sh.H+band)*k)), x=c.getContext('2d');
    x.drawImage(sh.c,0,0); x.scale(k,k);
    x.fillStyle='#161616'; x.fillRect(0,sh.H,sh.W,band);
    try{ await document.fonts.load('40px "Waguri"'); }catch(_){}
    const logo=invertedLogo(), pad=sh.pad*1.4, cy=sh.H+band/2;
    const stack=resCols<=1;   // 1열만 위아래로 쌓고, 2열부터는 왼쪽 로고·오른쪽 설명
    const two=resCols===2;   // 2열: 제목·설명 사이를 좁히고 제목을 조금 키움
    let iconH=band*(stack?.3:two?.5:.46), tS=band*(stack?.2:two?.35:.3), rS=band*(stack?.1:.13), gap=band*.12, mid=band*(two?.1:.3);
    const iconW=()=>logo?iconH*logo.width/logo.height:0;
    const wTitle=()=>{ x.font=`${tS}px "Waguri", ${FONT}`; return x.measureText('캐릭터 사진관').width; };
    const wRight=()=>{ x.font=`600 ${rS}px ${FONT}`; return Math.max(...DEMO_BAND_MSG.map(t=>x.measureText(t).width)); };
    const room=sh.W-pad*2;
    if(stack){
      const inner=Math.max(iconW()+(logo?gap:0)+wTitle(),wRight());
      if(inner>room){ const f=room/inner*.97; iconH*=f; tS*=f; rS*=f; gap*=f; }
      const lh=rS*1.5, blockH=iconH+rS*.9+lh*2, top=sh.H+(band-blockH)/2;
      let lx=pad; const ty=top+iconH/2;
      if(logo){ x.drawImage(logo,lx,top,iconW(),iconH); lx+=iconW()+gap; }
      x.fillStyle='#fff'; x.textBaseline='middle'; x.textAlign='left'; x.font=`${tS}px "Waguri", ${FONT}`; x.fillText('캐릭터 사진관',lx,ty+tS*.04);
      const y1=top+iconH+rS*.9+lh*.5;
      x.font=`600 ${rS}px ${FONT}`; x.fillStyle='#fff'; x.fillText(DEMO_BAND_MSG[0],pad,y1);
      x.font=`500 ${rS}px ${FONT}`; x.fillStyle='#bdbdbd'; x.fillText(DEMO_BAND_MSG[1],pad,y1+lh);
    } else {
      const inner=iconW()+(logo?gap:0)+wTitle()+mid+wRight();
      if(inner>room){ const f=room/inner*.97; iconH*=f; tS*=f; rS*=f; gap*=f; mid*=f; }
      let lx=pad;
      if(logo){ x.drawImage(logo,lx,cy-iconH/2,iconW(),iconH); lx+=iconW()+gap; }
      x.fillStyle='#fff'; x.textBaseline='middle'; x.textAlign='left'; x.font=`${tS}px "Waguri", ${FONT}`; x.fillText('캐릭터 사진관',lx,cy+tS*.04);
      x.textAlign='right'; x.font=`600 ${rS}px ${FONT}`; x.fillStyle='#fff'; x.fillText(DEMO_BAND_MSG[0],sh.W-pad,cy-rS*.75);
      x.font=`500 ${rS}px ${FONT}`; x.fillStyle='#bdbdbd'; x.fillText(DEMO_BAND_MSG[1],sh.W-pad,cy+rS*.75);
    }
    const blob=await toBlob(c); if(!blob){ toast('이미지를 만들지 못했어요.'); return false; }
    const name='캐릭터사진관_데모_모아보기.png';
    let r; for(let t=0;t<60;t++){ r=await saveFile(name,blob); if(r!=='busy') break; await new Promise(r=>setTimeout(r,1500)); }
    if(r==='declined'||r==='busy') return false;
    if(r==='fallback') downloadBlob(blob,name);
    toast('모아보기 1장을 저장했어요',1800); return true;
  }catch(e){ console.error(e); toast('저장하지 못했어요: '+(e.message||e)); return false; }
  finally{ saving=false; btn.textContent=old; }
}
// 한 zip 최대 용량. 넘으면 촬영 5장 단위로 나눠 여러 zip으로 (미리보기도 zip마다 그 안의 것만)
let ZIP_MAX=2*1024**3;
const zipSize=fs=>fs.reduce((n,f)=>{ const l=new TextEncoder().encode(f.name).length; return n+30+46+2*l+f.data.length; },22);
async function exportZip(views){
  if(saving||!snaps.length) return false; saving=true; const btn=$('resExport'); const old=btn.textContent;
  try{
    const now=new Date(), mmdd=String(now.getMonth()+1).padStart(2,'0')+String(now.getDate()).padStart(2,'0');
    const cn=safeName(charName), title=charName.trim(), base=`포트레이트_${cn?cn+'_':''}${mmdd}`;
    const total=snaps.length, recs=[];
    const LABEL={full:'전체 이미지',zoom:'확대 영역'};
    const png=async c=>new Uint8Array(await (await toBlob(c)).arrayBuffer());
    const sizeOf=(s,v)=>v==='zoom'?[Math.round(s.region.w),Math.round(s.region.h)]:[doc.width,doc.height];
    // 1) 촬영마다 PNG 만들기
    for(let i=0;i<total;i++){
      btn.textContent=`만드는 중… ${i+1}/${total}`;
      const s=snaps[i], num=numLabel(i,total), nm=safeName(s.name), fn=nm?`${num}_${nm}`:num;
      const r={num,name:s.name.trim(),files:[]}; await s.ready;
      for(const v of views){ const data=v==='full'?new Uint8Array(await s.full.arrayBuffer()):await png(await snapImage(s,true)); r.files.push({v,name:`${LABEL[v]}/${fn}.png`,data}); }
      recs.push(r); await new Promise(r=>setTimeout(r,0));
    }
    // 2) 묶음 크기 정하기: 전부 한 zip에 들어가면 그대로, 아니면 5장 단위로
    const filesOf=(a,b)=>recs.slice(a,b).flatMap(r=>r.files);
    const sheetsFor=async(a,b)=>{
      const pv=[];
      for(const v of views){
        const sh=makeSheet(snaps.slice(a,b).map(s=>sizeOf(s,v)),v==='zoom'?SHEET_W:doc.width,title,recs.slice(a,b).map(r=>r.name));
        for(let i=a;i<b;i++){ const f=recs[i].files.find(x=>x.v===v); const bmp=await createImageBitmap(new Blob([f.data],{type:'image/png'})); sheetDraw(sh,i-a,bmp,recs[i].num,recs[i].name); bmp.close?.(); }
        brandFaint(sh);
        pv.push({name:`미리보기-${LABEL[v]}.png`,data:await png(sh.c)});
      }
      return pv;
    };
    // 미리보기 시트 크기 어림: 전체 이미지 시트 ≈ 그 안의 전체 이미지 합, 확대 영역 시트는 한 칸에 약 0.2MB
    const est=(a,b)=>zipSize(filesOf(a,b))+recs.slice(a,b).reduce((n,r)=>n+r.files.reduce((m,f)=>m+(f.v==='full'?f.data.length:2e5),0),0);
    const fits=k=>{ for(let a=0;a<total;a+=k) if(est(a,Math.min(total,a+k))>ZIP_MAX) return false; return true; };
    const step=k=>k>5?(k%5?k-k%5:k-5):k-1;   // 5장 단위로 줄이고, 5장도 안 들어가면 1장씩
    let k=total;
    while(k>1&&!fits(k)) k=step(k);
    let zips;
    for(;;){   // 실제 미리보기까지 넣어 보고 넘치면 한 단계 더 줄임
      zips=[];
      for(let a=0;a<total;a+=k){ const b=Math.min(total,a+k); btn.textContent=`미리보기 만드는 중… ${b}/${total}`; zips.push([...await sheetsFor(a,b),...filesOf(a,b)]); }
      if(k===1||zips.every(z=>zipSize(z)<=ZIP_MAX)) break;
      k=step(k);
    }
    // 3) 저장
    const many=zips.length>1;
    for(let z=0;z<zips.length;z++){
      const zname=many?`${base}_${z+1}.zip`:`${base}.zip`, blob=makeZip(zips[z]);
      if(many) btn.textContent=`저장 중… ${z+1}/${zips.length}`;
      let r; for(let t=0;t<60;t++){ r=await saveFile(zname,blob); if(r!=='busy') break; await new Promise(r=>setTimeout(r,1500)); }
      if(r==='declined'||r==='busy') return;
      if(r==='fallback') downloadBlob(blob,zname);
      zips[z]=null;
    }
    toast(many?`용량이 커서 zip ${zips.length}개로 나눠 내보냈어요 (${k}장씩)`:'.zip으로 내보냈어요',many?3200:1800);
    return true;
  }catch(e){ console.error(e); toast('내보내지 못했어요: '+(e.message||e)); }
  finally{ saving=false; btn.textContent=old; }
}

// ---- 최소 ZIP 작성기 (무압축 · UTF-8 파일명) ----
const CRC=(()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc32(d){ let c=0xFFFFFFFF; for(let i=0;i<d.length;i++) c=CRC[(c^d[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function makeZip(files){
  const enc=new TextEncoder(), parts=[], central=[]; let off=0;
  const now=new Date(), time=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1), date=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate();
  for(const f of files){
    const name=enc.encode(f.name), crc=crc32(f.data), sz=f.data.length;
    const h=new DataView(new ArrayBuffer(30));
    h.setUint32(0,0x04034b50,true); h.setUint16(4,20,true); h.setUint16(6,0x0800,true); h.setUint16(8,0,true);
    h.setUint16(10,time,true); h.setUint16(12,date,true); h.setUint32(14,crc,true); h.setUint32(18,sz,true); h.setUint32(22,sz,true);
    h.setUint16(26,name.length,true); h.setUint16(28,0,true);
    parts.push(h,name,f.data);
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true); c.setUint16(4,20,true); c.setUint16(6,20,true); c.setUint16(8,0x0800,true); c.setUint16(10,0,true);
    c.setUint16(12,time,true); c.setUint16(14,date,true); c.setUint32(16,crc,true); c.setUint32(20,sz,true); c.setUint32(24,sz,true);
    c.setUint16(28,name.length,true); c.setUint32(42,off,true);
    central.push(c,name);
    off+=30+name.length+sz;
  }
  const cdSize=central.reduce((n,p)=>n+p.byteLength,0);
  const e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true); e.setUint16(8,files.length,true); e.setUint16(10,files.length,true); e.setUint32(12,cdSize,true); e.setUint32(16,off,true);
  return new Blob([...parts,...central,e],{type:'application/zip'});
}

// ---- 다이얼로그 ----
let dlgResolve=null;
function openOverlay(id){ $(id).classList.add('show'); }
function closeOverlay(id){ $(id).classList.remove('show'); }
function notice(msg){ $('dlgCancel').hidden=true; return ask(msg).finally(()=>{ $('dlgCancel').hidden=false; }); }
function ask(msg){
  if(dlgResolve) dlgResolve(false);
  document.activeElement?.blur?.();   // 직전에 누른 버튼·표시에 포커스가 남아 Enter가 다시 그 버튼을 누르지 않게
  $('dlgMsg').textContent=msg; openOverlay('dlg');
  return new Promise(res=>{ dlgResolve=v=>{ closeOverlay('dlg'); dlgResolve=null; res(v); }; });
}
$('dlgOk').onclick=()=>dlgResolve&&dlgResolve(true);
$('dlgCancel').onclick=()=>dlgResolve&&dlgResolve(false);

document.addEventListener('keydown',e=>{
  if(dlgResolve){
    if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); dlgResolve(document.activeElement!==$('dlgCancel')); }
    else if(e.key==='Escape'){ e.preventDefault(); dlgResolve(false); }
    return;
  }
  if($('imgDlg').classList.contains('show')){ if(e.key==='Escape'||e.key==='Enter'){ e.preventDefault(); closeOverlay('imgDlg'); } return; }
  if($('resDlg').classList.contains('show')) return;
  if(!enterMode||e.key!=='Enter'||e.isComposing||anyModalOpen()) return;
  if(e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
  e.preventDefault(); if(e.repeat) return; capture();
});

let tt; function toast(msg,ms=2400){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove('show'),ms); }

// ================= 파일 열기 =================
// 파일명: 폴더 칸 왼쪽 너비(해제 버튼 오른쪽 끝)를 넘지 않게, 길면 가운데를 줄이고 확장자는 남김
function setFileName(name){
  const el=$('fileName'); el.title=name; el.textContent=name;
  const fit=()=>{
    const blk=document.querySelector('#blocks .block .bctrl .xbtn, #blocks .block .bctrl .hidebtn');
    let maxW=114;
    if(blk&&blk.offsetParent){ const r=blk.getBoundingClientRect(); maxW=Math.max(60,r.right-el.getBoundingClientRect().left); }
    const cs=getComputedStyle(el), cx=document.createElement('canvas').getContext('2d'); cx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const w=s=>cx.measureText(s).width;
    if(w(name)<=maxW){ el.textContent=name; return; }
    const m=name.match(/^(.*?)(\.[^.]+)?$/), base=m[1], ext=m[2]||'';
    let lo=0, hi=base.length, best='…'+ext;
    while(lo<=hi){ const k=(lo+hi)>>1, a2=Math.ceil(k/2), b2=Math.floor(k/2);
      const s=base.slice(0,a2)+'…'+(b2?base.slice(-b2):'')+ext;
      if(w(s)<=maxW){ best=s; lo=k+1; } else hi=k-1; }
    el.textContent=best;
  };
  requestAnimationFrame(()=>requestAnimationFrame(fit));
  setFileName._fit=fit;
}
window.addEventListener('resize',()=>{ if(doc&&setFileName._fit) setFileName._fit(); });
function start(d,name){
  doc={width:d.width,height:d.height,name};
  comp.width=d.width; comp.height=d.height;
  buildBlocks(d.root); assignKeys(); memCur=null;
  document.body.classList.add('working');
  setFileName(name);
  renderPanel(); render(); requestAnimationFrame(()=>{ defaultRegion(); layoutPreview(); });
  snaps=[]; if(enterMode) setEnterMode(false); closeOverlay('resDlg'); picked.clear(); setMode('org');
  maybeFirstGuide();
}
const BIG_FILE=1024**3;   // 1GB 넘으면 처음에 안내
let loadingFile=false;
// 그릴 수 있는 레이어가 하나라도 있는지
function hasDrawable(n){ return (n.children||[]).some(o=>o.type==='group'?hasDrawable(o):!!nodeImage(o)); }
// 이 기기에서 이 크기 캔버스를 그릴 수 있는지 (너무 크면 브라우저가 빈 캔버스를 줌)
function canvasOK(w,h){ try{ const c=mkCanvas(w,h), x=c.getContext('2d'); if(!x) return false; x.fillStyle='#000'; x.fillRect(w-1,h-1,1,1); const ok=x.getImageData(w-1,h-1,1,1).data[3]===255; c.width=c.height=1; return ok; }catch(_){ return false; } }
const friendlyErr=m=>/[가-힣]/.test(m||'')?m:'파일을 읽지 못했어요. 손상되었거나 지원하지 않는 형식일 수 있어요.';
const isPNG=f=>/\.png$/i.test(f.name)||f.type==='image/png';
// PNG 여러 장 → 한 장 한 장이 파츠인 캐릭터로 (그림 크기는 가장 큰 PNG 기준, 모두 왼쪽 위에 맞춤)
async function pngDoc(files){
  const nodes=[]; let w=0,h=0, fails=0;
  for(const f of files){
    try{ const bmp=await createImageBitmap(f); const c=mkCanvas(bmp.width,bmp.height); c.getContext('2d').drawImage(bmp,0,0); bmp.close?.();
      w=Math.max(w,c.width); h=Math.max(h,c.height);
      nodes.push({type:'layer',name:f.name.replace(/\.png$/i,''),_img:{canvas:c,left:0,top:0},blend:'norm',opacity:1,hidden:false}); }
    catch(e){ console.error(e); fails++; }
  }
  if(!nodes.length) throw new Error('PNG 파일을 읽지 못했어요.');
  return {width:w,height:h,root:{type:'group',children:nodes.reverse()},pngFails:fails};   // 먼저 고른 PNG가 맨 위
}
async function openFile(fs,confirmed=false){
  const list=(Array.isArray(fs)?fs:[fs]).filter(Boolean); if(!list.length) return;
  const main=list.find(f=>!isPNG(f)), pngs=main?[]:list.filter(isPNG);   // .psd/.clip이 섞여 있으면 그 파일 하나만
  const f=main||pngs[0];
  if(loadingFile){ toast('한 번에 한 파일만 불러올 수 있어요. 지금 파일을 다 불러온 뒤 다시 열어 주세요.',2600); return; }
  if(saving){ toast('내보내는 도중에는 새 파일을 열 수 없어요.',2200); return; }
  if(doc&&!confirmed&&!await ask(ASK_NEW)) return;
  const size=main?f.size:pngs.reduce((a,x)=>a+x.size,0);
  if(size>BIG_FILE) await notice(`파일이 아주 큽니다. (${(size/1024**3).toFixed(1)}GB)\n작동이 느릴 수 있습니다.`);
  const isClip=/\.clip$/i.test(f.name);
  $('loading').classList.add('show'); loadingFile=true;
  try{
    const d=pngs.length?await pngDoc(pngs):isClip?await parseCLIP(await f.arrayBuffer()):await parsePSD(await f.arrayBuffer());
    const name=pngs.length>1?`${f.name.replace(/\.png$/i,'')} 외 ${pngs.length-1}장`:f.name;
    if(!d.root.children.length||!hasDrawable(d.root)){ $('loading').classList.remove('show'); await notice('불러올 레이어가 없었습니다.'); return; }
    memSaveNow();   // 열려 있던 파일의 설정을 먼저 기억
    start(d,name);
    $('loading').classList.remove('show'); await offerResume();
    if(!canvasOK(d.width,d.height)) await notice(`그림 크기가 너무 커요(${d.width}×${d.height}px).\n이 기기에서는 제대로 보이지 않거나 저장되지 않을 수 있어요.`);
    const sk=[d.skippedVector?`벡터 레이어 ${d.skippedVector}개`:'',d.skippedFilter?`그라데이션 맵 외 색조 보정 레이어 ${d.skippedFilter}개`:''].filter(Boolean);
    if(d.pngFails) toast(`읽지 못한 PNG ${d.pngFails}개는 빼고 불러왔어요.`,3000);
    if(sk.length) toast(`${sk.join(', ')}는 불러오지 못했어요. 클립스튜디오에서 래스터화(또는 결합) 후 저장해 주세요.`,6500);
  }catch(e){ console.error(e); toast(friendlyErr(e.message),5200); }
  finally{ $('loading').classList.remove('show'); loadingFile=false; }
}
// ================= 이어서 하기: 정리 설정만 브라우저에 자동 기억 (그림 파일은 저장 안 함) =================
// 레이어는 '원래 폴더 이름/원래 레이어 이름#순번'으로 알아봄 → 파일 위치가 바뀌거나 내용이 조금 바뀌어도 맞춰서 복원
const MEM_KEY='charStudio.sessions', MEM_MAX=5;
let memCur=null, memInit='', memLast='';
function assignKeys(){
  const seen=new Map();
  for(const B of blocks) for(const L of B.layers){ const base=(B.type==='folder'?'F:'+(B.srcName??B.name)+'/':'L:')+(L.node.name||''); const n=(seen.get(base)||0)+1; seen.set(base,n); L.k=base+'#'+n; }
}
function memLoad(){ try{ const a=JSON.parse(localStorage.getItem(MEM_KEY)||'[]'); return Array.isArray(a)?a:[]; }catch(_){ return []; } }
function memWrite(list){
  list.sort((a,b)=>b.savedAt-a.savedAt); list=list.slice(0,MEM_MAX);
  for(;;){ try{ localStorage.setItem(MEM_KEY,JSON.stringify(list)); return; }catch(_){ if(list.length<=1) return; list.pop(); } }   // 공간이 모자라면 오래된 것부터
}
function memState(){
  const bi=new Map(blocks.map((B,i)=>[B.id,i])), lk=new Map(allLayers().map(L=>[L.id,L.k]));
  const ref=r=>!r?null:r.kind==='folder'?(bi.has(r.id)?{kind:'folder',i:bi.get(r.id)}:null):(lk.get(r.id)?{kind:'layer',k:lk.get(r.id)}:null);
  return {blocks:blocks.map(B=>({type:B.type,name:B.name,srcName:B.srcName,color:B.color,multi:B.multi,multiSet:B.multiSet,randomOn:B.randomOn,hidden:B.hidden,defHidden:B.defHidden,hideMake:B.hideMake,
      clipTo:ref(B.clipTo),clipOn:B.clipOn,gblend:B.gblend,gop:B.gop,srcClip:B.srcClip,
      layers:B.layers.filter(L=>L.k).map(L=>({k:L.k,name:L.name,on:L.on,def:L.def,clipTo:ref(L.clipTo),clipOn:L.clipOn,link:L.link||null}))})),
    region:region?{x:region.x,y:region.y,w:region.w,h:region.h}:null, ratioKey, lastLinkG};
}
function memSaveNow(){
  if(!memCur||!doc||isDemo()) return;
  const st=JSON.stringify(memState()); if(st===memLast) return;
  if(st===memInit&&!memCur.saved) return;   // 아무것도 안 바꿨으면 기억하지 않음
  memLast=st; memCur.saved=true;
  const list=memLoad().filter(e=>e.id!==memCur.id);
  list.push({id:memCur.id,name:doc.name,w:doc.width,h:doc.height,keys:memCur.keys,savedAt:Date.now(),state:JSON.parse(st)});
  memWrite(list);
}
setInterval(memSaveNow,1500);
addEventListener('pagehide',memSaveNow); document.addEventListener('visibilitychange',()=>{ if(document.hidden) memSaveNow(); });
async function offerResume(){
  if(!doc||isDemo()) return;
  const keys=allLayers().map(L=>L.k), ks=new Set(keys);
  let best=null, bs=0;
  for(const e of memLoad()){
    if(e.w!==doc.width||e.h!==doc.height||!Array.isArray(e.keys)) continue;
    let n=0; for(const k of e.keys) if(ks.has(k)) n++;
    const j=n/(e.keys.length+keys.length-n||1); if(j>bs){ bs=j; best=e; }
  }
  const hit=best&&bs>=.5;
  memCur=null;   // 고르는 동안에는 저장하지 않음
  const cur={id:hit?best.id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),keys,saved:hit};
  if(hit){
    const d=new Date(best.savedAt), when=`${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    const ok=$('dlgOk'), cn=$('dlgCancel'), o1=ok.textContent, o2=cn.textContent; ok.textContent='이어서 하기'; cn.textContent='새로 시작';
    const go=await ask(`지난번에 정리하던 파일이 있습니다.\n(${best.name} · ${when})\n이어서 할까요?`).finally(()=>{ ok.textContent=o1; cn.textContent=o2; });
    if(go) memApply(best.state);
  }
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ if(!doc||allLayers()[0]?.k!==keys[0]) return; memInit=memLast=JSON.stringify(memState()); memCur=cur; }));   // 확대 영역 기본값이 잡힌 뒤를 '처음 상태'로
}
function memApply(st){
  const byK=new Map(allLayers().filter(L=>L.k).map(L=>[L.k,L])), used=new Set(), nb=[]; let missing=0;
  for(const sb of st.blocks||[]){
    const B={id:++uid,type:sb.type==='loose'?'loose':'folder',layers:[]};
    if(B.type==='folder') Object.assign(B,{name:sb.name||'폴더',srcName:sb.srcName,color:sb.color??null,multi:!!sb.multi,multiSet:!!sb.multiSet,randomOn:sb.randomOn!==false,hidden:!!sb.hidden,defHidden:!!sb.defHidden,gblend:sb.gblend||'pass',gop:sb.gop??1,srcClip:!!sb.srcClip,clipOn:!!sb.clipOn});
    B.hideMake=!!sb.hideMake;
    for(const sl of sb.layers||[]){
      const L=byK.get(sl.k); if(!L||used.has(L)){ missing++; continue; }
      used.add(L); Object.assign(L,{name:sl.name??L.name,on:!!sl.on,def:!!sl.def,clipOn:!!sl.clipOn,link:sl.link||null}); L._clip=sl.clipTo; B.layers.push(L);
    }
    nb.push(B);
  }
  const res=r=>{ if(!r) return null; if(r.kind==='folder') return nb[r.i]&&nb[r.i].type==='folder'?{kind:'folder',id:nb[r.i].id}:null; const L=byK.get(r.k); return L&&used.has(L)?{kind:'layer',id:L.id}:null; };
  (st.blocks||[]).forEach((sb,i)=>{ if(nb[i].type!=='folder') return; nb[i].clipTo=res(sb.clipTo); if(!nb[i].clipTo) nb[i].clipOn=false; });
  for(const L of used){ L.clipTo=res(L._clip); delete L._clip; if(!L.clipTo) L.clipOn=false; }
  const fresh=allLayers().filter(L=>!used.has(L)), nFresh=fresh.length;
  if(nFresh) nb.unshift({id:++uid,type:'folder',name:'새 파츠',multi:true,multiSet:true,randomOn:true,layers:fresh.slice(),clipTo:null,clipOn:false,hidden:false,defHidden:false,gblend:'pass',gop:1,color:null});   // 파일에 새로 생긴 레이어
  blocks=nb; normalize();
  if(st.lastLinkG) lastLinkG=Math.max(lastLinkG,st.lastLinkG);
  renderPanel(); render();
  if(st.region) requestAnimationFrame(()=>requestAnimationFrame(()=>{
    region={...st.region}; ratioKey=st.ratioKey||ratioKey;
    document.querySelectorAll('#ratioSeg button').forEach(b=>b.classList.toggle('on',b.dataset.r===ratioKey));
    layoutPreview(); drawZoom();
  }));
  const msg=['지난번 정리를 불러왔어요.'];
  if(nFresh) msg.push(`파일에 새로 생긴 파츠 ${nFresh}개는 맨 위 '새 파츠' 폴더에 모았어요.`);
  if(missing) msg.push(`파일에서 없어진 파츠 ${missing}개는 뺐어요.`);
  toast(msg.join(' '),msg.length>1?4200:2200);
}
// 처음으로: 올린 파일과 작업 상태를 지우고 첫 화면으로
$('btnHome').onclick=async e=>{
  e.currentTarget.blur();
  if(saving){ toast('내보내는 도중에는 처음으로 돌아갈 수 없어요.',2200); return; }
  if(!await ask('올린 파일을 닫고 처음 화면으로 돌아갈까요?\n(정리한 설정은 5개 파일까지 이 브라우저에 기억됩니다.)')) return;
  memSaveNow(); memCur=null;   // 닫기 전에 정리 설정 마지막으로 기억
  if(enterMode) setEnterMode(false);
  snaps=[]; blocks=[]; picked.clear(); touchMove=null; updateTouchBar(); doc=null; charName='';
  ['resDlg','imgDlg'].forEach(closeOverlay); closeLinkPop(); hideClipPeek(); $('randPop').classList.remove('show');
  comp.width=comp.height=1; zoomC.width=zoomC.height=1; comp.style.width=comp.style.height='';
  $('blocks').innerHTML=''; $('fileName').textContent=''; $('countNote').textContent=''; $('metaSize').textContent=''; $('metaCount').textContent='';
  document.body.classList.remove('working'); setMode('org'); scrollTo(0,0);
};
const fi=$('fileInput');
const ASK_NEW='지금 작업을 닫고 새 파일을 열까요?\n(지금까지 정리한 설정은 5개 파일까지 이 브라우저에 기억됩니다.)';
$('btnOpen').onclick=async e=>{ e.currentTarget.blur(); if(doc&&!await ask(ASK_NEW)) return; fi.click(); };
$('btnOpen2').onclick=()=>fi.click();
fi.onchange=()=>{ openFile([...fi.files],true); fi.value=''; };
const isFileDrag=e=>[...(e.dataTransfer?.types||[])].includes('Files');
['dragover','dragenter'].forEach(ev=>document.addEventListener(ev,e=>{ if(!isFileDrag(e)) return; e.preventDefault(); $('drop').classList.add('over'); }));
document.addEventListener('dragleave',e=>{ if(isFileDrag(e)) $('drop').classList.remove('over'); });
document.addEventListener('drop',e=>{ if(!isFileDrag(e)) return; e.preventDefault(); $('drop').classList.remove('over'); if(!$('addModal').hidden){ addParts([...e.dataTransfer.files]); return; } openFile([...e.dataTransfer.files]); });

// ================= 도움말 (첫 업로드 때 한 번, 이후 '도움말' 버튼) =================
const HELP_KEY='charStudio.helpSeen';
function anyModalOpen(){ return [...document.querySelectorAll('.hmodal')].some(m=>!m.hidden)||!!document.querySelector('.overlay.show'); }
function openModal(id){ $(id).hidden=false; document.body.classList.add('modal-open'); }
function closeModal(id){ $(id).hidden=true; if(!anyModalOpen()) document.body.classList.remove('modal-open'); }
let guideStep=1; const GUIDE_N=document.querySelectorAll('#guideModal .g-step:not(.g-pre)').length;
const guideMin=()=>TOUCH.matches?0:1;   // 터치 기기는 'PC에 맞춰 만들었어요' 안내(0쪽)부터
function showGuideStep(n){
  guideStep=Math.max(guideMin(),Math.min(GUIDE_N,n));
  document.querySelectorAll('#guideModal .g-step').forEach(s=>s.hidden=+s.dataset.step!==guideStep);
  document.querySelectorAll('#guideDots i').forEach(d=>d.classList.toggle('on',+d.dataset.i===guideStep));
  $('guidePrev').hidden=guideStep===guideMin();
  $('guideNext').textContent=guideStep===GUIDE_N?'찍어보자!':guideStep===0?'시작하기':'다음으로';
  const gb=$('guideModal').querySelector('.guide-body'); gb.classList.toggle('fit',guideStep===GUIDE_N); gb.scrollTop=0;
}
function openGuide(){ showGuideStep(guideMin()); openModal('guideModal'); }
function maybeFirstGuide(){
  let seen=false; try{ seen=localStorage.getItem(HELP_KEY)==='1'; }catch(_){ seen=false; }
  if(seen) return; openGuide(); try{ localStorage.setItem(HELP_KEY,'1'); }catch(_){}
}
$('guideBtn').onclick=e=>{ e.currentTarget.blur(); openGuide(); };
$('guideClose').onclick=()=>closeModal('guideModal');
$('guidePrev').onclick=()=>showGuideStep(guideStep-1);
$('guideNext').onclick=()=>{ if(guideStep===GUIDE_N) closeModal('guideModal'); else showGuideStep(guideStep+1); };
$('guideDots').onclick=e=>{ const d=e.target.closest('i'); if(d) showGuideStep(+d.dataset.i); };
// 도움말: → 와 Enter는 '다음으로', 마지막 '찍어보자!'는 Enter로만 닫음
document.addEventListener('keydown',e=>{
  if($('guideModal').hidden||e.isComposing) return;
  if(e.key==='ArrowRight'){ e.preventDefault(); if(guideStep<GUIDE_N) showGuideStep(guideStep+1); }
  else if(e.key==='Enter'){ e.preventDefault(); e.stopImmediatePropagation(); $('guideNext').click(); }
  else if(e.key==='ArrowLeft'&&guideStep>guideMin()){ e.preventDefault(); showGuideStep(guideStep-1); }
},true);
document.querySelectorAll('.hmodal').forEach(m=>m.addEventListener('pointerdown',e=>{ if(e.target===m) closeModal(m.id); }));
document.addEventListener('keydown',e=>{ if(e.key!=='Escape') return; for(const id of ['addModal','guideModal']) if(!$(id).hidden){ e.stopImmediatePropagation(); closeModal(id); return; } },true);

// ================= 파츠 추가 (.psd · .clip · .png → 맨 위 폴더 미지정) =================
$('btnAdd').onclick=e=>{ e.currentTarget.blur(); if(isDemo()){ notice('데모 캐릭터에는 파츠를 추가할 수 없어요.\n내 파일을 불러와서 추가해 보세요.'); return; } openModal('addModal'); };
$('addClose').onclick=()=>closeModal('addModal');
$('addInput').onchange=e=>{ const fs=[...e.target.files]; e.target.value=''; addParts(fs); };
const addDrop=$('addDrop');
['dragover','dragenter'].forEach(ev=>addDrop.addEventListener(ev,e=>{ if(!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); addDrop.classList.add('over'); }));
addDrop.addEventListener('dragleave',()=>addDrop.classList.remove('over'));
addDrop.addEventListener('drop',e=>{ if(!isFileDrag(e)) return; e.preventDefault(); e.stopPropagation(); addDrop.classList.remove('over'); addParts([...e.dataTransfer.files]); });
async function addParts(files){
  if(isDemo()){ closeModal('addModal'); notice('데모 캐릭터에는 파츠를 추가할 수 없어요.\n내 파일을 불러와서 추가해 보세요.'); return; }
  files=files.filter(f=>/\.(psd|psb|clip|png)$/i.test(f.name)||f.type==='image/png');
  if(!files.length){ toast('.psd · .clip · .png 파일만 추가할 수 있어요'); return; }
  $('loading').classList.add('show');
  const added=[], fails=[];
  try{
    for(const f of files){
      try{
        if(/\.png$/i.test(f.name)||f.type==='image/png'){
          const bmp=await createImageBitmap(f); const c=mkCanvas(bmp.width,bmp.height); c.getContext('2d').drawImage(bmp,0,0);
          const node={type:'layer',name:f.name.replace(/\.png$/i,''),_img:{canvas:c,left:0,top:0},blend:'norm',opacity:1,hidden:false};
          added.push(mkL(node,node.name,true));
        } else {
          const buf=await f.arrayBuffer(); const d=/\.clip$/i.test(f.name)?await parseCLIP(buf):await parsePSD(buf);
          const walk=n=>{ for(const ch of n.children.slice().reverse()){ if(ch.type==='group') walk(ch); else if(nodeImage(ch)) added.push(mkL(ch,cleanName(ch.name||'')||'레이어',!ch.hidden)); } };   // 위→아래, 폴더는 풀어서
          walk(d.root);
        }
      }catch(err){ console.error(err); fails.push(f.name); }
    }
  } finally { $('loading').classList.remove('show'); }
  if(added.length){
    let F=blocks.find(b=>b.type==='folder'&&b.name==='추가 파츠');
    if(F) F.layers.unshift(...added);
    else { F={id:++uid,type:'folder',name:'추가 파츠',multi:false,randomOn:true,layers:added,clipTo:null,clipOn:false,gblend:'norm',gop:1}; blocks.unshift(F); }
    if(!F.multi&&added.filter(L=>L.on).length>1) F.multi=true;
    afterMoveInto(F); normalize();
    closeModal('addModal'); renderPanel(); render();
    toast(`파츠 ${added.length}개를 '추가 파츠' 폴더에 넣었어요`+(fails.length?` · 읽지 못한 파일 ${fails.length}개`:''),2200);
  } else toast(fails.length?'파일을 읽지 못했어요.':'추가할 레이어가 없어요.');
}

// ================= 데모 캐릭터 =================
// 빌드할 때 데모 PSD가 들어감 (한 파일 버전: data URI · 나눈 버전: demo/demo.psd)
const DEMO_SRC='demo/demo.psd.gz', DEMO_NAME='시범조교 양.psd';
const DEMO_NOSAVE='데모 캐릭터는 한 장씩 저장할 수 없어요.\nPNG 연속 저장 기능을 사용해주세요.';
const isDemo=()=>!!doc?.demo;
async function demoBytes(){
  let buf;
  if(DEMO_SRC.startsWith('data:')){ const b=atob(DEMO_SRC.slice(DEMO_SRC.indexOf(',')+1)); const u=new Uint8Array(b.length); for(let k=0;k<b.length;k++) u[k]=b.charCodeAt(k); buf=u.buffer; }
  else { const r=await fetch(DEMO_SRC); if(!r.ok) throw new Error('demo'); buf=await r.arrayBuffer(); }
  const h=new Uint8Array(buf,0,2);
  if(h[0]===0x1f&&h[1]===0x8b) buf=await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();   // 압축된 데모 풀기 (서버가 이미 풀어서 보내면 그대로)
  return buf;
}
// 시범조교 양 기본 설정 (만든 사람이 정리해 둔 상태)
function applyDemoPreset(){
  const F=n=>blocks.find(b=>b.type==='folder'&&b.name===n);
  const loose=n=>blocks.find(b=>b.type==='loose'&&b.layers.some(L=>L.node.name===n));
  const Lof=(B,n)=>B?.layers.find(L=>L.node.name===n);
  const order=(B,names)=>{ if(!B) return; const rest=B.layers.filter(L=>!names.includes(L.node.name)); B.layers=[...names.map(n=>Lof(B,n)).filter(Boolean),...rest]; };
  const only=(B,n)=>{ if(!B) return; B.layers.forEach(L=>L.on=L.def=L.node.name===n); B.hidden=B.defHidden=false; };
  {   // 폴더 순서(위→아래): 악세-눈썹-안광-눈-흰자위-감정표현-입. 다른 묶음 자리는 그대로
    const want=['악세','눈썹','안광','눈','흰자위','감정표현','입'].map(F).filter(Boolean);
    const slots=blocks.map((b,i)=>want.includes(b)?i:-1).filter(i=>i>=0);
    slots.forEach((i,k)=>blocks[i]=want[k]);
  }
  order(F('입'),[':)',':D',':(']); order(F('안광'),['정면','옆']); order(F('눈'),['일반 눈','반눈2','반눈1']); order(F('흰자위'),['일반 눈 흰자위','반눈 흰자위']);
  only(F('감정표현'),'레이어 3'); only(F('입'),':)');
  for(const n of ['원산지표기','클리핑 확인용 레이어(풀었다 걸었다 해보세요)']){ const B=loose(n); if(B) B.hideMake=true; }
  const link=(fn,ln,g,role)=>{ const L=Lof(F(fn),ln); if(L) L.link={g,role}; };
  link('눈','일반 눈',1,'main'); link('흰자위','일반 눈 흰자위',1,'main'); link('안광','정면',1,'sub');
  link('흰자위','반눈 흰자위',2,'main'); link('눈','반눈2',2,'sub'); link('눈','반눈1',2,'sub');
  lastLinkG=3;
  if(F('악세')){ F('악세').multi=true; F('악세').multiSet=true; }
  if(F('안광')) F('안광').randomOn=false;
  renderPanel(); render();
  requestAnimationFrame(()=>requestAnimationFrame(()=>{   // 확대 영역: 얼굴 부근 270×270
    region={x:76,y:71,w:270,h:270}; layoutPreview(); drawZoom();
  }));
}
$('btnDemo').onclick=async()=>{
  if(loadingFile) return;
  $('loading').classList.add('show'); loadingFile=true;
  try{ const d=await parsePSD(await demoBytes()); start(d,DEMO_NAME); doc.demo=true; applyDemoPreset(); }
  catch(e){ console.error(e); toast('데모 캐릭터를 불러오지 못했어요.',3000); }
  finally{ $('loading').classList.remove('show'); loadingFile=false; }
};

// 휴대폰 세로 배치: 위에 붙는 미리보기 바로 아래에 '레이어 표시' 줄을 고정
(()=>{
  const ph=document.querySelector('.panelhead.when-work'), left=document.querySelector('.left'), mq=matchMedia(MOBILE_Q);
  if(!ph||!left) return;
  const sync=()=>{ ph.style.setProperty('--phTop', mq.matches&&getComputedStyle(left).position==='sticky' ? left.offsetHeight+'px' : ''); if(!mq.matches) ph.style.removeProperty('--phTop'); };
  new ResizeObserver(rafOnce(sync)).observe(left); mq.addEventListener('change',sync); addEventListener('resize',sync); sync();
})();

// 휴대폰: 확대·전체 미리보기 떠 있는 창 (위치·크기·탭·최소화 상태를 기억)
(()=>{
  const left=document.querySelector('.left'), bar=$('pvBar'), KEY='charstudio.preview';
  const st={tab:'zoom',min:false,x:null,y:null,w:null,h:null};
  try{ Object.assign(st,JSON.parse(localStorage.getItem(KEY)||'{}')); }catch(e){}
  const save=()=>{ try{ localStorage.setItem(KEY,JSON.stringify(st)); }catch(e){} };
  const VW=()=>document.documentElement.clientWidth, VH=()=>window.innerHeight;
  const bottomRoom=()=>mode==='make'?76:12;
  function apply(){
    left.classList.toggle('pv-t-zoom',st.tab==='zoom'); left.classList.toggle('pv-t-full',st.tab==='full');
    $('pvTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.t===st.tab));
    $('pvMin').setAttribute('aria-label',st.min?'다시 열기':'최소화'); $('pvMin').title=st.min?'다시 열기':'최소화';
    if(!MOBILE.matches){ left.classList.remove('pv-min-on'); return; }
    const W=VW(), H=VH();
    if(st.w==null){ st.w=Math.round(Math.min(250,W*.64)); st.h=Math.round(Math.min(300,H*.4)); }
    st.w=clamp(st.w,170,Math.max(170,W-16)); st.h=clamp(st.h,180,Math.max(180,H-16));
    if(st.x==null){ st.x=W-st.w-10; st.y=H-st.h-bottomRoom()-10; }
    left.classList.toggle('pv-min-on',st.min);
    left.style.setProperty('--pvW',st.w+'px'); left.style.setProperty('--pvH',st.h+'px');
    const cw=st.min?left.offsetWidth:st.w, chh=st.min?left.offsetHeight:st.h;
    const sb=document.querySelector('.left .savebar'), sbH=(mode==='make'&&sb&&getComputedStyle(sb).position==='fixed')?sb.offsetHeight:0;   // 아래 저장 버튼 줄에 가리지 않게
    const x=clamp(st.x,8,Math.max(8,W-cw-8)), y=clamp(st.y,8,Math.max(8,H-sbH-chh-8));
    left.style.setProperty('--pvX',x+'px'); left.style.setProperty('--pvY',y+'px');
  }
  const refresh=()=>requestAnimationFrame(()=>{ if(doc){ fitFrame(); layoutPreview(); } });
  $('pvTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{ st.tab=b.dataset.t; apply(); save(); refresh(); });
  $('pvMin').onclick=e=>{ e.stopPropagation(); st.min=!st.min; apply(); save(); refresh(); };
  // 창 옮기기: 위쪽 막대를 끌기 (최소화 상태에서 그냥 누르면 다시 열림)
  bar.addEventListener('pointerdown',e=>{
    if(!MOBILE.matches||e.target.closest('button')) return;
    const r=left.getBoundingClientRect(), sx=e.clientX, sy=e.clientY; let moved=false;
    const mv=ev=>{ const dx=ev.clientX-sx, dy=ev.clientY-sy; if(!moved&&Math.hypot(dx,dy)<5) return;
      if(!moved){ moved=true; left.classList.add('pv-dragging'); }
      st.x=Math.round(r.left+dx); st.y=Math.round(r.top+dy); apply(); ev.preventDefault(); };
    const up=()=>{ removeEventListener('pointermove',mv); removeEventListener('pointerup',up); removeEventListener('pointercancel',up);
      left.classList.remove('pv-dragging');
      if(moved){ const rr=left.getBoundingClientRect(); st.x=Math.round(rr.left); st.y=Math.round(rr.top); save(); }
      else if(st.min){ st.min=false; apply(); save(); refresh(); } };
    addEventListener('pointermove',mv,{passive:false}); addEventListener('pointerup',up); addEventListener('pointercancel',up);
  });
  // 창 크기 조정: 오른쪽 아래 모서리를 끌기
  $('pvResize').addEventListener('pointerdown',e=>{
    if(!MOBILE.matches) return; e.preventDefault(); e.stopPropagation();
    const h=e.currentTarget; h.setPointerCapture?.(e.pointerId);
    const sx=e.clientX, sy=e.clientY, w0=st.w, h0=st.h, r=left.getBoundingClientRect();
    const mv=ev=>{ st.w=Math.round(clamp(w0+ev.clientX-sx,170,VW()-r.left-8)); st.h=Math.round(clamp(h0+ev.clientY-sy,180,VH()-r.top-8)); apply(); };
    const up=()=>{ h.removeEventListener('pointermove',mv); h.removeEventListener('pointerup',up); h.removeEventListener('pointercancel',up); save(); refresh(); };
    h.addEventListener('pointermove',mv); h.addEventListener('pointerup',up); h.addEventListener('pointercancel',up);
  });
  MOBILE.addEventListener?.('change',()=>{ apply(); refresh(); });
  addEventListener('resize',rafOnce(apply));
  new MutationObserver(rafOnce(()=>{ apply(); })).observe(document.body,{attributes:true,attributeFilter:['class']});
  apply();
})();
