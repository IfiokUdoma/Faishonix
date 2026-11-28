// Measure a dark, centred foot on portrait A4 against a darker background.
// Reject ambiguous photos so the caller can ask for manual calibration.
export function estimateFootOnA4(image){
  const {data,width,height}=image;
  if(width<40||height<40)return null;
  const luminance=(x,y)=>{
    const i=(y*width+x)*4;
    return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  };
  const midX=Math.floor(width/2);
  const midY=Math.floor(height/2);
  const insetX=Math.floor(width*.065);
  const insetY=Math.floor(height*.065);
  const bright=(x,y)=>luminance(x,y)>=195;
  let left=width,right=-1,top=height,bottom=-1;
  for(let y=insetY;y<height-insetY;y++){
    for(let x=insetX;x<width-insetX;x++){
      if(!bright(x,y))continue;
      if(x<left)left=x;
      if(x>right)right=x;
      if(y<top)top=y;
      if(y>bottom)bottom=y;
    }
  }
  const paperWidth=right-left+1,paperHeight=bottom-top+1;
  if(left<=insetX||right>=width-insetX-1||top<=insetY||bottom>=height-insetY-1||
    paperHeight<height*.34||Math.abs(paperWidth/paperHeight-21/29.7)>.065||
    left>=midX||right<=midX||top>=midY||bottom<=midY)return null;
  for(let offset=1;offset<=3;offset++){
    if(!bright(left+offset,top+offset)||!bright(right-offset,top+offset)||
      !bright(left+offset,bottom-offset)||!bright(right-offset,bottom-offset))return null;
  }
  let first=bottom,last=top,maxSpan=0,darkCount=0;
  const edge=Math.max(2,Math.round(paperWidth*.075));
  for(let y=top+edge;y<=bottom-edge;y++){
    let rowMin=right,rowMax=left;
    for(let x=left+edge;x<=right-edge;x++){
      if(luminance(x,y)>145)continue;
      rowMin=Math.min(rowMin,x);
      rowMax=Math.max(rowMax,x);
      darkCount++;
    }
    const span=rowMax-rowMin+1;
    if(span<Math.max(3,paperWidth*.035))continue;
    if(rowMin===left+edge||rowMax===right-edge)return null;
    first=Math.min(first,y);
    last=Math.max(last,y);
    maxSpan=Math.max(maxSpan,span);
  }
  const length=(last-first+1)*29.7/paperHeight;
  const footWidth=maxSpan*21/paperWidth;
  const fill=darkCount/((last-first+1)*maxSpan);
  if(length<20||length>28||footWidth<5||footWidth>13||fill<.5||fill>1||first<=top+edge||last>=bottom-edge)return null;
  return {length:Number(length.toFixed(1)),width:Number(footWidth.toFixed(1))};
}
