import React from 'react';
import { Stack } from 'expo-router';
import { SnapbackProvider } from 'snapback3/react';
import { client } from '../src/client';
export default function Layout(){return <SnapbackProvider client={client}><Stack screenOptions={{headerTitle:'Clique',contentStyle:{backgroundColor:'#f8f8fc'}}}/></SnapbackProvider>}
