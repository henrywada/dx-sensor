"use client";

import { useState } from "react";
import { Mail, Lock } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { createClient } from "@/lib/supabase/client";

type Mode = "password" | "reset";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError("メールアドレスまたはパスワードが正しくありません。");
      return;
    }

    window.location.assign("/");
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/set-password`,
    });

    setLoading(false);

    if (error) {
      setError("メールの送信に失敗しました。時間をおいて再度お試しください。");
      return;
    }

    setResetSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-[#11521A]">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">dx-sensor</span>
        </div>

        {mode === "password" && (
          <form
            onSubmit={handlePasswordSubmit}
            className="scan-card space-y-4 rounded-lg border border-line bg-white p-6"
          >
            <div>
              <label htmlFor="email" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
                <Mail className="h-4 w-4" aria-hidden="true" />
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
                <Lock className="h-4 w-4" aria-hidden="true" />
                パスワード
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-alert">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>

            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("reset");
              }}
              className="w-full text-center text-xs text-ink-soft underline"
            >
              パスワードを未設定/お忘れの方はこちら
            </button>
          </form>
        )}

        {mode === "reset" && (
          <form
            onSubmit={handleResetSubmit}
            className="scan-card space-y-4 rounded-lg border border-line bg-white p-6"
          >
            {resetSent ? (
              <p className="text-sm text-[#11521A]">
                メールを送信しました。届いたリンクからパスワードを設定してください。
              </p>
            ) : (
              <>
                <div>
                  <label htmlFor="reset-email" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]">
                    <Mail className="h-4 w-4" aria-hidden="true" />
                    メールアドレス
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-md border border-line px-3 py-2 text-sm text-[#11521A] outline-none focus:border-signal focus:ring-1 focus:ring-signal"
                    placeholder="you@example.com"
                  />
                </div>

                {error && <p className="text-sm text-alert">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {loading ? "送信中..." : "パスワード設定メールを送る"}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setError(null);
                setResetSent(false);
                setMode("password");
              }}
              className="w-full text-center text-xs text-ink-soft underline"
            >
              ログイン画面に戻る
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
