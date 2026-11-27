const looks = [
  ['Casual', /casual|weekend|relaxed|friday|everyday|décontracté|informal/u, 'Linen shirt and straight-leg chinos', 'Linen blouse and straight-leg jeans', 'Pair with clean trainers and a canvas tote.'],
  ['Professional', /work|office|interview|professional|business|meeting|bureau|oficina/u, 'Navy blazer and pressed trousers', 'Tailored blazer and straight-leg trousers', 'Finish with loafers and a structured bag.'],
  ['Formal', /formal|wedding|gala|elegant|black tie|mariage|boda/u, 'Dark suit and a crisp shirt', 'Midi occasion dress', 'Choose polished shoes and understated accessories. Check the invitation’s dress code.'],
  ['Traditional', /traditional|cultural|ankara|aso oke|agbada|owambe|native/u, 'Agbada or a tailored senator set', 'Ankara or aso oke occasion set', 'Let the fabric lead and keep accessories simple.'],
  ['Sporty', /sport|gym|active|running|training|workout/u, 'Technical tee and tapered joggers', 'Training top and high-rise leggings', 'Choose trainers suited to your activity.'],
  ['Romantic', /romantic|date|dinner|soft|rendez-vous/u, 'Knit polo and pleated trousers', 'Soft midi dress with a light layer', 'Add a simple accessory and a comfortable dress shoe.'],
  ['Street', /street|edgy|streetwear|urban/u, 'Boxy overshirt and cargo trousers', 'Cropped jacket and wide-leg cargos', 'Keep one statement piece and ground it with simple trainers.'],
  ['Bold', /bold|fashion-forward|statement|party|festival/u, 'Statement jacket and tonal trousers', 'Colour-block separates', 'Echo one accent colour in a bag or shoe.'],
  ['Beach', /beach|holiday|vacation|resort|plage|playa/u, 'Linen shirt and tailored shorts', 'Cotton sundress and flat sandals', 'Add a sun hat and a lightweight layer.']
];
const garments=[
  ['shirt','Shirt','Pair a structured shirt with straight-leg trousers. Roll the sleeves for a relaxed occasion.'],
  ['blazer','Blazer','Pair with tonal tailored trousers for work or straight-leg denim for a casual look.'],
  ['dress','Dress','Try a short structured jacket and simple shoes that suit the occasion.'],
  ['jeans','Jeans','Pair straight-leg jeans with a tucked-in shirt and clean trainers.'],
  ['sneakers','Sneakers','Pair clean sneakers with lightweight chinos or wide-leg denim.'],
  ['trousers','Trousers','Add a neatly tucked shirt and loafers.'],
  ['skirt','Skirt','Pair with a fitted knit top and add a jacket for cooler weather.']
];

export function styleSuggestions(query,gender){
  if(typeof query!=='string'||query.length>180)return [];
  const words=query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}-]+/gu)||[];
  const matches=looks.filter(([,pattern])=>words.some(word=>new RegExp(`^(?:${pattern.source})$`,'u').test(word)) || ['black tie'].some(phrase=>query.toLowerCase().includes(phrase)&&pattern.test(phrase)));
  const items=matches.map(([match,,male,female,desc])=>({name:gender==='female'?female:male,desc,match,emoji:'✦'}));
  for(const [word,name,desc] of garments){
    if(words.includes(word))items.push({name,desc,match:'Garment pairing',emoji:'✦'});
  }
  return items;
}
