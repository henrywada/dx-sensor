"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { LogoMark } from "@/components/ui/LogoMark";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/signup/callback`,
      },
    });

    setLoading(false);

    if (error) {
      setError("メールの送信に失敗しました。時間をおいて再度お試しください。");
      return;
    }

    setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-[#11521A]">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">dx-sensor</span>
        </div>

        <div className="scan-card space-y-4 rounded-lg border border-line bg-white p-6">
          {sent ? (
            <p className="text-sm text-[#11521A]">
              メールを送信しました。届いたリンクを開いて登録を完了してください。
              <br />
              ※ 登録に使用したのと同じ端末・ブラウザでリンクを開いてください。
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 flex items-center gap-1.5 text-sm font-medium text-[#11521A]"
                >
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

              {error && <p className="text-sm text-alert">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-signal px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "送信中..." : "登録メールを送る"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
