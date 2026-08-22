"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogoMark } from "@/components/ui/LogoMark";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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

    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-ink">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">
            dx-sensor
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
          className="scan-card space-y-4 rounded-lg border border-line bg-white p-6"
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
              パスワード
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-1 focus:ring-signal"
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
        </form>
      </div>
    </div>
  );
}
