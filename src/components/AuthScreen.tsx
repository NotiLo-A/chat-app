import { useState, type KeyboardEvent } from 'react';
import type { AuthTab, AuthStatus } from '../types';

interface AuthScreenProps {
  status: AuthStatus;
  onLogin: (username: string, password: string) => void;
  onRegister: (username: string, password: string) => void;
  onToggleTheme: () => void;
  isDark: boolean;
}

export function AuthScreen({ status, onLogin, onRegister, onToggleTheme, isDark }: AuthScreenProps) {
  const [tab, setTab] = useState<AuthTab>('login');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [regUser, setRegUser]     = useState('');
  const [regPass, setRegPass]     = useState('');

  const handleLogin = () => onLogin(loginUser.trim(), loginPass);
  const handleRegister = () => onRegister(regUser.trim(), regPass);

  const enterSubmit = (e: KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter') { e.preventDefault(); fn(); }
  };

  return (
    <>
      <div className="theme-corner">
        <button className="theme-btn" onClick={onToggleTheme}>
          {isDark ? 'dark' : 'light'}
        </button>
      </div>

      <div className="auth-screen">
        <div className="auth-box">
          <div className="auth-title">
            chat<span> // {location.hostname}</span>
          </div>

          <div className="auth-tabs">
            <button
              className={`auth-tab${tab === 'login' ? ' active' : ''}`}
              onClick={() => setTab('login')}
            >
              login
            </button>
            <button
              className={`auth-tab${tab === 'register' ? ' active' : ''}`}
              onClick={() => setTab('register')}
            >
              register
            </button>
          </div>

          {tab === 'login' ? (
            <div>
              <div className="field">
                <label>Username</label>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="enter username"
                  value={loginUser}
                  onChange={e => setLoginUser(e.target.value)}
                  onKeyDown={e => enterSubmit(e, handleLogin)}
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="enter password"
                  value={loginPass}
                  onChange={e => setLoginPass(e.target.value)}
                  onKeyDown={e => enterSubmit(e, handleLogin)}
                />
              </div>
              <button className="auth-btn" onClick={handleLogin}>-- login --</button>
            </div>
          ) : (
            <div>
              <div className="field">
                <label>Username</label>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="min. 3 characters"
                  value={regUser}
                  onChange={e => setRegUser(e.target.value)}
                  onKeyDown={e => enterSubmit(e, handleRegister)}
                />
              </div>
              <div className="field">
                <label>Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="enter password"
                  value={regPass}
                  onChange={e => setRegPass(e.target.value)}
                  onKeyDown={e => enterSubmit(e, handleRegister)}
                />
              </div>
              <button className="auth-btn" onClick={handleRegister}>-- register --</button>
            </div>
          )}

          <div className={`auth-status${status.type ? ' ' + status.type : ''}`}>
            {status.msg}
          </div>
        </div>
      </div>
    </>
  );
}
