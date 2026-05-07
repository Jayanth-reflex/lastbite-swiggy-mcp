import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PoweredBySwiggy } from "@/components/powered-by-swiggy";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-20">
        <div className="flex flex-col gap-4">
          <PoweredBySwiggy variant="inline" className="self-start" />
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Last Bite
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            WhatsApp-native Swiggy orders with three confirmation gates and a 30-second grace
            timer. Built for the 10-second post-order regret. COD-only by design.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/connect">Connect Swiggy MCP</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/privacy">Privacy</Link>
            </Button>
          </div>
        </div>

        <Separator />

        <section className="grid gap-4 sm:grid-cols-3">
          <Gate
            title="Calorie gate"
            text="~1,100 kcal incoming. Still go?"
          />
          <Gate
            title="ETA gate"
            text="42 min ETA. OK?"
          />
          <Gate
            title="30s grace"
            text="Reply STOP within 30 seconds to cancel."
          />
        </section>

        <Card className="border-orange-200/60 bg-orange-50/50 dark:bg-orange-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge variant="secondary">COD</Badge>
              Non-cancellable orders, by design
            </CardTitle>
            <CardDescription>
              Swiggy MCP orders are cash-on-delivery and cannot be cancelled after
              <code className="mx-1 rounded bg-background/60 px-1 py-0.5 text-xs">place_food_order</code>
              fires. Last Bite makes you slow down.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Three explicit human-in-the-loop gates and a visible 30-second grace timer ensure no
            order goes through without deliberate user intent.
          </CardContent>
        </Card>
      </section>
      <PoweredBySwiggy />
    </main>
  );
}

function Gate({ title, text }: { title: string; text: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}
