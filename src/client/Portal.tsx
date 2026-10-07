import { useEffect, useRef } from 'react';
import type { Journey, ModuleId } from './hub-controller.ts';
import {MODULES} from '../shared/modules.ts';

export const modules=MODULES;

/** Presentation stays separate from each system's rule and result schema. */
export const modulePresentation:Record<ModuleId,{cue:string;detail:string;caption:string}>= {
  meihua:{cue:'时间 / 三数',detail:'本卦 · 互卦 · 变卦',caption:'墨生万象'},
  tarot:{cue:'78 张经典牌',detail:'四种牌阵 · 可选逆位',caption:'星启秘仪'},
  xiaoliu:{cue:'农历月 · 日 · 时',detail:'六宫循行 · 时宫落定',caption:'六宫循时'},
  lenormand:{cue:'36 张象征牌',detail:'三张连读 · 五张对照',caption:'花叶成句'},
  liuyao:{cue:'六次三币',detail:'纳甲 · 世应 · 多爻变化',caption:'铜声成卦'},
};

/** Vector constellations keep their interactive hit area in the DOM. */
export function Constellation({module,size=300}:{module:ModuleId;size?:number}) {
  const points:{x:number;y:number;r:number}[]=[];
  const addLine=(x1:number,y1:number,x2:number,y2:number,n=8)=>{for(let i=0;i<=n;i++)points.push({x:x1+(x2-x1)*i/n,y:y1+(y2-y1)*i/n,r:i===0||i===n?1.5:.65});};
  const circle=(cx:number,cy:number,r:number,n=64)=>{for(let i=0;i<n;i++)points.push({x:cx+Math.cos(i/n*Math.PI*2)*r,y:cy+Math.sin(i/n*Math.PI*2)*r,r:i%8===0?1.65:.65});};
  circle(160,160,118);
  if(module==='meihua') {
    circle(160,160,46,40);
    const codes=[[1,1,1],[1,1,0],[1,0,1],[1,0,0],[0,1,1],[0,1,0],[0,0,1],[0,0,0]];
    codes.forEach((lines,k)=>lines.forEach((line,j)=>{
      const a=k*Math.PI/4,r=84+j*8;
      const f=(x:number)=>({x:160+Math.sin(a)*r+Math.cos(a)*x,y:160-Math.cos(a)*r+Math.sin(a)*x});
      const ranges=line?[[-17,17]]:[[-17,-4],[4,17]];
      for(const [x1,x2] of ranges){const p=f(x1!),q=f(x2!);addLine(p.x,p.y,q.x,q.y,6);}
    }));
    for(let i=0;i<32;i++){const a=i/31*Math.PI;points.push({x:160+Math.sin(a)*23,y:137-Math.cos(a)*23,r:.7});points.push({x:160-Math.sin(a)*23,y:183-Math.cos(a)*23,r:.7});}
    for(const [cx,cy] of [[55,76],[267,242],[87,275]])for(let k=0;k<5;k++)circle(cx!+Math.cos(k*Math.PI*.4)*5,cy!+Math.sin(k*Math.PI*.4)*5,3,8);
  } else if(module==='tarot') {
    circle(160,160,89,48);
    for(const x of [103,137,171]){addLine(x,122,x+46,122);addLine(x+46,122,x+46,215);addLine(x+46,215,x,215);addLine(x,215,x,122);}
    for(let i=0;i<35;i++){const a=-Math.PI*.65+i/34*Math.PI*1.3;points.push({x:171+Math.cos(a)*36,y:90+Math.sin(a)*36,r:.9});}
    for(let k=0;k<5;k++){const a=-Math.PI/2+k*Math.PI*.8,b=-Math.PI/2+(k+1)*Math.PI*.8;addLine(160+Math.cos(a)*72,160+Math.sin(a)*72,160+Math.cos(b)*72,160+Math.sin(b)*72,12);}
  } else if(module==='xiaoliu') {
    circle(160,160,44,40);
    const nodes=Array.from({length:6},(_,i)=>({x:160+Math.cos(-Math.PI/2+i*Math.PI/3)*87,y:160+Math.sin(-Math.PI/2+i*Math.PI/3)*87}));
    nodes.forEach((p,i)=>{const q=nodes[(i+1)%6]!;addLine(p.x,p.y,q.x,q.y,10);circle(p.x,p.y,15,20);addLine(p.x,p.y,160,160,10);});
    for(let i=0;i<95;i++){const a=i/94*Math.PI*3,r=4+i/94*28;points.push({x:160+Math.cos(a)*r,y:160+Math.sin(a)*r,r:.9});}
  } else if(module==='lenormand') {
    circle(160,160,88,48);
    for(const [x,y] of [[87,121],[137,102],[187,121]]){addLine(x!,y!,x!+46,y!);addLine(x!+46,y!,x!+46,y!+94);addLine(x!+46,y!+94,x!,y!+94);addLine(x!,y!+94,x!,y!);}
    for(let k=0;k<4;k++)circle(160+Math.cos(k*Math.PI/2)*13,148+Math.sin(k*Math.PI/2)*13,12,20);
    addLine(160,167,160,193);addLine(160,183,173,174);circle(160,148,3,8);
    for(let side=-1;side<=1;side+=2)for(let i=0;i<5;i++){
      const a=(.1+i*.15)*Math.PI,cx=160+side*Math.cos(a)*102,cy=160+Math.sin(a)*102;
      addLine(cx,cy,cx-side*9,cy-13,6);addLine(cx,cy,cx+side*8,cy-12,6);
    }
  } else {
    for(const [x,y] of [[119,108],[201,108],[160,79]]){circle(x!,y!,21,32);addLine(x!-6,y!-6,x!+6,y!-6,4);addLine(x!+6,y!-6,x!+6,y!+6,4);addLine(x!+6,y!+6,x!-6,y!+6,4);addLine(x!-6,y!+6,x!-6,y!-6,4);}
    [1,0,1,0,1,0].forEach((yang,i)=>{const y=150+i*16;if(yang)addLine(119,y,201,y,18);else{addLine(119,y,151,y,8);addLine(169,y,201,y,8);}});
    addLine(101,145,101,235,18);addLine(219,145,219,235,18);
  }
  return <svg width={size} height={size} viewBox="0 0 320 320" className={`wx-constellation wx-constellation-${module}`} aria-hidden="true">
    <circle cx="160" cy="160" r="118" className="wx-orbit"/><circle cx="160" cy="160" r="139" className="wx-orbit wx-orbit-outer"/>
    {points.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={p.r} className={p.r>1?'wx-star-anchor':'wx-star-dust'}/>)}
    <circle cx="160" cy={module==='meihua'?137:module==='xiaoliu'?160:module==='lenormand'?148:88} r="3.2" className="wx-star-anchor"/>
  </svg>;
}

export function CosmosMark() {return <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" strokeWidth=".8"/><path d="m14 4 2.5 7.5L24 14l-7.5 2.5L14 24l-2.5-7.5L4 14l7.5-2.5Z" fill="none" stroke="currentColor" strokeWidth=".8"/><circle cx="14" cy="14" r="2" fill="currentColor"/></svg>;}

export function Starfield({active,journey}:{active:boolean;journey?:Journey|null}) {
  const ref=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    const canvas=ref.current;
    if(!canvas||!active||typeof CanvasRenderingContext2D==='undefined')return;
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width=1,height=1,raf=0,disposed=false;
    const stars=Array.from({length:720},(_,i)=>{const n=Math.sin(i*127.1+31.7)*43758.5453,m=Math.sin(i*269.5+17.9)*43758.5453;return {x:n-Math.floor(n),y:m-Math.floor(m),depth:.2+(i%11)/13,r:i%29===0?1.6:.4+(i%7)*.12};});
    const resize=()=>{const box=canvas.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(reduced){cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);}};
    const frame=(now:number)=>{
      if(disposed||document.hidden)return;
      if(reduced)now=0;
      ctx.clearRect(0,0,width,height);
      const t=journey?Math.min(1,(Date.now()-journey.startedAt)/journey.duration):0;
      const collapse=journey?Math.min(1,Math.max(0,(t-.125)/.345)):0;
      const expand=journey?Math.max(0,(t-.56)/.44):0;
      const ox=(journey?.origin.x??.5)*width,oy=(journey?.origin.y??.5)*height;
      for(const [i,s] of stars.entries()) {
        let x=s.x*width+Math.sin(now*.000025+s.y*7)*13*s.depth,y=s.y*height+Math.cos(now*.000018+s.x*6)*9*s.depth;
        if(journey){const ease=collapse*collapse;x=x*(1-ease)+ox*ease;y=y*(1-ease)+oy*ease;if(expand){const a=s.x*Math.PI*2+Math.sin(i)*.4,r=expand*expand*Math.hypot(width,height)*s.depth;x=ox+Math.cos(a)*r;y=oy+Math.sin(a)*r;}}
        const alpha=(.3+s.depth*.6+Math.sin(now*.0008+i)*.08)*(1-expand*.65);
        ctx.fillStyle=`rgba(${i%7===0?'216,189,129':'172,207,238'},${alpha})`;ctx.beginPath();ctx.arc(x,y,s.r*(1+collapse*.45),0,Math.PI*2);ctx.fill();
        if(i%29===0){ctx.strokeStyle=`rgba(178,210,238,${alpha*.3})`;ctx.beginPath();ctx.moveTo(x-4,y);ctx.lineTo(x+4,y);ctx.moveTo(x,y-4);ctx.lineTo(x,y+4);ctx.stroke();}
      }
      if(journey&&t>.36&&t<.78){const radius=5+Math.max(0,t-.56)*width*1.5;const g=ctx.createRadialGradient(ox,oy,0,ox,oy,Math.max(20,radius));const hue=journey.to==='xiaoliu'?'142,193,182':journey.to==='lenormand'?'178,198,145':journey.to==='liuyao'?'201,161,108':journey.to==='meihua'?'154,164,153':'222,197,137';g.addColorStop(0,`rgba(${hue},.9)`);g.addColorStop(1,'rgba(175,197,223,0)');ctx.fillStyle=g;ctx.fillRect(0,0,width,height);}
      if(!reduced)raf=requestAnimationFrame(frame);
    };
    const visibility=()=>{cancelAnimationFrame(raf);if(!document.hidden&&!disposed)raf=requestAnimationFrame(frame);};
    resize();const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;observer?.observe(canvas);
    window.addEventListener('resize',resize);document.addEventListener('visibilitychange',visibility);cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
    return ()=>{disposed=true;cancelAnimationFrame(raf);observer?.disconnect();window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',visibility);};
  },[active,journey]);
  return <canvas ref={ref} className="wx-starfield" aria-hidden="true"/>;
}

export function Portal({active,onEnter}:{active:boolean;onEnter:(id:ModuleId,origin:{x:number;y:number})=>void}) {
  const ref=useRef<HTMLElement>(null);
  return <section ref={ref} className="wx-portal" aria-label="选择占卜方式">
    <Starfield active={active}/><div className="wx-nebula" aria-hidden="true"/>
    <div className="wx-portal-heading"><p className="wx-kicker"><span/>问象 · THE QUIET BETWEEN STARS<span/></p><h1>一念起，万象生</h1><p>五种观象方式，从此刻的一问开始。</p></div>
    <div className="wx-portal-guide"><span>选择一种方式</span><p>起卦与抽牌可在本地完成，解读时再选择模型。</p><span aria-hidden="true">01 — 05</span></div>
    <div className="wx-portals">{modules.map(m=><button type="button" key={m.id} className={`wx-gateway wx-gateway-${m.id}`} onClick={event=>{const page=ref.current!.getBoundingClientRect(),box=event.currentTarget.getBoundingClientRect();onEnter(m.id,{x:(box.left+box.width/2-page.left)/page.width,y:(box.top+box.height/2-page.top)/page.height});}}>
      <span className="wx-gateway-tradition"><b>{m.index}</b><span>{m.tradition}</span></span><Constellation module={m.id}/><span className="wx-gateway-title">{m.title}</span><span className="wx-gateway-subtitle">{m.subtitle}</span><span className="wx-gateway-cue">{modulePresentation[m.id].cue}</span><span className="wx-gateway-detail">{modulePresentation[m.id].detail}</span><span className="wx-gateway-enter">进入此境 <span aria-hidden="true">↗</span></span>
    </button>)}</div>
    <footer className="wx-portal-footer"><span>星河无言，万象有迹。</span><span>本地起象 · 共享背景 · 围绕结果追问</span><span>供娱乐与自省</span></footer>
  </section>;
}
