'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileLaunchSheet } from '@/components/launch/MobileLaunchSheet';

export function QuickSpawn() {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <Button
        variant="default"
        size="mobile"
        className="w-full gap-2"
        onClick={() => setShowDialog(true)}
      >
        <Plus className="h-4 w-4" />
        New Session
      </Button>
      <MobileLaunchSheet
        open={showDialog}
        onClose={() => setShowDialog(false)}
      />
    </>
  );
}
