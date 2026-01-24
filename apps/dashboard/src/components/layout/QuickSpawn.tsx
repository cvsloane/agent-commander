'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SessionGenerator } from '@/components/session-generator';

export function QuickSpawn() {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <>
      <Button
        variant="default"
        size="sm"
        className="w-full gap-2"
        onClick={() => setShowDialog(true)}
      >
        <Plus className="h-4 w-4" />
        New Session
      </Button>
      <SessionGenerator
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
      />
    </>
  );
}
