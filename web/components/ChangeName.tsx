"use client";

import { useState } from "react";
import NameForm from "./NameForm";

/** A small "Change name" link that opens the same name form in place. */
export default function ChangeName({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="mt-3 flex w-full justify-center">
        <NameForm
          variant="change"
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onSaved?.();
          }}
        />
      </div>
    );
  }
  return (
    <button onClick={() => setOpen(true)} className="min-h-11 px-2 underline">
      Change name
    </button>
  );
}
