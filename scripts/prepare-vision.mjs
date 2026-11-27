import {createHash} from 'node:crypto';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';

const source=new URL('../node_modules/@mediapipe/tasks-vision/',import.meta.url);
const assets=new URL('../public/vision/',import.meta.url);
const model=new URL('pose.task',assets);
const modelUrl='https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const expectedHash='59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a';
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');

await mkdir(assets,{recursive:true});
await cp(new URL('vision_bundle.mjs',source),new URL('vision_bundle.mjs',assets));
const wasmDir=new URL('wasm/',assets);
await mkdir(wasmDir,{recursive:true});
for(const file of await readdir(new URL('wasm/',source))){
  await cp(new URL('wasm/'+file,source),new URL(file,wasmDir));
}
const cached=await readFile(model).catch(error=>{
  if(error.code==='ENOENT')return null;
  throw error;
});
if(!cached||digest(cached)!==expectedHash){
  const response=await fetch(modelUrl,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('Pose model download failed with HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(digest(bytes)!==expectedHash)throw new Error('Downloaded pose model failed integrity verification.');
  await writeFile(model,bytes);
}
