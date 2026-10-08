import {useEffect,useRef,useState} from 'react';
import {PreflightStatus} from './GenerationStatus.tsx';

export interface ReadingNavigation {sequence:number;target:'result'|'interpretation'|'latest'}

/** Keep every scroll inside the module, independent of the host's scroll position. */
export function scrollWithin(panel:HTMLElement,target:HTMLElement,end=false):void {
  const panelBox=panel.getBoundingClientRect(),targetBox=target.getBoundingClientRect();
  const style=panel.ownerDocument.defaultView?.getComputedStyle(panel),height=Number.parseFloat(style?.height??'');
  // offsetHeight rounds fractional layout pixels. On a long answer that small
  // error becomes a visible jump offset at 150% zoom, so use the computed box.
  const extra=style&&style.boxSizing!=='border-box'?['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'].reduce((sum,key)=>sum+(Number.parseFloat(style[key as keyof CSSStyleDeclaration] as string)||0),0):0;
  const layoutHeight=height>0?height+extra:panel.offsetHeight;
  const scale=layoutHeight>0&&panelBox.height>0?panelBox.height/layoutHeight:1;
  const toolbar=panel.querySelector('.wx-reading-jump')?.getBoundingClientRect().height??0;
  const top=panel.scrollTop+(end?(targetBox.bottom-panelBox.bottom)/scale+24:(targetBox.top-panelBox.top-toolbar)/scale-18);
  panel.scrollTop=Math.max(0,top);
}

/** A new successful action may navigate; streamed text never takes over a reader's scroll. */
export function useReadingNavigation({navigation,active=true,paused=false,contentKey,busy}:{navigation?:ReadingNavigation;active?:boolean;paused?:boolean;contentKey:string;busy:boolean}) {
  const ref=useRef<HTMLElement>(null),handled=useRef(0),follow=useRef(true),previous=useRef(contentKey);
  const [hasNewContent,setHasNewContent]=useState(false);
  const getLatest=()=>{const ends=ref.current?.querySelectorAll<HTMLElement>('[data-reading-end]');return ends?.length?ends[ends.length-1]:undefined;};
  const jump=(target:'result'|'interpretation'|'latest')=>{
    const panel=ref.current;if(!panel)return;
    const node=target==='latest'?getLatest():panel.querySelector<HTMLElement>(`[data-reading-${target}]`);
    if(node){scrollWithin(panel,node,target==='latest');if(target!=='latest'){node.setAttribute('tabindex','-1');node.focus({preventScroll:true});}}
    follow.current=target==='latest';setHasNewContent(false);
  };
  useEffect(()=>{
    const panel=ref.current;if(!panel)return;
    const onScroll=()=>{
      const end=getLatest();if(!end)return;
      const near=end.getBoundingClientRect().bottom<=panel.getBoundingClientRect().bottom+96;
      follow.current=near;if(near)setHasNewContent(false);
    };
    panel.addEventListener('scroll',onScroll,{passive:true});return()=>panel.removeEventListener('scroll',onScroll);
  },[]);
  useEffect(()=>{
    if(!active||paused||!navigation||navigation.sequence===handled.current)return;
    const timer=setTimeout(()=>{
      if(!ref.current)return;
      handled.current=navigation.sequence;jump(navigation.target);
      // The heading stays visible while a new response starts; once the answer
      // extends below the viewport, the reader controls whether to follow it.
      const end=getLatest();follow.current=!!end&&end.getBoundingClientRect().bottom<=ref.current.getBoundingClientRect().bottom+96;
    },0);
    return()=>clearTimeout(timer);
  },[navigation?.sequence,active,paused]);
  useEffect(()=>{
    if(previous.current===contentKey)return;previous.current=contentKey;
    if(!active||paused)return;
    const panel=ref.current,end=getLatest();if(!panel||!end)return;
    if(follow.current)scrollWithin(panel,end,true);else if(busy)setHasNewContent(true);
  },[contentKey,active,paused,busy]);
  return {ref,jump,hasNewContent};
}

export function ReadingJump({onJump,hasNewContent=false,preflight=false,onCancel}:{onJump:(target:'result'|'interpretation'|'latest')=>void;hasNewContent?:boolean;preflight?:boolean;onCancel?:()=>Promise<void>}) {
  return <nav className="wx-reading-jump" aria-label="阅读位置">{preflight&&onCancel&&<PreflightStatus active onCancel={onCancel}/>}<button type="button" onClick={()=>onJump('interpretation')}>本轮解读</button><button type="button" onClick={()=>onJump('latest')}>{hasNewContent?'有新内容 · 回到最新':'回到最新'}</button></nav>;
}
