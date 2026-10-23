import Link from "next/link";

export default function NotFound() {
  return (
    <section className="flex w-full flex-col items-center gap-4 rounded-2xl border border-foreground/20 p-6 text-center" data-testid="shared-missing">
      <p className="text-lg font-bold">That result isn&apos;t here</p>
      <p className="text-sm opacity-70">The link may be mistyped, or the solve was never saved.</p>
      <Link href="/" className="flex min-h-12 w-full items-center justify-center rounded-xl bg-orange-500 px-4 py-3 text-lg font-semibold text-white">
        Play Yomi
      </Link>
    </section>
  );
}
