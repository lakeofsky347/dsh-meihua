import {Fragment, type ReactNode} from 'react';

/** A deliberately small Markdown subset. Provider HTML, images and links remain text. */
function inline(text:string):ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part,index)=>part.startsWith('**')&&part.endsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:part.startsWith('`')&&part.endsWith('`')?<code key={index}>{part.slice(1,-1)}</code>:<Fragment key={index}>{part}</Fragment>);
}

/** Render headings, paragraphs and lists consistently without interpreting HTML. */
export function ReadingText({text,className=''}:{text:string;className?:string}) {
  const blocks:ReactNode[]=[],lines=text.replace(/\r\n?/g,'\n').split('\n');
  let paragraph:string[]=[],items:string[]=[],ordered=false;
  const flushParagraph=()=>{if(paragraph.length){blocks.push(<p key={blocks.length}>{inline(paragraph.join('\n'))}</p>);paragraph=[];}};
  const flushList=()=>{if(items.length){const children=items.map((item,index)=><li key={index}>{inline(item)}</li>);blocks.push(ordered?<ol key={blocks.length}>{children}</ol>:<ul key={blocks.length}>{children}</ul>);items=[];}};
  for(const line of lines){
    const heading=line.match(/^\s{0,3}#{1,6}\s+(.+)$/),bullet=line.match(/^\s*(?:[-*+]\s+|(\d+)[.)、]\s+)(.+)$/);
    if(heading){flushParagraph();flushList();blocks.push(<h4 key={blocks.length}>{inline(heading[1]!)}</h4>);}
    else if(bullet){flushParagraph();const nextOrdered=!!bullet[1];if(items.length&&ordered!==nextOrdered)flushList();ordered=nextOrdered;items.push(bullet[2]!);}
    else if(!line.trim()){flushParagraph();flushList();}
    else {flushList();paragraph.push(line);}
  }
  flushParagraph();flushList();
  return <div className={`wx-reading-text ${className}`}>{blocks}</div>;
}
