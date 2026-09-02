import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export type FriendInviteCandidate = {
  userId: string;
  email: string;
};

export async function listFriendInviteCandidates(
  tenantId: string
): Promise<FriendInviteCandidate[]> {
  const supabase = createServerSupabase();

  const { data: members, error: membersError } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId);
  if (membersError) throw membersError;

  const { data: friends, error: friendsError } = await supabase
    .from("line_friends")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("status", "linked");
  if (friendsError) throw friendsError;

  const linkedUserIds = new Set((friends ?? []).map((row) => row.user_id as string));
  const candidateUserIds = (members ?? [])
    .map((row) => row.user_id as string)
    .filter((userId) => !linkedUserIds.has(userId));

  if (candidateUserIds.length === 0) return [];

  const service = createServiceSupabase();
  const emailById = await listEmailsByUserIds(service, candidateUserIds);

  return candidateUserIds.map((userId) => ({
    userId,
    email: emailById.get(userId) ?? "(メール不明)",
  }));
}

async function listEmailsByUserIds(
  supabase: ReturnType<typeof createServiceSupabase>,
  userIds: string[]
): Promise<Map<string, string>> {
  const targetIds = new Set(userIds);
  const map = new Map<string, string>();
  const perPage = 1000;
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (targetIds.has(user.id)) map.set(user.id, user.email ?? "");
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  return map;
}
