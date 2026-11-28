/**
 * Add a sizing link to a product page. Opening a new tab lets the shopper
 * grant camera access directly to Faishonix and keeps scans off the host page.
 */
export function mountSizeGuide(container,{origin,mode='body',label='Find my size'}={}){
  if(!(container instanceof Element))throw new TypeError('A container element is required.');
  const url=new URL(origin);
  if(url.protocol!=='https:')throw new TypeError('Use the HTTPS Faishonix origin.');
  if(!['body','shoes'].includes(mode))throw new TypeError('Choose body or shoes.');
  url.pathname='/';
  url.search='';
  url.hash=mode==='shoes'?'shoe-scan':'scanner';
  const link=document.createElement('a');
  link.href=url.href;
  link.target='_blank';
  link.rel='noopener noreferrer';
  link.textContent=label;
  link.className='faishonix-size-guide';
  container.append(link);
  return link;
}
