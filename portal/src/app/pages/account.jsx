import { useState } from 'preact/hooks';
import { api, toast, refreshSession } from '../lib.js';
import { Field, useAction } from '../ui.jsx';

export function Account({ user }) {
  const [profile, setProfile] = useState({ name: user.name, phone: user.phone || '' });
  const [pw, setPw] = useState({ current: '', password: '', confirm: '' });
  const p = useAction();
  const s = useAction();
  const saveProfile = (e) => { e.preventDefault(); p.run(async () => { await api('PATCH', '/auth/profile', profile); await refreshSession(); toast('Profile saved.'); }); };
  const savePw = (e) => {
    e.preventDefault();
    if (pw.password !== pw.confirm) return s.setError('The new passwords don’t match.');
    s.run(async () => { await api('POST', '/auth/password', { current: pw.current, password: pw.password }); setPw({ current: '', password: '', confirm: '' }); toast('Password changed. Other devices were signed out.'); });
  };
  return (
    <div class="page" style="max-width:720px">
      <div class="page-head"><div><div class="eyebrow">Account</div><h1>Your account</h1><p class="sub">{user.email}</p></div></div>
      <form class="card stack" onSubmit={saveProfile}>
        <h2>Profile</h2>
        <Field label="Name"><input class="input" value={profile.name} onInput={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
        <Field label="Mobile" help={user.role === 'client' ? 'used to recognize your texts to GOAT' : 'shown to your clients'}><input class="input" type="tel" value={profile.phone} onInput={(e) => setProfile({ ...profile, phone: e.target.value })} /></Field>
        {p.error && <div class="alert bad">{p.error}</div>}
        <div><button class="btn" disabled={p.busy}>Save profile</button></div>
      </form>
      <form class="card stack" onSubmit={savePw}>
        <h2>Change password</h2>
        <Field label="Current password"><input class="input" type="password" autocomplete="current-password" value={pw.current} onInput={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
        <Field label="New password" help="at least 12 characters"><input class="input" type="password" minLength={12} autocomplete="new-password" value={pw.password} onInput={(e) => setPw({ ...pw, password: e.target.value })} required /></Field>
        <Field label="Confirm new password"><input class="input" type="password" minLength={12} autocomplete="new-password" value={pw.confirm} onInput={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
        {s.error && <div class="alert bad">{s.error}</div>}
        <div><button class="btn" disabled={s.busy}>Change password</button></div>
      </form>
    </div>
  );
}
