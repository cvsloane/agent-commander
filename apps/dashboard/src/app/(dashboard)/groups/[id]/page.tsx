import { redirect } from 'next/navigation';

interface GroupRedirectPageProps {
  params: { id: string };
}

export default function GroupRedirectPage({ params }: GroupRedirectPageProps) {
  const groupId = encodeURIComponent(params.id);
  redirect(`/sessions?group_id=${groupId}`);
}
