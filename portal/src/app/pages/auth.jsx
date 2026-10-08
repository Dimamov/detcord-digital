import { useEffect, useState } from 'preact/hooks';
import { api, navigate, refreshSession, query } from '../lib.js';
import { Field, Loading, Chips, useAction } from '../ui.jsx';

function AuthLayout({ children }) {
  return (
    <div class="auth">
      <div class="art">
        <div class="inner">
          <img class="logo" src="/detcord-logo-transparent.webp" alt="Detcord Digital" />
          <div class="copy">
            <h2>Marketing shouldn’t require a marketing degree.</h2>
            <p>You ask. GOAT does the work. You review. You approve. Done.</p>
          </div>
        </div>
      </div>
      <div class="panel"><div class="box">{children}</div></div>
    </div>
  );
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await api('POST', '/auth/login', { email, password });
      await refreshSession();
      const next = query().next;
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    });
  };
  return (
    <AuthLayout>
      <div class="eyebrow">Detcord portal</div>
      <h1>Sign in</h1>
      <p class="muted">Clients, sales and the Detcord team.</p>
      <form class="stack mt" onSubmit={submit}>
        <Field label="Email"><input class="input" type="email" autocomplete="username" required value={email} onInput={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input class="input" type="password" autocomplete="current-password" required value={password} onInput={(e) => setPassword(e.target.value)} /></Field>
        {error && <div class="alert bad" role="alert">{error}</div>}
        <button class="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <a class="small muted" href="/forgot">Forgot your password?</a>
      </form>
    </AuthLayout>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const { busy, error, run } = useAction();
  return (
    <AuthLayout>
      <h1>Reset your password</h1>
      {sent ? (
        <div class="stack mt"><div class="alert good">{sent}</div><a class="btn secondary" href="/login">Back to sign in</a></div>
      ) : (
        <form class="stack mt" onSubmit={(e) => { e.preventDefault(); run(async () => setSent((await api('POST', '/auth/forgot', { email })).message)); }}>
          <p class="muted">Enter your email and we’ll send a link to choose a new password.</p>
          <Field label="Email"><input class="input" type="email" required value={email} onInput={(e) => setEmail(e.target.value)} /></Field>
          {error && <div class="alert bad">{error}</div>}
          <button class="btn block" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          <a class="small muted" href="/login">Back to sign in</a>
        </form>
      )}
    </AuthLayout>
  );
}

// Invitation activation and password reset share this screen. The link secret lives in the URL fragment.
export function SetPassword({ kind }) {
  const link = location.hash.slice(1);
  const base = kind === 'invite' ? '/auth/activate' : '/auth/reset';
  const [state, setState] = useState({ loading: true });
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { busy, error, setError, run } = useAction();
  useEffect(() => {
    api('POST', `${base}/check`, { link }).then((d) => setState({ who: d })).catch((e) => setState({ error: e.message }));
  }, []);
  const submit = (e) => {
    e.preventDefault();
    if (pw !== pw2) return setError('The two passwords don’t match.');
    run(async () => {
      await api('POST', base, { link, password: pw });
      const next = query().next;
      history.replaceState({}, '', location.pathname); // drop the secret from the address bar
      await refreshSession();
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    });
  };
  return (
    <AuthLayout>
      {state.loading ? <Loading /> : state.error ? (
        <div class="stack">
          <h1>{kind === 'invite' ? 'This invitation can’t be used' : 'This reset link can’t be used'}</h1>
          <div class="alert bad">{state.error}</div>
          <a class="btn secondary" href={kind === 'invite' ? '/login' : '/forgot'}>{kind === 'invite' ? 'Go to sign in' : 'Request a new link'}</a>
        </div>
      ) : (
        <form class="stack" onSubmit={submit}>
          <div class="eyebrow">{kind === 'invite' ? 'Welcome' : 'Password reset'}</div>
          <h1>{kind === 'invite' ? `Hi ${state.who.name.split(' ')[0]}, create your password` : 'Choose a new password'}</h1>
          <p class="muted">Signing in as {state.who.email}. Use at least 12 characters; a short sentence works well.</p>
          <Field label="New password"><input class="input" type="password" minLength={12} autocomplete="new-password" required value={pw} onInput={(e) => setPw(e.target.value)} /></Field>
          <Field label="Confirm password"><input class="input" type="password" minLength={12} autocomplete="new-password" required value={pw2} onInput={(e) => setPw2(e.target.value)} /></Field>
          {error && <div class="alert bad">{error}</div>}
          <button class="btn block" disabled={busy}>{busy ? 'Saving…' : kind === 'invite' ? 'Create password and continue' : 'Save new password'}</button>
        </form>
      )}
    </AuthLayout>
  );
}

// Public pre-call questionnaire for prospects.
export function Intake() {
  const link = location.hash.slice(1);
  const [state, setState] = useState({ loading: true });
  const [answers, setAnswers] = useState({});
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => {
    api('POST', '/intake/check', { link }).then((d) => setState(d)).catch((e) => setState({ error: e.message }));
  }, []);
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  return (
    <div style="min-height:100vh">
      <div class="page" style="max-width:720px">
        <img src="/detcord-logo-transparent.webp" alt="Detcord Digital" style="width:180px;border-radius:8px;margin:0 auto 24px" />
        {state.loading ? <Loading /> : state.error ? <div class="alert bad">{state.error}</div> : done ? (
          <div class="card" style="text-align:center">
            <img src="/goat-96.webp" alt="" style="width:80px;height:80px;border-radius:50%;margin:0 auto 12px" />
            <h1 style="margin:0 0 8px">Thanks! You’re all set.</h1>
            <p class="muted">Your strategist will review this before your call. Talk soon.</p>
          </div>
        ) : (
          <form class="card stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await api('POST', '/intake/submit', { link, answers }); setDone(true); }); }}>
            <div>
              <div class="eyebrow">Before your call</div>
              <h1 style="margin:0 0 6px;font-size:24px">{state.business}</h1>
              <p class="muted" style="margin:0">{state.form.intro}</p>
            </div>
            {state.form.questions.map((qu) => (
              <div class="field">
                <span>{qu.q}{qu.optional && <span class="help"> · optional</span>}</span>
                {qu.type === 'long' ? <textarea class="textarea" required={!qu.optional} value={answers[qu.id] || ''} onInput={(e) => set(qu.id, e.target.value)} />
                  : qu.type === 'single' || qu.type === 'multi' ? <Chips options={qu.options} multi={qu.type === 'multi'} value={answers[qu.id]} onChange={(v) => set(qu.id, v)} />
                  : <input class="input" required={!qu.optional} placeholder={qu.placeholder || ''} value={answers[qu.id] || ''} onInput={(e) => set(qu.id, e.target.value)} />}
              </div>
            ))}
            {error && <div class="alert bad">{error}</div>}
            <button class="btn" disabled={busy}>{busy ? 'Sending…' : 'Send my answers'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
