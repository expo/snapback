import React from 'react';
export default function Video({uri}:{uri:string}){return React.createElement('video',{src:uri,controls:true,autoPlay:true,style:{width:'100%',maxHeight:450}})}
