import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpikeApp } from './spike/SpikeApp';
import './spike/spike.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpikeApp />
  </StrictMode>,
);
