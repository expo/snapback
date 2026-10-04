import { Slot } from 'expo-router';
import { AppProvider } from 'snapback4/react';
import { app } from '../src/client';
export default function Layout(){return <AppProvider app={app}><Slot /></AppProvider>}
