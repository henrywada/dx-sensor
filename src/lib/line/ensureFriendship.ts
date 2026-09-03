export interface FriendshipLiffClient {
  getFriendship: () => Promise<{ friendFlag: boolean }>;
  requestFriendship: () => Promise<unknown>;
}

/**
 * LINEアプリ内のLIFFブラウザでは liff.isLoggedIn() が最初からtrueになり
 * liff.login() (LINEログインの認可フロー)が呼ばれないため、LIFFアプリ設定の
 * 「友だち追加オプション」による自動プロンプトが発火しない。
 * ログイン済みユーザーに対して明示的にフォロー状態を確認し、
 * 未フォローならliff.requestFriendship()でサブウィンドウを表示する。
 * ユーザーがキャンセルした場合やAPI非対応環境でも、後続の連携フローは
 * 止めないため失敗は無視する。
 */
export async function ensureFriendship(liff: FriendshipLiffClient): Promise<void> {
  try {
    const { friendFlag } = await liff.getFriendship();
    if (!friendFlag) {
      await liff.requestFriendship();
    }
  } catch {
    // 友だち追加の勧誘に失敗しても連携フロー自体は継続する
  }
}
