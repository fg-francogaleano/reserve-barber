import { COPY } from '@/lib/copy';
import { PUBLIC_TRANSFER_API } from '@/server/application/auth/routeGuard';
import { SubmitReceiptButton } from './SubmitReceiptButton';

/**
 * The receipt submission.
 *
 * **A native multipart form posting to a fixed path.** No client-side upload,
 * no fetch, no progress bar: a guest halfway through paying a deposit is
 * exactly the person who must never meet a broken script, and the browser's own
 * upload indicator is more truthful than one this page could draw.
 *
 * The token travels in the body rather than the URL, which is what lets the
 * deny-by-default guard admit this endpoint by string equality and keeps a live
 * credential out of access logs and `Referer` headers.
 *
 * `accept` is a **hint to the file picker, not a check**. It narrows what the
 * client sees on a phone; the decision is made server-side from the file's
 * leading bytes, because an attribute a page sets is not a constraint on what a
 * request carries.
 */
export function ReceiptUploadForm({
  token,
  replacing = false,
}: {
  token: string;
  /** Whether a receipt already exists and this submission would replace it. */
  replacing?: boolean;
}) {
  return (
    <form
      method="post"
      action={PUBLIC_TRANSFER_API}
      encType="multipart/form-data"
      className="border-border flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{COPY.booking.receiptHeading}</h2>
        <p className="text-muted-foreground text-sm">{COPY.booking.receiptHelp}</p>
      </div>

      <input type="hidden" name="token" value={token} />

      <label className="flex flex-col gap-1 text-sm" htmlFor="receipt">
        <span className="text-muted-foreground">{COPY.booking.receiptField}</span>
        <input
          id="receipt"
          name="receipt"
          type="file"
          required
          accept="image/jpeg,image/png,application/pdf"
          className="border-border rounded-md border p-2 text-sm"
        />
      </label>

      <SubmitReceiptButton replacing={replacing} />
    </form>
  );
}
