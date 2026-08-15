# image-storage Specification

## Purpose
How profile and cover images reach Supabase Storage: validated by content rather than declaration, downscaled in the browser, written under a key derived only from server-held values, and authorized by the owner's own session rather than a privileged credential. Created by archiving change p1-owner-public-profile.

## Requirements

### Requirement: The upload path is proven on the deployment runtime before it is relied upon
A multipart upload through a Server Action SHALL be exercised against `opennextjs-cloudflare preview` — not `next dev` — and confirmed to arrive intact, before any upload user interface is built.

Request buffering on `workerd` under OpenNext is precisely the class of behaviour where this stack has already diverged from Node (`docs/s0-versions-decision.md`). If the check fails, the design changes to a signed upload URL and a direct browser-to-storage transfer, which is a different design; discovering that after the editor exists means discarding it.

#### Scenario: An upload arrives intact on the deployment runtime
- **WHEN** a representative image is uploaded through a Server Action running under the Cloudflare preview
- **THEN** the bytes received server-side match the bytes sent

#### Scenario: The check fails
- **WHEN** the upload does not survive the deployment runtime
- **THEN** implementation stops and the transfer mechanism is reconsidered before user interface work continues

### Requirement: The global Server Action body limit is not raised
`serverActions.bodySizeLimit` SHALL remain at its framework default. Images SHALL be made small enough on the client to fit it.

The setting is global. Raising it to admit a 5 MB photograph would equally admit a 5 MB body on `loginAction`, which is reachable unauthenticated and whose only defence against large-body abuse is that ceiling — `loginThrottle` counts attempts, not bytes. A branding feature SHALL NOT widen the authentication surface.

#### Scenario: Configuration review
- **WHEN** the change is complete
- **THEN** no Server Action body-size override has been introduced

#### Scenario: An oversized file reaches the client control
- **WHEN** the owner selects a file too large to transmit
- **THEN** it is reduced on the client before transmission, or refused there with an explanatory message — never sent and rejected by the framework

### Requirement: Images are downscaled and re-encoded in the browser before upload
The client SHALL reduce a selected image to at most a bounded dimension and target size before it is transmitted, by decoding it and re-encoding it to a supported type.

Re-encoding is what makes the payload small enough to fit the unchanged body limit, and it is also what discards embedded metadata. Both outcomes come from one operation, which is why neither is deferred.

#### Scenario: A phone photograph is reduced
- **WHEN** a multi-megabyte photograph is selected
- **THEN** the transmitted file is a re-encoded image within the target size, not the original bytes

#### Scenario: An image that cannot be decoded
- **WHEN** the selected file cannot be decoded as an image by the browser
- **THEN** it is refused on the client with an explanatory message and nothing is transmitted

### Requirement: Location metadata never reaches storage
No uploaded object SHALL carry the metadata embedded by the capturing device, including geographic coordinates.

Phone photographs record where they were taken. Publishing one to a public bucket publishes that location, and a photograph taken somewhere other than the shop discloses somewhere other than the shop.

#### Scenario: A photograph carrying coordinates
- **WHEN** an image containing embedded geographic metadata is selected
- **THEN** the object written to storage carries none of it

### Requirement: Image type is validated by content, not by declaration
The server SHALL accept only JPEG, PNG and WEBP, determined by inspecting the leading bytes of the received file. The client-declared content type and the file extension SHALL NOT be trusted as evidence of type, and SHALL NOT determine what is stored.

Both are client-controlled and prove nothing. SVG is excluded deliberately: an SVG served from a public bucket is a script-execution surface.

#### Scenario: A file whose bytes contradict its declaration
- **WHEN** a non-image file is uploaded declaring an image content type and an image extension
- **THEN** it is rejected before any object is written

#### Scenario: The stored content type comes from the bytes
- **WHEN** an image passes validation
- **THEN** the content type recorded on the stored object is the one determined by inspection

### Requirement: The server enforces the size bound independently of the client
The server SHALL reject an image exceeding the accepted size, regardless of any reduction performed by the client.

The client-side reduction is an ergonomic and payload measure. It runs in an environment the server does not control, so it is not a validation.

#### Scenario: An oversized file that bypassed the client
- **WHEN** an oversized image reaches the action without having been reduced
- **THEN** it is rejected with a distinct message and no object is written

### Requirement: The object key is derived only from server-held values
The storage key SHALL be composed of the authenticated user's identifier resolved from the session, a fixed role segment, a server-generated uniqueness component, and an extension derived from the inspected image type. No part of the key SHALL derive from the uploaded file's name or from any other client-supplied string.

The leading segment SHALL be the authentication user identifier rather than the domain owner identifier. They are distinct values, and only the former is what the bucket policy can compare against the session, which is what makes the prefix rule enforceable by the database.

Storage keys accept path separators, so a crafted filename that reached the key could write outside the owner's prefix — including into the private bucket that will hold transfer receipts. Every write SHALL land under the owner's prefix.

#### Scenario: A filename attempting to escape the prefix
- **WHEN** a valid image is uploaded under a filename containing path separators and parent-directory segments
- **THEN** the resulting key lies within the owner's prefix and no object is written elsewhere

#### Scenario: Replacement does not reuse a key
- **WHEN** an image is replaced
- **THEN** the new object is written under a key distinct from the previous one, so a cached copy cannot be served in its place

### Requirement: Uploads are authorized by the owner's session, not by a privileged credential
Uploads and deletions SHALL be performed server-side through the session-bound Supabase client the application already builds from the project URL and the anonymous key. Authorization SHALL come from an access policy on the bucket, granting the authenticated role insert, update and delete within it.

No service-role credential SHALL be introduced into the application's runtime environment, in any environment, for this feature. `scripts/provision-owner.ts` and `.env.example` already state that the service-role key must never be stored in `.env` or `.dev.vars` and is passed inline for one-off provisioning only. That rule holds because the key bypasses row-level security across the entire database; making it a standing credential of the Worker would turn any code-execution defect in the application into total database compromise.

#### Scenario: No new secret is required
- **WHEN** the change is complete
- **THEN** no service-role credential appears in `.env`, `.dev.vars`, `.env.example`, or the deployed Worker's secrets

#### Scenario: Client bundle review
- **WHEN** the client bundle is inspected
- **THEN** it contains no credential beyond the anonymous key the application already ships

#### Scenario: The session has expired
- **WHEN** an upload is attempted with an expired session
- **THEN** the write is refused, no object is stored, and the failure surfaces as an infrastructure error rather than succeeding under borrowed authority

### Requirement: The bucket policy confines a write to the owner's own prefix
The access policy SHALL restrict writes to keys whose leading path segment matches the authenticated user's identifier. The application SHALL compose keys with that identifier as their leading segment so that the confinement is enforced by the database rather than promised by application code.

This is the same preference the schema expresses everywhere else: a constraint the database owns outranks a check the application performs. It also means a defect in key composition is refused rather than written.

#### Scenario: A write inside the owner's prefix
- **WHEN** an authenticated upload targets a key whose leading segment is the session user's identifier
- **THEN** it is accepted

#### Scenario: A write outside the owner's prefix
- **WHEN** an upload targets a key whose leading segment is any other value
- **THEN** the database refuses it, independently of any application-side validation

#### Scenario: An anonymous write
- **WHEN** an unauthenticated request attempts to write to the bucket
- **THEN** it is refused

### Requirement: The public bucket holds only images meant to be public
Profile and cover images SHALL be written to a bucket whose objects are readable without authentication. Assets that are not meant to be public — transfer receipts above all — SHALL NOT be written to this bucket.

Public readability is chosen because these images are rendered to anonymous clients, where signing a URL on every render would be the wrong mechanism. That reasoning does not transfer to any asset with a different audience.

#### Scenario: A stored profile image is publicly readable
- **WHEN** a stored image URL is requested without credentials
- **THEN** the image is returned

#### Scenario: Bucket scope
- **WHEN** a future asset with a restricted audience needs storage
- **THEN** it uses a separate bucket rather than this one

### Requirement: Publication is not reversible on demand
The editor SHALL disclose that a published image may remain retrievable for a period after it is replaced or removed.

Public objects are cached by intermediaries. Deleting the object removes the source, not every copy, and an owner who uploads the wrong image deserves to know that before they upload rather than after.

#### Scenario: The disclosure is present
- **WHEN** the owner is offered an image upload control
- **THEN** copy states that a published image cannot be guaranteed to disappear immediately once replaced

### Requirement: Uploads occur before the transaction, and orphans are never fatal
An image SHALL be uploaded before the database transaction opens. If the transaction subsequently fails, the uploaded object SHALL be recorded in the log as unreferenced and left in place; the failure reported to the owner SHALL be the database failure.

Storage is not transactional and a network upload must not hold a transaction open. The consequence — an unreferenced object after a failed save — is accepted: reclaiming a few hundred kilobytes is not worth a save that fails because cleanup failed. There is no automatic reclamation of unreferenced objects in this change.

#### Scenario: The database write fails after a successful upload
- **WHEN** the transaction fails after an image has been uploaded
- **THEN** no profile change is persisted, the unreferenced key is logged, and the owner sees the database failure

#### Scenario: A retried save
- **WHEN** the owner retries after such a failure
- **THEN** the retry succeeds and the earlier unreferenced object is not required to have been removed

### Requirement: Replacing an image deletes its predecessor on a best-effort basis
After a save that replaces a stored image, the previously referenced object SHALL be deleted. A failure to delete SHALL be logged and SHALL NOT fail the save.

A deletion SHALL be treated as successful only when the provider reports that an object was actually removed. The absence of a reported error SHALL NOT be taken as evidence of removal.

The access policy SHALL grant the authenticated role permission to read objects in the bucket, confined to the same prefix as the write permissions. This is a precondition for deletion, not a separate capability: the provider looks an object up before removing it, and without read permission that lookup matches nothing, so the delete removes nothing and reports success.

#### Scenario: A successful replacement
- **WHEN** a stored image is replaced and the save commits
- **THEN** the previously referenced object is deleted, and the provider reports it as removed

#### Scenario: A deletion that matches nothing
- **WHEN** a deletion reports no error but removes no object
- **THEN** it is treated as a failure, logged, and the save is still reported as successful

#### Scenario: Deletion fails
- **WHEN** the deletion of the previous object fails
- **THEN** the save is still reported as successful and the failure is logged

#### Scenario: The delete path is proven end to end
- **WHEN** the storage gate deletes an object it created
- **THEN** the object is confirmed absent from storage, rather than inferred absent from its URL no longer resolving

### Requirement: Storage failures are reported distinctly and logged without business data
A storage failure SHALL be surfaced to the owner as an infrastructure failure, distinguishable from a validation failure. Log entries SHALL carry the operation name, the failure cause and the object key, and SHALL NOT carry submitted business data.

This follows the constraint-diagnostics rule already established for database failures: driver and provider messages embed submitted values, which puts business data in the log stream and lets crafted input forge structured log fields.

#### Scenario: The storage provider is unavailable
- **WHEN** the storage provider returns a server error
- **THEN** the owner sees an infrastructure error distinct from any field-level message, and the entry logged carries no submitted business data
