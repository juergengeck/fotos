import '../global.css';
import React, {useEffect, useState} from 'react';
import {registerRootComponent} from 'expo';
import {useKeepAwake} from 'expo-keep-awake';
import {FireTvApp} from './ui';
import {FireTvRuntime} from './runtime/FireTvRuntime';

const runtime = new FireTvRuntime();

function App() {
  useKeepAwake();
  const [snapshot, setSnapshot] = useState(() => runtime.getSnapshot());
  useEffect(() => {
    const unsubscribe = runtime.subscribe(setSnapshot);
    void runtime.start();
    return unsubscribe;
  }, []);
  return <FireTvApp
    {...snapshot}
    onPair={() => {void runtime.createPairingInvitation();}}
    onClosePairing={() => runtime.closePairing()}
    onRetry={() => {void runtime.retry();}}
  />;
}

registerRootComponent(App);
