import React from 'react';
import {useLocalSearchParams} from 'expo-router';
import {Guard,Profile} from '../../src/screens';
export default function ProfileRoute(){const {handle}=useLocalSearchParams<{handle:string}>();return <Guard><Profile handle={handle}/></Guard>}
