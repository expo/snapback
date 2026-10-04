import React, {useState} from 'react';
import {View, Text, Pressable, ScrollView, Linking} from 'react-native';
import {usePathname, useLocalSearchParams, router} from 'expo-router';
import {useAuth,useClient,useQuery,useMutation,useAsset} from 'snapback4/react';
import * as ImagePicker from 'expo-image-picker';
import {AuthForm,ProfileForm,FeedTabs} from '../ui';
import {Insights} from './Insights';
import {Search} from './Search';
import {Chats,NewChat,ConversationRoute} from './Chats';
import {Feed,Thread,AuthorPosts} from './Feed';
import {api} from '../snapback/generated/api';
const empty={displayName:'',handle:'',bio:'',location:'',link:''};
export function Nav({label,path,testID}:{label:string,path?:string,testID?:string}){return <Pressable testID={testID} onPress={()=>router.push(path as any)} style={{padding:14}}><Text style={{color:'#4f46e5',fontWeight:'600'}}>{label}</Text></Pressable>}
export default function Shell(){
 const auth=useAuth();
 const [mode,setMode]=useState<'sign-in'|'sign-up'>('sign-in'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 if(auth.state==='restoring')return <Text>Restoring account…</Text>;
 if(auth.state!=='signed-in')return <View style={{maxWidth:520,width:'100%',alignSelf:'center',paddingTop:70}}><AuthForm mode={mode} email={email} password={password} onChangeEmail={setEmail} onChangePassword={setPassword} onToggleMode={()=>{setMode(mode==='sign-in'?'sign-up':'sign-in');setError('')}} errorText={error} submitting={busy} onSubmit={async()=>{setBusy(true);try{const r=await (mode==='sign-up'?auth.signup(email,password):auth.login(email,password));if(!r.ok)setError(r.why.message);else router.replace('/');}catch(e){setError(String(e))}finally{setBusy(false)}}}/></View>;
 return <SignedIn/>;
}
function SignedIn(){
 const path=usePathname(),auth=useAuth(),me=useQuery(api.me,{});const params=useLocalSearchParams<{tab?:string}>();const feedTab=(params.tab??'following') as any;
 if(!('data' in me))return <Text>{'denied' in me?me.denied.message:'Loading profile…'}</Text>;
 if(!me.data)return <Editor initial={empty}/>;
 return <View style={{flex:1,backgroundColor:'#f8fafc'}}><View style={{flexDirection:'row',borderBottomWidth:1,borderColor:'#e2e8f0',backgroundColor:'white'}}><Nav label="Clique" path="/"/><Nav label="Feed" path="/"/><Nav label="My profile" path={'/profile/'+me.data.handle}/><Nav label="Chats" path="/chats"/><Nav label="Search" path="/search"/><Nav label="Settings" path="/settings"/></View><FeedTabs active={feedTab} onChange={t=>router.push(('/?tab='+t) as any)}/>{path.startsWith('/conversation/')?<ConversationRoute key={path} path={path}/>:<ScrollView contentContainerStyle={{maxWidth:760,width:'100%',alignSelf:'center',padding:20}}>
 {path==='/insights'?<Insights/>:path==='/search'?<Search/>:path==='/chats'?<Chats/>:path==='/new-chat'?<NewChat/>:path==='/settings'?<Pressable testID="sm-settings-logout" onPress={()=>void auth.logout()}><Text>Log out</Text></Pressable>:path==='/profile/edit'?<Editor initial={{...me.data,link:me.data.link??''}}/>:path.startsWith('/profile/')?<Profile handle={decodeURIComponent(path.split('/')[2])}/>:path.startsWith('/post/')?<Thread id={path.split('/')[2]}/>:<><Chats/><Feed tab={feedTab}/></>}
 </ScrollView>}</View>
}
function Profile({handle}:{handle:string}){
 const auth=useAuth(),read=useQuery(api.profile,{handle});const p='data' in read?read.data:null;const avatar=useAsset(p?.avatar?.id??null);
 if(!p)return <Text>{'denied' in read?read.denied.message:'Loading profile…'}</Text>;
 const shared={...p,link:p.link??'',avatarUri:avatar.status==='ready'?avatar.url:undefined,followerCount:0,followingCount:0,onPressFeed:()=>router.push('/'),onPressLink:(url:string)=>Linking.openURL(url)};
 return <ProfileContent p={p} shared={shared}/>;
}
function Editor({initial}:{initial:any}){
 const [values,setValues]=useState(initial),[error,setError]=useState('');const client=useClient(),save=useMutation(api.saveProfile),place=useMutation(api.placeAvatar),avatar=useAsset(initial.avatar?.id??null);
 async function upload(){try{const p=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images']});if(p.canceled)return;const u=await client.upload(await(await fetch(p.assets[0].uri)).blob());if(!u.ok){setError(u.why.message);return}const r=await place.run({avatar:{id:u.asset.id}});if(r.state==='failed')setError(r.why.message);}catch(e){setError(String(e))}}
 return <ProfileForm mode="edit" values={values} avatarUri={avatar.status==='ready'?avatar.url:undefined} onChange={p=>setValues({...values,...p})} onPressAvatar={()=>void upload()} errorText={error} saving={save.inFlight} onPressSave={async()=>{try{const r=await save.run({displayName:values.displayName,handle:values.handle,bio:values.bio,location:values.location,link:values.link||null});if(r.state==='failed')setError(r.why.message);else if(r.state==='sent')router.replace('/profile/'+values.handle);else setError('Profile queued; waiting for connection.')}catch(e){setError(String(e))}}}/>;
}

function ProfileContent({p,shared}:{p:any,shared:any}){const auth=useAuth(),state=useQuery(api.followState,{principal:p.principal}),follow=useMutation(api.setFollow);const s='data'in state?state.data:null;const props={...shared,followerCount:s?.followers??0,followingCount:s?.follows??0};return <>{p.principal===auth.viewer&&<Nav label="Insights" path="/insights"/>}{p.principal===auth.viewer?<ProfileForm {...props} mode="view-own" onPressEdit={()=>router.push('/profile/edit')}/>:<ProfileForm {...props} mode="view-other" following={s?.following??false} onPressFollow={()=>{if(s)void follow.run({principal:p.principal,active:!s.following})}}/>}<AuthorPosts principal={p.principal}/></>}
