"use client";

import { FormEvent, useEffect, useState } from "react";
import styles from "./login.module.css";
import { authErrorMessage, getSession, login, returnToFromLocation } from "../../features/auth/auth-client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((session) => {
      if (!cancelled && session.authenticated) window.location.replace(returnToFromLocation());
    }).catch((sessionError: unknown) => {
      if (!cancelled) setError(authErrorMessage(sessionError));
    }).finally(() => { if (!cancelled) setIsChecking(false); });
    return () => { cancelled = true; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await login({ username: username.trim(), password });
      setPassword("");
      window.location.replace(returnToFromLocation());
    } catch (loginError: unknown) {
      setPassword("");
      setError(authErrorMessage(loginError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className={styles.page}>
    <section className={styles.shell} aria-labelledby="login-title">
      <div className={styles.identity}>
        <div className={styles.brand}><span>LR</span><strong>LangReport</strong></div>
        <p className={styles.eyebrow}>CONSULTING EVIDENCE WORKSPACE</p>
        <h1 id="login-title">回到可追溯的<br />咨询证据工作台</h1>
        <p className={styles.intro}>登录后继续处理 Project、Data Snapshot、Evidence Block 与审核记录。</p>
        <dl className={styles.facts}>
          <div><dt>SESSION</dt><dd>默认 7 天</dd></div>
          <div><dt>DELIVERY</dt><dd>HttpOnly Cookie</dd></div>
          <div><dt>SCOPE</dt><dd>私有 Workspace</dd></div>
        </dl>
      </div>
      <div className={styles.formPanel}>
        <div className={styles.formHeading}><span>01 / AUTHENTICATION</span><h2>账号登录</h2><p>使用部署维护者提供的账号进入 LangReport。</p></div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <label><span>账号</span><input autoFocus={!isChecking} autoComplete="username" disabled={isChecking || isSubmitting} maxLength={128} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="请输入账号" /></label>
          <label><span>密码</span><input autoComplete="current-password" disabled={isChecking || isSubmitting} maxLength={1024} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
          {error && <div className={styles.error} role="alert"><strong>登录未完成</strong><span>{error}</span></div>}
          <button type="submit" disabled={isChecking || isSubmitting || !username.trim() || !password}>{isChecking ? "检查会话中…" : isSubmitting ? "正在验证…" : "进入工作台 ↗"}</button>
        </form>
        <p className={styles.security}>密码不会写入 URL、浏览器存储或请求历史；会话 Token 仅保存在 HttpOnly Cookie 中。</p>
      </div>
    </section>
  </main>;
}
