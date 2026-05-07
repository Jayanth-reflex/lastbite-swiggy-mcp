import Link from "next/link";
import { CheckCircle2, MessageCircle, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PageProps {
  searchParams: Promise<{ phone?: string }>;
}

export default async function ConnectSuccessPage({ searchParams }: PageProps) {
  const { phone } = await searchParams;
  const masked = phone ? maskPhone(phone) : null;

  const botPhone = process.env.GUPSHUP_SOURCE_PHONE;
  const exampleQuery = "biryani Paradise ₹500";
  const waLink = botPhone
    ? `https://wa.me/${botPhone.replace(/\D/g, "")}?text=${encodeURIComponent(exampleQuery)}`
    : null;

  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col items-start gap-3">
          <div className="rounded-full bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            You're connected
          </h1>
          {masked && (
            <p className="text-muted-foreground">
              Your Swiggy access token is sealed and paired with{" "}
              <span className="rounded bg-secondary px-2 py-0.5 font-mono text-sm text-foreground">{masked}</span>.
            </p>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              Try your first order on WhatsApp
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {waLink ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Tap below to open WhatsApp pre-filled with a sample order. Send anything in plain English — we'll walk you through three confirmation gates.
                </p>
                <Button asChild size="lg" className="self-start">
                  <a href={waLink} target="_blank" rel="noreferrer">
                    Message Last Bite on WhatsApp
                  </a>
                </Button>
                <p className="text-xs text-muted-foreground">
                  Sample message: <code className="rounded bg-secondary px-1.5 py-0.5">{exampleQuery}</code>
                </p>
              </>
            ) : (
              <>
                <Badge variant="secondary" className="self-start">Coming soon</Badge>
                <p className="text-sm text-muted-foreground">
                  Last Bite isn't paired with a WhatsApp number yet. Once it is, we'll DM you on{" "}
                  {masked ?? "the number you registered"} so you can place your first order.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-orange-200/60 bg-orange-50/40 dark:bg-orange-500/5">
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 text-orange-600" />
            <div>
              <p className="font-medium">Three gates, then a 30-second grace timer</p>
              <p className="mt-1 text-muted-foreground">
                Calorie → ETA → final confirm. After the final YES, you have 30 seconds to reply <code className="rounded bg-background/60 px-1 py-0.5">STOP</code> before the order goes in. COD only, ₹999 cap during beta.
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-sm text-muted-foreground">
          Want out? Reply <code className="rounded bg-secondary px-1 py-0.5">FORGET ME</code> on WhatsApp anytime — we'll wipe your token and any in-flight order. Or read the{" "}
          <Link href="/privacy" className="underline">privacy policy</Link>.
        </p>
      </section>
    </main>
  );
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;
  return `${phone.slice(0, phone.length - digits.length + 2)}…${digits.slice(-4)}`;
}
