## ADDED Requirements

### Requirement: The shareable link is displayed as live
After a slug is saved the editor SHALL display the full public link, `{origin}/b/{slug}`, with a control that copies it. The origin SHALL be resolved server-side; it SHALL NOT be read from `window.location` in a component that also renders on the server.

The link now resolves. Copy stating or implying that it does not yet work SHALL NOT remain anywhere in the editor.

The editor SHALL continue to warn, at the moment the slug is changed away from its stored value, that links already shared will stop working. That warning is now the mitigation for a live failure rather than a theoretical one: until this change no shared link could resolve, so none could usefully have been shared, and `docs/tech-debt.md` T33 recorded the cost as zero. It stops being zero here.

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

## REMOVED Requirements

### Requirement: The shareable link is displayed and disclosed as not yet published
**Reason**: Its stated justification — "`/b/**` is denied to anonymous visitors until B1 opens it, so an owner who shares the link today sends clients to a login page" — expires with this change. B1 opens `/b/**`, so the disclosure became false the moment this change deployed. Leaving a requirement whose reasoning no longer holds is worse than leaving none: the next story would read it as still-considered fact.

**Migration**: Replaced by "The shareable link is displayed as live", which keeps every scenario about server-resolved origin and clipboard behaviour unchanged and drops only the unpublished disclosure. The corresponding copy is removed from `src/lib/copy.ts` and from the editor in the same change.
