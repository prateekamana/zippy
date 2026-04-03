import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Login from './Login';
import Tasks from './Tasks';
import './styles.css';

function App() {
  const [loggedIn, setLoggedIn] = useState(null); // null = checking

  useEffect(() => {
    fetch('/api/session')
      .then(res => setLoggedIn(res.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  if (loggedIn === null) return null;
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;
  return <Tasks />;
}

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <>
      <div className="title-bar">
        <span className="title-bar-label">Zippy</span>
      </div>
      <App />
    </>
  </StrictMode>
);
