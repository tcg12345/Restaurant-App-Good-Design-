import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import type { ReviewSnapshot } from './in-review';

/** Draw from explicit recap fields; never screenshot private UI or fetch photos. */
export function reviewCard(r: ReviewSnapshot, includeFavorite = false): string {
  const canvas=document.createElement('canvas'); canvas.width=1080; canvas.height=1920;
  const c=canvas.getContext('2d'); if(!c) throw new Error('Image export is unavailable.');
  const annual=r.period.kind==='year';
  const gradient=c.createLinearGradient(0,0,1080,1920);
  gradient.addColorStop(0,annual?'#151b35':r.period.kind==='week'?'#163e35':'#163c64'); gradient.addColorStop(1,annual?'#493429':'#102127');
  c.fillStyle=gradient; c.fillRect(0,0,1080,1920);
  c.strokeStyle='#a8d0b844'; c.lineWidth=2;
  for(let i=0;i<5;i++){c.beginPath();c.arc(940,460,180+i*68,0,Math.PI*2);c.stroke();}
  const text=(value:string,x:number,y:number,size:number,color='#fff',weight=600)=>{c.fillStyle=color;c.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;c.fillText(value,x,y);};
  const wrap=(value:string,x:number,y:number,size:number,max:number,lines=3)=>{
    c.font=`600 ${size}px -apple-system, BlinkMacSystemFont, Arial, sans-serif`;
    const words=value.split(/\s+/); const rows:string[]=[]; let row='';
    for(const word of words){if(c.measureText(row+' '+word).width>max&&row){rows.push(row);row=word;}else row+=(row?' ':'')+word;}
    if(row)rows.push(row);
    rows.slice(0,lines).forEach((line,i)=>{let out=line;if(i===lines-1&&rows.length>lines)out+='…';while(c.measureText(out).width>max&&out.length>1)out=out.slice(0,-2)+'…';text(out,x,y+i*size*1.16,size);});
  };
  text('GoodEats',80,130,43);text('IN REVIEW',80,190,23,'#ffffffaa');
  text(annual?'THE ANNUAL EDITION':`MY ${r.period.kind.toUpperCase()} IN FOOD`,80,345,23,'#a8d0b8');
  wrap(annual?'Good taste.\nA whole year of it.':'Good food. Good memories. Very me.',80,470,91,910,3);
  text(r.period.label,80,825,32,'#ffffffbb',400);
  const stats=[['Places rated',r.places],['Cuisines',r.cuisines.length],['Home meals',r.meals],['Recipes created',r.recipes]];
  stats.forEach(([label,n],i)=>{const x=80+(i%2)*475,y=1070+Math.floor(i/2)*250;text(String(n),x,y,113);text(String(label),x,y+55,28,'#ffffffbb',400);});
  if(includeFavorite&&r.favorite){text('MY STANDOUT TABLE',80,1570,22,'#ffffff99');wrap(r.favorite.name,80,1630,40,920,2);}
  else {text(r.cuisines[0]?`Top cuisine: ${r.cuisines[0].name}`:'A little more good taste, every day.',80,1640,31,'#ffffffcc',400);}
  c.fillStyle='#ffffff33';c.fillRect(80,1745,920,1);text('Make every meal a good one.',80,1830,29,'#ffffffbb',400);
  return canvas.toDataURL('image/png');
}
export async function shareReviewCard(dataUrl:string, r:ReviewSnapshot):Promise<'shared'|'downloaded'|'cancelled'> {
  const filename=`GoodEats-${r.period.kind}-${r.period.start}.png`;
  if(Capacitor.isNativePlatform()){
    const path=`reviews/${filename}`;
    const {uri}=await Filesystem.writeFile({path,directory:Directory.Cache,data:dataUrl.split(',')[1],recursive:true});
    try {await Share.share({title:'GoodEats in Review',files:[uri],dialogTitle:'Share your GoodEats review'});return 'shared';}
    catch(error){if(/cancel|abort/i.test(String(error)))return 'cancelled';throw error;}
    finally {void Filesystem.deleteFile({path,directory:Directory.Cache}).catch(()=>{});}
  }
  const blob=await (await fetch(dataUrl)).blob();
  const file=new File([blob],filename,{type:'image/png'});
  if(navigator.canShare?.({files:[file]})&&navigator.share){
    try {await navigator.share({files:[file],title:'GoodEats in Review'});return 'shared';}
    catch(error){if(error instanceof Error&&error.name==='AbortError')return 'cancelled';throw error;}
  }
  const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=filename;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),10000);return 'downloaded';
}
