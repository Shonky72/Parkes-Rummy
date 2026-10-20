import { createElement as h } from 'react';
import { ImageResponse } from 'next/og';
import type { SharedRecord } from '../db/records';
import { RECORDS_PUBLIC_HEADERS } from './records-server';
import { sharedConditionLines } from './record-condition-label';
const rank=(n:number)=>n===14||n===1?'A':n===13?'K':n===12?'Q':n===11?'J':String(n);
const suitPaths={
  H:'M12 25C8 21 1 15 1 8C1 1 9-1 12 5C15-1 23 1 23 8C23 15 16 21 12 25Z',
  D:'M12 1L23 13L12 26L1 13Z',
  S:'M12 1C8 7 1 12 1 17C1 23 8 26 11 20L8 27H16L13 20C16 26 23 23 23 17C23 12 16 7 12 1Z',
  C:'M12 1C4 1 5 11 9 12C0 6-3 21 5 22C8 22 10 20 11 19L8 27H16L13 19C14 20 16 22 19 22C27 21 24 6 15 12C19 11 20 1 12 1Z',
};

export function sharedRecordImage(record:SharedRecord):ImageResponse {
  const cards=record.opening.flatMap(m=>m.cards);
  const conditions=sharedConditionLines(record.conditions);
  const children=[
    h('div',{key:'brand',style:{display:'flex',justifyContent:'space-between',fontSize:24,color:'#e6ca83'}},h('span',null,'PARKES RUMMY'),h('span',null,'Beat my record')),
    h('div',{key:'name',style:{fontSize:26,marginTop:18,color:'#e9f1ea'}},record.displayName),
    h('div',{key:'rule',style:{fontSize:18,marginTop:4,color:'#d7c996'}},`${record.game===4?'Original Rules':`Game ${record.game}`} | Rule ${record.ruleNumber}`),
    h('div',{key:'title',style:{fontSize:34,marginTop:4,fontWeight:700,color:'#ffebba'}},record.ruleName),
    h('div',{key:'turn',style:{fontSize:56,fontWeight:700,marginTop:6}},`Opening on Turn ${record.openingTurn}`),
    h('div',{key:'cards',style:{display:'flex',gap:8,marginTop:16}},...cards.map((card,index)=>{
      const color=card.suit==='D'||card.suit==='H'?'#af263a':'#142c29';
      return h('div',{key:index,style:{width:78,height:106,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,background:'#fff9e9',color,borderRadius:9,fontSize:27,fontWeight:700}},
        h('span',null,rank(card.rank)),h('svg',{width:24,height:28,viewBox:'0 0 24 28'},h('path',{d:suitPaths[card.suit],fill:color})));
    })),
    h('div',{key:'conditions',style:{display:'flex',flexDirection:'column',gap:4,fontSize:18,marginTop:16,color:'#d7e5d9'}},...conditions.map((line,index)=>h('div',{key:index},line))),
    h('div',{key:'foot',style:{display:'flex',justifyContent:'space-between',fontSize:17,marginTop:14,color:'#d7c996'}},h('span',null,'Completed hand | Personal turns, shared ties'),h('span',null,'parkesrummy.com | IBD Collective')),
  ];
  return new ImageResponse(h('div',{style:{width:'100%',height:'100%',display:'flex',flexDirection:'column',padding:'32px 48px',background:'#083d30',color:'#fff7de',border:'8px solid #bf9d50',fontFamily:'sans-serif'}},...children),{width:1200,height:630,headers:{...RECORDS_PUBLIC_HEADERS,'Content-Disposition':'inline; filename="parkes-rummy-record.png"'}});
}
