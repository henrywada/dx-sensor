import { LogoMark } from "@/components/ui/LogoMark";
import { AppCard } from "@/components/ui/AppCard";
import { PLAN_OPTIONS } from "./planOptions";

export default function SignupPlanPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex flex-col items-center gap-2 text-[#11521A]">
          <LogoMark className="h-8 w-8 text-signal" />
          <span className="text-xl font-bold tracking-tight">dx-sensor</span>
        </div>

        <h1 className="mb-6 text-center text-lg font-bold text-[#11521A]">
          プランを選択してください
        </h1>

        <div className="grid gap-4 sm:grid-cols-2">
          {PLAN_OPTIONS.map((plan) => (
            <AppCard
              key={plan.id}
              icon={plan.icon}
              eyebrow={plan.eyebrow}
              title={plan.title}
              description={plan.description}
              href={plan.href}
              badge={plan.badge}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
