import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { AlbumView } from "./AlbumView";

export default async function SendPictureAlbumPage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");

  return <AlbumView userId={viewer.userId} />;
}
