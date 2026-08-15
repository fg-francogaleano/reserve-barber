import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileHeader, initialsFrom } from './ProfileHeader';

describe('initialsFrom', () => {
  it('should_take_one_letter_from_each_of_the_first_two_words', () => {
    expect(initialsFrom('Barbería Don Juan')).toBe('BD');
  });

  it('should_take_a_single_letter_from_a_one_word_name', () => {
    expect(initialsFrom('Barbería')).toBe('B');
  });

  it('should_uppercase_a_lowercase_name', () => {
    expect(initialsFrom('barbería don juan')).toBe('BD');
  });

  it('should_ignore_surrounding_and_repeated_whitespace', () => {
    expect(initialsFrom('   Don    Juan   ')).toBe('DJ');
  });

  it('should_keep_a_whole_emoji_rather_than_half_a_surrogate_pair', () => {
    // An emoji in a shop name is not exotic, and `charAt` would return a lone
    // surrogate that renders as a replacement character.
    expect(initialsFrom('💈 Barbería')).toBe('💈B');
  });

  it('should_return_nothing_for_a_name_that_is_only_whitespace', () => {
    expect(initialsFrom('   ')).toBe('');
  });
});

describe('ProfileHeader', () => {
  it('should_render_the_cover_image_when_present', () => {
    render(
      <ProfileHeader
        businessName="Barbería Don Juan"
        photoUrl={null}
        coverUrl="https://storage.example/cover.webp"
      />
    );

    expect(screen.getByRole('img', { name: /Portada de Barbería Don Juan/ })).toBeInTheDocument();
  });

  it('should_reserve_the_cover_band_even_with_no_cover_image', () => {
    // The band keeps its height so the page does not reflow, and the avatar
    // does not slide up over the name.
    const { container } = render(
      <ProfileHeader businessName="Barbería Don Juan" photoUrl={null} coverUrl={null} />
    );

    const band = container.querySelector('.aspect-\\[3\\/1\\]');
    expect(band).not.toBeNull();
    expect(band?.querySelector('img')).toBeNull();
  });

  it('should_give_the_photo_explicit_dimensions_so_its_space_is_reserved', () => {
    render(
      <ProfileHeader
        businessName="Barbería Don Juan"
        photoUrl="https://storage.example/photo.webp"
        coverUrl={null}
      />
    );

    const photo = screen.getByRole('img', { name: /Foto de Barbería Don Juan/ });
    expect(photo).toHaveAttribute('width', '96');
    expect(photo).toHaveAttribute('height', '96');
  });

  it('should_stack_the_avatar_above_the_cover_band', () => {
    // Reported as "the cover covers the profile picture". The avatar is pulled
    // up with `-mt-12` to overlap the band, but overlap alone does not decide
    // what paints on top: a positioned element paints above static ones
    // regardless of DOM order, so the cover — which carried a `relative` that
    // positioned nothing — buried the top half of the avatar.
    const { container } = render(
      <ProfileHeader
        businessName="Barbería Don Juan"
        photoUrl="https://storage.example/photo.webp"
        coverUrl="https://storage.example/cover.webp"
      />
    );

    const band = container.querySelector('[class*="aspect-"]')!;
    const avatarRow = container.querySelector('[class*="-mt-12"]')!.parentElement!;

    expect(band.className).not.toContain('relative');
    expect(avatarRow.className).toContain('relative');
    expect(avatarRow.className).toContain('z-10');
  });

  it('should_show_initials_instead_of_a_broken_image_when_there_is_no_photo', () => {
    render(<ProfileHeader businessName="Barbería Don Juan" photoUrl={null} coverUrl={null} />);

    expect(screen.getByText('BD')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('should_constrain_and_wrap_a_long_unbroken_name', () => {
    // Both classes, and `w-full` is the one that actually matters. jsdom does
    // not compute layout, so this asserts the fix rather than the symptom: the
    // heading is a flex item under `items-center`, and without an explicit
    // width it sizes to its content and grows past the container — measured in
    // a real browser at 120 characters, the page scrolled to 2014px inside a
    // 1366px viewport with `break-words` already present. T18 is the same
    // overflow reaching production once before, on the barbers list.
    render(<ProfileHeader businessName={'A'.repeat(120)} photoUrl={null} coverUrl={null} />);

    const heading = screen.getByRole('heading');
    expect(heading).toHaveClass('break-words');
    expect(heading).toHaveClass('w-full');
  });
});
