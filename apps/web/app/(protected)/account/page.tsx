"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "./account.module.css";
import { changePassword } from "../../../features/auth/auth-client";
import { useAuthSession } from "../../../features/auth/use-auth-session";
import { formatApiError } from "../../../lib/http-client";

export default function AccountPage() {
  const { data: session } = useAuthSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setError(null);
    setSuccess(null);

    if (newPassword.length < 6) {
      setError("新密码至少需要 6 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }

    setIsSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("密码已更新。当前及其他设备的登录会话会保留到各自原定过期时间。");
    } catch (changeError) {
      setError(formatApiError(changeError, "密码更新失败。"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          LangReport
        </Link>
        <Link className={styles.backLink} href="/">
          返回工作台
        </Link>
      </header>
      <section className={styles.content} aria-labelledby="account-title">
        <div className={styles.heading}>
          <span className={styles.eyebrow}>ACCOUNT</span>
          <h1 id="account-title">账号设置</h1>
        </div>
        <div className={styles.card}>
          <div className={styles.identity}>
            <span className={styles.label}>当前账号</span>
            <strong>{session?.authenticated ? session.username : "正在读取…"}</strong>
          </div>
          <form className={styles.form} onSubmit={(event) => void submit(event)} aria-busy={isSaving}>
            <h2>修改密码</h2>
            <label>
              <span>当前密码</span>
              <input
                autoComplete="current-password"
                maxLength={1024}
                required
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              <span>新密码</span>
              <input
                autoComplete="new-password"
                maxLength={1024}
                minLength={6}
                required
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label>
              <span>确认新密码</span>
              <input
                autoComplete="new-password"
                maxLength={1024}
                minLength={6}
                required
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {success && (
              <p className={styles.success} role="status">
                {success}
              </p>
            )}
            <button
              className={styles.submit}
              type="submit"
              disabled={isSaving || !currentPassword || !newPassword || !confirmPassword}
            >
              {isSaving ? "正在更新…" : "更新密码"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
