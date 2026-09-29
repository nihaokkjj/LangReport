"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, Button, CircularProgress, TextField } from "@mui/material";
import styles from "./login.module.css";
import { authErrorMessage, getSession, login, returnToFromLocation } from "../../features/auth/auth-client";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isChecking, setIsChecking] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBusy = isChecking || isSubmitting;

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then((session) => {
        if (!cancelled && session.authenticated) window.location.replace(returnToFromLocation());
      })
      .catch((sessionError: unknown) => {
        if (!cancelled) setError(authErrorMessage(sessionError));
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || isBusy) return;
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

  return (
    <main className={styles.page}>
      <section className={styles.shell} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.visuallyHidden}>
          登录
        </h1>
        <div className={styles.artwork} aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none" focusable="false">
            <circle cx="32" cy="32" r="25" />
            <path d="M18 43.5h28" />
            <path d="m19 36 9-9 8 6 10-13" />
            <circle className={styles.artworkPoint} cx="46" cy="20" r="2.5" />
            <path className={styles.artworkBar} d="M20 39v4M29 35v8M38 37v6" />
          </svg>
        </div>
        <p className={styles.brandName}>LangReport</p>

        <form
          className={styles.form}
          onSubmit={(event) => void submit(event)}
          aria-labelledby="login-title"
          aria-busy={isBusy}
        >
          <TextField
            label="账号"
            autoFocus={!isChecking}
            autoComplete="username"
            disabled={isBusy}
            slotProps={{ htmlInput: { maxLength: 128 } }}
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label="密码"
            autoComplete="current-password"
            disabled={isBusy}
            slotProps={{ htmlInput: { maxLength: 1024 } }}
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          <Button
            variant="contained"
            fullWidth
            type="submit"
            disabled={isBusy || !username.trim() || !password}
            startIcon={isBusy ? <CircularProgress size={16} color="inherit" aria-hidden="true" /> : undefined}
          >
            <span>登录</span>
          </Button>
          <span className={styles.visuallyHidden} role="status" aria-live="polite">
            {isChecking ? "正在检查会话" : isSubmitting ? "正在登录" : ""}
          </span>
        </form>
      </section>
    </main>
  );
}
