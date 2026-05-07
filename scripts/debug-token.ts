async function main() {
  const { Redis } = await import("@upstash/redis");
  const { decrypt } = await import("@/lib/crypto");

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL!;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN!;
  const redis = new Redis({ url, token });

  console.log("BYOC_ENCRYPTION_KEY length:", process.env.BYOC_ENCRYPTION_KEY?.length);
  console.log("BYOC_ENCRYPTION_KEY first 6 chars:", process.env.BYOC_ENCRYPTION_KEY?.slice(0, 6));

  const keys = (await redis.keys("byoc:*")) as string[];
  console.log("Found byoc keys:", keys);

  for (const key of keys) {
    const stored = (await redis.get<string>(key)) as string | null;
    console.log(`\nkey=${key}`);
    console.log(`  type: ${typeof stored}`);
    console.log(`  length: ${stored?.length ?? 0}`);
    console.log(`  first 40 chars: ${stored?.slice(0, 40)}`);
    if (typeof stored === "string") {
      try {
        const plain = decrypt(stored);
        console.log(`  ✓ DECRYPTED ok, plaintext length: ${plain.length}, prefix: ${plain.slice(0, 8)}…`);
      } catch (err) {
        console.log(`  ✗ decrypt threw: ${(err as Error).message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("crash:", err);
  process.exit(1);
});
