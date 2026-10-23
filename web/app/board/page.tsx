import { redirect } from "next/navigation";

// The people-ranking board is gone. Old links land on the page that explains what the model is learning.
export default function BoardPage() {
  redirect("/learn");
}
