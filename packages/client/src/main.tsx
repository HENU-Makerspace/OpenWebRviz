import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import * as ROSLIB from 'roslib';
import { EventEmitter2 } from 'eventemitter2';

// Expose to window for compatibility
(window as any).ROSLIB = ROSLIB;
(window as any).EventEmitter2 = EventEmitter2;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
