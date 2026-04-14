import { StrictMode, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Login from './Login';
import Tasks from './Tasks';
import FocusList from './FocusList';
import './styles.css';

function App() {
  const [loggedIn, setLoggedIn] = useState(null);
  const [page, setPage] = useState(() =>
    window.location.pathname === '/focus-list' ? 'focus' : 'tasks'
  );

  useEffect(() => {
    fetch('/api/session')
      .then(res => setLoggedIn(res.ok))
      .catch(() => setLoggedIn(false));
  }, []);

  useEffect(() => {
    function onPopState() {
      setPage(window.location.pathname === '/focus-list' ? 'focus' : 'tasks');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(target) {
    const path = target === 'focus' ? '/focus-list' : '/';
    history.pushState(null, '', path);
    setPage(target);
  }

  if (loggedIn === null) return null;
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;

  return (
    <>
      <div className="title-bar">
        <span className="title-bar-label">Zippy</span>
        <button
          className={`title-bar-nav-btn${page === 'focus' ? ' title-bar-nav-btn-active' : ''}`}
          onClick={() => navigate(page === 'focus' ? 'tasks' : 'focus')}
        >
          {page === 'focus' ? '← Tasks' : '★ Focus List'}
        </button>
      </div>
      <div style={{ display: page === 'tasks' ? 'block' : 'none' }}><Tasks /></div>
      <div style={{ display: page === 'focus' ? 'block' : 'none' }}><FocusList /></div>
    </>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
