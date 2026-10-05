import {useVideoPlayer,VideoView} from 'expo-video';
export default function Video({uri}:{uri:string}){const player=useVideoPlayer(uri,p=>p.play());return <VideoView player={player} nativeControls style={{width:'100%',height:300}}/>}
