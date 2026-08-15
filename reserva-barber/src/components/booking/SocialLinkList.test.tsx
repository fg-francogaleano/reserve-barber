import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SocialLinkList, isRenderableUrl } from './SocialLinkList';
import { SocialLink } from '@/server/domain/models/BusinessProfile';
import { COPY } from '@/lib/copy';

describe('isRenderableUrl', () => {
  it.each(['https://instagram.com/a', 'http://ejemplo.com.ar'])(
    'should_accept_%s',
    (url) => {
      expect(isRenderableUrl(url)).toBe(true);
    }
  );

  // P1 refuses these on the way in. The check is repeated here because this
  // page is what that validation was protecting, and a future write path that
  // skips the validator would otherwise turn a stored value into script.
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ])('should_refuse_%s', (url) => {
    expect(isRenderableUrl(url)).toBe(false);
  });

  it.each(['not a url', '', 'http://', '//instagram.com/a'])(
    'should_refuse_the_unparseable_value_%s',
    (url) => {
      expect(isRenderableUrl(url)).toBe(false);
    }
  );
});

describe('SocialLinkList', () => {
  it('should_render_nothing_when_the_set_is_empty', () => {
    const { container } = render(<SocialLinkList links={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('should_render_nothing_when_every_stored_url_is_unrenderable', () => {
    // Not an empty section with a heading: a client would read that as
    // something having failed to load.
    const { container } = render(
      <SocialLinkList links={[new SocialLink('INSTAGRAM', 'javascript:alert(1)', 0)]} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('should_drop_only_the_unrenderable_link_and_keep_the_rest', () => {
    render(
      <SocialLinkList
        links={[
          new SocialLink('INSTAGRAM', 'javascript:alert(1)', 0),
          new SocialLink('WHATSAPP', 'https://wa.me/5491100000000', 1),
        ]}
      />
    );

    expect(screen.queryByRole('link', { name: 'Instagram' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
  });

  it('should_label_each_platform_for_a_reader_rather_than_naming_the_enum', () => {
    render(<SocialLinkList links={[new SocialLink('TIKTOK', 'https://tiktok.com/@a', 0)]} />);

    expect(screen.getByRole('link', { name: 'TikTok' })).toBeInTheDocument();
    expect(screen.queryByText('TIKTOK')).not.toBeInTheDocument();
  });

  it('should_head_the_section_with_the_public_copy', () => {
    render(<SocialLinkList links={[new SocialLink('X', 'https://x.com/a', 0)]} />);

    expect(screen.getByText(COPY.publicProfile.socialHeading)).toBeInTheDocument();
  });
});
