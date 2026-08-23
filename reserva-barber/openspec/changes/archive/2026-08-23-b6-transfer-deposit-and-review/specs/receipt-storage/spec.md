## ADDED Requirements

### Requirement: Receipts live in a private bucket that no anonymous read can reach

Transfer receipts SHALL be stored in a bucket that is **not** public. The reasoning that made the profile bucket public — that its images are rendered to unauthenticated clients on every page view — does not extend to a document holding a client's bank details.

The bucket SHALL declare its own size limit and its own allowed MIME types, and those SHALL agree with what the application enforces.

The anonymous role SHALL have no `select`, no `update` and no `delete` on this bucket. An object SHALL NOT be reachable without a signature.

#### Scenario: An anonymous request cannot read an object
- **WHEN** an anonymous client requests a stored receipt object without a signature
- **THEN** the request is refused

#### Scenario: An anonymous caller cannot enumerate the bucket
- **WHEN** an anonymous client lists the bucket
- **THEN** nothing is returned

#### Scenario: An anonymous caller cannot delete
- **WHEN** an anonymous client attempts to delete a stored object
- **THEN** the deletion is refused and the object remains

### Requirement: The anonymous write is authorized by the database, not only by the application

The insert policy SHALL admit the anonymous role **only** through a predicate that resolves the object path against the booking data: the path's second segment SHALL name a real `Booking` whose hold is live, and the path's first segment SHALL equal that booking's owner's Supabase auth user id.

The predicate SHALL be implemented as a `SECURITY DEFINER` function with a pinned `search_path`, so the check can read the application's tables without granting the anonymous role any privilege on them.

An unconditional insert grant SHALL NOT be used. The key that authorizes it is designed to be published, and a policy that admits every caller reads as protection while protecting nothing.

#### Scenario: A path naming no booking is refused
- **WHEN** an insert is attempted as the anonymous role at a path whose booking segment matches no `Booking`
- **THEN** the insert is refused by the database

#### Scenario: A path naming the wrong owner is refused
- **WHEN** an insert is attempted as the anonymous role at a path whose first segment is not the booking owner's auth user id
- **THEN** the insert is refused by the database

#### Scenario: A path naming a booking with no live hold is refused
- **WHEN** an insert is attempted as the anonymous role for a booking that is `CANCELLED`
- **THEN** the insert is refused by the database

#### Scenario: A legitimate upload is admitted
- **WHEN** the application inserts at a path naming a real booking with a live hold under its real owner
- **THEN** the insert succeeds

### Requirement: The bucket and its policies are reproducible from the repository

The bucket, the predicate function and the three policies SHALL be committed as SQL in the change directory and applied as a Supabase migration, not created only through the dashboard.

The SQL SHALL be idempotent and safe to re-run.

The SQL SHALL name, in comments, the application columns the predicate depends on, because these objects live in a schema the ORM does not track and a rename there is never reported as drift.

#### Scenario: The infrastructure can be rebuilt from the repository
- **WHEN** the committed SQL is applied to a project that does not yet have the bucket
- **THEN** the bucket, the function and the policies exist afterwards

#### Scenario: Re-running changes nothing
- **WHEN** the committed SQL is applied again to a project that already has it
- **THEN** it succeeds and the resulting configuration is unchanged

### Requirement: A select policy exists for the owner, and its absence would break deletion silently

The bucket SHALL carry a `select` policy for the authenticated role confined to the caller's own prefix.

It is also what makes the owner-scoped `delete` policy usable at all: the storage service looks an object up before removing it, so with no `select` policy the lookup finds nothing, the delete removes nothing, and the API reports **no error** — P1's probe F measured exactly this. B6 itself performs no deletion (a superseded object is a bounded orphan, because the anonymous uploader must never hold a delete grant), so the `delete` policy exists for the retention rule that will follow rather than for any path shipping here.

#### Scenario: An owner reads only their own prefix
- **WHEN** an owner's session lists objects under another owner's prefix
- **THEN** nothing is returned

#### Scenario: An owner-scoped delete is possible and confined
- **WHEN** an owner's session deletes an object under their own prefix, and separately attempts one under another owner's
- **THEN** the first succeeds and the second is refused

### Requirement: The object key is derived only from server-held values

The key SHALL be composed of the owner's Supabase auth user id, the booking id, and the upload instant, with an extension derived from the **detected** file type.

No part of the key SHALL derive from the uploaded file's name. Storage keys accept path separators, so a filename reaching the key is a traversal primitive aimed at exactly this bucket.

The leading segment SHALL be the Supabase auth user id and not the application's own owner id — they are distinct values, and only the former is what the policy can compare against the session.

#### Scenario: A hostile filename contributes nothing
- **WHEN** a file named `../../other-owner/x.jpg` is uploaded
- **THEN** the stored key contains no part of that name and remains inside the owner's prefix

#### Scenario: The extension follows the detection
- **WHEN** a file declared `image/png` is detected as JPEG
- **THEN** the stored key ends in the JPEG extension

### Requirement: The receipt storage contract is separate from the image storage contract

Receipt storage SHALL be expressed as its own interface with its own content-type union, alongside the existing image storage contract rather than by widening it.

Widening the existing union would permit a profile-only type into the receipt bucket and a receipt-only type into the public bucket, in both cases silently, and the two contracts differ in audience, bucket visibility, authorization and accepted types.

#### Scenario: The unions do not overlap into each other's buckets
- **WHEN** the two storage contracts are reviewed
- **THEN** neither accepts a content type the other's bucket forbids

### Requirement: A failed upload is never mistaken for a successful one

The adapter SHALL treat a failure reported in the response payload as a failure, not only a rejected promise, because the storage client reports refusals in the payload.

An upload that returns neither data nor an error SHALL be treated as a failure.

Keys carry an instant, so a collision indicates a defect: the adapter SHALL NOT overwrite on upload.

#### Scenario: A refused upload is not persisted as a path
- **WHEN** the storage service refuses an upload and reports it in the payload
- **THEN** the adapter raises, no `filePath` is persisted, and no row points at a non-existent object

#### Scenario: A collision fails loudly
- **WHEN** an upload targets a key that already exists
- **THEN** the upload fails rather than replacing the existing object

### Requirement: The storage path is proven on the deployment runtime before it is relied upon

The bucket's behaviour SHALL be verified from both sides against real infrastructure before the change is archived: that the anonymous role can insert only where the predicate admits it, that it cannot read, list or delete, and that an owner's signed read cannot reach another owner's prefix.

#### Scenario: The policy is exercised as the anonymous role
- **WHEN** the gate script runs against the live project
- **THEN** an insert with a non-existent booking id is refused, a legitimate insert succeeds, and the anonymous role's read, list and delete attempts all fail
