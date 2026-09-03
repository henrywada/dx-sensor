import { redirect } from "next/navigation";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  const viewer = await getViewerContext();

  if (viewer.userId) {
    const tenant = await getActiveTenant(viewer.userId);
    if (tenant) {
      redirect("/");
    }
  }

  return <SignupForm />;
}
