# business-profile Specification

## Purpose
The owner edits the public face of the business — name, bio, profile and cover images, social links — and gets the shareable booking link that clients open. Created by archiving change p1-owner-public-profile.

## Requirements

### Requirement: The profile editor is owner-scoped and reachable from the dashboard
The dashboard SHALL expose a profile editor at `/perfil`, linked from the dashboard navigation alongside locations, barbers and services. The page and every write action SHALL resolve the owner from the session before doing anything else.

Server Actions carry no middleware protection by design — `decideGuardAction` returns `continue` for any request bearing the `next-action` header — so `requireOwner()` as the first statement of each action is the entire authorization boundary. This applies to destructive actions as forcefully as to saves.

#### Scenario: Anonymous access to the editor
- **WHEN** an unauthenticated request loads `/perfil`
- **THEN** it is redirected to `/login` carrying `next=%2Fperfil`

#### Scenario: Every action resolves the owner first
- **WHEN** any profile action executes
- **THEN** the session owner is resolved before the payload is parsed, uploaded or persisted

### Requirement: The profile is a singleton created on first save
Exactly one `BusinessProfile` SHALL exist per owner. No profile row SHALL exist until the owner saves the form for the first time; the editor SHALL render an empty form in that state rather than treating the absence as an error. Every subsequent save SHALL update that same row.

#### Scenario: First save creates the profile
- **WHEN** the owner submits a valid form and no profile row exists
- **THEN** exactly one row is created, carrying the session owner's id

#### Scenario: The editor renders before a profile exists
- **WHEN** the editor loads and no profile row exists
- **THEN** an empty form renders and no error state is shown

#### Scenario: A later save does not create a second profile
- **WHEN** the owner saves again
- **THEN** the existing row is updated and no second row appears

### Requirement: Business name and bio are bounded and normalized
`businessName` SHALL be required, normalized with the same helper that normalizes location, barber and service names, and between 2 and 120 characters after normalization. `bio` SHALL be optional and at most 1000 characters; a blank bio SHALL be persisted as absence, not as an empty string.

Length SHALL be measured with the runtime's string length. That measure counts UTF-16 code units while the column counts characters, so it is strictly stricter than the column and a database overflow is unreachable by construction. This is deliberate and SHALL NOT be "corrected" toward counting code points, which would loosen validation toward the column limit.

#### Scenario: A name that normalizes to nothing
- **WHEN** the submitted name consists only of whitespace or punctuation
- **THEN** it is rejected as required, not persisted as an empty name

#### Scenario: A blank bio
- **WHEN** the bio field is submitted empty or whitespace-only
- **THEN** it is persisted as absent

#### Scenario: A bio of astral-plane characters
- **WHEN** a bio whose code-unit length exceeds the bound is submitted
- **THEN** it is rejected by the application before reaching the database

### Requirement: The slug is derived, normalized, and bounded
The editor SHALL offer a slug derived from the business name — diacritics stripped, lowercased, non-alphanumeric runs collapsed to single hyphens, trimmed of leading and trailing hyphens — which the owner MAY override. The submitted slug SHALL be normalized by the same rule before validation and persistence, SHALL be between 3 and 60 characters, and SHALL match `^[a-z0-9]+(-[a-z0-9]+)*$`.

No reserved-word denylist SHALL be introduced. The public namespace is `/b/{slug}`, so no slug can collide with a dashboard route. This is recorded so the protection nobody needs is not added later.

#### Scenario: Derivation from the business name
- **WHEN** the business name is "Barbería Don Juan"
- **THEN** the offered slug is "barberia-don-juan"

#### Scenario: Malformed slugs are rejected
- **WHEN** a slug shorter than 3 characters, longer than 60, containing a space, or carrying leading, trailing or doubled hyphens is submitted
- **THEN** it is rejected with a field-level message

#### Scenario: A collision is reported in its normalized form
- **WHEN** the owner submits "Barbería Don Juan" as the slug and "barberia-don-juan" is already taken
- **THEN** the duplicate message names the normalized value, so the error does not appear to refer to a different string

### Requirement: Changing the slug warns that shared links break
The editor SHALL warn, at the moment the slug is changed away from its stored value, that links already shared will stop working. No alias or redirect from a previous slug SHALL be implemented in this change.

The warning belongs at the point of change because that is the only moment it can be acted on; there is no way to learn afterwards who holds the old link.

Once a save succeeds, the slug field SHALL show the value that was persisted, not the text the owner typed, and the warning SHALL clear. The slug is normalized before persistence, so those two differ whenever the owner types anything non-canonical. A warning left standing after a successful save states that shared links have broken when nothing changed — and this warning is the only mitigation carried for the accepted debt of unrecoverable slug changes, so it must not be spent on false alarms.

#### Scenario: The field reconciles with what was stored
- **WHEN** a save succeeds after the owner typed a slug that normalizes to a different string
- **THEN** the field shows the normalized value, the field agrees with the shareable link, and no change warning remains

#### Scenario: Editing a stored slug
- **WHEN** the owner alters a slug that has already been saved
- **THEN** a warning that previously shared links will stop working is shown before the save is submitted

#### Scenario: Choosing a slug for the first time
- **WHEN** no slug has been saved yet
- **THEN** no warning is shown

### Requirement: Social links are replaced as one whole set
The editor SHALL accept at most seven social links, at most one per platform of the `SocialPlatform` enum. A save SHALL replace the owner's entire set of links with what was submitted, so the stored set always equals the last submitted set.

Rows left entirely blank SHALL be discarded as absence, not reported as errors. A row carrying a platform with no URL, or a URL with no platform, SHALL be reported as an error.

Because the set is replaced wholesale, the rows on screen SHALL continue to represent the stored set once an action resolves. A row the owner added or edited SHALL NOT revert to an earlier value when the save completes. Reverting is not cosmetic here: a row that reverts to blank is discarded as absence by the rule above, so the next save deletes a link the owner successfully stored.

#### Scenario: Replacement, not accumulation
- **WHEN** a profile holding Instagram and Facebook links is saved with Instagram and TikTok
- **THEN** exactly two links remain, and Facebook is gone

#### Scenario: An identical resubmission
- **WHEN** the same form is submitted twice
- **THEN** the resulting set is identical to the set after the first save

#### Scenario: Blank rows
- **WHEN** the form is submitted with empty platform and URL rows
- **THEN** those rows are ignored and no validation error is raised for them

#### Scenario: A half-filled row
- **WHEN** a row carries a platform but no URL
- **THEN** the save is rejected with a field-level error on that row

#### Scenario: A row added during the session survives its own save
- **WHEN** the owner adds a social row, saves successfully, and saves again without touching the form
- **THEN** the second save stores the same set as the first, and the added link is still present

#### Scenario: A rejected save keeps the rows the owner typed
- **WHEN** a save is rejected and the form is re-rendered with its errors
- **THEN** every social row still shows the platform and URL that were submitted, not the values held when the page was opened

### Requirement: Duplicate platforms are rejected before any write
Two rows naming the same platform SHALL be rejected during validation, before any image is uploaded and before any transaction is opened.

The database enforces this with a composite unique key, but reaching it aborts a transaction whose images have already been uploaded and whose other fields are then lost. The rule belongs where it costs nothing.

#### Scenario: Two links on one platform
- **WHEN** the form is submitted with two Instagram rows
- **THEN** a field-level duplicate-platform error is returned, no upload occurs, and no transaction is opened

### Requirement: Social link URLs are restricted to http and https
Every social URL SHALL be parsed as a URL and its protocol checked against an explicit allowlist of `http:` and `https:`. Validation SHALL NOT rely on a pattern match.

These URLs are rendered as `href` on a page anonymous clients open. A stored `javascript:` URL is stored cross-site scripting, so the check is a security control, not a formatting nicety.

#### Scenario: A javascript URL
- **WHEN** a social link URL uses the `javascript:` scheme
- **THEN** it is rejected with a field-level error and never persisted

#### Scenario: A URL that is not a URL
- **WHEN** a social link URL cannot be parsed
- **THEN** it is rejected with a field-level error

### Requirement: An unchanged image input preserves the stored image
The wire format SHALL distinguish "this input was not touched" from "remove this image". A save whose file inputs were not touched SHALL leave `photoUrl` and `coverUrl` at their stored values, upload nothing, and delete nothing. Removal SHALL require an explicit control.

A resubmitted form sends empty file fields. Treating that as a removal would delete both images every time the owner edits only their bio, which is the single most likely defect in this change.

Because the intent is raised by the client only once the chosen file has been re-encoded, the form SHALL NOT be submittable while an image is still being prepared. Submission SHALL be blocked and the preparation SHALL be disclosed until every slot has settled. A save sent during that interval would carry `unchanged` alongside the original file, so the server would obey the intent, discard the replacement, and report success — the owner's change lost with no error to show for it.

#### Scenario: Editing only the bio
- **WHEN** the owner changes the bio and submits without touching either file input
- **THEN** both stored image URLs are unchanged, and no object is uploaded or deleted

#### Scenario: Explicit removal
- **WHEN** the owner activates the remove control for an image and saves
- **THEN** that URL is set to absent and the previously stored object is deleted

#### Scenario: A second save after an image was replaced
- **WHEN** a save succeeds and the owner saves again without touching either image
- **THEN** the second save succeeds, the stored images are unchanged, and no validation error is raised against an image the owner did not touch

#### Scenario: Saving while the image is still being prepared
- **WHEN** the owner chooses an image and tries to submit before the client has finished re-encoding it
- **THEN** the submission is refused, the preparation is disclosed, and the save becomes available again once the slot has settled — so no save can carry `unchanged` alongside a file the owner just chose

#### Scenario: A save that failed keeps the owner's chosen file
- **WHEN** a save fails after the owner selected a new image
- **THEN** the selection is still pending on the retry, rather than silently reverting to the stored image

### Requirement: The shareable link is displayed as live
After a slug is saved the editor SHALL display the full public link, `{origin}/b/{slug}`, with a control that copies it. The origin SHALL be resolved server-side; it SHALL NOT be read from `window.location` in a component that also renders on the server.

The link now resolves. Copy stating or implying that it does not yet work SHALL NOT remain anywhere in the editor.

The editor SHALL continue to warn, at the moment the slug is changed away from its stored value, that links already shared will stop working. That warning is now the mitigation for a live failure rather than a theoretical one: until B1 no shared link could resolve, so none could usefully have been shared, and `docs/tech-debt.md` T33 recorded the cost as zero. It stopped being zero when the public page shipped.

#### Scenario: The link is rendered from a server-resolved origin
- **WHEN** the editor renders the shareable link
- **THEN** the origin comes from server-side configuration or request headers, and no hydration mismatch occurs on first paint

#### Scenario: No unpublished disclosure remains
- **WHEN** the shareable link is displayed
- **THEN** no copy states or implies that the link is not yet reachable

#### Scenario: The link the owner copies resolves
- **WHEN** the owner copies the displayed link and opens it without a session
- **THEN** the public profile for that slug renders

#### Scenario: Copying without clipboard access
- **WHEN** the clipboard API is unavailable or refuses permission
- **THEN** the link remains selectable as text and the failure is not silent

#### Scenario: A successful copy is confirmed
- **WHEN** the copy control succeeds
- **THEN** a visible confirmation is shown

### Requirement: The editor presents every transient, empty and error state in Spanish
All user-facing copy SHALL live in `src/lib/copy.ts` and be written in es-AR; no user-facing literal SHALL appear in a component. The editor SHALL present: a loading state for the initial read, a pending state during submission, an empty state before any profile exists, an empty state for the social-link list, and field-level errors associated with their inputs.

The pending state SHALL disable submission and SHALL state that the tab must stay open. An upload through a Server Action cannot report progress, so a save that takes several seconds on a mobile connection is indistinguishable from a frozen page without that copy.

#### Scenario: Submission is in flight
- **WHEN** a save is submitted
- **THEN** the submit control is disabled, an indeterminate progress indicator is shown, and copy asks the owner not to close the tab

#### Scenario: Field errors are announced
- **WHEN** a field-level error is returned
- **THEN** it is rendered adjacent to its input and associated with it for assistive technology

#### Scenario: An infrastructure failure preserves the owner's work
- **WHEN** a save fails for a reason other than validation
- **THEN** the submitted business name, bio, slug and social links are returned to the form rather than cleared

### Requirement: Image previews show the true rendered aspect ratio
The editor SHALL preview a selected image before it is saved, at the aspect ratio the public profile will use. No cropping or repositioning tool SHALL be provided in this change.

Without a crop tool the preview is the only place a mismatched image can be caught, so it must not flatter the result.

#### Scenario: A portrait image chosen as a cover
- **WHEN** a portrait photograph is selected for the cover slot
- **THEN** the preview renders it in the cover's aspect ratio, showing how it will actually appear

#### Scenario: Preview resources are released
- **WHEN** a preview is replaced or the editor unmounts
- **THEN** the object URL backing the preview is revoked

### Requirement: Navigational controls on this page render with their intended styling
Controls that navigate rather than submit SHALL render with the same visual treatment as their button counterparts, without a per-instance workaround.

`docs/tech-debt.md` T10 records a defect where a link styled as a button renders unreadably, worked around three times by moving the classes to an inner element. Its recorded trigger is this change, because this is the first page whose audience is the client rather than the owner. The investigation SHALL begin by re-verifying the symptom, since the tech-debt entry names the inspecting extension as a live explanation. If the symptom does not reproduce or the cause is not found within its time box, the outcome SHALL be recorded in `docs/tech-debt.md`; a fourth silent copy of the workaround is not an acceptable outcome.

#### Scenario: A link styled as a primary control
- **WHEN** the profile editor renders a navigational control with primary styling
- **THEN** its background and foreground both resolve, and it is legible without an inner-element workaround

#### Scenario: The time box expires
- **WHEN** the cause is not identified within the time box
- **THEN** the finding is recorded in the tech-debt entry rather than left undocumented
