import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

/** Place a modal beside the module scroll containers, within this plugin's panel. */
export function PanelLayer({children}:{children:ReactNode}) {
  const anchor=useRef<HTMLSpanElement>(null),[target,setTarget]=useState<HTMLElement|null>(null);
  useEffect(()=>{setTarget(anchor.current?.closest<HTMLElement>('.wx-hub')??anchor.current?.parentElement?.parentElement??null);},[]);
  return <><span ref={anchor} hidden/>{target&&createPortal(children,target)}</>;
}
