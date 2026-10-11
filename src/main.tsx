import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { iniciar } from './store';
import { rodar } from './automation';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void iniciar().then(() => {
  void rodar();
  // a esteira confere sozinha se ficou algo para trás (internet caiu, prefeitura fora do ar…)
  setInterval(() => void rodar(), 60_000);
  window.addEventListener('online', () => void rodar());
});
