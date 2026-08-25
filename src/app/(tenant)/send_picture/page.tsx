import { redirect } from "next/navigation";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { SendPictureForm } from "./SendPictureForm";

export default async function SendPicturePage() {
  const viewer = await getViewerContext();
  if (!viewer.userId) redirect("/login");

  return (
    <SendPictureForm
      userId={viewer.userId}
      userEmail={viewer.email ?? ""}
    />
  );
}
