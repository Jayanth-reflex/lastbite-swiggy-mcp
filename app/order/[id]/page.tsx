import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PoweredBySwiggy } from "@/components/powered-by-swiggy";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-20">
        <PoweredBySwiggy variant="inline" className="self-start" />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Order
              <Badge variant="secondary" className="font-mono text-xs">
                {id}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Live tracking lands when Trail (Project 2) ships. For now, this page exists so
              every order has a shareable URL with the required Swiggy attribution.
            </p>
            <p>
              <Link href="/" className="text-foreground underline-offset-4 hover:underline">
                ← Back to Last Bite
              </Link>
            </p>
          </CardContent>
        </Card>
      </section>
      <PoweredBySwiggy />
    </main>
  );
}
