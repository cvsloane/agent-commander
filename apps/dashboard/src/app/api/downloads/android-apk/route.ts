import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const APK_FILENAME = 'agent-command-android.apk';
const APK_DOWNLOAD_FILENAME = 'agent-command-android-0.1.1.apk';
const APK_PATH = path.resolve(process.cwd(), '..', '..', 'android-distribution', APK_FILENAME);

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [apk, apkStat] = await Promise.all([readFile(APK_PATH), stat(APK_PATH)]);
    return new NextResponse(new Uint8Array(apk), {
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${APK_DOWNLOAD_FILENAME}"`,
        'Content-Length': String(apkStat.size),
        'Content-Type': 'application/vnd.android.package-archive',
        'Last-Modified': apkStat.mtime.toUTCString(),
      },
    });
  } catch {
    return NextResponse.json({ error: 'APK not available' }, { status: 404 });
  }
}
