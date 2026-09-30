"use client"

import { Trash2 } from "lucide-react"
import { useTransition } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"

import { deleteReview } from "./actions"

export function DeleteResponse({ id, reviewKey }: { id: string; reviewKey: string | null }) {
  const [pending, start] = useTransition()
  const remove = () =>
    start(async () => {
      try {
        await deleteReview(id, reviewKey)
        toastManager.add({ type: "success", title: "Response deleted" })
      } catch {
        toastManager.add({ type: "error", title: "Couldn't delete the response" })
      }
    })

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="xs" className="text-destructive-foreground" />}>
        <Trash2 /> Delete
      </AlertDialogTrigger>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this response?</AlertDialogTitle>
          <AlertDialogDescription>This removes it from the database. It can&apos;t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <AlertDialogClose render={<Button variant="destructive" onClick={remove} disabled={pending} />}>Delete</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
