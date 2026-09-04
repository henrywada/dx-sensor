import { Gift, Crown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface PlanOption {
  id: "free" | "premium";
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  href?: string;
  badge?: string;
}

export const PLAN_OPTIONS: PlanOption[] = [
  {
    id: "free",
    icon: Gift,
    eyebrow: "無料プラン",
    title: "Free",
    description: "個人でのご利用に。基本機能を無料でお使いいただけます。",
    href: "/signup",
  },
  {
    id: "premium",
    icon: Crown,
    eyebrow: "有料プラン",
    title: "Premium",
    description: "拡張機能をご利用いただけます。近日公開予定です。",
    badge: "近日公開",
  },
];
