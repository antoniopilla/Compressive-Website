import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LucideProvider } from 'lucide-react';
import './styles/global.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* Every outline icon draws the same 1.75px line, whatever its size. */}
    <LucideProvider strokeWidth={1.75} absoluteStrokeWidth>
      <App />
    </LucideProvider>
  </StrictMode>,
);
