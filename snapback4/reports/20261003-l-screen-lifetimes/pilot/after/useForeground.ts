import {useEffect,useState} from 'react';
import {AppState,Platform} from 'react-native';
// Visibility is an application input; it is not inferred from a query.
export function useForeground(){
 const current=()=>AppState.currentState==='active'&&(Platform.OS!=='web'||document.visibilityState==='visible');
 const [foreground,set]=useState(current);
 useEffect(()=>{const update=()=>set(current()),sub=AppState.addEventListener('change',update);if(Platform.OS==='web')document.addEventListener('visibilitychange',update);update();return()=>{sub.remove();if(Platform.OS==='web')document.removeEventListener('visibilitychange',update)}},[]);
 return foreground;
}
