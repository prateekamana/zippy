import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Tasks from './Tasks';
import './styles.css';

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <Tasks />
    {/* <App /> */}
  </StrictMode>
);