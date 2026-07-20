import { redirect } from 'next/navigation';

type RedirectSearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TmuxRedirectPage({
  searchParams,
}: {
  searchParams: RedirectSearchParams;
}) {
  const resolvedParams = await searchParams;
  const nextParams = new URLSearchParams();

  Object.entries(resolvedParams).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => nextParams.append(key, entry));
    } else if (value !== undefined) {
      nextParams.set(key, value);
    }
  });

  const query = nextParams.toString();
  redirect(query ? `/?${query}` : '/');
}
