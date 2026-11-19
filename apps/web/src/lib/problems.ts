import { isLiftApiError } from "@lift/shared";
import { toast } from "sonner";

/**
 * Shows an API error where it belongs (docs/prd/02-frontend.md, "Talking to the API"): each of
 * the problem's `fields` on its form field, everything else as a toast with the problem's title.
 * `setFieldError` returns false for a field the form doesn't have.
 */
export function showProblem(
  error: unknown,
  setFieldError: (field: string, message: string) => boolean = () => false,
): void {
  if (!isLiftApiError(error)) {
    toast.error("Something went wrong", { description: "Check your connection and try again." });
    return;
  }
  const unplaced = Object.entries(error.fields ?? {}).filter(
    ([field, message]) => !setFieldError(field, message),
  );
  if (!error.fields || unplaced.length > 0) {
    toast.error(error.title, { description: error.detail });
  }
}
